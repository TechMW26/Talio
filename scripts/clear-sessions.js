#!/usr/bin/env node
/**
 * Clear productivity sessions to force recreation with correct schema
 */
require('dotenv').config();
const mongoose = require('mongoose');

async function clearSessions() {
  const uri = process.env.MONGODB_URI;
  console.log('Connecting to MongoDB...');
  await mongoose.connect(uri);
  
  // Find the tenant database
  const dbs = await mongoose.connection.db.admin().listDatabases();
  console.log('Available databases:', dbs.databases.map(d => d.name).join(', '));
  
  // Look for tenant DB with talio prefix
  const talioDb = dbs.databases.find(d => d.name.startsWith('talio_company_'));
  
  if (!talioDb) {
    console.log('Tenant database not found');
    process.exit(1);
  }
  
  console.log('Found database:', talioDb.name);
  const conn = mongoose.connection.useDb(talioDb.name);
  
  // List collections
  const collections = await conn.db.listCollections().toArray();
  console.log('Collections:', collections.map(c => c.name).join(', '));
  
  const result = await conn.collection('productivitysessions').deleteMany({});
  console.log('Deleted sessions:', result.deletedCount);
  
  await mongoose.disconnect();
  console.log('Done!');
}

clearSessions().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
