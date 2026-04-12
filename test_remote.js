import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';

(async () => {
    try {
        const uri = "mongodb+srv://jaisdevansh2004_db_user:V3pU4sMZdEEPwPzT@party.qaycsm4.mongodb.net/?appName=party";
        await mongoose.connect(uri);
        console.log('Connected to DB');
        
        const UserSchema = new mongoose.Schema({}, { strict: false });
        const User = mongoose.model('User', UserSchema, 'users');
        const user = await User.findOne({});
        console.log('Found user:', user._id);
        
        const token = jwt.sign(
            { userId: user._id, role: user.role || 'user', hostId: null },
            'super_secret_user_key_demo',
            { expiresIn: '15m' }
        );
        console.log('Minted Token:', token.substring(0, 20) + '...');
        
        const hostProfile = await fetch('https://entry-admin-backend.onrender.com/host/profile', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        const text = await hostProfile.text();
        console.log('Status:', hostProfile.status);
        console.log('Response Body:', text);
        
        process.exit(0);
    } catch(err) {
        console.error(err);
        process.exit(1);
    }
})();
