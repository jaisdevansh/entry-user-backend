import { GoogleGenerativeAI } from '@google/generative-ai';
import { SupportMessage } from '../models/support.model.js';
import Joi from 'joi';
import { cacheService } from '../services/cache.service.js';

// Validation Schema
export const askSupportSchema = Joi.object({
    message: Joi.string().required().max(500)
});

export const askSupport = async (req, res, next) => {
    try {
        const { message } = req.body;
        const userId = req.user.id;

        const { error } = askSupportSchema.validate({ message });
        if (error) {
            return res.status(400).json({ success: false, message: error.details[0].message });
        }

        // 1. Save User Message
        const userMsg = await SupportMessage.create({
            userId,
            content: message,
            role: 'user'
        });
        
        // Invalidate cache on new message
        await cacheService.del(cacheService.formatKey('support', userId));

        // 2. Initialize Gemini
        if (!process.env.GEMINI_API_KEY) {
            return res.status(500).json({ success: false, message: "Gemini API Key is not configured in backend." });
        }

        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });


        // 3. Fetch recent history for context (only fields needed by Gemini)
        const history = await SupportMessage.find({ userId })
            .select('role content createdAt')
            .sort({ createdAt: -1 })
            .limit(10)
            .lean();

        const context = history.reverse().map(m => ({
            role: m.role === 'ai' ? 'model' : 'user',
            parts: [{ text: m.content }]
        }));

        // 4. Generate AI Response
        const chat = model.startChat({
            history: [
                {
                    role: "user",
                    parts: [{ text: "You are the 'Entry Club Concierge', an elite AI assistant for 'Entry Club'. Entry Club helps members discover exclusive events, premium venues, and luxury nightlife experiences. Your tone must be sophisticated, helpful, and exclusive. Keep responses concise. If a user asks about memberships, mention Essential, Gold, and Black tiers. If they ask about booking or entry status, guide them to their dashboard or the specific venue page." }],
                },
                {
                    role: "model",
                    parts: [{ text: "Welcome to Entry Club. I am your personal concierge, dedicated to elevating your experience. How may I assist you this evening?" }],
                },
                ...context.slice(0, -1)
            ],
        });

        const result = await chat.sendMessage(message);
        const response = await result.response;
        const aiResponseText = response.text();

        // 5. Save AI Response
        const aiMsg = await SupportMessage.create({
            userId,
            content: aiResponseText,
            role: 'ai',
            metadata: {
                model: "gemini-2.5-flash"
            }
        });


        res.status(200).json({
            success: true,
            data: {
                message: aiResponseText,
                historyId: aiMsg._id,
                userMessageId: userMsg._id
            }
        });

    } catch (err) {
        console.error('[AI Chat] Error:', err.message);
        
        // GRACEFUL FALLBACK FOR LOCAL DEV NETWORK BLOCKING
        if (err.message && err.message.includes('fetch failed')) {
            return res.status(200).json({
                success: true,
                data: {
                    message: "I am experiencing network connectivity issues at the moment. Please try again later.",
                    historyId: "fallback_sys_error",
                    userMessageId: "fallback_sys_usr"
                }
            });
        }

        res.status(500).json({
            success: false,
            message: "AI Support failed to respond",
            error: err.message
        });
    }
};

export const getSupportChat = async (req, res, next) => {
    try {
        const cacheKey = cacheService.formatKey('support', req.user.id);
        const messages = await cacheService.wrap(cacheKey, 30, async () => {
             return await SupportMessage.find({ userId: req.user.id })
                .sort({ createdAt: 1 })
                .limit(50)
                .lean();
        });

        res.status(200).json({
            success: true,
            data: messages
        });
    } catch (err) {
        next(err);
    }
};

export const clearSupportChat = async (req, res, next) => {
    try {
        await SupportMessage.deleteMany({ userId: req.user.id });
        res.status(200).json({
            success: true,
            message: "Chat history cleared successfully"
        });
    } catch (err) {
        next(err);
    }
};

export const deleteSupportMessage = async (req, res, next) => {
    try {
        const { id } = req.params;
        const message = await SupportMessage.findOne({ _id: id, userId: req.user.id });

        if (!message) {
            return res.status(404).json({ success: false, message: "Message not found" });
        }

        await SupportMessage.findByIdAndDelete(id);
        res.status(200).json({
            success: true,
            message: "Message deleted successfully"
        });
    } catch (err) {
        next(err);
    }
};

