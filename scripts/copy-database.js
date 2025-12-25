/**
 * Database Copy Script
 * Copies all collections from source database to target database
 * 
 * Usage: node scripts/copy-database.js <source_db> <target_db>
 * Example: node scripts/copy-database.js hrms_db mushroom_world_group
 */

const mongoose = require('mongoose');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI;

async function copyDatabase(sourceDbName, targetDbName) {
  if (!sourceDbName || !targetDbName) {
    console.error('Usage: node scripts/copy-database.js <source_db> <target_db>');
    console.error('Example: node scripts/copy-database.js hrms_db mushroom_world_group');
    process.exit(1);
  }

  if (sourceDbName === targetDbName) {
    console.error('Source and target database names must be different');
    process.exit(1);
  }

  console.log(`\n🔄 Copying database: ${sourceDbName} → ${targetDbName}\n`);

  try {
    // Connect to MongoDB
    await mongoose.connect(MONGODB_URI, {
      maxPoolSize: 10,
    });
    console.log('✅ Connected to MongoDB Atlas');

    // Get connections to both databases
    const sourceDb = mongoose.connection.useDb(sourceDbName);
    const targetDb = mongoose.connection.useDb(targetDbName);

    // Get all collections from source
    const collections = await sourceDb.db.listCollections().toArray();
    console.log(`📦 Found ${collections.length} collections in ${sourceDbName}`);

    let totalDocuments = 0;
    const results = [];

    for (const collectionInfo of collections) {
      const collectionName = collectionInfo.name;
      
      // Skip system collections
      if (collectionName.startsWith('system.')) {
        console.log(`  ⏭️  Skipping system collection: ${collectionName}`);
        continue;
      }

      const sourceCollection = sourceDb.db.collection(collectionName);
      const targetCollection = targetDb.db.collection(collectionName);

      // Get all documents from source
      const documents = await sourceCollection.find({}).toArray();
      const docCount = documents.length;

      if (docCount === 0) {
        console.log(`  📄 ${collectionName}: 0 documents (empty)`);
        results.push({ collection: collectionName, count: 0, status: 'empty' });
        continue;
      }

      // Drop existing collection in target (if exists)
      try {
        await targetCollection.drop();
      } catch (e) {
        // Collection doesn't exist, that's fine
      }

      // Insert documents into target
      await targetCollection.insertMany(documents, { ordered: false });
      
      console.log(`  ✅ ${collectionName}: ${docCount} documents copied`);
      results.push({ collection: collectionName, count: docCount, status: 'copied' });
      totalDocuments += docCount;

      // Copy indexes
      try {
        const indexes = await sourceCollection.indexes();
        for (const index of indexes) {
          if (index.name === '_id_') continue; // Skip default _id index
          const { key, ...options } = index;
          delete options.v; // Remove version field
          delete options.ns; // Remove namespace field
          try {
            await targetCollection.createIndex(key, options);
          } catch (indexError) {
            console.warn(`    ⚠️ Could not create index ${index.name}: ${indexError.message}`);
          }
        }
      } catch (indexError) {
        console.warn(`    ⚠️ Could not copy indexes for ${collectionName}`);
      }
    }

    console.log(`\n${'─'.repeat(50)}`);
    console.log(`✅ Database copy complete!`);
    console.log(`   Source: ${sourceDbName}`);
    console.log(`   Target: ${targetDbName}`);
    console.log(`   Collections: ${results.filter(r => r.status === 'copied').length}`);
    console.log(`   Total Documents: ${totalDocuments.toLocaleString()}`);
    console.log(`${'─'.repeat(50)}\n`);

    // Print summary table
    console.log('Collection Summary:');
    console.log('┌────────────────────────────────┬──────────┬──────────┐');
    console.log('│ Collection                     │ Documents│ Status   │');
    console.log('├────────────────────────────────┼──────────┼──────────┤');
    for (const r of results) {
      const name = r.collection.padEnd(30).substring(0, 30);
      const count = r.count.toString().padStart(8);
      const status = r.status.padEnd(8);
      console.log(`│ ${name} │ ${count} │ ${status} │`);
    }
    console.log('└────────────────────────────────┴──────────┴──────────┘');

  } catch (error) {
    console.error('❌ Error copying database:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\n👋 Disconnected from MongoDB');
  }
}

// Get command line arguments
const [,, sourceDb, targetDb] = process.argv;

copyDatabase(sourceDb, targetDb);
