import express from 'express';
import { getNearbyUsers, toggleVisibility } from '../controllers/radar.controller.js';
import { protect } from '../middleware/auth.middleware.js';

const router = express.Router();

router.use(protect);

router.get('/nearby', getNearbyUsers);
router.post('/visibility', toggleVisibility);

export default router;
