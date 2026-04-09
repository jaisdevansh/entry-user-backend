import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

async function fixData() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        const hostId = new mongoose.Types.ObjectId('69d36ca6ebbc8c559c466e2b');
        
        let m = await mongoose.connection.collection('menuitems').updateMany({}, { $set: { hostId } });
        let g = await mongoose.connection.collection('gifts').updateMany({}, { $set: { hostId } });

        console.log(`Updated ${m.modifiedCount} menu items and ${g.modifiedCount} gifts!`);
        process.exit(0);
    } catch(e) {
        console.error(e);
        process.exit(1);
    }
}
fixData();
