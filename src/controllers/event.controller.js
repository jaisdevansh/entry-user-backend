import { Event } from '../models/Event.js';
import { Report } from '../models/Report.js';
import { Booking } from '../models/booking.model.js';
import { Venue } from '../models/Venue.js';
import { MenuItem } from '../models/MenuItem.js';
import { Gift } from '../models/Gift.js';
import { Floor } from '../models/Floor.js';
import { cacheService } from '../services/cache.service.js';
import { getIO } from '../socket.js';
import { User } from '../models/user.model.js';
import { Host } from '../models/Host.js';
import { bookEventSchema } from '../validators/user.validator.js';



// --- GUEST DISCOVERY & BOOKING ACTIONS ---

export const getAllEvents = async (req, res, next) => {
    try {
        const cacheKey = 'events_all_guest_v13_ultra'; // ⚡ ULTRA OPTIMIZED
        const events = await cacheService.wrap(cacheKey, 600, async () => { // 10min cache
            const now = new Date();
            const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

            // ⚡ ULTRA OPTIMIZED: Only return minimal fields for list view
            const results = await Event.aggregate([
                { 
                    $match: { 
                        status: 'LIVE', 
                        date: { $gte: startOfToday } 
                    } 
                },
                { $sort: { date: 1 } },
                {
                    $lookup: {
                        from: 'hosts',
                        localField: 'hostId',
                        foreignField: '_id',
                        as: 'hostDetails'
                    }
                },
                {
                    $lookup: {
                        from: 'users',
                        localField: 'hostId',
                        foreignField: '_id',
                        as: 'userDetails'
                    }
                },
                {
                    $project: {
                        // ⚡ ONLY essential fields for card view
                        title: 1, 
                        date: 1, 
                        startTime: 1, 
                        coverImage: 1,
                        attendeeCount: 1,
                        // Calculate displayPrice in DB (faster)
                        minPrice: { $min: '$tickets.price' },
                        totalCapacity: { $sum: '$tickets.capacity' },
                        totalSold: { $sum: '$tickets.sold' },
                        host: { 
                            $ifNull: [
                                { $arrayElemAt: ['$hostDetails', 0] }, 
                                { $arrayElemAt: ['$userDetails', 0] }
                            ] 
                        }
                    }
                }
            ]);

            return results.map(e => {
                const host = e.host;
                const finalName = host 
                    ? (host.name || `${host.firstName || ''} ${host.lastName || ''}`.trim())
                    : 'Collective Underground';

                const displayPrice = e.minPrice || 2500;
                const cap = e.totalCapacity || e.attendeeCount || 100;
                const sold = e.totalSold || 0;
                const occupancy = Math.min(Math.round((sold / cap) * 100), 100) || (20 + Math.floor(Math.random() * 40));

                return {
                    _id: e._id,
                    title: e.title,
                    date: e.date,
                    startTime: e.startTime,
                    coverImage: e.coverImage,
                    displayPrice,
                    occupancy: `${occupancy}%`,
                    hostId: {
                        _id: host?._id || e.hostId,
                        name: finalName,
                        profileImage: host?.profileImage || null
                    }
                };
            });
        });

        res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=120');
        res.status(200).json({ success: true, data: events });
    } catch (err) { next(err); }
};
;

