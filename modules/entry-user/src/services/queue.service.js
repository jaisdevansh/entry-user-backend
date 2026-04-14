import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';

const connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

// ── 1. Define Queues ──────────────────────────────────────────────────────────
export const notificationQueue = new Queue('notifications', { connection });
export const asyncTaskQueue = new Queue('asyncTasks', { connection });

// ── 2. Define Workers ──────────────────────────────────────────────────────────
export const notificationWorker = new Worker('notifications', async job => {
    // Implement notification pushing logic here (e.g. AWS SNS, Expo Push, etc)
    console.log(`[Queue] Processing notification job ${job.id}`);
}, { connection });

export const asyncTaskWorker = new Worker('asyncTasks', async job => {
    // Implement background jobs (e.g. status recalculation, cleanup)
    console.log(`[Queue] Processing async task ${job.id}`);
}, { connection });

// ── 3. Helper Enqueuing Functions ─────────────────────────────────────────────
export const queueNotification = async (data) => {
    await notificationQueue.add('sendNotification', data, { removeOnComplete: true });
};

export const queueAsyncTask = async (name, data) => {
    await asyncTaskQueue.add(name, data, { removeOnComplete: true, attempts: 3 });
};
