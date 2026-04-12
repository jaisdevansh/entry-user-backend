import express from 'express';
import { getAvailableCoupons, getUserCoupons, buyCoupon, applyCoupon, verifyPromoCode } from '../controllers/coupon.controller.js';
import { protect } from '../middleware/auth.middleware.js';

const router = express.Router();

router.use(protect); // Ensure secure wallet deductions

router.get('/', getAvailableCoupons);
router.get('/user', getUserCoupons);
router.post('/buy', buyCoupon);
router.post('/apply', applyCoupon);
router.post('/verify-code', verifyPromoCode);

export default router;
