import DeviceToken from '../models/DeviceToken.js';
import Notification from '../models/Notification.js';
import { notificationService } from '../services/notification.service.js';

export const registerPushToken = async (req, res) => {
    try {
        const { fcmToken, platform } = req.body;
        const userId = req.user._id;
        const role = req.user.role;

        if (!fcmToken) {
            return res.status(400).json({ success: false, message: 'FCM Token required' });
        }

        // Upsert the token for this user/device
        await DeviceToken.findOneAndUpdate(
            { fcmToken },
            { 
                userId, 
                role, 
                platform: platform || 'android',
                lastUpdated: new Date()
            },
            { upsert: true, new: true }
        );

        res.status(200).json({ success: true, message: 'Token registered successfully' });
    } catch (error) {
        console.error('[Token Registration Error]:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

export const deletePushToken = async (req, res) => {
    try {
        const { fcmToken } = req.body;
        await DeviceToken.findOneAndDelete({ fcmToken });
        res.status(200).json({ success: true, message: 'Token removed successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

export const getNotifications = async (req, res) => {
    try {
        const notifications = await Notification.find({ userId: req.user._id })
            .select('title body type isRead data createdAt')
            .sort({ createdAt: -1 })
            .limit(50)
            .lean();
        res.json({ success: true, data: notifications });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error fetching notifications' });
    }
};

export const markAsRead = async (req, res) => {
    try {
        await Notification.findByIdAndUpdate(req.params.id, { isRead: true });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error updating notification' });
    }
};

export const markAllAsRead = async (req, res) => {
    try {
        await Notification.updateMany({ userId: req.user._id, isRead: false }, { isRead: true });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error updating notifications' });
    }
};

export const deleteNotification = async (req, res) => {
    try {
        await Notification.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error deleting notification' });
    }
};

export const triggerNotification = async (req, res) => {
    const { userId, role, title, body, data } = req.body;
    
    // Only admins or internal system can trigger bulk/role notifications
    if (req.user.role !== 'admin' && !req.internal) {
        return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    if (userId) {
        await notificationService.sendToUser(userId, title, body, data);
    } else if (role) {
        await notificationService.sendToRole(role, title, body, data);
    }

    res.json({ success: true, message: 'Notification triggered' });
};
