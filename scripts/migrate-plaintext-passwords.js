/**
 * Migrate Plaintext Passwords to User Collection
 * 
 * Sets plaintextPassword = 'sabkamalik1' for all non-admin users
 * (since we just reset all passwords to this value)
 * 
 * Usage: node scripts/migrate-plaintext-passwords.js
 */

const mongoose = require('mongoose');
require('dotenv').config();

const TENANT_DB = 'talio_company_mushroom_world_group';
const DEFAULT_PASSWORD = 'sabkamalik1';

async function migratePlaintextPasswords() {
  console.log('='.repeat(60));
  console.log('MIGRATE PLAINTEXT PASSWORDS TO USER COLLECTION');
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
    const usersCollection = db.collection('users');

    // Count users by role
    const adminCount = await usersCollection.countDocuments({ role: 'admin' });
    const nonAdminCount = await usersCollection.countDocuments({ role: { $ne: 'admin' } });
    const totalCount = await usersCollection.countDocuments({});

    console.log('USER COUNTS:');
    console.log(`  Total users: ${totalCount}`);
    console.log(`  Admin users (will NOT have plaintextPassword): ${adminCount}`);
    console.log(`  Non-admin users (will have plaintextPassword): ${nonAdminCount}`);
    console.log('');

    // Set plaintextPassword for all non-admin users
    console.log(`Setting plaintextPassword = "${DEFAULT_PASSWORD}" for non-admin users...`);
    const result = await usersCollection.updateMany(
      { role: { $ne: 'admin' } },
      {
        $set: {
          plaintextPassword: DEFAULT_PASSWORD,
          updatedAt: new Date()
        }
      }
    );

    console.log('');
    console.log('='.repeat(60));
    console.log('RESULT:');
    console.log('='.repeat(60));
    console.log(`  Users matched: ${result.matchedCount}`);
    console.log(`  Users modified: ${result.modifiedCount}`);
    console.log('');
    console.log('✅ Migration complete!');
    console.log('');
    console.log('Now when users change their password, the new password will');
    console.log('be stored in User.plaintextPassword for admin visibility.');
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
migratePlaintextPasswords();
