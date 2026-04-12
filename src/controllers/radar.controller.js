import { EventPresence } from '../models/EventPresence.js';
import { User } from '../models/user.model.js';

export const getNearbyUsers = async (req, res) => {
    try {
        const { eventId } = req.query;
        if (!eventId) {
            return res.status(400).json({ success: false, message: 'eventId is required' });
        }
        
        const presences = await EventPresence.find({ eventId, visibility: true })
            .populate('userId', 'name username profileImage bio gender')
            .lean();
            
        const nearbyUsers = presences
            .filter(p => p.userId && p.userId._id.toString() !== req.user.id)
            .map(p => ({
                _id: p.userId._id,
                name: p.userId.name,
                username: p.userId.username,
                profileImage: p.userId.profileImage,
                bio: p.userId.bio,
                gender: p.userId.gender
            }));
            
        res.status(200).json({ success: true, data: nearbyUsers });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const toggleVisibility = async (req, res) => {
    try {
         const { eventId, visibility } = req.body;
         if (!eventId) return res.status(400).json({ success: false, message: 'eventId is required' });
         
         const presence = await EventPresence.findOneAndUpdate(
             { userId: req.user.id, eventId },
             { visibility, lastSeen: Date.now() },
             { new: true, upsert: true }
         );
         
         res.status(200).json({ success: true, data: presence });
    } catch (error) {
         res.status(500).json({ success: false, message: error.message });
    }
};
