#!/usr/bin/env node
require('dotenv').config();
const mongoose = require('mongoose');

async function check() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.useDb('talio_company_mushroom_world_group');
  const emails = db.collection('onboardingemails');
  
  const withPassword = await emails.countDocuments({ passwordSent: { $exists: true, $ne: null } });
  const withoutPassword = await emails.countDocuments({ $or: [{ passwordSent: { $exists: false }}, { passwordSent: null }] });
  
  console.log('Records with passwordSent:', withPassword);
  console.log('Records without passwordSent:', withoutPassword);
  
  // Get sample with passwords
  const sample = await emails.find({ passwordSent: { $exists: true, $ne: null } }).limit(5).toArray();
  console.log('\nSample records with passwords:');
  sample.forEach(r => {
    console.log('  -', r.recipientEmail, '|', r.passwordSent);
  });
  
  await mongoose.disconnect();
}
check();
