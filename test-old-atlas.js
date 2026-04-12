import mongoose from 'mongoose';

const OLD_MONGO_URI = 'mongodb+srv://jaisdevansh2004_db_user:V3pU4sMZdEEPwPzT@party.qaycsm4.mongodb.net/?appName=party';

console.log('Testing OLD Atlas connection...');
console.log('URI:', OLD_MONGO_URI.replace(/:[^:@]+@/, ':****@'));

mongoose.connect(OLD_MONGO_URI, { 
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 45000 
})
.then(() => {
    console.log('✅ OLD Atlas MongoDB connected successfully!');
    console.log('Database:', mongoose.connection.db.databaseName);
    process.exit(0);
})
.catch((err) => {
    console.error('❌ OLD Atlas MongoDB connection failed:', err.message);
    process.exit(1);
});
