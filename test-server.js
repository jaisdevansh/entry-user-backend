import express from 'express';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = 3001;
const MONGO_URI = process.env.MONGO_URI;

console.log('Starting test server...');

app.get('/health', (req, res) => {
    res.json({ success: true, message: 'Server is running!' });
});

const startServer = async () => {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(MONGO_URI, { 
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000 
        });
        console.log('✅ MongoDB connected!');
        
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`✅ Test server running on port ${PORT}`);
        });
    } catch (err) {
        console.error('❌ Error:', err.message);
        process.exit(1);
    }
};

startServer();
