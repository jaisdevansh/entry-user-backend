import mongoose from 'mongoose';

const MONGO_URI = 'mongodb+srv://Harish119306:Ha%403456@cluster0.8f1iibc.mongodb.net/entry_club?retryWrites=true&w=majority&appName=Cluster0';

console.log('Testing MongoDB connection...');
console.log('URI:', MONGO_URI.replace(/:[^:@]+@/, ':****@')); // Hide password

mongoose.connect(MONGO_URI, { 
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 45000 
})
.then(() => {
    console.log('✅ MongoDB connected successfully!');
    console.log('Database:', mongoose.connection.db.databaseName);
    process.exit(0);
})
.catch((err) => {
    console.error('❌ MongoDB connection failed:', err.message);
    process.exit(1);
});
