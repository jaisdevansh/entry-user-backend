import { Event } from '../models/Event.js';
import { Booking } from '../models/booking.model.js';
import { sendNotification } from '../services/notification.service.js';
import { getIO } from '../socket.js';

let isRunning = false;

// Runs every minute to check if any events should be revealed
export const checkAndRevealLocations = async () => {
    if (isRunning) return; // Prevent overlapping runs
    isRunning = true;

    try {
        const now = new Date();
        
        // Find events that are delayed, not yet revealed, and revealTime has passed
        const eventsToReveal = await Event.find({
            locationVisibility: 'delayed',
            isLocationRevealed: false,
            revealTime: { $lte: now }
        });

        if (eventsToReveal.length === 0) {
            isRunning = false;
            return;
        }

        console.log(`[Location Reveal] Found ${eventsToReveal.length} events to auto-reveal.`);

        for (const event of eventsToReveal) {
            event.isLocationRevealed = true;
            await event.save();

            console.log(`[Location Reveal] Revealed location for event: ${event.title}`);

            // 1. Notify via Websockets for active viewers
            const io = getIO();
            if (io) {
                io.emit('location_revealed', { eventId: event._id });
            }

            // 2. Fetch all users with confirmed tickets
            // Includes 'confirmed' 'approved' 'active' since the exact status wording can vary
            const bookings = await Booking.find({ 
                eventId: event._id, 
                status: { $in: ['approved', 'active', 'confirmed', 'checked_in'] } 
            });

            const uniqueUserIds = [...new Set(bookings.map(b => b.userId.toString()))];

            const title = 'Location Revealed 📍';
            const body = `The secret location for "${event.title}" is now available. Tap to view.`;

            const notificationPromises = uniqueUserIds.map(async (userId) => {
                return sendNotification(userId, title, body, 'event', { 
                    type: 'location_reveal', 
                    eventId: event._id.toString() 
                });
            });

            await Promise.allSettled(notificationPromises);
            console.log(`[Location Reveal] Sent ${uniqueUserIds.length} push notifications for event: ${event._id}`);
        }

    } catch (error) {
        console.error('[Location Reveal] Error processing auto-reveals:', error);
    } finally {
        isRunning = false;
    }
};

// Initialize the interval processing
export const initLocationRevealService = () => {
    console.log('[Location Reveal] Initializing background auto-reveal worker (Every 60s)');
    setInterval(checkAndRevealLocations, 60 * 1000);
    // Run once immediately on start
    setTimeout(checkAndRevealLocations, 5000); 
};
