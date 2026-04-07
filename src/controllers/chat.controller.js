import { Message } from '../models/Message.js';
import { User } from '../models/user.model.js';

/**
 * Get chat history between current user and a peer.
 * Uses cursor-based or offset-based pagination.
 */
export const getChatHistory = async (req, res) => {
    try {
        const currentUserId = req.user.id;
        const peerId = req.params.peerId;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const skip = (page - 1) * limit;

        // Fetch peer info just to verify and send basic details if needed
        const peer = await User.findById(peerId).select('name role status isVerified');
        if (!peer) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        // Extremely fast lookup given the compound indices: {sender: 1, receiver: 1, createdAt: -1} and vice-versa
        const messages = await Message.find({
            $or: [
                { sender: currentUserId, receiver: peerId },
                { sender: peerId, receiver: currentUserId }
            ]
        })
        .sort({ createdAt: -1 }) // Newest first for inverted list
        .skip(skip)
        .limit(limit)
        .lean(); // lean for massive performance gain

        res.status(200).json({
            success: true,
            data: {
                peer,
                messages,
                hasMore: messages.length === limit,
                page
            }
        });
    } catch (error) {
        console.error('getChatHistory Error:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

/**
 * Mark messages from peer as read
 */
export const markAsRead = async (req, res) => {
    try {
        const currentUserId = req.user.id;
        const peerId = req.body.peerId;

        await Message.updateMany(
            { sender: peerId, receiver: currentUserId, isRead: false },
            { $set: { isRead: true } }
        );

        res.status(200).json({ success: true, message: 'Messages marked as read' });
    } catch (error) {
        console.error('markAsRead Error:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};
