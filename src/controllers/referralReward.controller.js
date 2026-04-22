import mongoose from 'mongoose';
import { User } from '../models/user.model.js';
import { ReferralReward } from '../models/ReferralReward.js';
import { PointsWallet } from '../models/PointsWallet.js';

/**
 * Creates a pending referral when B signs up using A's code
 */
export const createPendingReferral = async (req, res) => {
    try {
        const { referralCode } = req.body; // B sends this during signup/onboarding
        const referredId = req.user.id; // User B

        const referrer = await User.findOne({ referralCode });
        if (!referrer) {
            return res.status(404).json({ success: false, message: 'Invalid referral code' });
        }

        if (referrer._id.toString() === referredId) {
            return res.status(400).json({ success: false, message: 'Cannot refer yourself' });
        }

        // Ensure no duplicate
        const existing = await ReferralReward.findOne({ referredUserId: referredId });
        if (existing) {
            return res.status(400).json({ success: false, message: 'Already referred' });
        }

        const reward = await ReferralReward.create({
            referrerId: referrer._id,
            referredUserId: referredId,
            pointsAmount: 100, // 100 base points config
            status: 'pending'
        });

        res.status(201).json({ success: true, data: reward });
    } catch (error) {
        console.error('createPendingReferral Error:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

/**
 * Unlocks referral and increments A's wallet when B completes action (e.g. books event)
 */
export const unlockReferralReward = async (req, res) => {
    try {
        const { referredId } = req.body; 

        // Find pending reward securely 
        const reward = await ReferralReward.findOne({ 
            referredUserId: referredId,
            status: 'pending' 
        });

        if (!reward) {
            return res.status(200).json({ success: true, message: 'No pending referral found' });
        }

        // 1. Mark as unlocked
        reward.status = 'unlocked';
        await reward.save();

        // 2. Increment wallet of User A
        let wallet = await PointsWallet.findOne({ userId: reward.referrerId });
        if (!wallet) {
            wallet = await PointsWallet.create({ userId: reward.referrerId, points: 0 });
        }

        wallet.points += reward.pointsAmount;
        await wallet.save();

        // 3. Increment legacy loyaltyPoints and referralsCount for backwards compatibility
        await User.updateOne(
            { _id: reward.referrerId },
            { $inc: { loyaltyPoints: reward.pointsAmount, referralsCount: 1 } }
        );

        res.status(200).json({ success: true, message: 'Referral unlocked and points awarded!' });
    } catch (error) {
        console.error('unlockReferralReward Error:', error);
        res.status(500).json({ success: false, message: 'Reward Processing Failed' });
    }
};

/**
 * Public handler for invite link — displays a landing page with a deep-link button.
 * Route: GET /invite/:code
 */
export const handleInvite = async (req, res) => {
    try {
        const { code } = req.params;
        const normalizedCode = code.toUpperCase();
        
        const user = await User.findOne({ referralCode: normalizedCode }).select('name profileImage').lean();
        
        // Deep link URI — scheme must match app.json "scheme": "entry-club"
        // NOTE: In Expo Router, route groups like (auth) are transparent — they do NOT
        // appear in the URL. So src/app/(auth)/signup.tsx is reachable at /signup.
        const appLink = `entry-club://signup?code=${normalizedCode}`;

        // Simple but premium HTML response
        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Entry Club — Join the Elite</title>
                <style>
                    body { background: #000; color: #fff; font-family: -apple-system, sans-serif; height: 100vh; margin: 0; display: flex; align-items: center; justify-content: center; overflow: hidden; }
                    .card { background: linear-gradient(135deg, #111 0%, #0a0a0a 100%); padding: 48px; border-radius: 32px; text-align: center; border: 1px solid #1f1f1f; width: 420px; box-shadow: 0 40px 100px rgba(0,0,0,0.8); }
                    .logo { font-size: 14px; color: #7c4dff; font-weight: 900; letter-spacing: 4px; margin-bottom: 24px; }
                    .avatar { width: 88px; height: 88px; border-radius: 44px; background: #1a1a1a; border: 1px solid rgba(124, 77, 255, 0.4); margin: 0 auto 24px; display: flex; align-items: center; justify-content: center; overflow: hidden; position: relative; }
                    .avatar-char { font-size: 36px; font-weight: 800; color: #7c4dff; text-transform: uppercase; }
                    .avatar img { width: 100%; height: 100%; object-fit: cover; }
                    h1 { font-size: 32px; font-weight: 900; margin-bottom: 12px; letter-spacing: -0.5px; }
                    p { color: #888; font-size: 16px; line-height: 1.6; margin-bottom: 40px; }
                    .btn { display: block; background: #7c4dff; color: #fff; text-decoration: none; padding: 20px; border-radius: 20px; font-weight: 800; font-size: 18px; box-shadow: 0 10px 40px rgba(124, 77, 255, 0.25); transition: transform 0.2s, background 0.2s; cursor: pointer; border: none; width: 100%; }
                    .btn:hover { background: #6c3dec; transform: translateY(-2px); }
                    .btn:active { transform: translateY(0); }
                    .footer { margin-top: 32px; font-size: 12px; color: #555; font-weight: 500; }
                </style>
            </head>
            <body>
                <div class="card">
                    <div class="logo">ENTRY CLUB</div>
                    <div class="avatar">
                        ${user?.profileImage && user.profileImage.startsWith('http') 
                            ? `<img src="${user.profileImage}" onerror="this.style.display='none'; document.getElementById('fbk').style.display='flex';" />` 
                            : ''}
                        <div id="fbk" class="avatar-char" style="${user?.profileImage && user.profileImage.startsWith('http') ? 'display:none;' : 'display:flex;'}">${user?.name?.[0] || 'E'}</div>
                    </div>
                    <h1>Join the Club</h1>
                    <p><strong>${user?.name || 'A private member'}</strong> has invited you to join the most exclusive nightlife discovery community.</p>
                    <a id="mainBtn" class="btn" href="${appLink}">ENTER THE CLUB</a>
                    <div class="footer">Opening this link will launch the Entry Club App</div>
                </div>
                <script>
                    // On Android Chrome, window.location.href for custom schemes is blocked
                    // unless triggered directly by a user gesture (tap).
                    // Using an <a href="..."> tag is the most reliable cross-platform approach.
                    // The script below is a fallback for devices that need it.
                    document.getElementById('mainBtn').addEventListener('click', function(e) {
                        e.preventDefault();
                        window.location.href = "${appLink}";
                        // If app not installed, show install hint after 2.5s
                        setTimeout(function() {
                            document.querySelector('.footer').textContent = 
                                'App not installed? Download Entry Club from the Play Store.';
                        }, 2500);
                    });
                </script>
            </body>
            </html>
        `);
    } catch (err) {
        console.error('handleInvite Error:', err);
        res.status(500).send('Server Error');
    }
};
