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
    callbackURL:  process.env.NODE_ENV === 'production' 
        ? 'https://test-53pw.onrender.com/api/auth/callback/google'
        : 'http://localhost:3000/api/auth/callback/google',
    scope: ['profile', 'email'],
}, async (accessToken, refreshToken, profile, done) => {
    try {
        console.log('--- [BACKEND DEBUG] Google Strategy Callback ---');
        const email = profile.emails?.[0]?.value?.toLowerCase();
        console.log('[DEBUG] Google Email acquired:', email);
        const name  = profile.displayName || '';
        const picture = profile.photos?.[0]?.value || '';
        const googleId = profile.id;

        if (!email) {
            console.error('[DEBUG] No email found in Google profile');
            return done(new Error('No email from Google'), null);
        }

        // 🔒 SECURITY: Google login is ONLY for regular users, not admin/host/staff
        // Admin/Host/Staff must use their dedicated login flows (OTP or password)
        console.log('[DEBUG] Searching for user in User collection only...');
        let user = await User.findOne({ email: { $regex: new RegExp(`^${email}$`, 'i') } });
        
        // 🚨 BLOCK: If email exists in Admin/Host/Staff, reject Google login
        const [adminExists, hostExists, staffExists] = await Promise.all([
            Admin.findOne({ email: { $regex: new RegExp(`^${email}$`, 'i') } }),
            Host.findOne({ email: { $regex: new RegExp(`^${email}$`, 'i') } }),
            Staff.findOne({ email: { $regex: new RegExp(`^${email}$`, 'i') } }),
        ]);
        
        if (adminExists || hostExists || staffExists) {
            console.error('[DEBUG] Email belongs to Admin/Host/Staff - Google login not allowed');
            return done(new Error('This email is registered as Admin/Host/Staff. Please use the appropriate login method.'), null);
        }

        if (!user) {
            console.log('[DEBUG] New user! Provisioning with auto-username...');
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
                onboardingCompleted: true,   // ✅ No onboarding for Google users
                isActive: true,
                referralCode,
            });
            await user.save();
            console.log(`[DEBUG] User created: ${email} | username: ${autoUsername}`);
        } else {
            console.log('[DEBUG] Existing user found. Role:', user.role);
            // Patch missing fields for existing users
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
        console.error('[DEBUG] Strategy Error:', err.message);
        return done(err, null);
    }
}));

// ── Google OAuth Routes ───────────────────────────────────────────────────────

// Step 1: Redirect user to Google login page
router.get('/google', (req, res, next) => {
    console.log('--- [BACKEND DEBUG] GET /api/auth/google hit ---');
    const redirectUri = req.query.redirectUri || 'entry-club://auth';
    const state = Buffer.from(JSON.stringify({ redirectUri })).toString('base64');
    passport.authenticate('google', { scope: ['profile', 'email'], session: false, state })(req, res, next);
});

// Step 2: Google calls back → generate JWT → deep-link back to app
router.get('/callback/google',
    (req, res, next) => {
        console.log('--- [BACKEND DEBUG] Callback hit from Google ---');
        // Handle failed authentication
        if (req.query.error) {
            let redirectUri = 'entry-club://auth';
            if (req.query.state) {
                try {
                    const decoded = JSON.parse(Buffer.from(req.query.state, 'base64').toString('utf8'));
                    if (decoded.redirectUri) redirectUri = decoded.redirectUri;
                } catch(e) {}
            }
            return res.redirect(`${redirectUri}?error=google_failed`);
        }
        passport.authenticate('google', { session: false })(req, res, next);
    },
    async (req, res) => {
        try {
            console.log('--- [BACKEND DEBUG] Handling Final Callback ---');
            const user = req.user;
            
            let redirectUri = 'entry-club://auth';
            if (req.query.state) {
                try {
                    const decoded = JSON.parse(Buffer.from(req.query.state, 'base64').toString('utf8'));
                    if (decoded.redirectUri) redirectUri = decoded.redirectUri;
                } catch(e) {}
            }

            if (!user) {
                console.error('[DEBUG] No user object in request after passport auth');
                return res.redirect(`${redirectUri}?error=no_user`);
            }

            console.log('[DEBUG] Generating JWT for user:', user.email);
            
            // ⚡ LONG SESSION: Generate tokens with extended expiry (matching regular login)
            const token = jwt.sign(
                { userId: user._id, role: user.role, hostId: user.hostId || null },
                process.env.JWT_SECRET || 'supersecretkey123',
                { expiresIn: '30d' }  // ⚡ 30 days for persistent sessions
            );
            
            const refreshToken = jwt.sign(
                { userId: user._id },
                process.env.JWT_REFRESH_SECRET || 'superrefreshsecret123',
                { expiresIn: '90d' }  // ⚡ 90 days for persistent sessions
            );
            
            // ⚡ FIX: Save refresh token to database (now properly async)
            await user.constructor.updateOne(
                { _id: user._id }, 
                { $set: { refreshToken } }
            );

            // ⚡ CRITICAL: Clear cached profile data for this user to prevent stale data
            const { cacheService } = await import('../services/cache.service.js');
            await cacheService.delete(cacheService.formatKey('profile_v2', user._id.toString()));
            console.log('[DEBUG] Cleared cached profile for user:', user._id.toString());

            const params = new URLSearchParams({
                token,
                refreshToken,  // ⚡ FIX: Include refresh token in callback
                role:                user.role || 'user',
                name:                user.name || '',
                email:               user.email || '',
                profileImage:        user.profileImage || '',
                onboardingCompleted: 'true',   // ✅ Google users always skip onboarding
                hostId:              user.hostId?.toString() || '',
                username:            user.username || '',
                phone:               user.phone || '',
                gender:              user.gender || '',
                userId:              user._id.toString(),
            });

            const deepLink = `${redirectUri}?${params.toString()}`;
            console.log('[DEBUG] Redirecting back to app via Deep Link:', deepLink.substring(0, 50) + '...');
            console.log('[DEBUG] User data being sent:', {
                name: user.name,
                email: user.email,
                profileImage: user.profileImage,
                username: user.username,
                userId: user._id.toString()
            });
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
router.post('/google', googleLogin); // Legacy: mobile token-based fallback

export default router;
