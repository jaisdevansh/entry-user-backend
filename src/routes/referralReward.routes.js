import express from 'express';
import { createPendingReferral, unlockReferralReward, handleInvite } from '../controllers/referralReward.controller.js';
import { protect } from '../middleware/auth.middleware.js';

const router = express.Router();

router.get('/:code', handleInvite);

router.use(protect);
router.post('/create', createPendingReferral);
router.post('/unlock', unlockReferralReward); 

export default router;
