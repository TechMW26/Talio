/**
 * Sync Passwords from OnboardingEmail to User.plaintextPassword
 * 
 * This script populates User.plaintextPassword from OnboardingEmail.passwordSent
 * for users that don't have a plaintext password stored.
 * 
 * This is useful for users created before the plaintextPassword feature was added.
 * 
 * Usage: node scripts/sync-passwords-from-onboarding.js
 */

const mongoose = require('mongoose');
require('dotenv').config();

const TENANT_DB = process.env.TENANT_DB || 'talio_company_mushroom_world_group';

async function syncPasswordsFromOnboarding() {
  console.log('='.repeat(60));
  console.log('SYNC PASSWORDS FROM ONBOARDING EMAILS');
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
    const onboardingEmailsCollection = db.collection('onboardingemails');

    // Get all users without plaintextPassword
    const usersWithoutPassword = await usersCollection.find({
      $or: [
        { plaintextPassword: { $exists: false } },
        { plaintextPassword: null },
        { plaintextPassword: '' }
      ]
    }).toArray();

    console.log(`Found ${usersWithoutPassword.length} users without plaintextPassword\n`);

    if (usersWithoutPassword.length === 0) {
      console.log('No users need password sync. Exiting.');
      return;
    }

    let updated = 0;
    let notFound = 0;
    let alreadySet = 0;

    for (const user of usersWithoutPassword) {
      // Find the most recent onboarding email for this user
      const onboardingEmail = await onboardingEmailsCollection.findOne(
        { 
          user: user._id,
          status: 'sent',
          passwordSent: { $exists: true, $ne: null, $ne: '' }
        },
        { sort: { sentAt: -1 } }
      );

      if (onboardingEmail && onboardingEmail.passwordSent) {
        // Update user with plaintext password
        await usersCollection.updateOne(
          { _id: user._id },
          { 
            $set: { 
              plaintextPassword: onboardingEmail.passwordSent,
              updatedAt: new Date()
            } 
          }
        );
        console.log(`✓ Updated: ${user.email} -> password from onboarding email`);
        updated++;
      } else {
        // Try to find by email in recipientEmail field
        const onboardingByEmail = await onboardingEmailsCollection.findOne(
          { 
            recipientEmail: user.email.toLowerCase(),
            status: 'sent',
            passwordSent: { $exists: true, $ne: null, $ne: '' }
          },
          { sort: { sentAt: -1 } }
        );

        if (onboardingByEmail && onboardingByEmail.passwordSent) {
          await usersCollection.updateOne(
            { _id: user._id },
            { 
              $set: { 
                plaintextPassword: onboardingByEmail.passwordSent,
                updatedAt: new Date()
              } 
            }
          );
          console.log(`✓ Updated: ${user.email} -> password from onboarding email (by email match)`);
          updated++;
        } else {
          console.log(`✗ Not found: ${user.email} - no onboarding email with password`);
          notFound++;
        }
      }
    }

    console.log('');
    console.log('='.repeat(60));
    console.log('RESULT:');
    console.log('='.repeat(60));
    console.log(`  Total users without password: ${usersWithoutPassword.length}`);
    console.log(`  Successfully updated: ${updated}`);
    console.log(`  No onboarding email found: ${notFound}`);
    console.log('');
    console.log('✅ Sync complete!');
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
syncPasswordsFromOnboarding();
