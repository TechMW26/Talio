#!/usr/bin/env node
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');

const emails = [
  'sahi.sahu@mushroomworldgroup.com',
  'jaya.raghuwanshi@mushroomworldgroup.com'
];

async function sendPasswords() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.useDb('talio_company_mushroom_world_group');
  const users = db.collection('users');
  const employees = db.collection('employees');
  
  const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT),
    secure: process.env.EMAIL_SECURE === 'true',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD
    }
  });
  
  for (const email of emails) {
    const employee = await employees.findOne({ email });
    if (!employee) {
      console.log('❌ Employee not found:', email);
      continue;
    }
    
    const user = await users.findOne({ email });
    if (!user) {
      console.log('❌ User not found:', email);
      continue;
    }
    
    // Generate new password
    const newPassword = Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-4).toUpperCase();
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
    // Update user password
    await users.updateOne({ _id: user._id }, { $set: { password: hashedPassword } });
    
    // Send email
    const mailOptions = {
      from: process.env.EMAIL_FROM || 'Talio <info@talio.in>',
      to: email,
      subject: 'Your New Talio Password',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #6366f1;">Hello ${employee.firstName}!</h2>
          <p>Your password has been reset. Here are your new login credentials:</p>
          <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>New Password:</strong> ${newPassword}</p>
          </div>
          <p>Please login at <a href="https://talio.ai/login">https://talio.ai/login</a> and change your password.</p>
          <p style="color: #6b7280; font-size: 12px;">- Talio Team</p>
        </div>
      `
    };
    
    await transporter.sendMail(mailOptions);
    console.log('✅ Password sent to:', email, '- Name:', employee.firstName, employee.lastName);
  }
  
  await mongoose.disconnect();
  console.log('\n✅ Done!');
}

sendPasswords().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
