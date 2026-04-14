import { EventPresence } from '../models/EventPresence.js';
import { User } from '../models/user.model.js';
import { Booking } from '../models/booking.model.js';

/**
 * TEST ENDPOINT: Add checked-in users to EventPresence for radar testing
 * This will find all users with active bookings for an event and add them to EventPresence
 */
export const seedEventPresence = async (req, res) => {
    try {
        const { eventId } = req.params;
        
        if (!eventId) {
            return res.status(400).json({ success: false, message: 'eventId is required' });
        }

        console.log('🌱 [Seed] Starting EventPresence seed for event:', eventId);

        // Find all active bookings for this event
        const bookings = await Booking.find({
            eventId: eventId,
            status: { $in: ['checked_in', 'active', 'approved'] }
        }).populate('userId', 'name username profileImage gender').lean();

        console.log('📋 [Seed] Found bookings:', bookings.length);

        if (bookings.length === 0) {
            return res.json({ 
                success: true, 
                message: 'No active bookings found for this event',
                count: 0 
            });
        }

        // Create EventPresence records for each user
        const results = [];
        for (const booking of bookings) {
            if (!booking.userId) continue;

            // Generate random location within a small area (simulating venue)
            const baseLat = 28.5355; // Example: Delhi coordinates
            const baseLng = 77.3910;
            const randomLat = baseLat + (Math.random() - 0.5) * 0.001; // ~50m radius
            const randomLng = baseLng + (Math.random() - 0.5) * 0.001;

            const presence = await EventPresence.findOneAndUpdate(
                { userId: booking.userId._id, eventId: eventId },
                {
                    userId: booking.userId._id,
                    eventId: eventId,
                    lat: randomLat,
                    lng: randomLng,
                    visibility: true, // Make them visible by default for testing
                    lastSeen: new Date()
                },
                { upsert: true, new: true }
            );

            results.push({
                userId: booking.userId._id,
                name: booking.userId.name,
                username: booking.userId.username,
                visibility: true
            });

            console.log('✅ [Seed] Added presence for:', booking.userId.name);
        }

        res.json({
            success: true,
            message: `Successfully seeded ${results.length} users to EventPresence`,
            count: results.length,
            users: results
        });

    } catch (error) {
        console.error('❌ [Seed] Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * TEST ENDPOINT: Clear all EventPresence records for an event
 */
export const clearEventPresence = async (req, res) => {
    try {
        const { eventId } = req.params;
        
        const result = await EventPresence.deleteMany({ eventId });
        
        res.json({
            success: true,
            message: `Cleared ${result.deletedCount} presence records`,
            deletedCount: result.deletedCount
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * TEST ENDPOINT: Get all EventPresence records for an event
 */
export const getEventPresence = async (req, res) => {
    try {
        const { eventId } = req.params;
        
        const presences = await EventPresence.find({ eventId })
            .populate('userId', 'name username profileImage gender')
            .lean();
        
        res.json({
            success: true,
            count: presences.length,
            data: presences
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
