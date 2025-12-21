/**
 * Sync Existing Users to Backup Database
 * 
 * This script syncs all existing users from the main database to the backup database.
 * Useful for one-time sync of users that were created before backup sync was implemented.
 * 
 * Usage: node scripts/sync-existing-users-to-backup.js
 */

require('dotenv').config();
const mongoose = require('mongoose');

const MAIN_DB_URI = process.env.MONGODB_URI;
const BACKUP_DB_URI = process.env.MONGODB_BACKUP_URI;

if (!MAIN_DB_URI) {
  console.error('❌ MONGODB_URI not found in environment variables');
  process.exit(1);
}

if (!BACKUP_DB_URI) {
  console.error('❌ MONGODB_BACKUP_URI not found in environment variables');
  process.exit(1);
}

// User schema for backup DB (simplified) - uses 'User' collection
const BackupUserSchema = new mongoose.Schema({
  originalUserId: { type: String, required: true, unique: true },
  email: { type: String, required: true },
  password: { type: String, required: true },
  role: { type: String },
  employeeId: { type: String },
  isActive: { type: Boolean, default: true },
  syncedAt: { type: Date, default: Date.now },
  lastUpdated: { type: Date, default: Date.now }
}, { timestamps: true, collection: 'User' });

async function syncUsersToBackup() {
  let mainConn = null;
  let backupConn = null;

  try {
    console.log('🔄 Connecting to main database...');
    mainConn = await mongoose.createConnection(MAIN_DB_URI).asPromise();
    console.log('✅ Connected to main database');

    console.log('🔄 Connecting to backup database...');
    backupConn = await mongoose.createConnection(BACKUP_DB_URI).asPromise();
    console.log('✅ Connected to backup database');

    // Get users from main DB (including password for backup)
    const MainUser = mainConn.model('User', new mongoose.Schema({
      email: String,
      password: String,
      role: String,
      employeeId: mongoose.Schema.Types.ObjectId,
      isActive: Boolean,
    }));

    const BackupUser = backupConn.model('User', BackupUserSchema);

    // Fetch all users with passwords
    const users = await MainUser.find({}).select('+password').lean();
    console.log(`📋 Found ${users.length} users in main database`);

    if (users.length === 0) {
      console.log('ℹ️ No users to sync');
      return;
    }

    let synced = 0;
    let updated = 0;
    let errors = 0;

    for (const user of users) {
      try {
        const backupData = {
          originalUserId: user._id.toString(),
          email: user.email,
          password: user.password,
          role: user.role,
          employeeId: user.employeeId?.toString(),
          isActive: user.isActive !== false,
          lastUpdated: new Date()
        };

        const existing = await BackupUser.findOne({ originalUserId: user._id.toString() });
        
        if (existing) {
          await BackupUser.updateOne(
            { originalUserId: user._id.toString() },
            { $set: backupData }
          );
          updated++;
          console.log(`  ↻ Updated: ${user.email}`);
        } else {
          backupData.syncedAt = new Date();
          await BackupUser.create(backupData);
          synced++;
          console.log(`  ✓ Synced: ${user.email}`);
        }
      } catch (err) {
        errors++;
        console.error(`  ✗ Error syncing ${user.email}:`, err.message);
      }
    }

    console.log('\n📊 Sync Summary:');
    console.log(`   New synced: ${synced}`);
    console.log(`   Updated: ${updated}`);
    console.log(`   Errors: ${errors}`);
    console.log(`   Total: ${users.length}`);

    // Verify backup count
    const backupCount = await BackupUser.countDocuments();
    console.log(`\n✅ Backup database now has ${backupCount} users`);

  } catch (error) {
    console.error('❌ Sync failed:', error);
    throw error;
  } finally {
    if (mainConn) await mainConn.close();
    if (backupConn) await backupConn.close();
    console.log('\n🔒 Database connections closed');
  }
}

// Run the sync
syncUsersToBackup()
  .then(() => {
    console.log('\n✅ Sync completed successfully');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ Sync failed:', err);
    process.exit(1);
  });
