/**
 * Remove SuperAdmin from UserTenantMapping
 * SuperAdmin should only login via /superadmin/login
 */

const mongoose = require('mongoose');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI;
const match = MONGODB_URI.match(/^(mongodb(?:\+srv)?:\/\/[^/]+)\/?([^?]*)?(\?.*)?$/);
const uri = match[1] + '/talio_superadmin' + (match[3] || '');

async function removeSuperAdminMapping() {
  console.log('Removing SuperAdmin from UserTenantMapping...');
  const conn = await mongoose.createConnection(uri).asPromise();
  
  const result = await conn.db.collection('usertenantmappings').deleteOne({
    email: 'avi2001raj@gmail.com'
  });
  
  console.log('Deleted:', result.deletedCount);
  await conn.close();
  console.log('Done! SuperAdmin should now only login at /superadmin/login');
}

removeSuperAdminMapping().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
