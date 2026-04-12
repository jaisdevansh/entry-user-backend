import express from 'express';
import {
    getProfile, updateProfile, changePassword, checkUsername, updateMembership,
    submitAppRating, getReferralData, applyReferralCode,
    sendSplitRequest, getSplitRequests, respondSplitRequest
} from '../controllers/user.controller.js';

import {
    getAllEvents, getEventBasic, getEventDetails, getEventTickets, getFloorPlan, getEventFull, bookEvent, getBookedTables, lockSeats, getActiveEvent, getMenuItems, getEventBooking,
    getHostMenu, getHostGifts, checkEventsUpdates
} from "../controllers/event.controller.js";

import {
    getAllVenues, getVenueById
} from "../controllers/venue.controller.js";

import {
    getMyBookings, getBookingById, cancelBooking, getMyFoodOrders, checkBookingsUpdates, checkOrdersUpdates
} from "../controllers/booking.controller.js";

import {
    submitBugReport, submitSupportRequest
} from '../controllers/support.controller.js';

import {
    submitIncidentReport, submitReview
} from '../controllers/support.controller.js';

import { reportEvent } from '../controllers/event.controller.js';
import { protect } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';

const router = express.Router();

router.use(protect);

// --- IDENTITY & PROFILE ---
router.get('/profile', getProfile);
router.put('/profile', updateProfile);
router.post('/check-username', checkUsername);
router.put('/change-password', changePassword);
router.put('/membership', updateMembership);

// --- BOOKINGS (Guest Side) ---
router.get('/bookings', getMyBookings);
router.get('/bookings/check-updates', checkBookingsUpdates); // Smart refresh
router.get('/bookings/:id', getBookingById);
router.put('/bookings/:id/cancel', authorize('user'), cancelBooking);

// --- ORDERS ---
router.get('/orders/my', getMyFoodOrders);
router.get('/orders/check-updates', checkOrdersUpdates); // Smart refresh

// --- EVENTS (Discovery) ---
router.get('/events', getAllEvents);
router.get('/events/check-updates', checkEventsUpdates); // Smart refresh endpoint
router.get('/events/:id/full', getEventFull); // ⚡ ULTRA-OPTIMIZED: Single endpoint for all event data
router.get('/events/:id/basic', getEventBasic);
router.get('/events/:id/details', getEventDetails);
router.get('/events/:id/tickets', getEventTickets);
router.get('/events/:id/floor-plan', getFloorPlan);
router.post('/events/lock-seats', lockSeats);
router.post('/events/book', authorize('user'), bookEvent);
router.get('/events/:eventId/booked-tables', getBookedTables);
router.get('/active-event', getActiveEvent);
router.get('/events/:eventId/menu', getMenuItems);
router.get('/events/:eventId/my-booking', getEventBooking);

// --- VENUES (Discovery) ---
router.get('/venues', getAllVenues);
router.get('/venues/:id', getVenueById);

// --- HOST CATALOG (post-booking ordering) ---
router.get('/host/:hostId/menu', getHostMenu);
router.get('/host/:hostId/gifts', getHostGifts);

// --- REVIEWS ---
router.post('/reviews', submitReview);

// --- SUPPORT & SAFETY ---
router.post('/rate', submitAppRating);
router.post('/report-incident', submitIncidentReport);
router.post('/report-bug', submitBugReport);
router.post('/support-ticket', submitSupportRequest);
router.post('/events/:eventId/report', reportEvent);

// --- REFERRALS & SPLIT ---
router.get('/referral', getReferralData);
router.post('/referral/apply', applyReferralCode);
router.post('/split-requests', sendSplitRequest);
router.get('/split-requests', getSplitRequests);
router.put('/split-requests', respondSplitRequest);

export default router;
