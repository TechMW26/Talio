#!/usr/bin/env node
/**
 * Debug script to check team members and screenshots
 */
require('dotenv').config();
const mongoose = require('mongoose');

async function debug() {
  await mongoose.connect(process.env.MONGODB_URI);
  const conn = mongoose.connection.useDb('talio_company_mushroom_world_group');
  
  console.log('=== SCREENSHOTS ===');
  // Get unique users with screenshots
  const screenshotUsers = await conn.collection('screenshots').distinct('user');
  console.log('Users with screenshots:', screenshotUsers.length);
  
  for (const userId of screenshotUsers.slice(0, 5)) {
    const count = await conn.collection('screenshots').countDocuments({ user: userId });
    const user = await conn.collection('users').findOne({ _id: userId });
    const emp = await conn.collection('employees').findOne({ userId: userId });
    console.log(`  - User ${userId}: ${count} screenshots, email: ${user?.email}, emp: ${emp?.firstName || 'N/A'}`);
  }
  
  console.log('\n=== CURRENT USER (AVIRAJ - manager) ===');
  const avirajId = new mongoose.Types.ObjectId('6957b358bf0b9ea49ca506f7');
  const aviraj = await conn.collection('users').findOne({ _id: avirajId });
  console.log('User:', aviraj?.email, 'role:', aviraj?.role);
  
  const avirajEmpId = aviraj?.employeeId;
  const avirajEmp = await conn.collection('employees').findOne({ _id: avirajEmpId });
  console.log('Employee:', avirajEmp?.firstName, avirajEmp?.lastName);
  console.log('Department ID:', avirajEmp?.department?.toString());
  
  console.log('\n=== DEPARTMENT CHECK ===');
  const dept = await conn.collection('departments').findOne({ _id: avirajEmp?.department });
  console.log('Department:', dept?.name);
  console.log('Department head:', dept?.head?.toString());
  console.log('Department heads:', dept?.heads?.map(h => h.toString()));
  console.log('Is Aviraj head:', dept?.head?.toString() === avirajEmpId?.toString() || dept?.heads?.some(h => h.toString() === avirajEmpId?.toString()));
  
  console.log('\n=== TEAM MEMBERS (in this dept) ===');
  const teamEmps = await conn.collection('employees').find({ 
    department: avirajEmp?.department,
    status: 'active'
  }).toArray();
  console.log('Total employees in dept:', teamEmps.length);
  
  for (const emp of teamEmps) {
    const hasUserId = !!emp.userId;
    const screenshotCount = hasUserId 
      ? await conn.collection('screenshots').countDocuments({ user: emp.userId })
      : 0;
    console.log(`  - ${emp.firstName} ${emp.lastName}: userId=${hasUserId}, screenshots=${screenshotCount}`);
  }
  
  await mongoose.disconnect();
  console.log('\nDone!');
}

debug().catch(console.error);
