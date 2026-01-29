import 'dotenv/config';
import mongoose from 'mongoose';
import admin from 'firebase-admin';

const TARGET_EMAIL = process.argv[2] || 'adil.khan@mushroomworldgroup.com';
const uri = process.env.MONGODB_URI.replace(/\/[^\/]*\?/, '/talio_company_mushroom_world_group?');

console.log('='.repeat(60));
console.log('🔔 Check Token & Send Test Notification');
console.log('='.repeat(60));
console.log('📧 Target:', TARGET_EMAIL);

await mongoose.connect(uri);
console.log('✅ Connected to MongoDB');

const UserSchema = new mongoose.Schema({ email: String, name: String, fcmTokens: Array }, { strict: false });
const User = mongoose.model('User', UserSchema);

const user = await User.findOne({ email: TARGET_EMAIL });
if (!user) {
    console.log('❌ User not found');
    await mongoose.disconnect();
    process.exit(1);
}

console.log('\n📱 FCM Tokens:', user.fcmTokens?.length || 0);

if (!user.fcmTokens?.length) {
    console.log('\n❌ No FCM tokens registered!');
    console.log('\n📋 Steps to fix:');
    console.log('   1. Install Talio-v1.0.6-push-fix.apk');
    console.log('   2. Login to the app');
    console.log('   3. Grant notification permission');
    console.log('   4. Run this script again');
    await mongoose.disconnect();
    process.exit(1);
}

// Show tokens
user.fcmTokens.forEach((t, i) => {
    const isExpo = t.token?.startsWith('ExponentPushToken');
    console.log(`\nToken ${i + 1}:`);
    console.log(`  Type: ${isExpo ? '❌ EXPO (invalid)' : '✅ NATIVE FCM'}`);
    console.log(`  Token: ${t.token?.substring(0, 50)}...`);
    console.log(`  Platform: ${t.deviceInfo?.platform}`);
    console.log(`  Model: ${t.deviceInfo?.model}`);
    console.log(`  App Version: ${t.deviceInfo?.appVersion}`);
});

// Find valid FCM tokens (not Expo)
const validTokens = user.fcmTokens.filter(t => !t.token?.startsWith('ExponentPushToken'));

if (validTokens.length === 0) {
    console.log('\n❌ No valid native FCM tokens! Only Expo tokens found.');
    console.log('   The app is still using Expo push tokens instead of native FCM.');
    await mongoose.disconnect();
    process.exit(1);
}

// Initialize Firebase
console.log('\n🔥 Initializing Firebase...');
const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
if (!serviceAccount) {
    console.log('❌ FIREBASE_SERVICE_ACCOUNT_KEY not found');
    await mongoose.disconnect();
    process.exit(1);
}

admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(serviceAccount))
});
console.log('✅ Firebase initialized');

// Send test notification
console.log('\n📤 Sending test notification...');

for (const tokenData of validTokens) {
    const message = {
        token: tokenData.token,
        notification: {
            title: '🎉 Push Notifications Working!',
            body: `Hello! Test sent at ${new Date().toLocaleTimeString()}`
        },
        data: {
            type: 'test',
            timestamp: Date.now().toString()
        },
        android: {
            priority: 'high',
            notification: {
                channelId: 'talio_notifications',
                priority: 'high',
                defaultSound: true
            }
        }
    };

    try {
        const result = await admin.messaging().send(message);
        console.log(`✅ SUCCESS! Message ID: ${result}`);
    } catch (error) {
        console.log(`❌ FAILED: ${error.message}`);
        if (error.code === 'messaging/registration-token-not-registered') {
            console.log('   Token is invalid/expired');
        }
    }
}

console.log('\n' + '='.repeat(60));
await mongoose.disconnect();
