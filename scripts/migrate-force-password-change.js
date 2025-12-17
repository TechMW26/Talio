/**
 * Migration Script: Set forcePasswordChange for existing users
 * 
 * This script sets forcePasswordChange: true for all existing users
 * who don't already have this field set.
 * 
 * Run with: node scripts/migrate-force-password-change.js
 * 
 * Options:
 *   --dry-run    Show what would be updated without making changes
 *   --skip-existing-false    Skip users who already have forcePasswordChange set to false
 */

const mongoose = require('mongoose');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI environment variable is not set');
  process.exit(1);
}

// Simple User schema for migration
const UserSchema = new mongoose.Schema({
  email: String,
  forcePasswordChange: Boolean,
  role: String,
  isActive: Boolean,
  lastLogin: Date,
}, { timestamps: true });

const User = mongoose.models.User || mongoose.model('User', UserSchema);

async function migrate() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const skipExistingFalse = args.includes('--skip-existing-false');

  console.log('\n🔐 Force Password Change Migration');
  console.log('═'.repeat(50));
  
  if (isDryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n');
  }

  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Build query for users to update
    const query = {};
    
    if (skipExistingFalse) {
      // Only update users where forcePasswordChange is undefined/null
      query.forcePasswordChange = { $exists: false };
    } else {
      // Update all users where forcePasswordChange is not explicitly false
      query.$or = [
        { forcePasswordChange: { $exists: false } },
        { forcePasswordChange: null }
      ];
    }

    // Find users that need to be updated
    const usersToUpdate = await User.find(query).select('email role isActive forcePasswordChange lastLogin');
    
    console.log(`📊 Found ${usersToUpdate.length} users to update\n`);

    if (usersToUpdate.length === 0) {
      console.log('✅ No users need to be updated');
      await mongoose.disconnect();
      return;
    }

    // Show users that will be updated
    console.log('Users to be updated:');
    console.log('─'.repeat(50));
    
    for (const user of usersToUpdate) {
      const status = user.isActive ? '✓' : '✗';
      const lastLoginStr = user.lastLogin 
        ? new Date(user.lastLogin).toLocaleDateString()
        : 'Never';
      console.log(`  ${status} ${user.email} (${user.role}) - Last login: ${lastLoginStr}`);
    }
    
    console.log('─'.repeat(50));
    console.log('');

    if (isDryRun) {
      console.log('🔍 DRY RUN - Would update these users with forcePasswordChange: true');
    } else {
      // Perform the update
      const result = await User.updateMany(
        query,
        { $set: { forcePasswordChange: true } }
      );

      console.log(`✅ Updated ${result.modifiedCount} users with forcePasswordChange: true`);
    }

    console.log('\n🎉 Migration complete!');
    
  } catch (error) {
    console.error('❌ Migration error:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
}

migrate();
