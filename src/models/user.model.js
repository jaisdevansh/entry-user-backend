import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema({
    name: { type: String, default: '' },
    gender: { type: String, enum: ['Male', 'Female', 'Other', ''], default: '' },
    googleId: { type: String, unique: true, sparse: true },
    tokenVersion: { type: Number, default: 0 },
    email: { type: String, unique: true, sparse: true },
    password: { type: String },
    phone: { type: String, unique: true, sparse: true },
    role: { type: String, enum: ['user', 'host', 'admin', 'superadmin', 'staff', 'waiter', 'security'], default: 'user' },
    hostId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // for staff to link to their host
    preferredZone: { type: String }, // for staff zone preference
    onboardingCompleted: { type: Boolean, default: false },
    emailVerified: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    profileImage: { type: String, default: '' },
    dob: { type: Date },
    location: { type: String, default: '' },
    username: { type: String, unique: true, sparse: true },
    referralCode: { type: String, unique: true, sparse: true },
    referredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    referralsCount: { type: Number, default: 0 },
    loyaltyPoints: { type: Number, default: 0 },
    refreshToken: { type: String, default: null },
    expoPushToken: { type: String, default: null },
    resetPasswordToken: { type: String },
    resetPasswordExpire: { type: Date },
    verificationToken: { type: String },
    verificationTokenExpire: { type: Date }
}, { timestamps: true });

// Pre-save hook to hash password if modified
userSchema.pre('save', async function (next) {
    if (!this.isModified('password')) return next();

    try {
        const salt = await bcrypt.genSalt(10);
        this.password = await bcrypt.hash(this.password, salt);
        next();

    } catch (err) {
        next(err);
    }
});

// Method to verify password
userSchema.methods.comparePassword = async function (candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
};

// ⚡ PRODUCTION-READY INDEXES - Optimized for auth and queries
userSchema.index({ phone: 1 }, { unique: true, sparse: true }); // Auth (CRITICAL)
userSchema.index({ email: 1 }, { unique: true, sparse: true }); // Auth (CRITICAL)
userSchema.index({ role: 1, isActive: 1 }); // Auth middleware (CRITICAL)
userSchema.index({ role: 1 });
userSchema.index({ isActive: 1 });
userSchema.index({ createdAt: -1 });
userSchema.index({ onboardingCompleted: 1 });
userSchema.index({ hostId: 1, role: 1 });
userSchema.index({ name: 'text', email: 'text', username: 'text', phone: 'text' }); // Full-text search
userSchema.index({ updatedAt: -1 }); // Smart refresh check

export const User = mongoose.model('User', userSchema);
