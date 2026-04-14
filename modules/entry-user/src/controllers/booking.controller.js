import mongoose from 'mongoose';
import { Booking } from '../models/booking.model.js';
import { FoodOrder } from '../models/FoodOrder.js';
import { DrinkRequest } from '../models/DrinkRequest.js';
import { cacheService } from '../services/cache.service.js';

export const getMyBookings = async (req, res, next) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;
        const status = req.query.status; // Optional filter

        const cacheKey = `my-bookings:${req.user.id}:${page}:${limit}:${status || 'all'}`;
        const cached = await cacheService.get(cacheKey);
        if (cached) {
            res.set('Cache-Control', 'private, max-age=30');
            return res.status(200).json({ success: true, data: cached });
        }

        // Build query
        const query = { userId: req.user.id };
        if (status) query.status = status;

        // ⚡ ULTRA OPTIMIZED: Pagination + minimal fields + lean()
        const [bookings, total] = await Promise.all([
            Booking.find(query)
                .select('eventId status paymentStatus ticketType pricePaid createdAt')
                .populate('eventId', 'title date coverImage startTime')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Booking.countDocuments(query)
        ]);

        const result = {
            bookings,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit)
            }
        };

        await cacheService.set(cacheKey, result, 120); // 2min cache
        res.set('Cache-Control', 'private, max-age=30');
        res.status(200).json({ success: true, data: result });
    } catch (err) { next(err); }
};

export const getBookingById = async (req, res, next) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(404).json({ success: false, message: 'Invalid booking identifier format' });
        }

        // ⚡ Single query — lean() keeps hostId as string before populate
        const booking = await Booking.findById(id)
            .select('eventId hostId status paymentStatus ticketType tableId seatIds guests pricePaid checkInTime createdAt')
            .populate('eventId', 'title date coverImage startTime venue')
            .lean();

        if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

        // hostId stays as plain string in lean() result (no populate = never null)
        booking.hostIdRaw = booking.hostId?.toString() || null;

        res.status(200).json({ success: true, data: booking });
    } catch (err) { next(err); }
};

export const cancelBooking = async (req, res, next) => {
    try {
        const { id } = req.params;
        const booking = await Booking.findOneAndUpdate(
            { _id: id, userId: req.user.id, status: { $ne: 'cancelled' } },
            { status: 'cancelled' },
            { new: true }
        );
        if (!booking) return res.status(404).json({ success: false, message: 'Booking not found or already cancelled' });
        res.status(200).json({ success: true, message: 'Booking cancelled' });
    } catch (err) { next(err); }
};

export const getMyFoodOrders = async (req, res, next) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;
        const status = req.query.status; // Optional filter

        const cacheKey = `my-orders:${req.user.id}:${page}:${limit}:${status || 'all'}`;
        const cached = await cacheService.get(cacheKey);
        if (cached) {
            res.set('Cache-Control', 'private, max-age=30');
            return res.status(200).json({ success: true, data: typeof cached === 'string' ? JSON.parse(cached) : cached });
        }

        // Build query for both receiverId (gifts received) and userId (self orders)
        const query = {
            $or: [
                { userId: req.user.id },
                { receiverId: req.user.id }
            ]
        };
        if (status) query.status = status;

        // ⚡ OPTIMIZED: Fetch both FoodOrders and DrinkRequests
        const [foodOrders, drinkRequests] = await Promise.all([
            FoodOrder.find(query)
                .select('eventId totalAmount createdAt status items type userId receiverId senderId')
                .populate({ path: 'eventId', select: 'title' })
                .populate({ path: 'senderId', select: 'name' })
                .populate({ path: 'receiverId', select: 'name' })
                .sort({ createdAt: -1 })
                .lean(),
            DrinkRequest.find(query)
                .select('eventId totalAmount createdAt status items type userId receiverId senderId')
                .populate({ path: 'eventId', select: 'title' })
                .populate({ path: 'senderId', select: 'name' })
                .populate({ path: 'receiverId', select: 'name' })
                .sort({ createdAt: -1 })
                .lean()
        ]);

        // Combine and sort by date
        const allOrders = [...foodOrders, ...drinkRequests]
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .slice(skip, skip + limit);

        const total = foodOrders.length + drinkRequests.length;

        const result = {
            orders: allOrders,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit)
            }
        };

        await cacheService.set(cacheKey, result, 30); // 30 sec cache
        res.set('Cache-Control', 'private, max-age=30');
        res.status(200).json({ success: true, data: result });
    } catch (err) { next(err); }
};


// ⚡ SMART REFRESH: Check if bookings have updates
export const checkBookingsUpdates = async (req, res, next) => {
    try {
        const { lastFetchedAt } = req.query;
        
        if (!lastFetchedAt) {
            return res.status(200).json({ 
                success: true, 
                hasUpdates: true, 
                message: 'No timestamp provided, fetch recommended' 
            });
        }

        const lastFetchDate = new Date(parseInt(lastFetchedAt));

        // Check if any bookings were updated/created after lastFetchedAt
        const updatedCount = await Booking.countDocuments({
            userId: req.user.id,
            $or: [
                { updatedAt: { $gt: lastFetchDate } },
                { createdAt: { $gt: lastFetchDate } }
            ]
        });

        const hasUpdates = updatedCount > 0;

        res.status(200).json({
            success: true,
            hasUpdates,
            lastUpdated: Date.now(),
            message: hasUpdates ? 'New updates available' : 'No updates'
        });
    } catch (err) {
        next(err);
    }
};

// ⚡ SMART REFRESH: Check if orders have updates
export const checkOrdersUpdates = async (req, res, next) => {
    try {
        const { lastFetchedAt } = req.query;
        
        if (!lastFetchedAt) {
            return res.status(200).json({ 
                success: true, 
                hasUpdates: true, 
                message: 'No timestamp provided, fetch recommended' 
            });
        }

        const lastFetchDate = new Date(parseInt(lastFetchedAt));

        // Check if any orders were updated/created after lastFetchedAt
        const updatedCount = await FoodOrder.countDocuments({
            userId: req.user.id,
            $or: [
                { updatedAt: { $gt: lastFetchDate } },
                { createdAt: { $gt: lastFetchDate } }
            ]
        });

        const hasUpdates = updatedCount > 0;

        res.status(200).json({
            success: true,
            hasUpdates,
            lastUpdated: Date.now(),
            message: hasUpdates ? 'New updates available' : 'No updates'
        });
    } catch (err) {
        next(err);
    }
};
