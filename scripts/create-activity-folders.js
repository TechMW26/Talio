/**
 * Migration Script: Create Activity Folders for Existing Employees
 * 
 * This script creates the activity folder structure for all existing users
 * with the 'employee' role who may not have folders yet.
 * 
 * Usage: node scripts/create-activity-folders.js
 */

const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/talio';

// User model schema
const userSchema = new mongoose.Schema({
  name: String,
  email: String,
  role: String,
  active: Boolean
}, { collection: 'users' });

const User = mongoose.model('User', userSchema);

async function ensureDirectory(dirPath) {
  try {
    await fs.promises.access(dirPath, fs.constants.W_OK);
    return { exists: true, created: false };
  } catch {
    try {
      await fs.promises.mkdir(dirPath, { recursive: true, mode: 0o755 });
      return { exists: true, created: true };
    } catch (error) {
      return { exists: false, error: error.message };
    }
  }
}

async function main() {
  console.log('========================================');
  console.log('Activity Folder Migration Script');
  console.log('========================================\n');

  // Connect to MongoDB
  console.log(`Connecting to MongoDB...`);
  await mongoose.connect(MONGODB_URI);
  console.log('✓ Connected to MongoDB\n');

  // Get all users (focus on employees, but create for all)
  const users = await User.find({ active: { $ne: false } });
  console.log(`Found ${users.length} active users\n`);

  const publicDir = path.join(process.cwd(), 'public', 'activity');
  
  // Ensure base activity directory exists
  const baseResult = await ensureDirectory(publicDir);
  console.log(`Base activity directory: ${baseResult.created ? 'Created' : 'Already exists'}\n`);

  let created = 0;
  let existing = 0;
  let errors = 0;

  // Create folder for each user
  for (const user of users) {
    const userDir = path.join(publicDir, user._id.toString());
    const result = await ensureDirectory(userDir);

    if (result.exists) {
      if (result.created) {
        console.log(`✓ Created: ${user.name || user.email} (${user._id})`);
        created++;
      } else {
        console.log(`- Exists: ${user.name || user.email} (${user._id})`);
        existing++;
      }
    } else {
      console.log(`✗ Error: ${user.name || user.email} - ${result.error}`);
      errors++;
    }
  }

  console.log('\n========================================');
  console.log('Summary');
  console.log('========================================');
  console.log(`Total users:     ${users.length}`);
  console.log(`Folders created: ${created}`);
  console.log(`Already existed: ${existing}`);
  console.log(`Errors:          ${errors}`);
  console.log('========================================\n');

  // Also ensure the uploads directory for legacy screenshot storage
  const uploadsDir = path.join(process.cwd(), 'public', 'uploads', 'captures');
  const uploadsResult = await ensureDirectory(uploadsDir);
  console.log(`Legacy uploads/captures directory: ${uploadsResult.created ? 'Created' : 'Already exists'}`);

  await mongoose.disconnect();
  console.log('\n✓ Migration complete!');
  process.exit(0);
}

main().catch(error => {
  console.error('Migration failed:', error);
  process.exit(1);
});
