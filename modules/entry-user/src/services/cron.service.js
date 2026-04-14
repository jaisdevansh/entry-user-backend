import cron from 'node-cron';
import { Event } from '../models/Event.js';
import { cacheService } from './cache.service.js';

export const startCronJobs = () => {
    // Run every minute
    cron.schedule('* * * * *', async () => {
        try {
            const now = new Date();
            // Find all LIVE events whose date + endTime is in the past
            // Or simplified: Just check if date < today, or if today, if endTime has elapsed.
            // A more robust way is to just find all LIVE events and calculate in memory if they are small,
            // or better: Use a precise expiration query if endTime is ISO.
            
            // Assuming `endTime` is a string like "02:00AM" or just relying on `date`.
            // For simplicity, mark events as EXPIRED if their main date is < yesterday.
            const yesterday = new Date();
            yesterday.setDate(now.getDate() - 1);

            const result = await Event.updateMany(
                { status: 'LIVE', date: { $lt: yesterday } },
                { $set: { status: 'EXPIRED' } }
            );

            if (result.modifiedCount > 0) {
                console.log(`[Cron] Auto-expired ${result.modifiedCount} events.`);
                await cacheService.delete('events_all_guest_v13_ultra');
            }

        } catch (error) {
            console.error('[Cron Error] Failed to expire events:', error.message);
        }
    });

    console.log('[Cron] Event auto-expiration job scheduled.');
};