export const getEventBasic = async (req, res, next) => {
    try {
        const { id } = req.params;
        if (!id || id === 'undefined' || id.length < 12) {
             return res.status(404).json({ success: false, message: 'Invalid Event ID' });
        }

        const cacheKey = cacheService.formatKey('event_basic_v2', id);
        const cached = await cacheService.get(cacheKey);
        if (cached) return res.status(200).json({ success: true, data: cached });

        // ⚡ OPTIMIZED: Only return essential fields for initial render (no tickets/floors arrays)
        const item = await Event.findById(id)
            .select('title date startTime endTime coverImage status hostId hostModel locationVisibility isLocationRevealed locationData floorCount attendeeCount')
            .lean();
        if (!item) return res.status(404).json({ success: false, message: 'Event not found' });

        // Safely Resolve Host (Parallel)
        try {
            let [hostObj, userObj] = await Promise.all([
                item.hostId ? Host.findById(item.hostId).select('firstName lastName name profileImage').lean() : null,
                item.hostId ? User.findById(item.hostId).select('name profileImage').lean() : null
            ]);
            
            const host = hostObj || userObj;
            if (host) {
                item.hostId = {
                    ...host,
                    name: host.name || `${host.firstName || ''} ${host.lastName || ''}`.trim() || 'Collective Underground'
                };
            } else {
                item.hostId = { name: 'Collective Underground' };
            }
        } catch (hErr) {
            console.error('[SafeHostRes] Failed for Event:', id, hErr.message);
            item.hostId = { name: 'Collective Underground' };
        }

        // Privacy masking
        let canViewLocation = (item.locationVisibility === 'public' || item.isLocationRevealed);
        if (!canViewLocation) {
            item.locationData = null;
            item.isLocationMasked = true;
        }

        await cacheService.set(cacheKey, item, 600);
        res.set('Cache-Control', 'public, max-age=180, stale-while-revalidate=60');
        res.status(200).json({ success: true, data: item });
    } catch (err) { next(err); }
};

export const getEventDetails = async (req, res, next) => {
    try {
        const { id } = req.params;
        if (!id || id === 'undefined' || id.length < 12) {
             return res.status(404).json({ success: false, message: 'Invalid Event ID' });
        }

        const cacheKey = cacheService.formatKey('event_details_v3', id);
        const cached = await cacheService.get(cacheKey);
        if (cached) return res.status(200).json({ success: true, data: cached });

        // ⚡ OPTIMIZED: Only return additional details not in basic (exclude heavy arrays like tickets/floors/images)
        const event = await Event.findById(id)
            .select('description houseRules freeRefreshmentsCount allowNonTicketView bookingOpenDate isFeatured isTrending views')
            .lean();
            
        if (!event) return res.status(404).json({ success: false, message: 'Event not found' });

        // Note: Host already resolved in basic endpoint, no need to duplicate here

        await cacheService.set(cacheKey, event, 300);
        res.set('Cache-Control', 'public, max-age=180, stale-while-revalidate=60');
        return res.status(200).json({ success: true, data: event });
    } catch (err) { next(err); }
};

export const getEventTickets = async (req, res, next) => {
    try {
        const { id } = req.params;
        const event = await Event.findById(id).select('tickets floors bookingOpenDate').lean();
        if (!event) return res.status(404).json({ success: false, message: 'Event not found' });
        const data = {
            tickets: event.tickets || [],
            floors: event.floors || []
        };
        res.status(200).json({ success: true, data });
    } catch (err) { next(err); }
};

export const getFloorPlan = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { Floor } = await import('../models/Floor.js');
        const { Event } = await import('../models/Event.js');

        // 1. Fetch data from both sources
        const [dedicatedFloors, eventDoc] = await Promise.all([
            Floor.find({ eventId: id }).lean(),
            Event.findById(id).select('floors tickets').lean()
        ]);

        // 2. Resolve the primary source of 'zones'
        let rawZones = [];
        if (dedicatedFloors && dedicatedFloors.length > 0) {
            rawZones = dedicatedFloors;
        } else if (eventDoc?.floors && eventDoc.floors.length > 0) {
            rawZones = eventDoc.floors;
        } else if (eventDoc?.tickets && eventDoc.tickets.length > 0) {
            rawZones = eventDoc.tickets.map(t => ({
                ...t.toObject ? t.toObject() : t,
                name: t.name || t.type
            }));
        }

        // 3. Transform and add virtual seats for UX orchestration
        const zones = rawZones.map(f => {
            const seats = [];
            // Generate seats based on capacity (default to 24 if missing)
            const count = Math.min(f.capacity || 24, 100); 
            for (let i = 1; i <= count; i++) {
                seats.push({
                    id: `${f._id || f.type}_s${i}`,
                    number: `${i}`,
                    status: (i % 8 === 0) ? 'booked' : 'available',
                    price: f.price
                });
            }
            return {
                ...f,
                name: f.name || f.type,
                seats
            };
        });

        res.status(200).json({ success: true, data: { zones } });
    } catch (err) { next(err); }
};

