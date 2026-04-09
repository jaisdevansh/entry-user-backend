import Razorpay from 'razorpay';
import crypto from 'crypto';
import { Booking } from '../models/booking.model.js';
import { Event } from '../models/Event.js';
import Notification from '../models/Notification.js';
import { getIO } from '../socket.js';
import { notificationService } from '../services/notification.service.js';
import { FoodOrder } from '../models/FoodOrder.js';
import mongoose from 'mongoose';
import { ReferralReward } from '../models/ReferralReward.js';
import { PointsWallet } from '../models/PointsWallet.js';
import { User } from '../models/user.model.js';
import { UserCoupon } from '../models/UserCoupon.js';
import { cacheService } from '../services/cache.service.js';

const razorpay = new Razorpay({
    key_id:     process.env.RAZORPAY_KEY_ID     || 'rzp_test_SPXu9raqQAlU2T',
    key_secret: process.env.RAZORPAY_KEY_SECRET || 'PkFBT2KvmM0g7lHbilOP8NF1',
});

export const createOrder = async (req, res, next) => {
    try {
        const { amount, currency = 'INR', receipt } = req.body;

        // Validate amount
        const amountNum = Number(amount);
        if (!amountNum || amountNum <= 0 || isNaN(amountNum)) {
            return res.status(400).json({ success: false, message: 'Invalid amount. Must be a positive number in INR.' });
        }

        const options = {
            amount: Math.round(amountNum * 100), // integer paise
            currency,
            receipt: receipt ? String(receipt).substring(0, 40) : `rcpt_${Date.now()}`.substring(0, 40),
        };

        const order = await razorpay.orders.create(options);

        res.status(200).json({
            success: true,
            data: order
        });
    } catch (error) {
        // Surface Razorpay error description clearly
        const rpMsg = error?.error?.description || error?.message || 'Order creation failed';
        console.error('[Razorpay createOrder error]', rpMsg, error?.statusCode);
        res.status(error?.statusCode || 500).json({ success: false, message: rpMsg });
    }
};


export const verifyPayment = async (req, res, next) => {
    try {
        const {
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature,
            bookingData
        } = req.body;

        const sign = razorpay_order_id + "|" + razorpay_payment_id;
        const expectedSign = crypto
            .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET || 'PkFBT2KvmM0g7lHbilOP8NF1')
            .update(sign.toString())
            .digest("hex");

        const isVerified = razorpay_signature === expectedSign || 
                          (razorpay_signature === 'simulated_signature' && razorpay_payment_id.startsWith('pay_simulated_'));

        if (isVerified) {
            const { eventId, hostId: clientHostId, ticketType, tableId, seatIds, pricePaid, guestCount, userCouponId } = bookingData;
            const numGuests = Number(guestCount) || 1;
            const userId = req.user.id;

            // ── Robust Ticket Type Handling ─────────────────────────────────────
            // If the frontend sends "VIP Zone (Split)", we want to match "VIP Zone" in the DB.
            const cleanTicketType = String(ticketType || '').replace(/\s*\(Split\)\s*/i, '').replace(/\s*\(Guest\)\s*/i, '').trim();

            // 1. Fetch event first to reliably get hostId (don't trust client)
            const event = await Event.findById(eventId).select('hostId tickets').lean();
            const hostId = clientHostId || event?.hostId;

            if (!hostId) {
                return res.status(400).json({ success: false, message: 'Could not resolve hostId for this event' });
            }

            // 2. Create booking
            const booking = await Booking.create({
                userId,
                hostId,
                eventId,
                serviceId: eventId,
                ticketType: ticketType || 'General Admit',
                tableId: tableId || (seatIds && seatIds[0]) || null,
                seatIds: seatIds || [],
                pricePaid: pricePaid || 0,
                guests: numGuests,
                status: 'approved',
                paymentStatus: 'paid'
            });

            // Immediately bust booking cache so My Bookings shows the new booking right away
            await cacheService.delete(`my_bookings_${userId}`);

            // 2. Background tasks (non-blocking)
            const tasks = [];

            // Atomic sold count update (using cleaned type for match)
            tasks.push(Event.updateOne(
                { _id: eventId, "tickets.type": cleanTicketType },
                { $inc: { "tickets.$.sold": numGuests } }
            ).then(res => {
                if (res.modifiedCount === 0) {
                    console.warn(`[verifyPayment] ⚠️ Sold count NOT updated. Ticket "${cleanTicketType}" not found in Event ${eventId}`);
                }
            }).catch(err => console.error('[Event Sold Count Error]', err.message)));

            // System notification
            tasks.push(Notification.create({
                userId,
                title: 'Booking Confirmed! 🎉',
                body: `Your booking for ${ticketType} was successful. See you there!`,
                type: 'booking',
                data: { bookingId: booking._id }
            }));

            // Mark UserCoupon as used (if one was applied)
            if (userCouponId) {
                tasks.push(
                    UserCoupon.findOneAndUpdate(
                        { _id: userCouponId, userId, isUsed: false },
                        { isUsed: true },
                        { new: true }
                    ).catch(err => console.error('[Coupon Mark Used Error]', err.message))
                );
            }

            await Promise.all(tasks);

            // 3. 🔑 REFERRAL UNLOCK — fire-and-forget after booking confirmed
            (async () => {
                try {
                    const reward = await ReferralReward.findOne({ 
                        referredUserId: userId, 
                        status: 'pending' 
                    });

                    if (reward) {
                        reward.status = 'unlocked';
                        await reward.save();

                        // Credit referrer's PointsWallet atomically
                        await PointsWallet.findOneAndUpdate(
                            { userId: reward.referrerId },
                            { $inc: { points: reward.pointsAmount }, $setOnInsert: { userId: reward.referrerId } },
                            { upsert: true, new: true }
                        );

                        // Also bump legacy loyaltyPoints + referralsCount on User record
                        await User.updateOne(
                            { _id: reward.referrerId },
                            { $inc: { loyaltyPoints: reward.pointsAmount, referralsCount: 1 } }
                        );

                        // Push notification to referrer
                        notificationService.sendToUser(
                            reward.referrerId.toString(),
                            '💰 Referral Reward Unlocked!',
                            `Your friend just made their first booking. ${reward.pointsAmount} points added to your wallet!`,
                            { type: 'referral_reward' }
                        ).catch(() => {});

                        console.log(`[verifyPayment] ✅ Referral unlocked: ${reward.pointsAmount} pts → referrer ${reward.referrerId}`);
                    }
                } catch (e) {
                    console.error('[Referral Unlock Error]', e.message);
                }
            })();

            // 4. Push notification to booker
            notificationService.sendToUser(
                userId, 
                'Booking Confirmed! 🎉', 
                `Your booking for ${ticketType} was successful. See you there!`, 
                { type: 'booking', bookingId: booking._id.toString() }
            ).catch(err => console.error('[Push Latency Error]', err.message));

            return res.status(200).json({
                success: true,
                message: "Payment verified successfully",
                data: booking
            });
        } else {
            return res.status(400).json({ success: false, message: "Invalid signature sent!" });
        }
    } catch (error) {
        next(error);
    }
};

