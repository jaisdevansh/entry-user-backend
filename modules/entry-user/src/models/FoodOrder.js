import mongoose from 'mongoose';

const foodOrderItemSchema = new mongoose.Schema({
    menuItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'MenuItem', required: true },
    quantity: { type: Number, required: true },
    price: { type: Number, required: true },
    name: { type: String, required: true } // Snapshot for history
});

const foodOrderSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // The one who pays
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event' }, 
    hostId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // The host receiving the order
    // Gift specific fields
    type: { type: String, enum: ['order', 'gift'], default: 'order' },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    receiverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    items: [foodOrderItemSchema],
    zone: { type: String, default: 'general' },
    tableId: { type: String, default: 'Floor' },
    subtotal: { type: Number, required: true },
    serviceFee: { type: Number, default: 0 },
    tipAmount: { type: Number, default: 0 },
    totalAmount: { type: Number, required: true },
    status: { type: String, enum: ['payment_pending', 'confirmed', 'accepted', 'preparing', 'out_for_delivery', 'completed', 'cancelled'], default: 'payment_pending' },
    paymentStatus: { type: String, enum: ['pending', 'paid', 'failed'], default: 'pending' },
    transactionId: { type: String },
    assignedStaffId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    acceptedAt: { type: Date },
    completedAt: { type: Date }
}, { timestamps: true });

// ⚡ PRODUCTION-READY INDEXES - Optimized for all query patterns
foodOrderSchema.index({ userId: 1, createdAt: -1 }); // User orders (CRITICAL)
foodOrderSchema.index({ userId: 1, status: 1, createdAt: -1 }); // User active orders
foodOrderSchema.index({ eventId: 1, createdAt: -1 });
foodOrderSchema.index({ hostId: 1, createdAt: -1 });
foodOrderSchema.index({ hostId: 1, status: 1, createdAt: -1 }); // Host dashboard
foodOrderSchema.index({ status: 1, createdAt: -1 });
foodOrderSchema.index({ assignedStaffId: 1 });
foodOrderSchema.index({ status: 1, paymentStatus: 1, assignedStaffId: 1 }); // Available orders
foodOrderSchema.index({ status: 1, paymentStatus: 1, zone: 1, assignedStaffId: 1 }); // Zone-filtered
foodOrderSchema.index({ assignedStaffId: 1, status: 1 }); // Staff active orders
foodOrderSchema.index({ updatedAt: -1 }); // Smart refresh check

export const FoodOrder = mongoose.model('FoodOrder', foodOrderSchema);
