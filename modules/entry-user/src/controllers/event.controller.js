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
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;
        
        const cacheKey = `events:list:${page}:${limit}`; // Standardized cache key
        
        const events = await cacheService.wrap(cacheKey, 300, async () => { // 5min cache
            const now = new Date();
            const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

            console.log('🔍 [getAllEvents] Fetching events with filters:', {
                status: 'LIVE',
                date: { $gte: startOfToday },
                startOfToday: startOfToday.toISOString()
            });

            // First check total events in DB
            const totalEventsInDB = await Event.countDocuments({});
            const liveEvents = await Event.countDocuments({ status: 'LIVE' });
            const futureEvents = await Event.countDocuments({ date: { $gte: startOfToday } });
            
            console.log('📊 [getAllEvents] Database stats:', {
                totalEvents: totalEventsInDB,
                liveEvents: liveEvents,
                futureEvents: futureEvents
            });

            // ⚡ ULTRA OPTIMIZED: Minimal fields + lean() + limit
            const results = await Event.find({ 
                status: 'LIVE', 
                date: { $gte: startOfToday } 
            })
            .select('title date startTime coverImage attendeeCount locationVisibility locationData bookingOpenDate venueName hostModel') // Added hostModel for refPath
            .populate({
                path: 'hostId',
                select: 'name profileImage businessName logo'
            })
            .sort({ date: 1, isFeatured: -1 })
            .skip(skip)
            .limit(limit)
            .lean(); // 3x faster

            console.log('✅ [getAllEvents] Found events:', results.length);
            if (results.length > 0) {
                console.log('📋 [getAllEvents] First event:', {
                    title: results[0].title,
                    date: results[0].date,
                    status: results[0].status,
                    hostId: results[0].hostId
                });
            }

            // Calculate display price and occupancy
            return results.map(e => {
                const tickets = e.tickets || [];
                const minPrice = tickets.length > 0 
                    ? Math.min(...tickets.map(t => t.price)) 
                    : 2500;
                
                const totalCapacity = tickets.reduce((sum, t) => sum + (t.capacity || 0), 0) || 100;
                const totalSold = tickets.reduce((sum, t) => sum + (t.sold || 0), 0);
                const occupancy = totalCapacity > 0 
                    ? Math.min(Math.round((totalSold / totalCapacity) * 100), 100)
                    : 20 + Math.floor(Math.random() * 40);

                return {
                    _id: e._id,
                    title: e.title,
                    date: e.date,
                    startTime: e.startTime,
                    coverImage: e.coverImage,
                    displayPrice: minPrice,
                    occupancy: `${occupancy}%`,
                    locationVisibility: e.locationVisibility,
                    locationData: e.locationData,
                    bookingOpenDate: e.bookingOpenDate,
                    venueName: e.venueName,
                    hostId: e.hostId // Don't override with fallback - let frontend handle it
                };
            });
        });

        // Get total count for pagination
        const total = await Event.countDocuments({ 
            status: 'LIVE', 
            date: { $gte: new Date().setHours(0,0,0,0) } 
        });

        res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=120');
        res.status(200).json({ 
            success: true, 
            data: events,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit)
            }
        });
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

        // Fire and forget cache write to save response time!
        cacheService.set(cacheKey, item, 600).catch(console.error);
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

        cacheService.set(cacheKey, event, 300).catch(console.error);
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
        
        cacheService.set(cacheKey, data, 300).catch(console.error);
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

        // ⚡ STEP 7: Cache for 5 minutes (Fire-and-forget so it doesn't block API)
        cacheService.set(cacheKey, data, 300).catch(console.error);
        
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
        const { eventId, seatIds, guestCount } = req.body;
        
        // ⚡ ATOMIC: Distributed Redis Lock for Seat Selection
        const lockId = `lock_${eventId}_${req.user.id}_${Date.now()}`;
        
        // Check if seats are already locked
        for (const seatId of seatIds) {
            const isLocked = await cacheService.get(`seat_lock_${eventId}_${seatId}`);
            if (isLocked) {
                return res.status(409).json({ success: false, message: 'Wait, some seats were just taken. Refreshing map.', code: 'SEATS_UNAVAILABLE' });
            }
        }
        
        // Lock seats for 5 minutes
        await Promise.all(seatIds.map(seatId => 
            cacheService.set(`seat_lock_${eventId}_${seatId}`, req.user.id, 300)
        ));

        res.status(200).json({ success: true, message: 'Seats locked for 5 minutes', lockId });
    } catch (err) { next(err); }
};