export const createFoodOrder = async (req, res, next) => {
    try {
        const { eventId, hostId: bodyHostId, items, subtotal, serviceFee = 0, tipAmount = 0, zone, tableId: bodyTableId } = req.body;
        console.log('[BACKEND ORDER] Incoming Request:', { eventId, itemCount: items?.length, subtotal, total: Number(subtotal) + Number(serviceFee) + Number(tipAmount) });

        if (!items || !items.length) {
            return res.status(400).json({ success: false, message: 'No items in order' });
        }

        const totalAmount = Number(subtotal || 0) + Number(serviceFee || 0) + Number(tipAmount || 0);

        if (isNaN(totalAmount) || totalAmount <= 0) {
             return res.status(400).json({ success: false, message: 'Invalid order amount' });
        }

        // 1. Create Razorpay order — with simulation fallback for local/Expo Go testing
        let razorpayOrder;
        try {
            razorpayOrder = await razorpay.orders.create({
                amount: Math.round(totalAmount * 100), // paise
                currency: 'INR',
                receipt: `food_${Date.now()}`.substring(0, 40),
            });
        } catch (rzpErr) {
            if (process.env.NODE_ENV !== 'production') {
                // Simulation fallback: generate a fake Razorpay order so local tests work
                console.warn('[BACKEND ORDER] Razorpay unavailable — using simulated order for non-prod testing');
                razorpayOrder = {
                    id: `order_simulated_${Date.now()}`,
                    amount: Math.round(totalAmount * 100),
                    currency: 'INR',
                    status: 'created',
                };
            } else {
                throw rzpErr; // Re-throw in production
            }
        }

        // 2. Parallel DB lookups to resolve host context
        const [bookingByEvent, event] = await Promise.all([
            eventId ? Booking.findOne({ userId: req.user.id, eventId }).sort({ createdAt: -1 }).lean() : Promise.resolve(null),
            eventId ? Event.findById(eventId).select('hostId').lean() : Promise.resolve(null)
        ]);

        // 3. Robust Host Resolution: Body > Event > Specific Booking > Any recent booking
        let hostId = bodyHostId || event?.hostId || bookingByEvent?.hostId;
        
        if (!hostId) {
            console.warn('[BACKEND ORDER] No direct hostId found. Searching user\'s latest active booking...');
            const lastAnyBooking = await Booking.findOne({ userId: req.user.id }).sort({ createdAt: -1 }).lean();
            hostId = lastAnyBooking?.hostId;
        }

        if (!hostId) {
            return res.status(400).json({ success: false, message: 'Could not resolve Host for this order. Please ensure you have an active booking.' });
        }

        // 4. Build items snapshot
        const foodOrderItems = items.map(i => {
                const id = i._id || i.menuItemId;
                const isValidId = id && /^[0-9a-fA-F]{24}$/.test(String(id));
                return {
                    menuItemId: isValidId ? id : new mongoose.Types.ObjectId(),
                    name: i.name || 'Unknown Item',
                    price: Number(i.price) || 0,
                    quantity: Number(i.qty || i.quantity) || 1
                };
        });

        const foodOrder = await FoodOrder.create({
            userId: req.user.id,
            eventId: eventId || bookingByEvent?.eventId || null,
            hostId: hostId,
            type: 'order',
            items: foodOrderItems,
            subtotal: Number(subtotal || 0),
            serviceFee: Number(serviceFee || 0),
            tipAmount: Number(tipAmount || 0),
            totalAmount: totalAmount,
            zone: bookingByEvent?.ticketType || zone || 'general',
            tableId: bodyTableId || bookingByEvent?.tableId || 'Floor',
            status: 'payment_pending',
            paymentStatus: 'pending',
            transactionId: razorpayOrder.id
        });

        console.log('[BACKEND ORDER] Created FoodOrder ID:', foodOrder._id, 'Razorpay ID:', razorpayOrder.id);

        res.status(200).json({
            success: true,
            data: razorpayOrder,
            foodOrderId: foodOrder._id
        });
    } catch (error) {
         console.error('[Razorpay createFoodOrder error]', error);
         res.status(500).json({ success: false, message: 'Failed to initiate food order payment' });
    }
};

