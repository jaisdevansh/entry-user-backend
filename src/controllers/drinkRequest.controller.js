import { DrinkRequest } from '../models/DrinkRequest.js';
import { FoodOrder } from '../models/FoodOrder.js';

export const sendDrinkRequest = async (req, res) => {
    try {
        const { receiverId, eventId, items, message, totalAmount } = req.body;
        const senderId = req.user.id;

        if (!receiverId || !eventId || !items || !items.length || !totalAmount) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }

        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        const recentRequests = await DrinkRequest.countDocuments({
            senderId,
            createdAt: { $gte: oneHourAgo }
        });

        if (recentRequests >= 5) {
            return res.status(429).json({ success: false, message: 'Rate limit exceeded. Max 5 requests per hour.' });
        }

        const newRequest = await DrinkRequest.create({
            senderId,
            receiverId,
            eventId,
            items,
            message,
            totalAmount,
            status: 'pending',
            expiresAt: new Date(Date.now() + 15 * 60 * 1000) 
        });

        res.status(201).json({ success: true, data: newRequest });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const getIncomingRequests = async (req, res) => {
    try {
        const requests = await DrinkRequest.find({
            receiverId: req.user.id,
            status: 'pending',
            expiresAt: { $gt: new Date() }
        })
        .select('senderId items message totalAmount status expiresAt createdAt')
        .populate('senderId', 'name username profileImage bio')
        .sort({ createdAt: -1 })
        .lean();

        res.status(200).json({ success: true, data: requests });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const getSentRequests = async (req, res) => {
    try {
        const requests = await DrinkRequest.find({ senderId: req.user.id })
            .select('receiverId items message totalAmount status expiresAt createdAt')
            .populate('receiverId', 'name username profileImage bio')
            .sort({ createdAt: -1 })
            .lean();
            
        res.status(200).json({ success: true, data: requests });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const respondToRequest = async (req, res) => {
    try {
        const { requestId, action } = req.body; 
        
        const request = await DrinkRequest.findOne({ _id: requestId, receiverId: req.user.id });
        if (!request) return res.status(404).json({ success: false, message: 'Request not found' });
        
        if (request.status !== 'pending') {
            return res.status(400).json({ success: false, message: `Request is already ${request.status}` });
        }
        
        if (new Date() > request.expiresAt) {
            request.status = 'expired';
            await request.save();
            return res.status(400).json({ success: false, message: 'Request has expired' });
        }

        request.status = action === 'accept' ? 'accepted' : 'rejected';
        await request.save();
        
        res.status(200).json({ success: true, data: request });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const processPayment = async (req, res) => {
    try {
        const { requestId, transactionId } = req.body;
        
        const request = await DrinkRequest.findOne({ _id: requestId, senderId: req.user.id });
        if (!request) return res.status(404).json({ success: false, message: 'Request not found' });
        
        if (request.status !== 'accepted') {
            return res.status(400).json({ success: false, message: 'Payment can only be processed for accepted requests' });
        }

        const { Event } = await import('../models/Event.js');
        const eventDoc = await Event.findById(request.eventId).select('hostId').lean();
        if (!eventDoc) return res.status(404).json({ success: false, message: 'Event not found' });
        
        const newOrder = await FoodOrder.create({
            userId: request.senderId,      
            eventId: request.eventId,
            hostId: eventDoc.hostId,
            type: 'gift',
            senderId: request.senderId,
            receiverId: request.receiverId,
            items: request.items.map(i => ({ 
                menuItemId: i.menuItemId,
                name: i.name, 
                quantity: i.quantity, 
                price: i.price 
            })),
            subtotal: request.totalAmount,
            totalAmount: request.totalAmount, // Assuming no service fee for gifts for now
            paymentStatus: 'paid',
            status: 'confirmed',             
            transactionId: transactionId || 'drink_req_tx'
        });

        request.status = 'completed_payment';
        await request.save();

        // Emit to waiters and admins
        const { getIO } = await import('../socket.js');
        try {
            const io = getIO();
            if (io) {
                const orderPayload = { 
                    orderId: newOrder._id, 
                    zone: newOrder.zone,
                    items: newOrder.items.length
                };
                io.to('admin_room').emit('new_order', orderPayload);
                io.to('waiter_room').emit('new_order', orderPayload);
            }
        } catch (err) {
            console.error('[Socket] new gift order emit:', err.message);
        }

        res.status(200).json({ success: true, order: newOrder, request });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