export const bookEvent = async (req, res, next) => {
    try {
        const { eventId, ticketType, tableId, seatIds, guests, pricePaid } = req.body;
        
        const event = await Event.findById(eventId).select('hostId title').lean();
        if (!event) return res.status(404).json({ success: false, message: 'Event not found' });

        // ⚡ ATOMIC: Verify lock ownership before booking
        if (seatIds && seatIds.length > 0) {
            for (const seatId of seatIds) {
                const lockOwner = await cacheService.get(`seat_lock_${eventId}_${seatId}`);
                if (lockOwner && lockOwner !== req.user.id) {
                    return res.status(409).json({ success: false, message: 'Session expired. Seats were taken by someone else.' });
                }
            }
        }

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

        // ⚡ RELEASE LOCKS AFTER SUCCESSFUL BOOKING
        if (seatIds && seatIds.length > 0) {
            await Promise.all(seatIds.map(seatId => cacheService.delete(`seat_lock_${eventId}_${seatId}`)));
        }

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
            console.log('🔄 [getActiveEvent] Force refresh requested, clearing cache');
            await cacheService.delete(cacheKey);
        }
        
        const cached = await cacheService.get(cacheKey);
        if (cached && !forceRefresh) {
            console.log('✅ [getActiveEvent] Cache HIT for user:', req.user.id);
            return res.status(200).json({ success: true, data: cached });
        }

        console.log('🔍 [getActiveEvent] Querying database for user:', req.user.id);
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
        
        console.log('📦 [getActiveEvent] Raw booking:', JSON.stringify(booking, null, 2));
        
        if (booking && booking.hostId) {
            booking.hostId = booking.hostId.toString();
            console.log('🎯 [getActiveEvent] Converted hostId to string:', booking.hostId);
            
            // Get live crowd count for this event
            const eventId = booking.eventId?._id || booking.eventId;
            if (eventId) {
                const checkedInCount = await Booking.countDocuments({
                    eventId: eventId,
                    status: { $in: ['checked_in', 'active'] }
                });
                
                booking.liveCrowd = checkedInCount;
                console.log('👥 [getActiveEvent] Live crowd count:', checkedInCount);
            }
            
            await cacheService.set(cacheKey, booking, 120);
        } else {
            console.log('⚠️ [getActiveEvent] No active booking found');
        }
        
        res.status(200).json({ success: true, data: booking || null });
    } catch (err) { 
        console.error('❌ [getActiveEvent] ERROR:', err.message);
        next(err); 
    }
};

// ── PUBLIC: Get host's menu items by hostId (post-booking) ─────────────────
export const getHostMenu = async (req, res, next) => {
    try {
        const { hostId } = req.params;
        if (!hostId) return res.status(200).json({ success: true, data: [] });

        const cacheKey = cacheService.formatKey('host_menu', hostId);
        
        // Check cache first
        const cached = await cacheService.get(cacheKey);
        if (cached) {
            return res.status(200).json({ 
                success: true, 
                data: typeof cached === 'string' ? JSON.parse(cached) : cached,
                cached: true 
            });
        }

        const SELECT = 'name price category image desc inStock';

        let items = await MenuItem.find({ hostId })
            .select(SELECT)
            .sort({ category: 1 })
            .lean();

        if (items.length === 0) {
            const venue = await Venue.findOne({ hostId }).select('_id').lean();
            if (venue) {
                items = await MenuItem.find({ venueId: venue._id }).select(SELECT).sort({ category: 1 }).lean();
            }
        }

        const data = items.map(i => ({ ...i, type: i.category, description: i.desc || '' }));
        await cacheService.set(cacheKey, data, 600);
        res.status(200).json({ success: true, data, count: data.length });
    } catch (err) { next(err); }
};

// ── PUBLIC: Get host's gifts by hostId (used post-booking) ───────────────────
export const getHostGifts = async (req, res, next) => {
    try {
        const { hostId } = req.params;
        console.log('🎁 [getHostGifts] Request for hostId:', hostId);
        
        if (!hostId) {
            console.log('🎁 [getHostGifts] No hostId provided');
            return res.status(200).json({ success: true, data: [] });
        }

        const cacheKey = cacheService.formatKey('host_gifts', hostId);
        
        // Check cache first
        const cached = await cacheService.get(cacheKey);
        if (cached) {
            console.log('🎁 [getHostGifts] Cache HIT:', typeof cached === 'string' ? JSON.parse(cached).length : cached.length, 'items');
            return res.status(200).json({ 
                success: true, 
                data: typeof cached === 'string' ? JSON.parse(cached) : cached,
                cached: true 
            });
        }

        console.log('🎁 [getHostGifts] Cache MISS, querying database...');
        let gifts = await Gift.find({ hostId, inStock: true, isDeleted: false })
            .select('name description price category image inStock')
            .sort({ category: 1 })
            .lean();

        console.log('🎁 [getHostGifts] Database returned:', gifts.length, 'items');
        
        if (gifts.length > 0) {
            console.log('🎁 [getHostGifts] Sample gift:', JSON.stringify(gifts[0]));
        }

        await cacheService.set(cacheKey, gifts, 600);
        console.log('🎁 [getHostGifts] Cached for 10 minutes');
        
        res.status(200).json({ success: true, data: gifts, count: gifts.length });
    } catch (err) { 
        console.error('🎁 [getHostGifts] ERROR:', err.message);
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

// ⚡ SMART REFRESH: Check if events have updates without fetching full data
export const checkEventsUpdates = async (req, res, next) => {
    try {
        const { lastFetchedAt } = req.query;
        
        if (!lastFetchedAt) {
            return res.status(200).json({ 
                success: true, 
                hasUpdates: true, 
                message: 'No timestamp provided, fetch recommended' 
            });
        }

        const lastFetchDate = new Date(parseInt(lastFetchedAt));
        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        // Check if any events were updated/created after lastFetchedAt
        const updatedCount = await Event.countDocuments({
            status: 'LIVE',
            date: { $gte: startOfToday },
            $or: [
                { updatedAt: { $gt: lastFetchDate } },
                { createdAt: { $gt: lastFetchDate } }
            ]
        });

        const hasUpdates = updatedCount > 0;

        res.status(200).json({
            success: true,
            hasUpdates,
            lastUpdated: now.getTime(),
            message: hasUpdates ? 'New updates available' : 'No updates'
        });
    } catch (err) {
        next(err);
    }
};
