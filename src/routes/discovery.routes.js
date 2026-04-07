import express from 'express';
import { protect } from '../middleware/auth.middleware.js';
import { 
    getNearbyUsers, 
    getMenu,
    placeOrder,
    getVenueGifts
} from '../controllers/discovery.controller.js';

const router = express.Router();

router.use(protect);

// Map / Presence
router.get('/nearby/:eventId', getNearbyUsers);

// Food & Drinks Ordering
router.get('/menu/:eventId', getMenu);
router.get('/gifts/:eventId', getVenueGifts);
router.post('/orders', placeOrder);

export default router;
