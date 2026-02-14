/**
 * Reset All User Passwords
 * 
 * This script resets ALL user passwords (including admins) to a known value
 * and correctly stores it in plaintextPassword.
 * 
 * This ensures the User Passwords page shows accurate, working credentials.
 * 
 * Usage: node scripts/reset-all-passwords.js
 */

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const TENANT_DB = process.env.TENANT_DB || 'talio_company_mushroom_world_group';
const NEW_PASSWORD = 'sabkamalik1'; // The new password for all users

async function resetAllPasswords() {
  console.log('='.repeat(60));
  console.log('RESET ALL USER PASSWORDS (INCLUDING ADMINS)');
  console.log('='.repeat(60));
  console.log(`Database: ${TENANT_DB}`);
  console.log(`New Password: ${NEW_PASSWORD}`);
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

    // Hash the new password
    console.log('Hashing password...');
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(NEW_PASSWORD, salt);

    // Count users
    const totalCount = await usersCollection.countDocuments({});

    console.log(`Total users to reset: ${totalCount}`);
    console.log('');

    // Update ALL users
    console.log('Resetting passwords for ALL users...');
    const result = await usersCollection.updateMany(
      {},
      {
        $set: {
          password: hashedPassword,
          plaintextPassword: NEW_PASSWORD,
          forcePasswordChange: false,
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
    console.log('✅ Password reset complete!');
    console.log('');
    console.log(`All users can now login with: ${NEW_PASSWORD}`);
    console.log('='.repeat(60));

  } catch (error) {
    console.error('ERROR:', error.message);
    console.error(error.stack);
  } finally {
    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB');
  }
}

// Run immediately
resetAllPasswords();
