/**
 * Script to drop all project-related and messages data from the database
 * Run with: node drop-project-data.js
 */

const mongoose = require('mongoose');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI;

async function dropCollections() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const db = mongoose.connection.db;

    // Collections to drop
    const collectionsToDelete = [
      'projects',
      'projectmembers', 
      'tasks',
      'taskassignees',
      'projecttimelineevents',
      'projectcompletionapprovals',
      'projectapprovalrequests',
      'projectnotes',
      'chats',           // Messages/chat data
      'messages',        // If separate messages collection exists
    ];

    console.log('\n🗑️  Dropping collections...\n');

    for (const collectionName of collectionsToDelete) {
      try {
        const collections = await db.listCollections({ name: collectionName }).toArray();
        if (collections.length > 0) {
          await db.collection(collectionName).drop();
          console.log(`  ✅ Dropped: ${collectionName}`);
        } else {
          console.log(`  ⏭️  Skipped (not found): ${collectionName}`);
        }
      } catch (err) {
        if (err.code === 26) {
          console.log(`  ⏭️  Skipped (not found): ${collectionName}`);
        } else {
          console.log(`  ❌ Error dropping ${collectionName}:`, err.message);
        }
      }
    }

    console.log('\n✅ All specified collections have been processed!');
    console.log('\n📊 Remaining collections:');
    
    const remainingCollections = await db.listCollections().toArray();
    remainingCollections.forEach(col => {
      console.log(`  - ${col.name}`);
    });

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
    process.exit(0);
  }
}

dropCollections();
