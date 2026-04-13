import express from 'express';
import { seedEventPresence, clearEventPresence, getEventPresence } from '../controllers/test.controller.js';
import { protect } from '../middleware/auth.middleware.js';

const router = express.Router();

// Test endpoints for EventPresence management
router.post('/seed-presence/:eventId', protect, seedEventPresence);
router.delete('/clear-presence/:eventId', protect, clearEventPresence);
router.get('/presence/:eventId', protect, getEventPresence);

export default router;
