import mongoose from 'mongoose';

(async () => {
    try {
        const phone = '+917772828027';

        console.log('1. Sending OTP to live user backend...');
        const sendRes = await fetch('https://entry-user-backend.onrender.com/auth/send-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identifier: phone })
        });
        console.log('Send OTP response:', await sendRes.text());

        console.log('2. Waiting 2 seconds for OTP to hit DB...');
        await new Promise(res => setTimeout(res, 2000));

        console.log('3. Fetching OTP from DB...');
        const uri = "mongodb+srv://jaisdevansh2004_db_user:V3pU4sMZdEEPwPzT@party.qaycsm4.mongodb.net/?appName=party";
        await mongoose.connect(uri);
        const OtpSchema = new mongoose.Schema({}, { strict: false });
        const Otp = mongoose.model('Otp', OtpSchema, 'otps');
        const otpDoc = await Otp.findOne({ identifier: phone }).sort({ createdAt: -1 });
        
        if (!otpDoc) {
            console.error('Failed to find OTP in DB!');
            process.exit(1);
        }
        console.log('Found OTP:', otpDoc.otp);

        console.log('4. Verifying OTP on live user backend...');
        const verifyRes = await fetch('https://entry-user-backend.onrender.com/auth/verify-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identifier: phone, otp: otpDoc.otp })
        });
        const verifyData = await verifyRes.json();
        const token = verifyData.data.accessToken;
        
        if (!token) {
            console.error('Failed to get token!', verifyData);
            process.exit(1);
        }
        console.log('Got live token:', token.substring(0, 20) + '...');

        console.log('5. Hitting live admin backend...');
        const profileRes = await fetch('https://entry-admin-backend.onrender.com/host/profile', {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        console.log('Status:', profileRes.status);
        console.log('Response:', await profileRes.text());

        process.exit(0);
    } catch(err) {
        console.error(err);
        process.exit(1);
    }
})();
