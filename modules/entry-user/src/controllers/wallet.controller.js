import { PointsWallet } from '../models/PointsWallet.js';
import { User } from '../models/user.model.js';

export const getWalletBalance = async (req, res) => {
    try {
        let wallet = await PointsWallet.findOne({ userId: req.user.id }).lean();
        
        if (!wallet) {
            // Auto-create wallet if it doesn't exist
            wallet = await PointsWallet.create({ userId: req.user.id, points: 0 });
        }

        res.status(200).json({
            success: true,
            data: wallet
        });
    } catch (error) {
        console.error('getWalletBalance Error:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

export const addPoints = async (req, res) => {
    try {
        const amount = Number(req.body.points) || 200;
        const userId = req.user.id;

        // Update PointsWallet (source of truth for rewards screen)
        const wallet = await PointsWallet.findOneAndUpdate(
            { userId },
            { $inc: { points: amount }, $setOnInsert: { userId } },
            { upsert: true, new: true }
        );

        // Also sync to User.loyaltyPoints
        await User.updateOne({ _id: userId }, { $inc: { loyaltyPoints: amount } });

        res.status(200).json({
            success: true,
            message: `✅ ${amount} points added to your wallet!`,
            data: { points: wallet.points }
        });
    } catch (error) {
        console.error('addPoints Error:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};