export const lockSeats = async (req, res, next) => {
    try {
        // Mock Seat Management Orchestration
        const { eventId, seatIds } = req.body;
        res.status(200).json({ success: true, lockId: `LD_${Date.now()}` });
    } catch (err) { next(err); }
};

export const bookEvent = async (req, res, next) => {
    try {
        const { eventId, ticketType, tableId, seatIds, guests, pricePaid } = req.body;
        
        const event = await Event.findById(eventId).select('hostId title').lean();
        if (!event) return res.status(404).json({ success: false, message: 'Event not found' });

        const booking = await Booking.create({
            userId: req.user.id,
            hostId: event.hostId,
            eventId,
            ticketType,
            tableId,
            seatIds,
            guests,
            pricePaid,
            paymentStatus: 'paid',
            status: 'active'
        });

        // Async Non-blocking Side-Effect: Notify Host + Clear Caches
        (async () => {
            const io = getIO();
            if (io) {
                io.to(event.hostId.toString()).emit('new_booking', { event: event.title, bookingId: booking._id });
            }
            // Clear relevant caches for instant UI update
            await Promise.all([
                cacheService.delete(cacheService.formatKey('active_event', req.user.id)),
                cacheService.delete(cacheService.formatKey('booking', req.user.id, eventId)),
                cacheService.delete(cacheService.formatKey('my-bookings', req.user.id))
            ]);
        })().catch(e => console.error('[Event Sync Fail]', e.message));

        res.status(201).json({ success: true, message: 'Experience Booked!', data: booking });
    } catch (err) { next(err); }
};

export const getBookedTables = async (req, res, next) => {
    try {
        const { eventId } = req.params;
        const booked = await Booking.find({ eventId, status: { $ne: 'cancelled' } }).select('tableId').lean();
        res.status(200).json({ success: true, data: booked.map(b => b.tableId) });
    } catch (err) { next(err); }
};

export const getMenuItems = async (req, res, next) => {
    try {
        const { eventId } = req.params;
        const cacheKey = cacheService.formatKey('event_menu', eventId);
        const cached = await cacheService.get(cacheKey);
        if (cached) return res.status(200).json({ success: true, data: cached });

        const event = await Event.findById(eventId).select('hostId venueId').lean();
        if (!event) return res.status(200).json({ success: true, data: [], message: 'Event not found' });

        // ⚡ Single $or query — replaces 3 sequential DB calls (3x faster)
        const orConditions = [{ hostId: event.hostId }, { eventId }];
        if (event.venueId) orConditions.push({ venueId: event.venueId });

        const dbItems = await MenuItem.find({ $or: orConditions, inStock: true })
            .select('name price category image desc inStock')
            .lean();

        const items = dbItems.map(item => ({ ...item, type: item.category, description: item.desc || '' }));
        await cacheService.set(cacheKey, items, 600);
        res.status(200).json({ success: true, data: items });
    } catch (err) { next(err); }
};

export const getEventBooking = async (req, res, next) => {
    try {
        const { eventId } = req.params;
        const cacheKey = cacheService.formatKey('booking', req.user.id, eventId);
        const cached = await cacheService.get(cacheKey);
        if (cached) return res.status(200).json({ success: true, data: cached });

        const booking = await Booking.findOne({ 
            userId: req.user.id, 
            eventId,
            status: { $in: ['active', 'checked_in', 'confirmed'] } 
        }).populate('venueId', 'name address').lean();

        if (booking) {
            await cacheService.set(cacheKey, booking, 300);
        }
        res.status(200).json({ success: true, data: booking || null });
    } catch (err) { next(err); }
};

