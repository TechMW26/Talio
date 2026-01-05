#!/usr/bin/env node

/**
 * Script to clear all ImageKit-related data from the database
 * Run with: node scripts/clear-imagekit-data.js
 * 
 * This script will:
 * 1. Delete all Screenshot documents
 * 2. Delete all ProductivitySession documents (they contain screenshot references)
 * 3. Clear ImageKit URLs from User avatars
 * 4. Clear ImageKit URLs from Employee profile pictures
 * 5. Clear Aadhaar document uploads from User profiles
 * 6. Clear any other ImageKit file references
 */

require('dotenv').config();
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI not found in environment');
  process.exit(1);
}

async function clearImageKitData() {
  try {
    console.log('🔄 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const db = mongoose.connection.db;
    
    // Get list of all databases (for multi-tenant setup)
    const adminDb = db.admin();
    const { databases } = await adminDb.listDatabases();
    
    // Filter to only tenant databases (exclude system databases)
    const tenantDatabases = databases.filter(d => 
      !['admin', 'local', 'config'].includes(d.name)
    );

    console.log(`\n📊 Found ${tenantDatabases.length} databases to process\n`);

    let totalStats = {
      screenshots: 0,
      productivitySessions: 0,
      userAvatars: 0,
      employeePhotos: 0,
      aadhaarDocs: 0,
      otherImageKit: 0
    };

    for (const database of tenantDatabases) {
      console.log(`\n🗄️  Processing database: ${database.name}`);
      console.log('─'.repeat(50));
      
      const tenantDb = mongoose.connection.useDb(database.name);
      
      // 1. Delete all Screenshots
      try {
        const screenshotCollection = tenantDb.collection('screenshots');
        const screenshotCount = await screenshotCollection.countDocuments();
        if (screenshotCount > 0) {
          await screenshotCollection.deleteMany({});
          console.log(`   ✅ Deleted ${screenshotCount} screenshots`);
          totalStats.screenshots += screenshotCount;
        } else {
          console.log(`   ℹ️  No screenshots found`);
        }
      } catch (e) {
        if (e.code !== 26) console.log(`   ⚠️  Screenshots: ${e.message}`);
      }

      // 2. Delete all ProductivitySessions
      try {
        const sessionCollection = tenantDb.collection('productivitysessions');
        const sessionCount = await sessionCollection.countDocuments();
        if (sessionCount > 0) {
          await sessionCollection.deleteMany({});
          console.log(`   ✅ Deleted ${sessionCount} productivity sessions`);
          totalStats.productivitySessions += sessionCount;
        } else {
          console.log(`   ℹ️  No productivity sessions found`);
        }
      } catch (e) {
        if (e.code !== 26) console.log(`   ⚠️  ProductivitySessions: ${e.message}`);
      }

      // 3. Clear User avatars and Aadhaar docs
      try {
        const userCollection = tenantDb.collection('users');
        const usersWithImageKit = await userCollection.countDocuments({
          $or: [
            { avatar: { $regex: /imagekit|ik\.imagekit/i } },
            { avatarFileId: { $exists: true, $ne: null } },
            { 'profileCompletion.aadhaarFront.url': { $exists: true } },
            { 'profileCompletion.aadhaarBack.url': { $exists: true } }
          ]
        });
        
        if (usersWithImageKit > 0) {
          // Clear avatar fields
          const avatarResult = await userCollection.updateMany(
            { $or: [
              { avatar: { $regex: /imagekit|ik\.imagekit/i } },
              { avatarFileId: { $exists: true, $ne: null } }
            ]},
            { $unset: { avatar: '', avatarFileId: '' } }
          );
          totalStats.userAvatars += avatarResult.modifiedCount;
          
          // Clear Aadhaar documents
          const aadhaarResult = await userCollection.updateMany(
            { $or: [
              { 'profileCompletion.aadhaarFront.url': { $exists: true } },
              { 'profileCompletion.aadhaarBack.url': { $exists: true } }
            ]},
            { 
              $unset: { 
                'profileCompletion.aadhaarFront': '',
                'profileCompletion.aadhaarBack': ''
              },
              $set: {
                'profileCompletion.completedFields.aadhaarUploaded': false,
                'profileCompletion.completedFields.ocrVerified': false,
                'profileCompletion.ocrVerification.status': 'pending'
              }
            }
          );
          totalStats.aadhaarDocs += aadhaarResult.modifiedCount;
          
          console.log(`   ✅ Cleared ${avatarResult.modifiedCount} user avatars`);
          console.log(`   ✅ Cleared ${aadhaarResult.modifiedCount} Aadhaar documents`);
        } else {
          console.log(`   ℹ️  No user ImageKit data found`);
        }
      } catch (e) {
        if (e.code !== 26) console.log(`   ⚠️  Users: ${e.message}`);
      }

      // 4. Clear Employee profile pictures
      try {
        const employeeCollection = tenantDb.collection('employees');
        const employeesWithImageKit = await employeeCollection.countDocuments({
          $or: [
            { profilePicture: { $regex: /imagekit|ik\.imagekit/i } },
            { profilePictureFileId: { $exists: true, $ne: null } }
          ]
        });
        
        if (employeesWithImageKit > 0) {
          const result = await employeeCollection.updateMany(
            { $or: [
              { profilePicture: { $regex: /imagekit|ik\.imagekit/i } },
              { profilePictureFileId: { $exists: true, $ne: null } }
            ]},
            { $unset: { profilePicture: '', profilePictureFileId: '' } }
          );
          console.log(`   ✅ Cleared ${result.modifiedCount} employee profile pictures`);
          totalStats.employeePhotos += result.modifiedCount;
        } else {
          console.log(`   ℹ️  No employee ImageKit data found`);
        }
      } catch (e) {
        if (e.code !== 26) console.log(`   ⚠️  Employees: ${e.message}`);
      }

      // 5. Clear Document uploads with ImageKit URLs
      try {
        const documentCollection = tenantDb.collection('documents');
        const docsWithImageKit = await documentCollection.countDocuments({
          $or: [
            { fileUrl: { $regex: /imagekit|ik\.imagekit/i } },
            { imagekitFileId: { $exists: true, $ne: null } }
          ]
        });
        
        if (docsWithImageKit > 0) {
          const result = await documentCollection.deleteMany({
            $or: [
              { fileUrl: { $regex: /imagekit|ik\.imagekit/i } },
              { imagekitFileId: { $exists: true, $ne: null } }
            ]
          });
          console.log(`   ✅ Deleted ${result.deletedCount} documents with ImageKit URLs`);
          totalStats.otherImageKit += result.deletedCount;
        }
      } catch (e) {
        if (e.code !== 26) console.log(`   ⚠️  Documents: ${e.message}`);
      }

      // 6. Clear Expense receipts with ImageKit URLs
      try {
        const expenseCollection = tenantDb.collection('expenses');
        const expensesWithImageKit = await expenseCollection.countDocuments({
          'receipts.url': { $regex: /imagekit|ik\.imagekit/i }
        });
        
        if (expensesWithImageKit > 0) {
          const result = await expenseCollection.updateMany(
            { 'receipts.url': { $regex: /imagekit|ik\.imagekit/i } },
            { $set: { receipts: [] } }
          );
          console.log(`   ✅ Cleared receipts from ${result.modifiedCount} expenses`);
          totalStats.otherImageKit += result.modifiedCount;
        }
      } catch (e) {
        if (e.code !== 26) console.log(`   ⚠️  Expenses: ${e.message}`);
      }

      // 7. Clear Company logos with ImageKit URLs
      try {
        const companyCollection = tenantDb.collection('companies');
        const companiesWithImageKit = await companyCollection.countDocuments({
          $or: [
            { logo: { $regex: /imagekit|ik\.imagekit/i } },
            { logoFileId: { $exists: true, $ne: null } }
          ]
        });
        
        if (companiesWithImageKit > 0) {
          const result = await companyCollection.updateMany(
            { $or: [
              { logo: { $regex: /imagekit|ik\.imagekit/i } },
              { logoFileId: { $exists: true, $ne: null } }
            ]},
            { $unset: { logo: '', logoFileId: '' } }
          );
          console.log(`   ✅ Cleared ${result.modifiedCount} company logos`);
          totalStats.otherImageKit += result.modifiedCount;
        }
      } catch (e) {
        if (e.code !== 26) console.log(`   ⚠️  Companies: ${e.message}`);
      }
    }

    // Print summary
    console.log('\n' + '═'.repeat(50));
    console.log('📊 SUMMARY');
    console.log('═'.repeat(50));
    console.log(`   Screenshots deleted:          ${totalStats.screenshots}`);
    console.log(`   Productivity sessions deleted: ${totalStats.productivitySessions}`);
    console.log(`   User avatars cleared:         ${totalStats.userAvatars}`);
    console.log(`   Employee photos cleared:      ${totalStats.employeePhotos}`);
    console.log(`   Aadhaar documents cleared:    ${totalStats.aadhaarDocs}`);
    console.log(`   Other ImageKit data cleared:  ${totalStats.otherImageKit}`);
    console.log('═'.repeat(50));
    console.log('\n✅ ImageKit data cleanup complete!');
    console.log('ℹ️  Users will need to re-upload their photos and documents.\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
}

// Run the script
clearImageKitData();
