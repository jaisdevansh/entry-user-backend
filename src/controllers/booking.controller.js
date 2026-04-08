import mongoose from 'mongoose';
import { Booking } from '../models/booking.model.js';
import { FoodOrder } from '../models/FoodOrder.js';
import { cacheService } from '../services/cache.service.js';

export const getMyBookings = async (req, res, next) => {
    try {
        const cacheKey = cacheService.formatKey('my-bookings', req.user.id);
        const cached = await cacheService.get(cacheKey);
        if (cached) {
            res.set('Cache-Control', 'private, max-age=30');
            return res.status(200).json({ success: true, data: cached });
        }

        // ⚡ ULTRA OPTIMIZED: Only select essential fields, limit to recent bookings
        const bookings = await Booking.find({ userId: req.user.id })
            .select('eventId status paymentStatus ticketType pricePaid createdAt')
            .populate('eventId', 'title date coverImage startTime') // Minimal event fields
            .sort({ createdAt: -1 })
            .limit(50) // ⚡ Only recent 50 bookings
            .lean();

        await cacheService.set(cacheKey, bookings, 120); // 2min cache
        res.set('Cache-Control', 'private, max-age=30');
        res.status(200).json({ success: true, data: bookings });
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
        const cacheKey = cacheService.formatKey('my-orders', req.user.id);
        const cached = await cacheService.get(cacheKey);
        if (cached) {
            res.set('Cache-Control', 'private, max-age=60');
            return res.status(200).json({ success: true, data: typeof cached === 'string' ? JSON.parse(cached) : cached });
        }

        // ⚡ OPTIMIZED: Limit to recent orders only
        const orders = await FoodOrder.find({ userId: req.user.id })
            .select('items totalPrice status createdAt eventId') // Only essential fields
            .populate('eventId', 'title date')
            .sort({ createdAt: -1 })
            .limit(30) // ⚡ Only recent 30 orders
            .lean();

        await cacheService.set(cacheKey, orders, 180); // 3 min cache
        res.set('Cache-Control', 'private, max-age=60');
        res.status(200).json({ success: true, data: orders });
    } catch (err) { next(err); }
};

