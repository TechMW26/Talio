/**
 * Reset Passwords for All Non-Admin Users
 * 
 * Sets password to "sabkamalik1" and forces password change on login
 * Admin users are excluded from this reset
 * 
 * Usage: node scripts/reset-non-admin-passwords.js
 */

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const TENANT_DB = 'talio_company_mushroom_world_group';
const NEW_PASSWORD = 'sabkamalik1';

async function resetNonAdminPasswords() {
  console.log('='.repeat(60));
  console.log('RESET NON-ADMIN PASSWORDS');
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

    // Get the users collection
    const db = mongoose.connection.db;
    const usersCollection = db.collection('users');

    // Hash the new password
    console.log('Hashing new password...');
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(NEW_PASSWORD, salt);
    console.log('Password hashed successfully\n');

    // Count users by role BEFORE update
    const adminCount = await usersCollection.countDocuments({ role: 'admin' });
    const nonAdminCount = await usersCollection.countDocuments({ role: { $ne: 'admin' } });
    const totalCount = await usersCollection.countDocuments({});

    console.log('USER COUNTS:');
    console.log(`  Total users: ${totalCount}`);
    console.log(`  Admin users (EXCLUDED): ${adminCount}`);
    console.log(`  Non-admin users (TO BE RESET): ${nonAdminCount}`);
    console.log('');

    // Get list of admins that won't be affected
    const admins = await usersCollection.find({ role: 'admin' }).project({ email: 1, _id: 0 }).toArray();
    console.log('ADMIN USERS (passwords unchanged):');
    admins.forEach(admin => console.log(`  - ${admin.email}`));
    console.log('');

    // Update all non-admin users
    console.log('Resetting passwords for non-admin users...');
    const result = await usersCollection.updateMany(
      { role: { $ne: 'admin' } },
      {
        $set: {
          password: hashedPassword,
          forcePasswordChange: true,
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
    console.log('✅ All non-admin users now have:');
    console.log(`   - Password: "${NEW_PASSWORD}"`);
    console.log('   - forcePasswordChange: true');
    console.log('');
    console.log('Users will be required to reset their password on next login.');
    console.log('='.repeat(60));

    // Also update onboarding emails collection with the new password for reference
    const onboardingCollection = db.collection('onboardingemails');
    const onboardingResult = await onboardingCollection.updateMany(
      {},
      {
        $set: {
          passwordSent: NEW_PASSWORD,
          updatedAt: new Date()
        }
      }
    );
    console.log(`\nAlso updated ${onboardingResult.modifiedCount} onboarding email records with new password.`);

  } catch (error) {
    console.error('ERROR:', error.message);
    console.error(error.stack);
  } finally {
    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB');
  }
}

// Run the script
resetNonAdminPasswords();
