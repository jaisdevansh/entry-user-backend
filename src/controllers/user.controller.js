import { User } from '../models/user.model.js';
import { Host } from '../models/Host.js';
import { Staff } from '../models/Staff.js';
import { Admin } from '../models/admin.model.js';
import { Venue } from '../models/Venue.js';
import { updateProfileSchema, changePasswordSchema, updateMembershipSchema } from '../validators/user.validator.js';
import { cacheService } from '../services/cache.service.js';
import { ReferralReward } from '../models/ReferralReward.js';
import { PointsWallet } from '../models/PointsWallet.js';
import { AppRating } from '../models/AppRating.js';

export const getProfile = async (req, res, next) => {
    try {
        const { id, role } = req.user;
        const cacheKey = cacheService.formatKey('profile_v2', id);
        
        const cached = await cacheService.get(cacheKey);
        if (cached) {
            res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
            return res.status(200).json({ success: true, data: typeof cached === 'string' ? JSON.parse(cached) : cached });
        }

        let user = null;
        const normalizedRole = role?.toUpperCase();
        const SELECT = '-password -refreshToken -__v -createdAt -updatedAt';
        
        if (normalizedRole === 'HOST') {
            user = await Host.findById(id).select(SELECT).lean();
        } else if (['ADMIN', 'SUPERADMIN'].includes(normalizedRole)) {
            user = await Admin.findById(id).select(SELECT).lean();
        } else if (['STAFF', 'WAITER', 'SECURITY'].includes(normalizedRole)) {
            user = await Staff.findById(id).select(SELECT).lean();
        } else {
            user = await User.findById(id).select(SELECT).lean();
        }

        if (!user) {
            const [admin, host, staff, regularUser] = await Promise.all([
                Admin.findById(id).select(SELECT).lean(),
                Host.findById(id).select(SELECT).lean(),
                Staff.findById(id).select(SELECT).lean(),
                User.findById(id).select(SELECT).lean()
            ]);
            user = admin || host || staff || regularUser;
        }

        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        if (user && !user.name && user.firstName) {
            user.name = `${user.firstName || ''} ${user.lastName || ''}`.trim();
            user.fullName = user.name;
        }

        if (['staff', 'waiter', 'security'].includes(user.role?.toLowerCase()) && user.hostId) {
            const venue = await Venue.findOne({ hostId: user.hostId }).select('name heroImage venueType').lean();
            if (venue) user.venue = venue;
        }

        await cacheService.set(cacheKey, user, 600);
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.status(200).json({ success: true, data: user });
    } catch (err) { next(err); }
};

export const updateProfile = async (req, res, next) => {
    try {
        const { id, role } = req.user;
        const { error } = updateProfileSchema.validate(req.body);
        if (error) return res.status(400).json({ success: false, message: error.details[0].message });

        let user;
        const normalizedRole = role?.toUpperCase();

        if (normalizedRole === 'HOST') {
            user = await Host.findByIdAndUpdate(id, req.body, { new: true }).select('-password -refreshToken');
        } else if (['ADMIN', 'SUPERADMIN'].includes(normalizedRole)) {
            user = await Admin.findByIdAndUpdate(id, req.body, { new: true }).select('-password -refreshToken');
        } else if (['STAFF', 'WAITER', 'SECURITY'].includes(normalizedRole)) {
            user = await Staff.findByIdAndUpdate(id, req.body, { new: true }).select('-password -refreshToken');
        } else {
            user = await User.findByIdAndUpdate(id, req.body, { new: true }).select('-password -refreshToken');
        }

        await cacheService.delete(cacheService.formatKey('profile_v2', id));
        res.status(200).json({ success: true, data: user });
    } catch (err) { next(err); }
};

export const checkUsername = async (req, res, next) => {
    try {
        const { username } = req.body;
        if (!username) return res.status(400).json({ success: false, message: 'Username required' });

        const clean = username.toLowerCase().replace(/[^a-z0-9_.]/g, '');
        const exists = await User.exists({ username: clean });

        if (!exists) {
            return res.status(200).json({ success: true, available: true, suggestions: [] });
        }

        // Generate smart suggestions and check availability in parallel
        const year = new Date().getFullYear().toString().slice(-2);
        const rand = () => Math.floor(10 + Math.random() * 990);
        const candidates = [
            `${clean}${rand()}`,
            `${clean}_${rand()}`,
            `${clean}${year}`,
            `_${clean}${rand()}`,
            `${clean}.x`,
        ];

        const taken = await User.find({ username: { $in: candidates } }).select('username').lean();
        const takenSet = new Set(taken.map(u => u.username));
        const suggestions = candidates.filter(s => !takenSet.has(s)).slice(0, 4);

        return res.status(200).json({ success: true, available: false, suggestions });
    } catch (err) { next(err); }
};

