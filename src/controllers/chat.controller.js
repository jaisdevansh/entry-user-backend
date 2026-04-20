import mongoose from 'mongoose';
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
        const peer = await User.findById(peerId).select('name profileImage role status isVerified');
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

/**
 * GET /api/v1/chat/peers
 * Returns all unique users the logged-in user has chatted with,
 * along with their last message and unread count.
 * Used to populate the Conversations screen on app load.
 */
export const getChatPeers = async (req, res) => {
    try {
        const userId = new mongoose.Types.ObjectId(req.user.id);

        const conversations = await Message.aggregate([
            // Step 1: Only messages involving this user
            { $match: { $or: [{ sender: userId }, { receiver: userId }] } },

            // Step 2: Sort newest first within each group
            { $sort: { createdAt: -1 } },

            // Step 3: Group by the OTHER user (the peer)
            {
                $group: {
                    _id: {
                        $cond: [{ $eq: ['$sender', userId] }, '$receiver', '$sender']
                    },
                    lastMessage:   { $first: '$content' },
                    lastMessageAt: { $first: '$createdAt' },
                    lastSenderId:  { $first: '$sender' },
                    unreadCount: {
                        $sum: {
                            $cond: [
                                { $and: [
                                    { $eq: ['$receiver', userId] },
                                    { $eq: ['$isRead', false] }
                                ]},
                                1, 0
                            ]
                        }
                    }
                }
            },

            // Step 4: Sort conversations by most recent
            { $sort: { lastMessageAt: -1 } },

            // Step 5: Join with users collection for peer info
            {
                $lookup: {
                    from: 'users',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'peer'
                }
            },
            { $unwind: { path: '$peer', preserveNullAndEmptyArrays: true } },

            // Step 6: Shape output
            {
                $project: {
                    peerId:        '$_id',
                    lastMessage:   1,
                    lastMessageAt: 1,
                    lastSenderId:  1,
                    unreadCount:   1,
                    peerName:      { $ifNull: ['$peer.name', 'User'] },
                    peerImage:     { $ifNull: ['$peer.profileImage', null] },
                }
            }
        ]);

        res.status(200).json({ success: true, data: { conversations } });
    } catch (error) {
        console.error('getChatPeers Error:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};
