import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import compression from 'compression';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import passport from 'passport';

dotenv.config();

import { logger } from './src/logs/logger.js';

const NODE_ENV  = process.env.NODE_ENV || 'development';
const MONGO_URI = process.env.MONGO_URI;
const PORT      = process.env.PORT || 3001;

// ── User Routes ────────────────────────────────────────────────────────────────
import authRoutes           from './src/routes/auth.routes.js';
import userRoutes           from './src/routes/user.routes.js';
import aiRoutes             from './src/routes/ai.routes.js';
import notificationRoutes   from './src/routes/notification.routes.js';
import paymentRoutes        from './src/routes/payment.routes.js';
import discoveryRoutes      from './src/routes/discovery.routes.js';
import drinkRequestRoutes   from './src/routes/drinkRequest.routes.js';
import radarRoutes          from './src/routes/radar.routes.js';
import floorRoutes          from './src/routes/floor.routes.js';
import chatRoutes           from './src/routes/chat.routes.js';
import walletRoutes         from './src/routes/wallet.routes.js';
import couponRoutes         from './src/routes/coupon.routes.js';
import referralRewardRoutes from './src/routes/referralReward.routes.js';
import supportRoutes        from './src/routes/support.routes.js';
import { errorHandler }     from './src/middleware/error.js';

// ── App Setup ─────────────────────────────────────────────────────────────────
const app = express();
app.set('trust proxy', 1);
app.use(helmet());
app.use(compression());
app.use(cors({ origin: '*', methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'] }));
app.options('*', cors());
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, message: { success: false, message: 'Too many requests' } }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cookieParser());
app.use(passport.initialize());
app.use(NODE_ENV === 'production' ? morgan('tiny') : morgan('dev'));

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/',       (_, res) => res.json({ status: 'active', service: 'user-api', env: NODE_ENV }));
app.get('/health', (_, res) => res.status(200).json({ success: true, service: 'user-api', ts: new Date().toISOString() }));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/auth',                    authRoutes);
app.use('/api/auth',                authRoutes);
app.use('/user',                    userRoutes);
app.use('/discovery',               discoveryRoutes);
app.use('/support',                 supportRoutes);
app.use('/api/v1/support',          aiRoutes);
app.use('/api/v1/notifications',    notificationRoutes);
app.use('/api/v1/payments',         paymentRoutes);
app.use('/api/v1/drink-requests',   drinkRequestRoutes);
app.use('/api/v1/radar',            radarRoutes);
app.use('/api/v1/floors',           floorRoutes);
app.use('/api/v1/chat',             chatRoutes);
app.use('/api/v1/wallet',           walletRoutes);
app.use('/api/v1/coupons',          couponRoutes);
app.use('/api/v1/referral',         referralRewardRoutes);
app.use('/invite',                  referralRewardRoutes);

app.use((req, res) => res.status(404).json({ success: false, message: 'Endpoint not found' }));
app.use(errorHandler);

// ── DB + Start ────────────────────────────────────────────────────────────────
const startServer = async () => {
    try {
        if (!MONGO_URI) { logger.error('MONGO_URI missing'); process.exit(1); }
        await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 5000, socketTimeoutMS: 45000, maxPoolSize: 50 });
        logger.info('✔ MongoDB connected (user-api)');

        const { initSocket } = await import('./src/socket.js');
        const { initLocationRevealService } = await import('./src/services/locationReveal.service.js');
        const { initIssueEscalationService } = await import('./src/services/issueEscalation.service.js');

        const server = app.listen(PORT, '0.0.0.0', () => logger.info(`🚀 User API on port ${PORT}`));
        server.keepAliveTimeout = 65000;
        server.headersTimeout   = 66000;
        initSocket(server);
        initLocationRevealService();
        initIssueEscalationService();

        // Cache warm-up
        setTimeout(async () => {
            try {
                const { Event }        = await import('./src/models/Event.js');
                const { User }         = await import('./src/models/user.model.js');
                const { cacheService } = await import('./src/services/cache.service.js');
                try { await User.collection.dropIndex('email_1'); } catch(_) {}
                try { await User.collection.dropIndex('phone_1'); } catch(_) {}
                await User.syncIndexes();
                const today = new Date(); today.setHours(0,0,0,0);
                const events = await Event.find({ status: 'LIVE', date: { $gte: today } })
                    .select('title date startTime coverImage locationVisibility isLocationRevealed locationData floorCount tickets floors hostId hostModel attendeeCount')
                    .sort({ date: 1 }).lean();
                await cacheService.set('events_all_guest_v11', events, 120);
                logger.info('⚡ Cache warm-up complete');
            } catch(e) { logger.warn('[Cache] ' + e.message); }
        }, 3000);

    } catch(err) { logger.error(err.message); process.exit(1); }
};

startServer();
process.on('uncaughtException',  (err) => { logger.error('Uncaught Exception',  err); process.exit(1); });
process.on('unhandledRejection', (err) => { logger.error('Unhandled Rejection', err); process.exit(1); });