export const changePassword = async (req, res, next) => {
    try {
        const { id, role } = req.user;
        const { currentPassword, newPassword } = req.body;
        const { error } = changePasswordSchema.validate(req.body);
        if (error) return res.status(400).json({ success: false, message: error.details[0].message });

        let user;
        if (role?.toUpperCase() === 'HOST') {
            user = await Host.findById(id);
        } else if (['ADMIN', 'SUPERADMIN'].includes(role?.toUpperCase())) {
            user = await Admin.findById(id);
        } else {
            user = await User.findById(id);
        }

        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        const isMatch = await user.comparePassword(currentPassword);
        if (!isMatch) return res.status(400).json({ success: false, message: 'Invalid current password' });

        if (role?.toUpperCase() === 'ADMIN' || role?.toUpperCase() === 'SUPERADMIN') {
            user.passwordHash = newPassword;
        } else {
            user.password = newPassword;
        }
        
        await user.save();
        res.status(200).json({ success: true, message: 'Password updated' });
    } catch (err) { next(err); }
};

export const updateMembership = async (req, res, next) => {
    try {
        const { tier } = req.body;
        const { error } = updateMembershipSchema.validate(req.body);
        if (error) return res.status(400).json({ success: false, message: error.details[0].message });

        const user = await User.findByIdAndUpdate(req.user.id, { membershipTier: tier }, { new: true });
        await cacheService.delete(cacheService.formatKey('profile', req.user.id));
        res.status(200).json({ success: true, data: user });
    } catch (err) { next(err); }
};

export const submitAppRating = async (req, res, next) => {
    try {
        const { stars, feedback } = req.body;
        const userId = req.user.id;

        if (!stars || stars < 1 || stars > 5) {
            return res.status(400).json({ success: false, message: 'Rating stars must be between 1 and 5' });
        }

        const rating = await AppRating.create({ userId, stars, feedback });

        res.status(200).json({ success: true, message: 'Rating received', data: rating });
    } catch (err) { next(err); }
};

export const getReferralData = async (req, res, next) => {
    try {
        const user = await User.findById(req.user.id).select('referralCode referralsCount loyaltyPoints').lean();
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });
        
        res.status(200).json({ success: true, data: user });
    } catch (err) { 
        console.error('getReferralData Error:', err);
        next(err); 
    }
};

export const applyReferralCode = async (req, res, next) => {
    try {
        const { code } = req.body;
        const userId = req.user.id;

        if (!code) return res.status(400).json({ success: false, message: 'Referral code is required' });

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        if (user.referredBy) {
            return res.status(400).json({ success: false, message: 'You have already used a referral code' });
        }

        const referrer = await User.findOne({ referralCode: code.trim().toUpperCase() });
        if (!referrer) {
            return res.status(404).json({ success: false, message: 'Invalid referral code' });
        }

        if (referrer._id.toString() === userId) {
            return res.status(400).json({ success: false, message: 'You cannot use your own referral code' });
        }

        // Prevent duplicate ReferralReward entries
        const existingReward = await ReferralReward.findOne({ referredUserId: userId });
        if (existingReward) {
            return res.status(400).json({ success: false, message: 'Referral already registered' });
        }

        // 1. Mark user as referred + give 50 pts on user record
        user.referredBy = referrer._id;
        user.loyaltyPoints = (user.loyaltyPoints || 0) + 50;
        await user.save();

        // 2. Give new user 50 pts in PointsWallet (source of truth for rewards screen)
        await PointsWallet.findOneAndUpdate(
            { userId },
            { $inc: { points: 50 }, $setOnInsert: { userId } },
            { upsert: true, new: true }
        );

        // 3. Create PENDING referral record — referrer gets 200 pts when referred user books
        await ReferralReward.create({
            referrerId: referrer._id,
            referredUserId: userId,
            pointsAmount: 200,
            status: 'pending'
        });

        console.log(`[applyReferralCode] ✅ User ${userId} used code of referrer ${referrer._id}. Pending 200pts for referrer.`);

        res.status(200).json({ 
            success: true, 
            message: '🎉 Referral applied! 50 bonus points added to your wallet.',
            data: { loyaltyPoints: user.loyaltyPoints }
        });
    } catch (err) { 
        console.error('applyReferralCode Error:', err);
        next(err); 
    }
};

export const sendSplitRequest = async (req, res, next) => {
    try {
        res.status(200).json({ success: true, message: 'Split request sent' });
    } catch (err) { next(err); }
};

export const getSplitRequests = async (req, res, next) => {
    try {
        res.status(200).json({ success: true, data: [] });
    } catch (err) { next(err); }
};

export const respondSplitRequest = async (req, res, next) => {
    try {
        res.status(200).json({ success: true, message: 'Split responded' });
    } catch (err) { next(err); }
};
