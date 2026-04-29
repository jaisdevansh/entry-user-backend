import axios from 'axios';

(async () => {
    try {
        console.log("Testing /user/referral API without token to see what it returns...");
        const res = await axios.get('http://127.0.0.1:3001/user/referral');
        console.log("Status:", res.status);
        console.log("Data:", res.data);
    } catch (err) {
        console.log("Error Status:", err.response?.status);
        console.log("Error Data:", err.response?.data);
        console.log("Error Message:", err.message);
    }
})();
