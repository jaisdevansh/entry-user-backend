import express from 'express';
import { getChatHistory, markAsRead } from '../controllers/chat.controller.js';
import { protect } from '../middleware/auth.middleware.js';

const router = express.Router();

router.use(protect); // All chat routes require authentication

router.get('/history/:peerId', getChatHistory);
router.post('/read', markAsRead);

export default router;
