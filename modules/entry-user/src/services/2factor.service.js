/**
 * 2Factor SMS Service
 * Documentation: https://2factor.in/docs
 */

import axios from 'axios';

const API_KEY = process.env.TWO_FACTOR_API_KEY;
const BASE_URL = 'https://2factor.in/API/V1';

/**
 * Send OTP via 2Factor SMS
 * @param {string} phoneNumber - Phone number without country code (e.g., "9876543210")
 * @returns {Promise<{sessionId: string, status: string}>}
 */
export const send2FactorOtp = async (phoneNumber) => {
    if (!API_KEY) {
        throw new Error('[2Factor] TWO_FACTOR_API_KEY not set in .env');
    }

    // Remove +91 if present
    const cleanPhone = phoneNumber.replace(/^\+91/, '').replace(/\s/g, '');

    try {
        const response = await axios.get(`${BASE_URL}/${API_KEY}/SMS/${cleanPhone}/AUTOGEN`);
        
        console.log(`[2Factor] OTP sent to ${cleanPhone} | Session: ${response.data.Details}`);
        
        return {
            sessionId: response.data.Details,
            status: response.data.Status,
            otp: response.data.OTP // Only in test mode
        };
    } catch (error) {
        console.error('[2Factor] Send OTP failed:', error.response?.data || error.message);
        throw new Error('Failed to send OTP via 2Factor');
    }
};

/**
 * Verify OTP via 2Factor
 * @param {string} sessionId - Session ID from send OTP
 * @param {string} otp - OTP code entered by user
 * @returns {Promise<boolean>}
 */
export const verify2FactorOtp = async (sessionId, otp) => {
    if (!API_KEY) {
        throw new Error('[2Factor] TWO_FACTOR_API_KEY not set in .env');
    }

    try {
        const response = await axios.get(
            `${BASE_URL}/${API_KEY}/SMS/VERIFY/${sessionId}/${otp}`
        );
        
        console.log(`[2Factor] Verify OTP: ${response.data.Status}`);
        
        return response.data.Status === 'Success';
    } catch (error) {
        console.error('[2Factor] Verify OTP failed:', error.response?.data || error.message);
        return false;
    }
};

/**
 * Send OTP with custom template
 * @param {string} phoneNumber - Phone number
 * @param {string} templateName - Template name from 2Factor dashboard
 * @param {object} variables - Template variables
 */
export const send2FactorOtpWithTemplate = async (phoneNumber, templateName, variables = {}) => {
    if (!API_KEY) {
        throw new Error('[2Factor] TWO_FACTOR_API_KEY not set in .env');
    }

    const cleanPhone = phoneNumber.replace(/^\+91/, '').replace(/\s/g, '');

    try {
        const response = await axios.post(
            `${BASE_URL}/${API_KEY}/SMS/${cleanPhone}/AUTOGEN/${templateName}`,
            variables
        );
        
        return {
            sessionId: response.data.Details,
            status: response.data.Status
        };
    } catch (error) {
        console.error('[2Factor] Template OTP failed:', error.response?.data || error.message);
        throw new Error('Failed to send template OTP');
    }
};
