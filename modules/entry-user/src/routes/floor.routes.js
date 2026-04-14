import express from 'express';
import * as FloorController from '../controllers/floor.controller.js';
import { protect } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';

const router = express.Router();

// PUBLIC ROUTES (Anyone can see floors of an event)
router.get('/:eventId', FloorController.getEventFloors);

// PROTECTED ROUTES (HOST ONLY)
router.use(protect);
router.use(authorize('host', 'admin'));

router.post('/:eventId', FloorController.addFloor);
router.put('/:eventId/:floorId', FloorController.updateFloor);
router.delete('/:eventId/:floorId', FloorController.deleteFloor);

export default router;
