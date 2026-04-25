/**
 * sms.service.js
 * ─────────────────────────────────────────────────────────────
 * Twilio Verify V2 – send and check SMS OTPs.
 * Uses Twilio Verify Service for managed OTP delivery.
 * ─────────────────────────────────────────────────────────────
 */

import twilio from 'twilio';

const accountSid  = process.env.TWILIO_ACCOUNT_SID;
const authToken   = process.env.TWILIO_AUTH_TOKEN;
const serviceSid  = process.env.TWILIO_VERIFY_SERVICE_SID;

// Lazy-init so the service still boots even if env vars are missing
const getClient = () => {
    if (!accountSid || !authToken || !serviceSid) {
        throw new Error('[Twilio] Missing TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_VERIFY_SERVICE_SID in .env');
    }
    return twilio(accountSid, authToken);
};

/**
 * Send an OTP via Twilio Verify to a phone number.
 * @param {string} phoneNumber  E.164 format, e.g. "+919876543210"
 * @returns {Promise<{sid: string, status: string}>}
 */
export const sendSmsOtp = async (phoneNumber) => {
    const client = getClient();
    const verification = await client.verify.v2
        .services(serviceSid)
        .verifications
        .create({ to: phoneNumber, channel: 'sms' });

    console.log(`[Twilio] OTP sent to ${phoneNumber} | SID: ${verification.sid} | Status: ${verification.status}`);
    return { sid: verification.sid, status: verification.status };
};

/**
 * Verify the OTP code a user entered via Twilio Verify.
 * @param {string} phoneNumber  E.164 format
 * @param {string} code         6-digit OTP entered by the user
 * @returns {Promise<boolean>}  true = approved, false = invalid/expired
 */
export const verifySmsOtp = async (phoneNumber, code) => {
    const client = getClient();
    const check = await client.verify.v2
        .services(serviceSid)
        .verificationChecks
        .create({ to: phoneNumber, code });

    console.log(`[Twilio] Verify check for ${phoneNumber}: ${check.status}`);
    return check.status === 'approved';
};
