const mongoose = require('mongoose');
require('dotenv').config();

// MongoDB connection string from environment
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI environment variable is not set');
  console.error('Please create a .env file with your MongoDB connection string');
  process.exit(1);
}

async function clearFCMTokens() {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(MONGODB_URI);

        console.log('Connected! Clearing all FCM tokens...');

        const result = await mongoose.connection.db.collection('users').updateMany(
            {},
            { $set: { fcmTokens: [] } }
        );

        console.log('✅ FCM tokens cleared successfully!');
        console.log(`   Users updated: ${result.modifiedCount}`);

        await mongoose.disconnect();
        process.exit(0);

    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

clearFCMTokens();
