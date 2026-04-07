import mongoose from 'mongoose';
import { Booking } from '../models/booking.model.js';
import { FoodOrder } from '../models/FoodOrder.js';
import { cacheService } from '../services/cache.service.js';

export const getMyBookings = async (req, res, next) => {
    try {
        const cacheKey = `my_bookings_${req.user.id}`;
        const cached = await cacheService.get(cacheKey);
        if (cached) return res.status(200).json({ success: true, data: cached });

        const bookings = await Booking.find({ userId: req.user.id })
            .select('eventId hostId status paymentStatus ticketType tableId seatIds guests pricePaid createdAt')
            .populate('eventId', 'title date coverImage startTime venue')
            .populate('hostId', 'name profileImage')
            .sort({ createdAt: -1 })
            .lean();

        await cacheService.set(cacheKey, bookings, 30); // 30s cache — explicit bust happens on booking create/update
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
        const cacheKey = `my_orders_${req.user.id}`;
        const cached = await cacheService.get(cacheKey);
        if (cached) return res.status(200).json({ success: true, data: typeof cached === 'string' ? JSON.parse(cached) : cached });

        const orders = await FoodOrder.find({ userId: req.user.id })
            .populate('eventId', 'title date')
            .sort({ createdAt: -1 })
            .lean();

        await cacheService.set(cacheKey, orders, 120); // 2 min cache (orders update frequently)
        res.status(200).json({ success: true, data: orders });
    } catch (err) { next(err); }
};

