const axios = require('axios');

const testLogin = async () => {
    try {
        console.log('Testing login with admin / admin123 ...');
        const response = await axios.post('http://localhost:3000/api/auth/login', {
            email: 'admin',
            password: 'admin123'
        });

        console.log('✅ Login Success!');
        console.log('Token received:', response.data.token ? 'YES' : 'NO');
        console.log('User:', JSON.stringify(response.data.user, null, 2));

    } catch (error) {
        if (error.response) {
            console.log('❌ Login Failed! Status:', error.response.status);
            console.log('Response:', JSON.stringify(error.response.data, null, 2));
        } else {
            console.log('❌ Connection Error:', error.message);
        }
    }
};

testLogin();
