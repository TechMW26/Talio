import 'dotenv/config';
import mongoose from 'mongoose';

const uri = process.env.MONGODB_URI.replace(/\/[^\/]*\?/, '/talio_company_mushroom_world_group?');
await mongoose.connect(uri);

const UserSchema = new mongoose.Schema({ email: String, name: String, fcmTokens: Array }, { strict: false });
const User = mongoose.model('User', UserSchema);

const user = await User.findOne({ email: 'adil.khan@mushroomworldgroup.com' });
console.log('Before cleanup - FCM tokens:', user.fcmTokens?.length);

const validTokens = (user.fcmTokens || []).filter(t => !t.token?.startsWith('ExponentPushToken'));
console.log('Valid tokens (non-Expo):', validTokens.length);

await User.updateOne({ email: 'adil.khan@mushroomworldgroup.com' }, { fcmTokens: validTokens });
console.log('Done - cleaned up invalid Expo tokens');

await mongoose.disconnect();
