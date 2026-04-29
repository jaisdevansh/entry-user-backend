import express from 'express';
import { getChatHistory, markAsRead, getChatPeers, deleteMessage, deleteConversation } from '../controllers/chat.controller.js';
import { protect } from '../middleware/auth.middleware.js';

const router = express.Router();

router.use(protect); // All chat routes require authentication

router.get('/peers', getChatPeers);                  // conversations list
router.get('/history/:peerId', getChatHistory);
router.post('/read', markAsRead);
router.delete('/message/:messageId', deleteMessage); // ← Unsend a single message
router.delete('/:peerId', deleteConversation);       // ← Delete entire conversation

export default router;
