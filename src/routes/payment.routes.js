import express from 'express';
import { createOrder, verifyPayment, createFoodOrder, verifyFoodPayment } from '../controllers/payment.controller.js';
import { protect } from '../middleware/auth.middleware.js';

const router = express.Router();

router.use(protect);

router.post('/create-order', createOrder);
router.post('/verify-payment', verifyPayment);

// Food/Drink specific payment flow
router.post('/food/order', createFoodOrder);
router.post('/food/verify', verifyFoodPayment);

export default router;
