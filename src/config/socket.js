import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { EventPresence } from '../models/EventPresence.js';

let io;
const users = new Map(); // Map userId to set of socketIds

export const initSocket = (server) => {
    io = new Server(server, {
        cors: {
            origin: '*',
            methods: ['GET', 'POST']
        }
    });

    // Authentication middleware
    io.use((socket, next) => {
        const token = socket.handshake.auth.token;
        if (!token) {
            console.warn('[Socket Auth] No token provided');
            return next(new Error('Authentication required'));
        }
        
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            console.log('[Socket Auth] Token decoded:', { 
                hasId: !!decoded.id, 
                has_id: !!decoded._id,
                hasUserId: !!decoded.userId,
                keys: Object.keys(decoded)
            });
            socket.user = decoded;
            next();
        } catch (err) {
            console.error('[Socket Auth] Token verification failed:', err.message);
            next(new Error('Invalid token'));
        }
    });

    io.on('connection', (socket) => {
        const userId = socket.user?.id || socket.user?._id || socket.user?.userId;
        
        console.log('[Socket] Connection attempt:', {
            hasUser: !!socket.user,
            userId,
            userKeys: socket.user ? Object.keys(socket.user) : []
        });
        
        if (!userId) {
            console.warn('[Socket] Disconnecting user with invalid/missing ID in JWT token');
            console.warn('[Socket] User object:', socket.user);
            socket.disconnect(true);
            return;
        }

        // Store userId on socket for easy access in event handlers
        socket.userId = userId;

        if (!users.has(userId)) users.set(userId, new Set());
        users.get(userId).add(socket.id);
        
        console.log('🔌 [Socket] User connected:', { 
            userId, 
            socketId: socket.id, 
            totalSockets: users.get(userId).size,
            totalUsers: users.size 
        });
        
        // Native socket.io targeting
        socket.join(userId.toString());

        // Admins and Security join shared admin room for host chat and emergency notifications
        const normalizedRole = socket.user.role?.toLowerCase();
        
        // Admins and Security join shared admin room
        if (['admin', 'superadmin', 'host', 'security'].includes(normalizedRole)) {
            socket.join('admin_room');
        }
        if (normalizedRole === 'security') {
            socket.join('security_room');
        }
        if (['waiter', 'staff'].includes(normalizedRole)) {
            socket.join('waiter_room');
        }

        // Silently connected
        // Join Event Room for presence
        socket.on('joinEvent', async ({ eventId }) => {
            socket.join(`event_${eventId}`);
            socket.eventId = eventId;
        });

        // Allow clients to explicitly join named rooms (e.g. security_room)
        socket.on('join_room', (roomName) => {
            socket.join(roomName);
        });

        // Update presence / visibility
        socket.on('updatePresence', async (data) => {
            const userId = socket.userId;
            const { eventId, lat, lng, visibility } = data;
            console.log('📡 [Socket] updatePresence received:', { userId, eventId, lat, lng, visibility });
            
            if(!eventId) {
                console.warn('⚠️ [Socket] updatePresence: No eventId provided');
                return;
            }

            try {
                const updated = await EventPresence.findOneAndUpdate(
                    { userId, eventId },
                    { userId, eventId, lat, lng, visibility, lastSeen: new Date() },
                    { upsert: true, new: true }
                );
                
                console.log('✅ [Socket] EventPresence updated:', {
                    userId: updated.userId,
                    eventId: updated.eventId,
                    visibility: updated.visibility,
                    hasLocation: !!(updated.lat && updated.lng)
                });
                
                // Broadcast updated stats to anyone listening in room
                const count = await EventPresence.countDocuments({ eventId, lastSeen: { $gte: new Date(Date.now() - 30 * 60000) } }); 
                console.log('👥 [Socket] Total present in event:', count);
                io.to(`event_${eventId}`).emit('presenceUpdate', { eventId, totalPresent: count });

                if (visibility) {
                    io.to(`event_${eventId}`).emit('userVisible', { userId });
                }
            } catch (err) {
                console.error("❌ [Socket] Presence update error:", err);
            }
        });

        // Leave Event Room
        socket.on('leaveEvent', async ({ eventId }) => {
            const userId = socket.userId;
            socket.leave(`event_${eventId}`);
            await EventPresence.findOneAndUpdate({ userId, eventId }, { visibility: false });
        });
        
        // Typing
        socket.on('typing', ({ receiverId, chatId }) => {
            const userId = socket.userId;
            const receiverSockets = users.get(receiverId);
            if(receiverSockets) {
                for (const sid of receiverSockets) {
                    io.to(sid).emit('typing', { senderId: userId, chatId });
                }
            }
        });

        // ─── Radar Chat / Direct Messaging ──────────────────────────────
        
        // Handle sending messages instantly and persist to DB in background
        socket.on('send_message', async (data, callback) => {
            const senderId = socket.userId;
            const { receiverId, content, tempId } = data;
            console.log('💬 [send_message] Received:', { senderId, receiverId, content: content?.substring(0, 50), tempId });
            
            if (!receiverId || !content) {
                console.warn('⚠️ [send_message] Missing fields:', { receiverId, hasContent: !!content });
                if(callback) callback({ success: false, error: 'Missing fields' });
                return;
            }

            const timestamp = new Date();

            // Get sender info for notification
            let senderName = 'Someone';
            let senderImage = '';
            try {
                const { User } = await import('../models/user.model.js');
                const sender = await User.findById(senderId).select('name profileImage').lean();
                console.log('👤 [send_message] Sender info from DB:', { senderId, sender });
                if (sender) {
                    senderName = sender.name;
                    senderImage = sender.profileImage || '';
                }
            } catch (err) {
                console.warn('⚠️ [send_message] Could not fetch sender info:', err.message);
            }

            // Emit to receiver immediately if online for sub-10ms delivery
            const receiverSockets = users.get(receiverId);
            console.log('👥 [send_message] Receiver sockets:', { receiverId, socketCount: receiverSockets?.size || 0, allUsers: Array.from(users.keys()) });
            
            if (receiverSockets) {
                const payload = {
                    tempId,
                    senderId,
                    receiverId,
                    content,
                    timestamp,
                    isRead: false,
                    senderName,
                    senderImage
                };
                console.log('📤 [send_message] Emitting payload:', { 
                    receiverId, 
                    socketIds: Array.from(receiverSockets), 
                    senderName,
                    hasSenderImage: !!senderImage
                });
                
                for (const sid of receiverSockets) {
                    io.to(sid).emit('receive_message', payload);
                    console.log('✅ [send_message] Emitted to socket:', sid);
                }
            } else {
                console.warn('⚠️ [send_message] Receiver not online:', receiverId);
            }

            // Acknowledge back to sender immediately so UI updates optimizing latency
            if (callback) {
                callback({ success: true, tempId, timestamp });
                console.log('✅ [send_message] Acknowledged to sender');
            }

            // Persist to MongoDB asynchronously in background
            try {
                // Dynamically import Message to avoid circular dependencies if any
                const { Message } = await import('../models/Message.js');
                const savedMsg = await Message.create({
                    sender: senderId,
                    receiver: receiverId,
                    content,
                    isRead: false,
                    // use same timestamp to keep consistency
                    createdAt: timestamp,
                    updatedAt: timestamp
                });
                console.log('💾 [send_message] Saved to DB:', savedMsg._id);
            } catch (err) {
                console.error('❌ [Socket Chat] Failed to save message:', err);
            }
        });

        // Handle marking messages as read
        socket.on('mark_read', async ({ senderId }) => {
            const userId = socket.userId;
            const senderSockets = users.get(senderId);
            if (senderSockets) {
                for (const sid of senderSockets) {
                    io.to(sid).emit('messages_read', { byUserId: userId });
                }
            }
            // Persist read status in background
            try {
                const { Message } = await import('../models/Message.js');
                await Message.updateMany(
                    { sender: senderId, receiver: userId, isRead: false },
                    { $set: { isRead: true } }
                );
            } catch (err) {
                console.error('[Socket Chat] Failed to update read status:', err);
            }
        });

        // ─── Gift Request System ──────────────────────────────────────────
        
        // Handle sending gift request
        socket.on('send_gift_request', async (data) => {
            const senderId = socket.userId;
            const { requestId, receiverId, item, message, eventId, senderName, senderImage } = data;
            console.log('🎁 [send_gift_request] Received:', { senderId, receiverId, requestId, item: item?.name });
            
            if (!receiverId || !item || !requestId) {
                console.warn('⚠️ [send_gift_request] Missing fields');
                return;
            }

            // Emit to receiver immediately if online
            const receiverSockets = users.get(receiverId);
            console.log('👥 [send_gift_request] Receiver sockets:', { receiverId, socketCount: receiverSockets?.size || 0 });
            
            if (receiverSockets) {
                const payload = {
                    requestId,
                    senderId,
                    senderName,
                    senderImage,
                    receiverId,
                    item,
                    message,
                    eventId,
                    timestamp: new Date().toISOString()
                };
                console.log('📤 [send_gift_request] Emitting to receiver:', { receiverId, payload });
                
                for (const sid of receiverSockets) {
                    io.to(sid).emit('receive_gift_request', payload);
                    console.log('✅ [send_gift_request] Emitted to socket:', sid);
                }
            } else {
                console.warn('⚠️ [send_gift_request] Receiver not online:', receiverId);
            }
        });

        // Handle gift request accepted
        socket.on('gift_request_accepted', async (data) => {
            const { requestId, senderId, receiverId } = data;
            console.log('✅ [gift_request_accepted] Received:', { requestId, senderId, receiverId });
            
            // Notify sender that gift was accepted
            const senderSockets = users.get(senderId);
            if (senderSockets) {
                for (const sid of senderSockets) {
                    io.to(sid).emit('gift_request_accepted', { requestId });
                    console.log('✅ [gift_request_accepted] Notified sender:', senderId);
                }
            }
        });

        // Handle gift request rejected
        socket.on('gift_request_rejected', async (data) => {
            const { requestId, senderId, receiverId } = data;
            console.log('❌ [gift_request_rejected] Received:', { requestId, senderId, receiverId });
            
            // Notify sender that gift was rejected
            const senderSockets = users.get(senderId);
            if (senderSockets) {
                for (const sid of senderSockets) {
                    io.to(sid).emit('gift_request_rejected', { requestId });
                    console.log('❌ [gift_request_rejected] Notified sender:', senderId);
                }
            }
        });

        socket.on('disconnect', () => {
            const userId = socket.userId;
            console.log('🔌 [Socket] User disconnecting:', { userId, socketId: socket.id });
            const userSockets = users.get(userId);
            if (userSockets) {
                userSockets.delete(socket.id);
                if (userSockets.size === 0) {
                    users.delete(userId);
                    console.log('👋 [Socket] User fully disconnected:', userId);
                } else {
                    console.log('🔌 [Socket] User still has', userSockets.size, 'socket(s) connected');
                }
            }
        });
    });

    return io;
};

export const getIO = () => {
    if (!io) {
        throw new Error('Socket.io not initialized');
    }
    return io;
};
