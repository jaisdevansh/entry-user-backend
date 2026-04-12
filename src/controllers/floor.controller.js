import { Event } from '../models/Event.js';
import { getIO } from '../socket.js';

// ── ADD FLOOR ────────────────────────────────────────────────────────────────
export const addFloor = async (req, res, next) => {
    try {
        const { eventId } = req.params;
        const floorData = req.body;

        const event = await Event.findById(eventId);
        if (!event) return res.status(404).json({ success: false, message: 'Event not found' });

        // Check if host owns this event
        if (req.user.role !== 'admin' && event.hostId.toString() !== req.user.id) {
            return res.status(403).json({ success: false, message: 'Unauthorized' });
        }

        event.floors.push(floorData);
        await event.save();

        // Broadcast update via Socket.IO
        const io = getIO();
        if (io) {
            io.emit('floor_update', { eventId, floors: event.floors });
        }

        res.status(201).json({ success: true, data: event.floors[event.floors.length - 1] });
    } catch (error) {
        next(error);
    }
};

// ── UPDATE FLOOR ─────────────────────────────────────────────────────────────
export const updateFloor = async (req, res, next) => {
    try {
        const { eventId, floorId } = req.params;
        const updateData = req.body;

        const event = await Event.findById(eventId);
        if (!event) return res.status(404).json({ success: false, message: 'Event not found' });

        if (req.user.role !== 'admin' && event.hostId.toString() !== req.user.id) {
            return res.status(403).json({ success: false, message: 'Unauthorized' });
        }

        const floor = event.floors.id(floorId);
        if (!floor) return res.status(404).json({ success: false, message: 'Floor not found' });

        Object.assign(floor, updateData);
        await event.save();

        const io = getIO();
        if (io) {
            io.emit('floor_update', { eventId, floors: event.floors });
        }

        res.status(200).json({ success: true, data: floor });
    } catch (error) {
        next(error);
    }
};

// ── DELETE FLOOR ─────────────────────────────────────────────────────────────
export const deleteFloor = async (req, res, next) => {
    try {
        const { eventId, floorId } = req.params;

        const event = await Event.findById(eventId);
        if (!event) return res.status(404).json({ success: false, message: 'Event not found' });

        if (req.user.role !== 'admin' && event.hostId.toString() !== req.user.id) {
            return res.status(403).json({ success: false, message: 'Unauthorized' });
        }

        event.floors.pull({ _id: floorId });
        await event.save();

        const io = getIO();
        if (io) {
            io.emit('floor_update', { eventId, floors: event.floors });
        }

        res.status(200).json({ success: true, message: 'Floor deleted successfully' });
    } catch (error) {
        next(error);
    }
};

// ── GET FLOORS ───────────────────────────────────────────────────────────────
export const getEventFloors = async (req, res, next) => {
    try {
        const { eventId } = req.params;
        const event = await Event.findById(eventId).select('floors');
        if (!event) return res.status(404).json({ success: false, message: 'Event not found' });

        res.status(200).json({ success: true, data: event.floors });
    } catch (error) {
        next(error);
    }
};
