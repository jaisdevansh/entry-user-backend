import express from 'express';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import jwt from 'jsonwebtoken';
import { User } from '../models/user.model.js';
import { Admin } from '../models/admin.model.js';
import { Host } from '../models/Host.js';
import { Staff } from '../models/Staff.js';
import mongoose from 'mongoose';
import { register, login, refresh, logout, forgotPassword, resetPassword, verifyEmail, sendOtp, verifyOtp, completeOnboarding, googleLogin } from '../controllers/auth.controller.js';
import { protect } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validator.middleware.js';
import { registerSchema, loginSchema, refreshTokenSchema, forgotPasswordSchema, resetPasswordSchema, sendOtpSchema, verifyOtpSchema } from '../validators/auth.validator.js';

const router = express.Router();

// ── Username generation for Google users ─────────────────────────────────────
const generateUsername = (name) => {
    const base = (name || 'user').replace(/\s+/g, '').toLowerCase().slice(0, 5);
    const random = Math.floor(1000 + Math.random() * 9000);
    return `${base}${random}`;
};
const getUniqueUsername = async (name) => {
    let attempts = 0;
    while (attempts < 10) {
        const username = generateUsername(name);
        const exists = await User.findOne({ username });
        if (!exists) return username;
        attempts++;
    }
    return `user${Date.now().toString().slice(-6)}`;
};

// ── Passport Google Strategy (for web-based OAuth flow) ──────────────────────
passport.use(new GoogleStrategy({
    clientID:     process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL:  process.env.GOOGLE_CALLBACK_URL || 
        (process.env.NODE_ENV === 'production' 
            ? 'https://stayin.in/api2/auth/callback/google'
            : 'http://localhost:3001/api/auth/callback/google'),
    scope: ['profile', 'email'],
}, async (accessToken, refreshToken, profile, done) => {
    try {
        const email = profile.emails?.[0]?.value?.toLowerCase();
        const name  = profile.displayName || '';
        const picture = profile.photos?.[0]?.value || '';
        const googleId = profile.id;

        if (!email) return done(new Error('No email from Google'), null);

        // 🔒 SECURITY: Google login is ONLY for regular users, not admin/host/staff
        let user = await User.findOne({ email: { $regex: new RegExp(`^${email}$`, 'i') } });
        
        // 🚨 BLOCK: If email exists in Admin/Host/Staff, reject Google login
        const [adminExists, hostExists, staffExists] = await Promise.all([
            Admin.findOne({ email: { $regex: new RegExp(`^${email}$`, 'i') } }),
            Host.findOne({ email: { $regex: new RegExp(`^${email}$`, 'i') } }),
            Staff.findOne({ email: { $regex: new RegExp(`^${email}$`, 'i') } }),
        ]);
        
        if (adminExists || hostExists || staffExists) {
            return done(new Error('This email is registered as Admin/Host/Staff. Please use the appropriate login method.'), null);
        }

        if (!user) {
            const tempId = new mongoose.Types.ObjectId();
            const referralCode = Math.random().toString(36).substring(2, 8).toUpperCase()
                + tempId.toString().substring(18, 22).toUpperCase();
            const autoUsername = await getUniqueUsername(name);

            user = new User({
                _id: tempId,
                name,
                username: autoUsername,
                email,
                profileImage: picture || undefined,
                emailVerified: true,
                isVerified: true,
                provider: 'google',
                googleId,
                role: 'user',
                bio: '',
                onboardingCompleted: true,
                isActive: true,
                referralCode,
            });
            await user.save();
        } else {
            const updates = {};
            if (!user.profileImage && picture) updates.profileImage = picture;
            if (!user.googleId) updates.googleId = googleId;
            if (!user.username) updates.username = await getUniqueUsername(name || user.name || 'user');
            if (Object.keys(updates).length > 0) {
                await user.constructor.updateOne({ _id: user._id }, { $set: updates });
                Object.assign(user, updates);
            }
        }

        return done(null, user);
    } catch (err) {
        console.error('[Google Auth] Error:', err.message);
        return done(err, null);
    }
}));

