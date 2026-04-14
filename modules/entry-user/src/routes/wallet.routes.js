import express from 'express';
import { getWalletBalance, addPoints } from '../controllers/wallet.controller.js';
import { protect } from '../middleware/auth.middleware.js';

const router = express.Router();

router.use(protect);
router.get('/', getWalletBalance);
router.post('/add', addPoints);

export default router;
