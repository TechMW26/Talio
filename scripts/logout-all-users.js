/**
 * Log All Users Out - Invalidate All Sessions
 * 
 * This script revokes all active user sessions in the database
 * 
 * Usage: node scripts/logout-all-users.js
 */

const mongoose = require('mongoose');
require('dotenv').config();

const TENANT_DB = 'talio_company_mushroom_world_group';

async function logoutAllUsers() {
  console.log('='.repeat(60));
  console.log('LOGOUT ALL USERS');
  console.log('='.repeat(60));
  console.log(`Database: ${TENANT_DB}`);
  console.log('='.repeat(60));
  console.log('');

  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
    console.log('Connecting to MongoDB...');
    await mongoose.connect(mongoUri, {
      dbName: TENANT_DB,
    });
    console.log('Connected to MongoDB\n');

    const db = mongoose.connection.db;

    // 1. Revoke all UserSessions
    const sessionsCollection = db.collection('usersessions');
    const activeSessionsCount = await sessionsCollection.countDocuments({ isActive: true });
    
    console.log(`Active sessions found: ${activeSessionsCount}`);
    
    const sessionResult = await sessionsCollection.updateMany(
      { isActive: true },
      {
        $set: {
          isActive: false,
          revokedAt: new Date(),
          revokedReason: 'admin_revoke'
        }
      }
    );
    
    console.log(`Sessions revoked: ${sessionResult.modifiedCount}`);

    // 2. Clear any refresh tokens if they exist
    const tokensCollection = db.collection('refreshtokens');
    const tokenExists = await tokensCollection.findOne({});
    if (tokenExists) {
      const tokenResult = await tokensCollection.deleteMany({});
      console.log(`Refresh tokens deleted: ${tokenResult.deletedCount}`);
    }

    // 3. Update lastLogin to force re-authentication
    const usersCollection = db.collection('users');
    const userResult = await usersCollection.updateMany(
      {},
      {
        $unset: { currentSessionId: '' }
      }
    );
    console.log(`Users updated: ${userResult.modifiedCount}`);

    console.log('');
    console.log('='.repeat(60));
    console.log('✅ ALL USERS LOGGED OUT');
    console.log('='.repeat(60));
    console.log('');
    console.log('All active sessions have been invalidated.');
    console.log('Users will need to log in again to access the system.');
    console.log('='.repeat(60));

  } catch (error) {
    console.error('ERROR:', error.message);
    console.error(error.stack);
  } finally {
    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB');
  }
}

// Run the script
logoutAllUsers();