// ── Google OAuth Routes ───────────────────────────────────────────────────────

// Step 1: Redirect user to Google login page
router.get('/google', (req, res, next) => {
    const redirectUri = req.query.redirectUri || 'entry-club://auth';
    const state = Buffer.from(JSON.stringify({ redirectUri })).toString('base64');
    passport.authenticate('google', { scope: ['profile', 'email'], session: false, state })(req, res, next);
});

// Step 2: Google calls back → generate JWT → deep-link back to app
router.get('/callback/google',
    (req, res, next) => {
        let redirectUri = 'entry-club://auth';
        if (req.query.state) {
            try {
                const decoded = JSON.parse(Buffer.from(req.query.state, 'base64').toString('utf8'));
                if (decoded.redirectUri) redirectUri = decoded.redirectUri;
            } catch(e) {}
        }

        if (req.query.error) {
            return res.redirect(`${redirectUri}?error=google_failed`);
        }

        passport.authenticate('google', { session: false }, (err, user, info) => {
            if (err) {
                console.error('[Google Callback] Auth Error:', err.message);
                const errMsg = err.message || 'server_error';
                return res.redirect(`${redirectUri}?error=${encodeURIComponent(errMsg)}`);
            }
            if (!user) {
                return res.redirect(`${redirectUri}?error=no_user`);
            }
            req.user = user;
            next();
        })(req, res, next);
    },
    async (req, res) => {
        try {
            const user = req.user;
            
            let redirectUri = 'entry-club://auth';
            if (req.query.state) {
                try {
                    const decoded = JSON.parse(Buffer.from(req.query.state, 'base64').toString('utf8'));
                    if (decoded.redirectUri) redirectUri = decoded.redirectUri;
                } catch(e) {}
            }

            if (!user) return res.redirect(`${redirectUri}?error=no_user`);
            
            const token = jwt.sign(
                { userId: user._id, role: user.role, hostId: user.hostId || null },
                process.env.JWT_SECRET || 'supersecretkey123',
                { expiresIn: '30d' }
            );
            
            const refreshToken = jwt.sign(
                { userId: user._id },
                process.env.JWT_REFRESH_SECRET || 'superrefreshsecret123',
                { expiresIn: '90d' }
            );
            
            await user.constructor.updateOne(
                { _id: user._id }, 
                { $set: { refreshToken } }
            );

            // Clear cached profile data
            const { cacheService } = await import('../services/cache.service.js');
            await cacheService.delete(cacheService.formatKey('profile_v2', user._id.toString()));

            const params = new URLSearchParams({
                token,
                refreshToken,
                role:                user.role || 'user',
                name:                user.name || '',
                email:               user.email || '',
                profileImage:        user.profileImage || '',
                onboardingCompleted: 'true',
                hostId:              user.hostId?.toString() || '',
                username:            user.username || '',
                phone:               user.phone || '',
                gender:              user.gender || '',
                userId:              user._id.toString(),
            });

            const deepLink = `${redirectUri}?${params.toString()}`;
            return res.redirect(deepLink);
        } catch (err) {
            console.error('[Google Callback] Error:', err.message);
            return res.redirect(`entry-club://auth?error=server_error`);
        }
    }
);

// ── Existing Auth Routes (unchanged) ─────────────────────────────────────────
router.post('/send-otp', validate(sendOtpSchema), sendOtp);
router.post('/verify-otp', validate(verifyOtpSchema), verifyOtp);
router.post('/register', validate(registerSchema), register);
router.post('/login', validate(loginSchema), login);
router.post('/refresh', validate(refreshTokenSchema), refresh);
router.post('/forgot-password', validate(forgotPasswordSchema), forgotPassword);
router.post('/reset-password', validate(resetPasswordSchema), resetPassword);
router.get('/verifyemail/:token', verifyEmail);
router.post('/verifyemail', verifyEmail);
router.post('/logout', protect, logout);
router.post('/onboarding', protect, completeOnboarding);
router.post('/google', googleLogin);

export default router;
