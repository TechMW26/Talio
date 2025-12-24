/**
 * Fix First Tenant Database Name
 * 
 * Updates the Mushroom World Group tenant to use hrms_db as the database name
 * for backwards compatibility.
 */

const mongoose = require('mongoose');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI;

function getClusterBaseUri() {
  const match = MONGODB_URI.match(/^(mongodb(?:\+srv)?:\/\/[^/]+)\/?([^?]*)?(\?.*)?$/);
  return {
    baseUri: match[1],
    options: match[3] || ''
  };
}

function getDatabaseUri(databaseName) {
  const { baseUri, options } = getClusterBaseUri();
  return `${baseUri}/${databaseName}${options}`;
}

async function fix() {
  console.log('🔧 Fixing tenant database name...');
  
  const uri = getDatabaseUri('talio_superadmin');
  const conn = await mongoose.createConnection(uri).asPromise();
  
  // Update TenantCompany
  const tenantResult = await conn.db.collection('tenantcompanies').updateOne(
    { slug: 'mushroom-world-group' },
    { $set: { databaseName: 'hrms_db' } }
  );
  console.log('TenantCompany updated:', tenantResult.modifiedCount);
  
  // Verify UserTenantMappings use hrms_db
  const mappingCount = await conn.db.collection('usertenantmappings').countDocuments({
    databaseName: 'hrms_db'
  });
  console.log('UserTenantMappings with hrms_db:', mappingCount);
  
  await conn.close();
  console.log('✅ Done!');
}

fix().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
