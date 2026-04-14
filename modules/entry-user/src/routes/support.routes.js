import express from 'express';
import { askSupport, getSupportChat, clearSupportChat, deleteSupportMessage } from '../controllers/support.controller.js';
import { protect } from '../middleware/auth.middleware.js';

const router = express.Router();

router.use(protect);

router.post('/ask', askSupport);
router.get('/chat', getSupportChat);
router.delete('/chat', clearSupportChat);
router.delete('/message/:id', deleteSupportMessage);

export default router;
