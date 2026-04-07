import express from 'express';
import { 
    sendDrinkRequest, 
    getIncomingRequests, 
    getSentRequests, 
    respondToRequest,
    processPayment
} from '../controllers/drinkRequest.controller.js';
import { protect } from '../middleware/auth.middleware.js'; 

const router = express.Router();

router.use(protect); 

router.post('/send', sendDrinkRequest);
router.get('/incoming', getIncomingRequests);
router.get('/sent', getSentRequests);
router.post('/respond', respondToRequest);
router.post('/pay', processPayment);

export default router;
