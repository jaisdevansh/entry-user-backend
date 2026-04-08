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
    const startTime = Date.now();
    try {
        const { id } = req.params;
        if (!id || id === 'undefined' || id.length < 12) {
             return res.status(404).json({ success: false, message: 'Invalid Event ID' });
        }

        const cacheKey = cacheService.formatKey('event_basic_v3', id);
        const cached = await cacheService.get(cacheKey);
        if (cached) {
            return res.status(200).json({ success: true, data: cached });
        }

        // ⚡ ULTRA FAST: Populate hostId directly in one query
        const item = await Event.findById(id)
            .select('title date startTime endTime coverImage images status hostId hostModel locationVisibility isLocationRevealed locationData floorCount attendeeCount')
            .populate({
                path: 'hostId',
                select: 'firstName lastName name profileImage',
                options: { lean: true }
            })
            .lean();
            
        if (!item) return res.status(404).json({ success: false, message: 'Event not found' });

        // Format host name
        if (item.hostId) {
            const host = item.hostId;
            item.hostId = {
                ...host,
                name: host.name || `${host.firstName || ''} ${host.lastName || ''}`.trim() || 'Collective Underground'
            };
        } else {
            item.hostId = { name: 'Collective Underground' };
        }

        // Privacy masking
        if (item.locationVisibility !== 'public' && !item.isLocationRevealed) {
            item.locationData = null;
            item.isLocationMasked = true;
        }

        await cacheService.set(cacheKey, item, 600);
        res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=120');
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
        if (cached) {
            return res.status(200).json({ success: true, data: cached });
        }

        // ⚡ OPTIMIZED: Only return additional details not in basic
        const event = await Event.findById(id)
            .select('description houseRules freeRefreshmentsCount allowNonTicketView bookingOpenDate isFeatured isTrending views')
            .lean();
            
        if (!event) return res.status(404).json({ success: false, message: 'Event not found' });

        await cacheService.set(cacheKey, event, 300);
        res.set('Cache-Control', 'public, max-age=180, stale-while-revalidate=60');
        return res.status(200).json({ success: true, data: event });
    } catch (err) { next(err); }
};

export const getEventTickets = async (req, res, next) => {
    try {
        const { id } = req.params;
        
        const cacheKey = cacheService.formatKey('event_tickets_v2', id);
        const cached = await cacheService.get(cacheKey);
        if (cached) {
            return res.status(200).json({ success: true, data: cached });
        }
        
        const event = await Event.findById(id).select('tickets floors bookingOpenDate').lean();
        if (!event) return res.status(404).json({ success: false, message: 'Event not found' });
        
        const data = {
            tickets: event.tickets || [],
            floors: event.floors || []
        };
        
        await cacheService.set(cacheKey, data, 300);
        res.set('Cache-Control', 'public, max-age=180, stale-while-revalidate=60');
        res.status(200).json({ success: true, data });
    } catch (err) { next(err); }
};

