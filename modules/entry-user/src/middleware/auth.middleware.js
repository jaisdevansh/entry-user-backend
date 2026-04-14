import jwt from 'jsonwebtoken';
import { User } from '../models/user.model.js';
import { Admin } from '../models/admin.model.js';
import { Host } from '../models/Host.js';
import { Staff } from '../models/Staff.js';
import { cacheService } from '../services/cache.service.js';

export const protect = async (req, res, next) => {
    try {
        let token;

        // Check for token in cookies first, then auth header
        if (req.cookies && req.cookies.accessToken) {
            token = req.cookies.accessToken;
        } else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
            token = req.headers.authorization.split(' ')[1];
        }

        if (!token) {
            return res.status(401).json({ success: false, message: 'Not authorized to access this route', data: {} });
        }

        let decoded;
        try {
            decoded = jwt.verify(token, process.env.JWT_SECRET || 'supersecretkey123');
        } catch (jwtError) {
            // ⚡ PRODUCTION FIX: Handle JWT errors gracefully
            if (jwtError.name === 'TokenExpiredError') {
                console.error('[Auth] Token expired at:', jwtError.expiredAt);
                return res.status(401).json({ 
                    success: false, 
                    message: 'Token expired', 
                    code: 'TOKEN_EXPIRED',
                    data: {} 
                });
            }
            if (jwtError.name === 'JsonWebTokenError') {
                console.error('[Auth] Invalid token:', jwtError.message);
                return res.status(401).json({ 
                    success: false, 
                    message: 'Invalid token', 
                    code: 'INVALID_TOKEN',
                    data: {} 
                });
            }
            throw jwtError;
        }

        // ⚡ HIGH-PERFORMANCE ROLE & STATUS VALIDATION (Sub-ms via Redis)
        // Correct segments - this catches if a user is deactivated or their role changes
        const CACHE_KEY = `auth_status_${decoded.userId}`;
        let cached = await cacheService.get(CACHE_KEY);
        
        let userRole = decoded.role;
        let isActive = true;
        let tokenVersion = decoded.tokenVersion || 0;

        if (!cached) {
            const projection = 'role isActive tokenVersion';
             // ⚡ STRICT ROLE ISOLATION: Only check the User model
            const user = await User.findById(decoded.userId).select(projection).lean();
            
            if (user) {
                userRole = user.role;
                isActive = user.isActive;
                tokenVersion = user.tokenVersion || 0;
                await cacheService.set(CACHE_KEY, { role: userRole, isActive, tokenVersion }, 120); // 2 min cache
            } else {
                return res.status(401).json({ success: false, message: 'Record missing from registry.' });
            }
        } else {
            userRole = cached.role;
            isActive = cached.isActive;
            tokenVersion = cached.tokenVersion || 0;
        }

        if (!isActive) {
            return res.status(401).json({ success: false, message: 'Your administrative session has been revoked.' });
        }

        // ✅ Check tokenVersion (invalidate old sessions)
        if (decoded.tokenVersion !== undefined && decoded.tokenVersion !== tokenVersion) {
            return res.status(401).json({ success: false, error: 'Session expired', message: 'Session expired' });
        }

        // 🛠️ FIX: Standardize User ID across all consumers (id, _id, userId)
        const userId = decoded.userId || decoded.id || decoded._id;
        
        // ⚡ STRICT ROLE ISOLATION ENFORCEMENT
        if (userRole !== 'user') {
            return res.status(403).json({ success: false, message: 'Unauthorized. Area restricted to Users only.' });
        }

        req.user = { 
            ...decoded, 
            id: userId, 
            _id: userId, 
            userId: userId,
            role: userRole 
        }; // Attach updated role and standardized IDs
        
        next();
    } catch (error) {
        // ⚡ PRODUCTION FIX: Better error logging
        const errorDetails = {
            message: error.message,
            name: error.name,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        };
        console.error('[Auth Middleware] Error:', JSON.stringify(errorDetails, null, 2));
        
        // Return specific error codes for client handling
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ 
                success: false, 
                message: 'Token expired', 
                code: 'TOKEN_EXPIRED',
                data: {} 
            });
        }
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ 
                success: false, 
                message: 'Invalid token', 
                code: 'INVALID_TOKEN',
                data: {} 
            });
        }
        return res.status(401).json({ 
            success: false, 
            message: 'Authentication failed', 
            code: 'AUTH_FAILED',
            data: {} 
        });
    }
};

export const requireAdmin = (req, res, next) => {
    if (req.user && (req.user.role?.toUpperCase() === 'ADMIN' || req.user.role?.toUpperCase() === 'SUPERADMIN')) {
        next();
    } else {
        res.status(403).json({ success: false, message: 'Not authorized as an admin' });
    }
};
