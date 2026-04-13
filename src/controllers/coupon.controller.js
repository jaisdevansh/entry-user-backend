import mongoose from 'mongoose';
import { Coupon } from '../models/Coupon.js';
import { UserCoupon } from '../models/UserCoupon.js';
import { PointsWallet } from '../models/PointsWallet.js';

export const getAvailableCoupons = async (req, res) => {
    try {
        const now = new Date();

        // One-time fix: mark coupons with missing isActive field as active
        await Coupon.updateMany(
            { isActive: { $exists: false } },
            { $set: { isActive: true } }
        );

        // Lazy expiry: bulk-mark expired coupons as inactive in DB
        const expired = await Coupon.updateMany(
            {
                isActive: { $ne: false },
                expiryDate: { $lt: now, $exists: true, $ne: null }
            },
            { $set: { isActive: false } }
        );
        if (expired.modifiedCount > 0) {
            console.log(`[Coupons] Auto-expired ${expired.modifiedCount} coupon(s)`);
        }

        // Return all coupons so frontend can show SOLD OUT / INACTIVE states
        const coupons = await Coupon.find()
            .populate({
                path: 'hostId',
                select: 'name businessName profileImage logo'
            })
            .sort({ isActive: -1, pointsCost: 1 }) // active first
            .lean();

        // Add computed status flags
        // Use === false so old docs without the field default to active (undefined !== false)
        const enriched = coupons.map(c => ({
            ...c,
            isSoldOut: c.usageLimit > 0 && (c.usedCount ?? 0) >= c.usageLimit,
            isInactive: c.isActive === false,
            isExpired: c.expiryDate ? new Date(c.expiryDate) < now : false,
        }));

        res.status(200).json({ success: true, data: enriched });
    } catch (error) {
        console.error('getAvailableCoupons Error:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

export const getUserCoupons = async (req, res) => {
    try {
        const userCoupons = await UserCoupon.find({ 
            userId: req.user.id, 
            isUsed: false, 
            expiresAt: { $gt: new Date() } 
        })
        .populate({
            path: 'couponId',
            select: 'title code discountType discountValue minPurchase applicableOn',
            populate: {
                path: 'hostId',
                select: 'name businessName profileImage logo'
            }
        })
        .sort({ createdAt: -1 }) // Show latest first
        .lean();

        console.log(`[getUserCoupons] Total for user ${req.user.id}: ${userCoupons.length}`);

        res.status(200).json({ 
            success: true, 
            data: userCoupons 
        });
    } catch (error) {
        console.error('[getUserCoupons] Error:', error);
        res.status(500).json({ success: false, message: 'Server error loading coupons' });
    }
};

export const buyCoupon = async (req, res, next) => {
    try {
        const { couponId } = req.body;
        const userId = req.user.id;

        console.log(`[buyCoupon] User: ${userId} trying to buy: ${couponId}`);

        // 1. Fetch Coupon
        const coupon = await Coupon.findById(couponId);
        if (!coupon || !coupon.isActive) {
            return res.status(404).json({ success: false, message: 'Coupon no longer available.' });
        }

        // 2. One-per-user check — block if user already owns an active copy
        const alreadyOwned = await UserCoupon.findOne({
            userId,
            couponId: coupon._id,
            isUsed: false,
            expiresAt: { $gt: new Date() }
        });
        if (alreadyOwned) {
            return res.status(400).json({ 
                success: false, 
                message: 'You already have this coupon in your wallet. Use it first!' 
            });
        }

        const pointsCost = Math.max(0, Number(coupon.pointsCost) || 0);

        // 3. Fetch/Create Wallet (Atomically)
        const wallet = await PointsWallet.findOneAndUpdate(
            { userId },
            { $setOnInsert: { points: 0 } },
            { upsert: true, new: true }
        );

        // 4. Balance Check
        if (wallet.points < pointsCost) {
            return res.status(400).json({ success: false, message: 'You need more points to buy this.' });
        }

        // 4. ATOMIC POINT DEDUCTION (Highly Robust)
        const debitSuccess = await PointsWallet.findOneAndUpdate(
            { userId, points: { $gte: pointsCost } },
            { $inc: { points: -pointsCost } },
            { new: true }
        );

        if (!debitSuccess) {
            return res.status(400).json({ success: false, message: 'Purchase failed. Insufficient points balance.' });
        }

        // 5. Grant Coupon
        let expiryDate = coupon.expiryDate;
        if (!expiryDate) {
            expiryDate = new Date();
            expiryDate.setDate(expiryDate.getDate() + (coupon.expiryDays || 30));
        }

        const userCoupon = await UserCoupon.create({
            userId,
            couponId: coupon._id,
            expiresAt: expiryDate
        });

        // 6. Update Usage Stats
        await Coupon.findByIdAndUpdate(couponId, { $inc: { usedCount: 1 } });

        console.log(`[buyCoupon] ✅ Success: ${userCoupon._id}`);

        res.status(200).json({
            success: true,
            message: `Redeemed: ${coupon.title}!`,
            data: userCoupon
        });

    } catch (error) {
        console.error('[buyCoupon] Internal Failure:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Internal purchase error. Please try again later.' 
        });
    }
};

export const applyCoupon = async (req, res) => {
    try {
        const { userCouponId, orderType, subtotal, eventId, hostId } = req.body;
        const userId = req.user.id;

        console.log('[applyCoupon] Request:', { userCouponId, orderType, subtotal, eventId, hostId });

        const userCoupon = await UserCoupon.findOne({ _id: userCouponId, userId, isUsed: false, expiresAt: { $gt: new Date() } })
            .populate('couponId');

        if (!userCoupon) {
            return res.status(400).json({ success: false, message: 'Invalid or expired coupon' });
        }

        const coupon = userCoupon.couponId;
        console.log('[applyCoupon] Coupon hostId:', coupon.hostId);
        
        // ✅ HOST-SPECIFIC COUPON VALIDATION
        if (coupon.hostId) {
            let eventHostId = hostId;
            
            // If hostId not provided directly, fetch from event
            if (!eventHostId && eventId) {
                const Event = (await import('../models/Event.js')).default;
                const event = await Event.findById(eventId).select('hostId');
                
                if (!event) {
                    return res.status(400).json({ success: false, message: 'Invalid event' });
                }
                eventHostId = event.hostId.toString();
            }
            
            console.log('[applyCoupon] Comparing - Coupon hostId:', coupon.hostId.toString(), 'Event hostId:', eventHostId);
            
            // Check if event's hostId matches coupon's hostId
            if (!eventHostId || eventHostId.toString() !== coupon.hostId.toString()) {
                console.log('[applyCoupon] ❌ Host mismatch - Rejecting coupon');
                return res.status(400).json({ 
                    success: false, 
                    message: `This coupon is only valid for events by ${coupon.hostId?.name || coupon.hostId?.businessName || 'this host'}` 
                });
            }
            
            console.log('[applyCoupon] ✅ Host match - Coupon valid');
        }
        
        if (coupon.applicableOn !== 'all' && coupon.applicableOn !== orderType) {
            return res.status(400).json({ success: false, message: `This coupon is only valid for ${coupon.applicableOn} orders` });
        }

        if (coupon.minPurchase && subtotal < coupon.minPurchase) {
            return res.status(400).json({ success: false, message: `Minimum order of ₹${coupon.minPurchase} required` });
        }

        let discount = 0;
        if (coupon.discountType === 'percentage') {
            discount = (subtotal * coupon.discountValue) / 100;
            if (coupon.maxDiscount && discount > coupon.maxDiscount) discount = coupon.maxDiscount;
        } else {
            discount = coupon.discountValue;
        }

        // Normally, marking as used happens AFTER payment success, but for simplicity we can return the discount calculation here
        // The actual checkout endpoint would mark it as used within its transaction.
        res.status(200).json({
            success: true,
            data: { discount, finalAmount: subtotal - discount }
        });
    } catch (error) {
        console.error('applyCoupon Error:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

export const verifyPromoCode = async (req, res) => {
    try {
        const { code, subtotal, orderType = 'all', hostId, eventId } = req.body;
        if (!code) return res.status(400).json({ success: false, message: 'Code required' });

        const searchCode = code.trim().toUpperCase();
        const coupon = await Coupon.findOne({ 
            code: searchCode, 
            isActive: true 
        }).populate('hostId', 'name businessName');

        if (!coupon) {
            return res.status(404).json({ success: false, message: 'Invalid Promo Code' });
        }

        // ✅ HOST-SPECIFIC COUPON VALIDATION
        if (coupon.hostId) {
            let eventHostId = hostId;
            
            // If hostId not provided directly, fetch from event
            if (!eventHostId && eventId) {
                const Event = (await import('../models/Event.js')).default;
                const event = await Event.findById(eventId).select('hostId');
                
                if (!event) {
                    return res.status(400).json({ success: false, message: 'Invalid event' });
                }
                eventHostId = event.hostId.toString();
            }
            
            // Check if event's hostId matches coupon's hostId
            if (!eventHostId || eventHostId.toString() !== coupon.hostId._id.toString()) {
                return res.status(400).json({ 
                    success: false, 
                    message: `This promo code is only valid for events by ${coupon.hostId?.name || coupon.hostId?.businessName || 'this host'}` 
                });
            }
        }

        // Check Expiry (if set)
        if (coupon.expiryDate && new Date(coupon.expiryDate) < new Date()) {
            return res.status(400).json({ success: false, message: 'Promo Code Expired' });
        }

        if (coupon.applicableOn !== 'all' && coupon.applicableOn !== orderType) {
            return res.status(400).json({ success: false, message: `Only valid for ${coupon.applicableOn}` });
        }

        if (coupon.minPurchase && subtotal < coupon.minPurchase) {
            return res.status(400).json({ success: false, message: `Min order ₹${coupon.minPurchase} required` });
        }

        let discount = 0;
        if (coupon.discountType === 'percentage') {
            discount = Math.round((subtotal * coupon.discountValue) / 100);
        } else {
            discount = coupon.discountValue;
        }

        res.status(200).json({
            success: true,
            data: { 
                discount, 
                code: coupon.code, 
                type: coupon.discountType, 
                value: coupon.discountValue 
            }
        });
    } catch (error) {
        console.error('verifyPromoCode Error:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};
