import express from 'express';
import { askSupport } from '../controllers/support.controller.js';
import { protect } from '../middleware/auth.middleware.js';

const router = express.Router();

router.use(protect);

router.post('/support-chat', askSupport);

export default router;
