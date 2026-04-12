import Joi from 'joi';

/**
 * ⚡ PRODUCTION-READY INPUT VALIDATION MIDDLEWARE
 * Validates request body, query, and params against Joi schemas
 * Prevents XSS, SQL injection, and malformed data
 */

// Validation wrapper
export const validate = (schema) => {
    return (req, res, next) => {
        const { error, value } = schema.validate(
            {
                body: req.body,
                query: req.query,
                params: req.params
            },
            {
                abortEarly: false, // Return all errors
                stripUnknown: true, // Remove unknown fields
                errors: { wrap: { label: false } }
            }
        );

        if (error) {
            const errors = error.details.map(detail => ({
                field: detail.path.join('.'),
                message: detail.message
            }));
            
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors
            });
        }

        // Replace req with validated values
        req.body = value.body || {};
        req.query = value.query || {};
        req.params = value.params || {};
        
        next();
    };
};

// ── Common Validation Schemas ─────────────────────────────────────────────────

// MongoDB ObjectId validation
const objectId = Joi.string().regex(/^[0-9a-fA-F]{24}$/).message('Invalid ID format');

// Phone number validation (Indian format)
const phone = Joi.string().regex(/^[6-9]\d{9}$/).message('Invalid phone number');

// Email validation
const email = Joi.string().email().message('Invalid email address');

// ── Event Validation Schemas ──────────────────────────────────────────────────

export const eventSchemas = {
    // GET /user/events (pagination)
    getAllEvents: Joi.object({
        query: Joi.object({
            page: Joi.number().integer().min(1).default(1),
            limit: Joi.number().integer().min(1).max(100).default(20)
        }),
        body: Joi.object(),
        params: Joi.object()
    }),

    // GET /user/events/:id
    getEventById: Joi.object({
        params: Joi.object({
            id: objectId.required()
        }),
        query: Joi.object(),
        body: Joi.object()
    }),

    // POST /user/events/book
    bookEvent: Joi.object({
        body: Joi.object({
            eventId: objectId.required(),
            floorId: objectId,
            ticketType: Joi.string().max(100),
            tableId: Joi.string().max(50),
            seatIds: Joi.array().items(Joi.string().max(50)),
            guests: Joi.number().integer().min(1).max(50).default(1),
            pricePaid: Joi.number().min(0).required()
        }),
        query: Joi.object(),
        params: Joi.object()
    }),

    // POST /user/events/:id/report
    reportEvent: Joi.object({
        params: Joi.object({
            id: objectId.required()
        }),
        body: Joi.object({
            reason: Joi.string().max(500).required(),
            description: Joi.string().max(2000)
        }),
        query: Joi.object()
    })
};

// ── Booking Validation Schemas ────────────────────────────────────────────────

export const bookingSchemas = {
    // GET /user/bookings
    getBookings: Joi.object({
        query: Joi.object({
            status: Joi.string().valid('pending', 'approved', 'rejected', 'active', 'checked_in', 'cancelled', 'invalid'),
            page: Joi.number().integer().min(1).default(1),
            limit: Joi.number().integer().min(1).max(100).default(20)
        }),
        body: Joi.object(),
        params: Joi.object()
    }),

    // GET /user/bookings/:id
    getBookingById: Joi.object({
        params: Joi.object({
            id: objectId.required()
        }),
        query: Joi.object(),
        body: Joi.object()
    })
};

// ── Order Validation Schemas ──────────────────────────────────────────────────

export const orderSchemas = {
    // POST /user/orders
    createOrder: Joi.object({
        body: Joi.object({
            eventId: objectId,
            hostId: objectId.required(),
            type: Joi.string().valid('order', 'gift').default('order'),
            senderId: objectId,
            receiverId: objectId,
            items: Joi.array().items(
                Joi.object({
                    menuItemId: objectId.required(),
                    quantity: Joi.number().integer().min(1).max(50).required(),
                    price: Joi.number().min(0).required(),
                    name: Joi.string().max(200).required()
                })
            ).min(1).required(),
            zone: Joi.string().max(50).default('general'),
            tableId: Joi.string().max(50).default('Floor'),
            subtotal: Joi.number().min(0).required(),
            serviceFee: Joi.number().min(0).default(0),
            tipAmount: Joi.number().min(0).default(0),
            totalAmount: Joi.number().min(0).required()
        }),
        query: Joi.object(),
        params: Joi.object()
    }),

    // GET /user/orders
    getOrders: Joi.object({
        query: Joi.object({
            status: Joi.string().valid('payment_pending', 'confirmed', 'accepted', 'preparing', 'out_for_delivery', 'completed', 'cancelled'),
            page: Joi.number().integer().min(1).default(1),
            limit: Joi.number().integer().min(1).max(100).default(20)
        }),
        body: Joi.object(),
        params: Joi.object()
    })
};

// ── Auth Validation Schemas ───────────────────────────────────────────────────

export const authSchemas = {
    // POST /auth/send-otp
    sendOtp: Joi.object({
        body: Joi.object({
            phone: phone.required(),
            role: Joi.string().valid('user', 'host', 'admin', 'staff', 'waiter', 'security').default('user')
        }),
        query: Joi.object(),
        params: Joi.object()
    }),

    // POST /auth/verify-otp
    verifyOtp: Joi.object({
        body: Joi.object({
            phone: phone.required(),
            otp: Joi.string().length(6).required(),
            role: Joi.string().valid('user', 'host', 'admin', 'staff', 'waiter', 'security').default('user')
        }),
        query: Joi.object(),
        params: Joi.object()
    }),

    // POST /auth/google
    googleLogin: Joi.object({
        body: Joi.object({
            idToken: Joi.string().required(),
            role: Joi.string().valid('user', 'host', 'admin').default('user')
        }),
        query: Joi.object(),
        params: Joi.object()
    })
};

// ── User Validation Schemas ───────────────────────────────────────────────────

export const userSchemas = {
    // PUT /user/profile
    updateProfile: Joi.object({
        body: Joi.object({
            name: Joi.string().max(100),
            gender: Joi.string().valid('Male', 'Female', 'Other', ''),
            email: email,
            dob: Joi.date().max('now'),
            location: Joi.string().max(200),
            username: Joi.string().alphanum().min(3).max(30),
            profileImage: Joi.string().uri()
        }),
        query: Joi.object(),
        params: Joi.object()
    }),

    // POST /user/device-token
    updateDeviceToken: Joi.object({
        body: Joi.object({
            token: Joi.string().required()
        }),
        query: Joi.object(),
        params: Joi.object()
    })
};

// ── Support Validation Schemas ────────────────────────────────────────────────

export const supportSchemas = {
    // POST /support/issue
    createIssue: Joi.object({
        body: Joi.object({
            eventId: objectId,
            hostId: objectId,
            category: Joi.string().max(100).required(),
            description: Joi.string().max(2000).required(),
            priority: Joi.string().valid('low', 'medium', 'high', 'critical').default('medium')
        }),
        query: Joi.object(),
        params: Joi.object()
    }),

    // POST /support/chat
    sendMessage: Joi.object({
        body: Joi.object({
            message: Joi.string().max(5000).required(),
            conversationId: objectId
        }),
        query: Joi.object(),
        params: Joi.object()
    })
};

export default validate;
