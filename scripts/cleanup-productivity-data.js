/**
 * Cleanup Script: Remove all productivity data from DB and ImageKit
 * 
 * This script will:
 * 1. Delete all ProductivitySession documents from all tenant databases
 * 2. Delete all ProductivityCapture documents from all tenant databases
 * 3. Delete all related images from ImageKit (screenshots folder)
 * 
 * Usage: node scripts/cleanup-productivity-data.js
 * 
 * Add --dry-run flag to preview what would be deleted without actually deleting
 */

require('dotenv').config();
const mongoose = require('mongoose');
const ImageKit = require('imagekit');

const MONGODB_URI = process.env.MONGODB_URI;
const DRY_RUN = process.argv.includes('--dry-run');

// Initialize ImageKit
const imagekit = new ImageKit({
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT
});

async function getTenantDatabases(connection) {
  const admin = connection.db.admin();
  const result = await admin.listDatabases();
  
  // Filter for tenant databases (they start with 'talio_company_')
  return result.databases
    .map(db => db.name)
    .filter(name => name.startsWith('talio_company_'));
}

async function cleanupDatabase(client, dbName) {
  console.log(`\n📂 Processing database: ${dbName}`);
  
  // Use the native MongoDB client to access the database directly
  const db = client.db(dbName);
  
  // Get collections
  const collections = await db.listCollections().toArray();
  const collectionNames = collections.map(c => c.name);
  
  let sessionsDeleted = 0;
  let capturesDeleted = 0;
  let sessionCount = 0;
  let captureCount = 0;
  
  // Delete ProductivitySessions
  if (collectionNames.includes('productivitysessions')) {
    const sessionsCollection = db.collection('productivitysessions');
    sessionCount = await sessionsCollection.countDocuments();
    
    if (DRY_RUN) {
      console.log(`  [DRY-RUN] Would delete ${sessionCount} productivity sessions`);
      sessionsDeleted = sessionCount;
    } else {
      const result = await sessionsCollection.deleteMany({});
      sessionsDeleted = result.deletedCount;
      console.log(`  ✅ Deleted ${sessionsDeleted} productivity sessions`);
    }
  } else {
    console.log(`  ℹ️ No productivitysessions collection found`);
  }
  
  // Delete ProductivityCaptures
  if (collectionNames.includes('productivitycaptures')) {
    const capturesCollection = db.collection('productivitycaptures');
    captureCount = await capturesCollection.countDocuments();
    
    if (DRY_RUN) {
      console.log(`  [DRY-RUN] Would delete ${captureCount} productivity captures`);
      capturesDeleted = captureCount;
    } else {
      const result = await capturesCollection.deleteMany({});
      capturesDeleted = result.deletedCount;
      console.log(`  ✅ Deleted ${capturesDeleted} productivity captures`);
    }
  } else {
    console.log(`  ℹ️ No productivitycaptures collection found`);
  }
  
  return { sessionsDeleted, capturesDeleted };
}

async function cleanupImageKit() {
  console.log('\n🖼️  Cleaning up ImageKit screenshots...');
  
  try {
    // List all files in the screenshots folder
    let totalDeleted = 0;
    let hasMore = true;
    let skip = 0;
    const limit = 100;
    
    while (hasMore) {
      const files = await imagekit.listFiles({
        path: '/screenshots',
        skip: skip,
        limit: limit
      });
      
      if (files.length === 0) {
        hasMore = false;
        break;
      }
      
      if (DRY_RUN) {
        console.log(`  [DRY-RUN] Would delete ${files.length} files from ImageKit`);
        totalDeleted += files.length;
      } else {
        // Delete each file
        for (const file of files) {
          try {
            await imagekit.deleteFile(file.fileId);
            totalDeleted++;
          } catch (err) {
            console.error(`  ⚠️ Failed to delete ${file.name}: ${err.message}`);
          }
        }
        console.log(`  ✅ Deleted batch of ${files.length} files`);
      }
      
      skip += limit;
      
      // Safety limit
      if (totalDeleted > 10000) {
        console.log('  ⚠️ Safety limit reached (10000 files). Run again to continue.');
        break;
      }
    }
    
    console.log(`  📊 Total ImageKit files ${DRY_RUN ? 'would be' : ''} deleted: ${totalDeleted}`);
    return totalDeleted;
    
  } catch (error) {
    console.error('  ❌ ImageKit cleanup error:', error.message);
    return 0;
  }
}

async function main() {
  console.log('🧹 Productivity Data Cleanup Script');
  console.log('=====================================');
  
  if (DRY_RUN) {
    console.log('⚠️  DRY-RUN MODE - No data will be deleted\n');
  } else {
    console.log('⚠️  WARNING: This will permanently delete all productivity data!\n');
    
    // Give user 5 seconds to cancel
    console.log('Starting in 5 seconds... Press Ctrl+C to cancel');
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  
  try {
    // Connect to MongoDB
    console.log('📡 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');
    
    // Get the native MongoDB client from mongoose
    const client = mongoose.connection.getClient();
    
    // Get all tenant databases
    const tenantDbs = await getTenantDatabases(mongoose.connection);
    console.log(`📋 Found ${tenantDbs.length} tenant databases`);
    
    let totalSessions = 0;
    let totalCaptures = 0;
    
    // Clean up each tenant database
    for (const dbName of tenantDbs) {
      const { sessionsDeleted, capturesDeleted } = await cleanupDatabase(client, dbName);
      totalSessions += sessionsDeleted;
      totalCaptures += capturesDeleted;
    }
    
    // Clean up ImageKit
    const imagesDeleted = await cleanupImageKit();
    
    // Summary
    console.log('\n=====================================');
    console.log('📊 CLEANUP SUMMARY');
    console.log('=====================================');
    console.log(`  Sessions ${DRY_RUN ? 'to delete' : 'deleted'}: ${totalSessions}`);
    console.log(`  Captures ${DRY_RUN ? 'to delete' : 'deleted'}: ${totalCaptures}`);
    console.log(`  ImageKit files ${DRY_RUN ? 'to delete' : 'deleted'}: ${imagesDeleted}`);
    
    if (DRY_RUN) {
      console.log('\n💡 Run without --dry-run to actually delete the data');
    } else {
      console.log('\n✅ Cleanup complete!');
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n📡 Disconnected from MongoDB');
  }
}

main();