// --- TECHNICAL TRIAGE & BUG REPORTING ---
export const submitBugReport = async (req, res, next) => {
    try {
        const { description, images, metadata } = req.body;
        const { User } = await import('../models/user.model.js');
        const user = await User.findById(req.user.id).select('name email username profileImage').lean();

        let uploadedUrls = [];
        if (images && images.length > 0) {
            try {
                const { uploadToCloudinary } = await import('../config/cloudinary.config.js');
                uploadedUrls = await Promise.all(images.map(img => uploadToCloudinary(img, 'entry-club/bugs')));
            } catch (cloudErr) { console.error('[Cloudinary] Upload Fail:', cloudErr.message); }
        }

        const transporter = (await import('nodemailer')).default.createTransport({
            service: 'gmail',
            auth: { user: process.env.EMAIL_USER || 'stitchapp.support@gmail.com', pass: process.env.EMAIL_PASS }
        });

        const html = `
            <h2>Bug Report</h2>
            <p><b>Reporter:</b> ${user?.name} (@${user?.username})</p>
            <p><b>OS:</b> ${metadata?.os} (${metadata?.osVersion})</p>
            <hr/>
            <p>${description}</p>
            ${uploadedUrls.length > 0 ? uploadedUrls.map(url => `<img src="${url}" width="200" style="margin: 5px;"/>`).join('') : ''}
        `;

        transporter.sendMail({
            from: `"STITCH Triage" <${process.env.EMAIL_USER || 'stitchapp.support@gmail.com'}>`,
            to: 'devanshjais20@gmail.com',
            subject: `🐞 BUG: ${description.substring(0, 40)}`,
            html
        }).catch(e => console.error('[Nodemailer] Dispatch Fail:', e.message));

        res.status(200).json({ success: true, message: 'Bug report dispatched to dev' });
    } catch (err) { next(err); }
};

export const submitSupportRequest = async (req, res, next) => {
    try {
        const { name, message } = req.body;
        const { User } = await import('../models/user.model.js');
        const user = await User.findById(req.user.id).select('email username').lean();

        const transporter = (await import('nodemailer')).default.createTransport({
            service: 'gmail',
            auth: { user: process.env.EMAIL_USER || 'stitchapp.support@gmail.com', pass: process.env.EMAIL_PASS }
        });

        const html = `
            <h2>New Support Request</h2>
            <p><b>From:</b> ${name} (${user?.email})</p>
            <p><b>Message:</b></p>
            <p>${message}</p>
        `;

        transporter.sendMail({
            from: `"STITCH Support" <${process.env.EMAIL_USER || 'stitchapp.support@gmail.com'}>`,
            to: 'devanshjais20@gmail.com',
            subject: `🎫 Support Ticket: ${name}`,
            html: html
        }).catch(e => console.error('[Nodemailer][Support] Dispatch Fail:', e.message));

        res.status(200).json({ success: true, message: 'Support request sent to dev' });
    } catch (err) { next(err); }
};

export const submitIncidentReport = async (req, res, next) => {
    try {
        const { type, zone, tableId, message, eventId, hostId } = req.body;
        const userId = req.user.id;

        if (!type || !message) {
            return res.status(400).json({ success: false, message: 'type and message are required' });
        }

        const { IssueReport } = await import('../models/IssueReport.js');
        
        // If eventId/hostId not provided, try to get from active booking
        let finalEventId = eventId;
        let finalHostId = hostId;
        
        if (!finalEventId || !finalHostId) {
            const { Booking } = await import('../models/booking.model.js');
            const activeBooking = await Booking.findOne({ 
                userId, 
                status: { $in: ['approved', 'active', 'checked_in'] }
            }).select('eventId hostId').lean();
            
            if (activeBooking) {
                finalEventId = finalEventId || activeBooking.eventId;
                finalHostId = finalHostId || activeBooking.hostId;
            }
        }
        
        if (!finalEventId || !finalHostId) {
            return res.status(400).json({ 
                success: false, 
                message: 'eventId and hostId are required. Please ensure you have an active booking.' 
            });
        }

        const report = await IssueReport.create({ 
            userId, 
            eventId: finalEventId,
            hostId: finalHostId,
            type, 
            zone, 
            tableId, 
            message, 
            status: 'open' 
        });

        res.status(201).json({ success: true, message: 'Incident reported', data: report });
    } catch (err) { 
        console.error('[Incident Report] Error:', err.message);
        next(err); 
    }
};

export const submitReview = async (req, res, next) => {
    try {
        const { eventId, hostId, rating, comment } = req.body;
        const userId = req.user.id;

        if (!eventId || !rating) {
            return res.status(400).json({ success: false, message: 'eventId and rating are required' });
        }

        const { Review } = await import('../models/Review.js');
        const review = await Review.create({ userId, eventId, hostId, rating, comment });

        res.status(201).json({ success: true, message: 'Review submitted', data: review });
    } catch (err) { next(err); }
};
