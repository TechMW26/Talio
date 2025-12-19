/**
 * Database Cleanup Script
 * Identifies and optionally deletes unused collections
 * 
 * Usage: node scripts/cleanup-db.js
 * To actually delete: node scripts/cleanup-db.js --delete
 */

const mongoose = require('mongoose');
require('dotenv').config();

// Expected collections based on models in /models directory
const expectedCollections = new Set([
  // Core models
  'activities', 'aicontexts', 'announcements', 'applicationusagelogs',
  'approvalrequests', 'approvalworkflows', 'assets', 'attendances',
  'attendancecorrections', 'candidates', 'chats', 'companies',
  'companysettings', 'courses', 'dailygoals', 'departments', 'designations',
  'documents', 'emailaccounts', 'employees', 'expenses', 'geofencelocations',
  'geofencelogs', 'healthscores', 'helpdesks', 'holidays', 'keystrokelogs',
  'leaves', 'leavebalances', 'leavetypes', 'meetings', 'notifications',
  'overtimerequests', 'payrolls', 'performances', 'performancegoals', 'pips',
  'policies', 'productivitysessions', 'projects', 'projectapprovalrequests',
  'projectcompletionapprovals', 'projectmembers', 'projectnotes',
  'projecttimelineevents', 'pushsubscriptions', 'recruitments',
  'recurringnotifications', 'resignations', 'schedulednotifications',
  'screenmonitors', 'screenmonitorlogs', 'screenshots', 'screenshotanalyses',
  'suggestions', 'systempreferences', 'tasks', 'taskassignees', 'trainings',
  'users', 'whiteboards',
  // GridFS collections for screenshots
  'screenshots.files', 'screenshots.chunks',
  // System/session collections
  'sessions'
]);

async function main() {
  const shouldDelete = process.argv.includes('--delete');
  
  console.log('========================================');
  console.log('Database Cleanup Script');
  console.log('========================================\n');
  
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✓ Connected to MongoDB\n');
  
  const db = mongoose.connection.db;
  const collections = await db.listCollections().toArray();
  
  console.log(`Total collections in database: ${collections.length}\n`);
  
  // Identify unused collections
  const unused = [];
  const used = [];
  
  for (const col of collections.sort((a, b) => a.name.localeCompare(b.name))) {
    const count = await db.collection(col.name).countDocuments();
    
    if (expectedCollections.has(col.name)) {
      used.push({ name: col.name, count });
    } else {
      unused.push({ name: col.name, count });
    }
  }
  
  console.log('=== USED COLLECTIONS ===');
  for (const col of used) {
    console.log(`  ✓ ${col.name}: ${col.count} documents`);
  }
  console.log(`\nTotal used: ${used.length} collections\n`);
  
  console.log('=== UNUSED COLLECTIONS (candidates for deletion) ===');
  for (const col of unused) {
    console.log(`  ✗ ${col.name}: ${col.count} documents`);
  }
  console.log(`\nTotal unused: ${unused.length} collections\n`);
  
  if (unused.length === 0) {
    console.log('No unused collections found.');
    await mongoose.disconnect();
    process.exit(0);
  }
  
  if (shouldDelete) {
    console.log('=== DELETING UNUSED COLLECTIONS ===');
    let deleted = 0;
    
    for (const col of unused) {
      try {
        await db.collection(col.name).drop();
        console.log(`  ✓ Deleted: ${col.name}`);
        deleted++;
      } catch (error) {
        console.log(`  ✗ Failed to delete ${col.name}: ${error.message}`);
      }
    }
    
    console.log(`\nDeleted ${deleted}/${unused.length} collections`);
  } else {
    console.log('To delete unused collections, run:');
    console.log('  node scripts/cleanup-db.js --delete\n');
  }
  
  await mongoose.disconnect();
  console.log('✓ Done');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