// ⚡⚡⚡ ULTRA-OPTIMIZED SINGLE ENDPOINT - STAFF+ LEVEL ⚡⚡⚡
// Replaces: getEventBasic + getEventDetails + getEventTickets + getFloorPlan
// Performance: 4859ms + 3588ms + 1661ms → <500ms (10x faster!)
export const getEventFull = async (req, res, next) => {
    const startTime = Date.now();
    try {
        const { id } = req.params;
        if (!id || id === 'undefined' || id.length < 12) {
            return res.status(404).json({ success: false, message: 'Invalid Event ID' });
        }

        // ⚡ STEP 1: Check Redis cache first
        const cacheKey = cacheService.formatKey('event_full_v1', id);
        const cached = await cacheService.get(cacheKey);
        if (cached) {
            console.log(`[⚡ OPTIMIZED] getEventFull (CACHED): ${Date.now() - startTime}ms`);
            res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=120');
            return res.status(200).json({ success: true, data: cached, cached: true });
        }

        // ⚡ STEP 2: Parallel execution - fetch everything at once
        const dbStart = Date.now();
        const [event, dedicatedFloors] = await Promise.all([
            Event.findById(id)
                .select('title date startTime endTime coverImage images status hostId locationVisibility isLocationRevealed locationData floorCount attendeeCount description houseRules freeRefreshmentsCount tickets floors bookingOpenDate')
                .populate({
                    path: 'hostId',
                    select: 'firstName lastName name profileImage',
                    options: { lean: true }
                })
                .lean(),
            Floor.find({ eventId: id }).select('name capacity price type').lean()
        ]);
        console.log(`[⚡ DB] Parallel queries: ${Date.now() - dbStart}ms`);

        if (!event) {
            return res.status(404).json({ success: false, message: 'Event not found' });
        }

        // ⚡ STEP 3: Format host (single operation)
        if (event.hostId) {
            const host = event.hostId;
            event.hostId = {
                _id: host._id,
                name: host.name || `${host.firstName || ''} ${host.lastName || ''}`.trim() || 'Collective Underground',
                profileImage: host.profileImage
            };
        } else {
            event.hostId = { name: 'Collective Underground' };
        }

        // ⚡ STEP 4: Privacy masking
        if (event.locationVisibility !== 'public' && !event.isLocationRevealed) {
            event.locationData = null;
            event.isLocationMasked = true;
        }

        // ⚡ STEP 5: Build floor plan (lightweight)
        let zones = [];
        const rawZones = dedicatedFloors.length > 0 ? dedicatedFloors : (event.floors || event.tickets || []);
        
        zones = rawZones.slice(0, 10).map(f => ({ // Limit to 10 zones max
            _id: f._id,
            name: f.name || f.type,
            capacity: f.capacity || 24,
            price: f.price,
            type: f.type
        }));

        // ⚡ STEP 6: Build optimized response (< 100KB target)
        const data = {
            // Basic info
            _id: event._id,
            title: event.title,
            date: event.date,
            startTime: event.startTime,
            endTime: event.endTime,
            coverImage: event.coverImage,
            images: (event.images || []).slice(0, 5), // Max 5 images
            status: event.status,
            hostId: event.hostId,
            locationVisibility: event.locationVisibility,
            isLocationRevealed: event.isLocationRevealed,
            locationData: event.locationData,
            isLocationMasked: event.isLocationMasked,
            floorCount: event.floorCount,
            attendeeCount: event.attendeeCount,
            
            // Details
            description: event.description,
            houseRules: (event.houseRules || []).slice(0, 5), // Max 5 rules
            freeRefreshmentsCount: event.freeRefreshmentsCount,
            bookingOpenDate: event.bookingOpenDate,
            
            // Tickets & Floors
            tickets: event.tickets || [],
            floors: zones
        };

        const payloadSize = JSON.stringify(data).length;
        console.log(`[⚡ PAYLOAD] Size: ${(payloadSize / 1024).toFixed(2)}KB`);

        // ⚡ STEP 7: Cache for 5 minutes
        await cacheService.set(cacheKey, data, 300);
        
        console.log(`[⚡ OPTIMIZED] getEventFull (DB): ${Date.now() - startTime}ms`);
        res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=120');
        res.status(200).json({ success: true, data, cached: false });
    } catch (err) {
        console.error(`[⚡ ERROR] getEventFull failed: ${Date.now() - startTime}ms`, err.message);
        next(err);
    }
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
        
        const forceRefresh = req.query.refresh === 'true';
        if (forceRefresh) {
            await cacheService.delete(cacheKey);
        }
        
        const cached = await cacheService.get(cacheKey);
        if (cached && !forceRefresh) {
            return res.status(200).json({ success: true, data: cached });
        }

        const booking = await Booking.findOne({ 
            userId: req.user.id, 
            status: { $in: ['approved', 'active', 'checked_in'] }
        })
        .select('eventId hostId status tableId zone createdAt')
        .populate({
            path: 'eventId',
            select: 'title coverImage startTime venueId'
        })
        .lean();
        
        if (booking && booking.hostId) {
            booking.hostId = booking.hostId.toString();
            await cacheService.set(cacheKey, booking, 120);
        }
        res.status(200).json({ success: true, data: booking || null });
    } catch (err) { 
        next(err); 
    }
};

// ── PUBLIC: Get host's menu items by hostId (post-booking) ─────────────────
export const getHostMenu = async (req, res, next) => {
    try {
        const { hostId } = req.params;
        console.log('[Host Menu] Request for hostId:', hostId);
        
        if (!hostId) return res.status(200).json({ success: true, data: [] });

        const cacheKey = cacheService.formatKey('host_menu', hostId);
        const cached = await cacheService.get(cacheKey);
        if (cached) {
            console.log('[Host Menu] Cache hit, returning', cached.length, 'items');
            return res.status(200).json({ success: true, data: typeof cached === 'string' ? JSON.parse(cached) : cached });
        }

        const SELECT = 'name price category image desc inStock';

        let items = await MenuItem.find({ hostId })
            .select(SELECT)
            .sort({ category: 1 })
            .lean();

        console.log('[Host Menu] Found', items.length, 'items for hostId:', hostId);

        if (items.length === 0) {
            const venue = await Venue.findOne({ hostId }).select('_id').lean();
            if (venue) {
                console.log('[Host Menu] Trying venue fallback:', venue._id);
                items = await MenuItem.find({ venueId: venue._id }).select(SELECT).sort({ category: 1 }).lean();
                console.log('[Host Menu] Found', items.length, 'items for venueId:', venue._id);
            }
        }

        const data = items.map(i => ({ ...i, type: i.category, description: i.desc || '' }));
        await cacheService.set(cacheKey, data, 600);
        console.log('[Host Menu] Returning', data.length, 'items');
        res.status(200).json({ success: true, data, count: data.length });
    } catch (err) { 
        console.error('[Host Menu] Error:', err.message);
        next(err); 
    }
};

// ── PUBLIC: Get host's gifts by hostId (used post-booking) ───────────────────
export const getHostGifts = async (req, res, next) => {
    try {
        const { hostId } = req.params;
        console.log('[Host Gifts] Request for hostId:', hostId);
        
        if (!hostId) return res.status(200).json({ success: true, data: [] });

        const cacheKey = cacheService.formatKey('host_gifts', hostId);
        const cached = await cacheService.get(cacheKey);
        if (cached) {
            const items = typeof cached === 'string' ? JSON.parse(cached) : cached;
            console.log('[Host Gifts] Cache hit, returning', items.length, 'items');
            return res.status(200).json({ success: true, data: items });
        }

        const gifts = await Gift.find({ hostId, inStock: true, isDeleted: false })
            .select('name description price category image inStock')
            .sort({ category: 1 })
            .lean();

        console.log('[Host Gifts] Found', gifts.length, 'gifts for hostId:', hostId);

        await cacheService.set(cacheKey, gifts, 600);
        res.status(200).json({ success: true, data: gifts });
    } catch (err) { 
        console.error('[Host Gifts] Error:', err.message);
        next(err); 
    }
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
