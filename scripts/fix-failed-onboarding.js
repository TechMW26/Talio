#!/usr/bin/env node
/**
 * FIX: Send emails to users whose onboarding failed
 * Uses the EXISTING passwordSent stored in the record - does NOT reset passwords
 * 
 * Usage: node scripts/fix-failed-onboarding.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');

// Configuration
const TENANT_DB = 'talio_company_mushroom_world_group';

// Email delay between sends (60 seconds to avoid rate limiting)
const EMAIL_DELAY = 60000;

// Sleep helper
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fixFailedOnboardingEmails() {
  console.log('🚀 Fixing failed onboarding emails (NO password reset)...\n');
  
  // Connect to MongoDB
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Connected to MongoDB\n');
  
  const db = mongoose.connection.useDb(TENANT_DB);
  const employees = db.collection('employees');
  const onboardingEmails = db.collection('onboardingemails');
  
  // Create email transporter
  const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT),
    secure: process.env.EMAIL_SECURE === 'true',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD
    }
  });
  
  // Get failed onboarding email records that have a passwordSent
  const failedRecords = await onboardingEmails.find({ 
    status: 'failed',
    passwordSent: { $exists: true, $ne: null }
  }).toArray();
  
  console.log(`📬 Failed records with stored passwords: ${failedRecords.length}\n`);
  
  if (failedRecords.length === 0) {
    console.log('✅ No failed records to fix!');
    await mongoose.disconnect();
    return;
  }
  
  // Process each failed record
  let successCount = 0;
  let failCount = 0;
  
  for (let i = 0; i < failedRecords.length; i++) {
    const record = failedRecords[i];
    const email = record.recipientEmail;
    const password = record.passwordSent; // Use the password that was already stored
    
    console.log(`\n[${i + 1}/${failedRecords.length}] Sending to: ${email}`);
    console.log(`   Password from record: ${password}`);
    
    try {
      // Get employee record for additional details
      const employee = record.employee ? await employees.findOne({ _id: record.employee }) : null;
      
      const firstName = record.recipientName?.split(' ')[0] || employee?.firstName || 'Team Member';
      const lastName = record.recipientName?.split(' ').slice(1).join(' ') || employee?.lastName || '';
      const employeeCode = record.employeeCode || employee?.employeeCode || '';
      const designation = record.designation || employee?.designation || '';
      const department = record.department || employee?.department || '';
      const dateOfJoining = record.dateOfJoining || employee?.dateOfJoining;
      
      // Format joining date
      const joiningDate = dateOfJoining 
        ? new Date(dateOfJoining).toLocaleDateString('en-IN', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })
        : null;
      
      // Build employee details section
      let detailsHtml = '';
      if (designation || department || joiningDate || employeeCode) {
        detailsHtml = `
          <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
            ${designation ? `<tr><td style="padding: 8px 0; color: #6b7280;">Role</td><td style="padding: 8px 0; font-weight: 600;">${designation}</td></tr>` : ''}
            ${department ? `<tr><td style="padding: 8px 0; color: #6b7280;">Department</td><td style="padding: 8px 0; font-weight: 600;">${department}</td></tr>` : ''}
            ${joiningDate ? `<tr><td style="padding: 8px 0; color: #6b7280;">Start Date</td><td style="padding: 8px 0; font-weight: 600;">${joiningDate}</td></tr>` : ''}
            ${employeeCode ? `<tr><td style="padding: 8px 0; color: #6b7280;">Employee ID</td><td style="padding: 8px 0; font-weight: 600; color: #3b82f6;">${employeeCode}</td></tr>` : ''}
          </table>
        `;
      }
      
      // Send email (NO password reset - use existing password)
      const mailOptions = {
        from: process.env.EMAIL_FROM || 'Talio <info@talio.in>',
        to: email,
        subject: `Welcome to Talio, ${firstName}`,
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f3f4f6;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f3f4f6; padding: 40px 20px;">
              <tr>
                <td align="center">
                  <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
                    <!-- Header -->
                    <tr>
                      <td style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); padding: 32px; text-align: center;">
                        <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 700;">Welcome, ${firstName}!</h1>
                      </td>
                    </tr>
                    
                    <!-- Content -->
                    <tr>
                      <td style="padding: 32px;">
                        <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 24px;">
                          Your Talio account has been created. Here is everything you need to get started.
                        </p>
                        
                        ${detailsHtml}
                        
                        <h3 style="color: #111827; font-size: 18px; margin: 24px 0 16px;">Your Credentials</h3>
                        
                        <div style="background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%); border: 1px solid #10b981; border-radius: 12px; padding: 20px; margin-bottom: 16px;">
                          <div style="margin-bottom: 12px;">
                            <span style="color: #6b7280; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Email</span>
                            <p style="margin: 4px 0 0; font-size: 16px; font-weight: 600; color: #111827;">${email}</p>
                          </div>
                          <div>
                            <span style="color: #6b7280; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Password</span>
                            <p style="margin: 4px 0 0; font-size: 18px; font-weight: 700; color: #059669; font-family: 'Courier New', monospace; letter-spacing: 1px;">${password}</p>
                          </div>
                        </div>
                        
                        <div style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 12px; padding: 16px; margin-bottom: 24px;">
                          <p style="margin: 0; color: #92400e; font-size: 14px;">
                            <strong>Important:</strong> Please change your password after your first login.
                          </p>
                        </div>
                        
                        <h3 style="color: #111827; font-size: 18px; margin: 24px 0 16px;">Get Started</h3>
                        <p style="color: #374151; font-size: 14px; line-height: 1.6; margin: 0 0 20px;">
                          Download and install the Talio app, then sign in with your credentials above.
                        </p>
                        
                        <div style="text-align: center; margin: 24px 0;">
                          <a href="https://app.talio.in/resources" style="display: inline-block; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">
                            Download Talio App
                          </a>
                        </div>
                        
                        <div style="text-align: center; margin: 16px 0;">
                          <a href="https://app.talio.in/login" style="display: inline-block; border: 2px solid #6366f1; color: #6366f1; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 600; font-size: 14px;">
                            Login via Browser
                          </a>
                        </div>
                        
                        <p style="color: #9ca3af; font-size: 13px; text-align: center; margin-top: 24px;">
                          Need help? Contact your HR administrator.
                        </p>
                      </td>
                    </tr>
                    
                    <!-- Footer -->
                    <tr>
                      <td style="background: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #e5e7eb;">
                        <p style="margin: 0; color: #9ca3af; font-size: 12px;">
                          © ${new Date().getFullYear()} Talio. All rights reserved.
                        </p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </body>
          </html>
        `
      };
      
      await transporter.sendMail(mailOptions);
      
      // Update the failed record to sent
      await onboardingEmails.updateOne(
        { _id: record._id },
        { 
          $set: { 
            status: 'sent',
            sentAt: new Date(),
            errorMessage: null,
            updatedAt: new Date(),
          }
        }
      );
      
      console.log(`   ✅ Email sent to ${firstName} ${lastName}`);
      successCount++;
      
      // Long delay between emails to avoid rate limiting (60 seconds)
      if (i < failedRecords.length - 1) {
        console.log(`   ⏳ Waiting ${EMAIL_DELAY/1000}s before next email...`);
        await sleep(EMAIL_DELAY);
      }
      
    } catch (error) {
      console.log(`   ❌ Failed: ${error.message}`);
      failCount++;
      
      // Update error message
      await onboardingEmails.updateOne(
        { _id: record._id },
        { 
          $set: { 
            errorMessage: error.message,
            updatedAt: new Date(),
          }
        }
      );
    }
  }
  
  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('📊 SUMMARY');
  console.log('='.repeat(50));
  console.log(`✅ Successful: ${successCount}`);
  console.log(`❌ Failed: ${failCount}`);
  console.log(`📬 Total processed: ${failedRecords.length}`);
  
  await mongoose.disconnect();
  console.log('\n✅ Done!');
}

// Run the script
fixFailedOnboardingEmails().catch(e => {
  console.error('❌ Error:', e.message);
  process.exit(1);
});