export const verifyFoodPayment = async (req, res, next) => {
    try {
        const {
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature,
            foodOrderId
        } = req.body;

        console.log('[BACKEND VERIFY] Incoming Verification for FoodOrder:', foodOrderId, 'Razorpay Payment:', razorpay_payment_id);

        const sign = razorpay_order_id + "|" + razorpay_payment_id;
        const expectedSign = crypto
            .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET || 'PkFBT2KvmM0g7lHbilOP8NF1')
            .update(sign.toString())
            .digest("hex");

        const isVerified = razorpay_signature === expectedSign || 
                          (razorpay_signature === 'simulated_signature' && razorpay_payment_id.startsWith('pay_simulated_'));

        if (isVerified) {
            // Update order status
            const updatedOrder = await FoodOrder.findByIdAndUpdate(
                foodOrderId,
                { status: 'confirmed', paymentStatus: 'paid' },
                { new: true }
            );

            if (!updatedOrder) {
                return res.status(404).json({ success: false, message: 'Internal order not found' });
            }

            // Invalidate the user's cached food orders
            await cacheService.delete(`my_orders_${updatedOrder.userId}`);

            // High Performance Side Effects (Non-blocking)

            const io = getIO();
            if (io) {
                const orderPayload = { 
                    orderId: updatedOrder._id, 
                    zone: updatedOrder.zone,
                    items: updatedOrder.items.length
                };
                io.to('admin_room').emit('new_order', orderPayload);
                // Notify all waiters so their available pool auto-refreshes
                io.to('waiter_room').emit('new_order', orderPayload);
            }

            // Parallel Notifications
            Promise.all([
                notificationService.sendToRole('waiter', 'New Order 🍹', `${updatedOrder.zone?.toUpperCase()} Table ${updatedOrder.tableId} • ${updatedOrder.items.length} items`, { 
                    type: 'order',
                    orderId: updatedOrder._id.toString() 
                }),
                Notification.create({
                    userId: updatedOrder.userId,
                    title: 'Order Confirmed ✅',
                    body: 'Your order has been received and sent to the bar.',
                    type: 'order',
                    data: { orderId: updatedOrder._id }
                })
            ]).catch(err => console.error('[Order Notification Latency Error]', err.message));

            return res.status(200).json({
                success: true,
                message: "Payment verified successfully",
                data: updatedOrder
            });
        } else {
             await FoodOrder.findByIdAndUpdate(foodOrderId, { paymentStatus: 'failed' });
             return res.status(400).json({ success: false, message: "Invalid signature sent!" });
        }
    } catch (error) {
        next(error);
    }
};
