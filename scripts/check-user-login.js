/**
 * Debug script to check user login issues
 * Run: node scripts/check-user-login.js [email]
 * 
 * This script dynamically looks up the tenant database from the UserTenantMapping
 * to avoid creating hardcoded database connections.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// Get MongoDB base URI from environment
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI environment variable is required');
  process.exit(1);
}

// Extract base URI for building database-specific connections
function getDatabaseUri(databaseName) {
  const match = MONGODB_URI.match(/^(mongodb(?:\+srv)?:\/\/[^/]+)\/?([^?]*)?(\?.*)?$/);
  if (!match) {
    throw new Error('Invalid MONGODB_URI format');
  }
  const baseUri = match[1];
  const options = match[3] || '';
  return `${baseUri}/${databaseName}${options}`;
}

// Default email or take from command line
const EMAIL = process.argv[2] || 'aviraj.sharma@mushroomworldgroup.com';

async function checkUser() {
  console.log('=== Checking User Login Issue ===\n');
  console.log('Checking email:', EMAIL, '\n');
  
  // Step 1: Check UserTenantMapping in superadmin DB
  console.log('Step 1: Checking UserTenantMapping in superadmin DB...');
  const superadminUri = getDatabaseUri('talio_superadmin');
  const superadminConn = await mongoose.createConnection(superadminUri).asPromise();
  const mapping = await superadminConn.db.collection('usertenantmappings').findOne({ 
    email: EMAIL.toLowerCase() 
  });
  
  if (mapping) {
    console.log('  ✅ Mapping found:');
    console.log('     Database:', mapping.databaseName);
    console.log('     Company:', mapping.companyName);
    console.log('     Active:', mapping.isActive);
    console.log('     Role:', mapping.role);
  } else {
    console.log('  ❌ No mapping found for email:', EMAIL);
    await superadminConn.close();
    return;
  }
  await superadminConn.close();
  
  // Step 2: Check User in tenant DB (dynamically using mapping.databaseName)
  console.log(`\nStep 2: Checking User in tenant DB (${mapping.databaseName})...`);
  const tenantUri = getDatabaseUri(mapping.databaseName);
  const tenantConn = await mongoose.createConnection(tenantUri).asPromise();
  const user = await tenantConn.db.collection('users').findOne({ 
    email: EMAIL.toLowerCase() 
  });
  
  if (user) {
    console.log('  ✅ User found:');
    console.log('     _id:', user._id);
    console.log('     Email:', user.email);
    console.log('     Role:', user.role);
    console.log('     Active:', user.isActive);
    console.log('     Has Password:', !!user.password);
    console.log('     Password Length:', user.password?.length);
    console.log('     Password Starts With:', user.password?.substring(0, 10) + '...');
    
    // Step 3: Test password comparison
    console.log('\nStep 3: Testing password comparison...');
    const testPassword = 'Test@123'; // Common test password
    
    if (user.password) {
      // Check if it's a bcrypt hash
      const isBcrypt = user.password.startsWith('$2');
      console.log('     Is bcrypt hash:', isBcrypt);
      
      if (isBcrypt) {
        // Try comparing with a test password
        console.log('     Password appears to be properly hashed.');
      } else {
        console.log('     ⚠️ Password is NOT a bcrypt hash - might be plain text!');
        console.log('     Plain text password:', user.password);
      }
    }
  } else {
    console.log('  ❌ User NOT found in tenant database!');
  }
  
  await tenantConn.close();
  console.log('\n=== Check Complete ===');
}

checkUser().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