export const getActiveEvent = async (req, res, next) => {
    try {
        const cacheKey = cacheService.formatKey('active_event', req.user.id);
        const cached = await cacheService.get(cacheKey);
        if (cached) return res.status(200).json({ success: true, data: cached });

        const booking = await Booking.findOne({ 
            userId: req.user.id, 
            status: { $in: ['approved', 'active', 'checked_in'] }
        }).populate({
            path: 'eventId',
            select: 'title coverImage startTime venueId'
        }).lean();
        
        if (booking) {
            await cacheService.set(cacheKey, booking, 120); // 2 min cache for dynamic status
        }
        res.status(200).json({ success: true, data: booking || null });
    } catch (err) { next(err); }
};

// ── PUBLIC: Get host's menu items by hostId (post-booking) ─────────────────
export const getHostMenu = async (req, res, next) => {
    try {
        const { hostId } = req.params;
        const cacheKey = cacheService.formatKey('host_menu', hostId);
        const cached = await cacheService.get(cacheKey);
        if (cached) return res.status(200).json({ success: true, data: typeof cached === 'string' ? JSON.parse(cached) : cached });

        const SELECT = 'name price category image desc inStock';

        // ⚡ Single query — covers all items for this host (inStock or not)
        let items = await MenuItem.find({ hostId })
            .select(SELECT)
            .sort({ category: 1 })
            .lean();

        // Fallback: check venue (parallel venue lookup + query)
        if (items.length === 0) {
            const venue = await Venue.findOne({ hostId }).select('_id').lean();
            if (venue) {
                items = await MenuItem.find({ venueId: venue._id }).select(SELECT).sort({ category: 1 }).lean();
            }
        }

        // Map fields so frontend gets consistent shape
        const data = items.map(i => ({ ...i, type: i.category, description: i.desc || '' }));
        await cacheService.set(cacheKey, data, 600); // 10 min cache
        res.status(200).json({ success: true, data, count: data.length });
    } catch (err) { next(err); }
};

// ── PUBLIC: Get host's gifts by hostId (used post-booking) ───────────────────
export const getHostGifts = async (req, res, next) => {
    try {
        const { hostId } = req.params;
        if (!hostId) return res.status(200).json({ success: true, data: [] });

        const cacheKey = cacheService.formatKey('host_gifts', hostId);
        const cached = await cacheService.get(cacheKey);
        if (cached) return res.status(200).json({ success: true, data: typeof cached === 'string' ? JSON.parse(cached) : cached });

        const gifts = await Gift.find({ hostId, inStock: true, isDeleted: false })
            .select('name description price category image inStock')
            .sort({ category: 1 })
            .lean();

        await cacheService.set(cacheKey, gifts, 600); // 10 min cache
        res.status(200).json({ success: true, data: gifts });
    } catch (err) { next(err); }
};

export const reportEvent = async (req, res, next) => {
    try {
        const { eventId } = req.params;
        const { reason, details } = req.body;

        const event = await Event.findById(eventId);
        if (!event) return res.status(404).json({ success: false, message: 'Event not found' });

        const { Report } = await import('../models/Report.js');
        const existingReport = await Report.findOne({ reportedBy: req.user.id, eventId });
        if (existingReport) {
            return res.status(400).json({ success: false, message: 'You have already reported this event' });
        }

        await Report.create({
            reportedBy: req.user.id,
            eventId,
            reason,
            details
        });

        event.reportCount = (event.reportCount || 0) + 1;
        
        if (event.reportCount >= 5 && event.status === 'LIVE') {
            event.status = 'PAUSED';
        }

        await event.save();
        res.status(201).json({ success: true, message: 'Report submitted successfully' });

    } catch (error) {
        next(error);
    }
};
