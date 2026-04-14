import express from 'express';
import {
    getNotifications,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    registerPushToken,
    deletePushToken,
    triggerNotification,
} from '../controllers/notification.controller.js';
import { protect } from '../middleware/auth.middleware.js';

const router = express.Router();

router.use(protect);

// Push token registration (called on app startup or login)
router.post('/register-token', registerPushToken);
router.post('/delete-token', deletePushToken);

// Trigger a notification (internal/admin)
router.post('/send', triggerNotification);

// User-facing
router.get('/', getNotifications);
router.patch('/read-all', markAllAsRead);
router.patch('/:id/read', markAsRead);
router.delete('/:id', deleteNotification);

export default router;
