/**
 * Add SuperAdmin to UserTenantMapping
 * This allows the superadmin to login from the regular login page too
 */

const mongoose = require('mongoose');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI;
const match = MONGODB_URI.match(/^(mongodb(?:\+srv)?:\/\/[^/]+)\/?([^?]*)?(\?.*)?$/);
const uri = match[1] + '/talio_superadmin' + (match[3] || '');

async function addSuperAdminMapping() {
  console.log('Adding SuperAdmin to UserTenantMapping...');
  const conn = await mongoose.createConnection(uri).asPromise();
  
  // Get the tenant company ID for mushroom-world-group
  const tenant = await conn.db.collection('tenantcompanies').findOne({ slug: 'mushroom-world-group' });
  
  if (!tenant) {
    console.log('❌ Tenant not found!');
    await conn.close();
    return;
  }
  
  console.log('Found tenant:', tenant.name);
  
  // Add or update the superadmin mapping to hrms_db
  const result = await conn.db.collection('usertenantmappings').updateOne(
    { email: 'avi2001raj@gmail.com' },
    {
      $set: {
        email: 'avi2001raj@gmail.com',
        tenantCompanyId: tenant._id,
        databaseName: 'hrms_db',
        companyName: tenant.name,
        companySlug: tenant.slug,
        role: 'admin',
        isActive: true
      }
    },
    { upsert: true }
  );
  
  console.log('Result:', result.modifiedCount || result.upsertedCount ? '✅ Added/Updated' : 'Already exists');
  await conn.close();
}

addSuperAdminMapping().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
