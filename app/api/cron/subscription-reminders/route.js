/**
 * Subscription Reminder Cron Job
 * Sends email reminders to companies when their subscription is nearing expiry
 * 
 * Reminder thresholds: 85%, 90%, 95% of tenure
 * 
 * Run daily via cron job
 * Endpoint: POST /api/cron/subscription-reminders
 * Required Header: x-cron-secret: {CRON_SECRET}
 */

import { NextResponse } from 'next/server';
import { connectSuperadminDB } from '@/lib/superadminDb';
import getTenantCompanyModel from '@/models/TenantCompany';
import nodemailer from 'nodemailer';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Allow up to 60 seconds for processing

// Reminder thresholds (percentage of tenure elapsed)
const REMINDER_THRESHOLDS = [85, 90, 95];

// Create email transporter
function createTransporter() {
  return nodemailer.createTransport({
    host: 'smtp.hostinger.com',
    port: 465,
    secure: true,
    auth: {
      user: 'info@talio.in',
      pass: process.env.EMAIL_PASSWORD,
    },
  });
}

/**
 * Calculate tenure progress percentage
 */
function calculateTenureProgress(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const now = new Date();
  
  const totalDuration = end.getTime() - start.getTime();
  const elapsed = now.getTime() - start.getTime();
  
  if (totalDuration <= 0) return 100;
  
  const progress = (elapsed / totalDuration) * 100;
  return Math.min(Math.max(progress, 0), 100);
}

/**
 * Get the highest threshold that applies
 */
function getApplicableThreshold(progress, remindersSent = []) {
  // Find the highest threshold that the progress has crossed but hasn't been sent yet
  for (let i = REMINDER_THRESHOLDS.length - 1; i >= 0; i--) {
    const threshold = REMINDER_THRESHOLDS[i];
    if (progress >= threshold && !remindersSent.includes(threshold)) {
      return threshold;
    }
  }
  return null;
}

/**
 * Format remaining days
 */
function getRemainingDays(endDate) {
  const end = new Date(endDate);
  const now = new Date();
  const diffTime = end.getTime() - now.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return Math.max(0, diffDays);
}

/**
 * Send subscription reminder email to company
 */
async function sendReminderToCompany(transporter, company, threshold, remainingDays) {
  const emailHtml = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); padding: 30px; text-align: center;">
        <h1 style="color: white; margin: 0;">Talio HRMS</h1>
      </div>
      
      <div style="padding: 30px; background: #f8fafc;">
        <h2 style="color: #1e293b;">Subscription Renewal Reminder</h2>
        
        <p style="color: #475569; font-size: 16px;">
          Dear <strong>${company.primaryContact?.name || company.name} Admin</strong>,
        </p>
        
        <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0;">
          <p style="margin: 0; color: #92400e;">
            <strong>⚠️ Your Talio subscription is ${threshold}% through its tenure.</strong>
          </p>
          <p style="margin: 10px 0 0 0; color: #92400e;">
            Only <strong>${remainingDays} days</strong> remaining until expiry.
          </p>
        </div>
        
        <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="color: #1e293b; margin-top: 0;">Subscription Details</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; color: #64748b;">Company:</td>
              <td style="padding: 8px 0; color: #1e293b; font-weight: 500;">${company.name}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #64748b;">Plan:</td>
              <td style="padding: 8px 0; color: #1e293b; font-weight: 500;">${company.subscription?.plan || 'Standard'}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #64748b;">Start Date:</td>
              <td style="padding: 8px 0; color: #1e293b; font-weight: 500;">${new Date(company.subscription?.startDate).toLocaleDateString('en-IN')}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #64748b;">End Date:</td>
              <td style="padding: 8px 0; color: #1e293b; font-weight: 500;">${new Date(company.subscription?.endDate).toLocaleDateString('en-IN')}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #64748b;">Amount:</td>
              <td style="padding: 8px 0; color: #1e293b; font-weight: 500;">₹${(company.subscription?.amount || 0).toLocaleString('en-IN')}</td>
            </tr>
          </table>
        </div>
        
        <p style="color: #475569; font-size: 16px;">
          To ensure uninterrupted access to Talio HRMS, please renew your subscription before the expiry date.
        </p>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="mailto:info@talio.in?subject=Subscription Renewal - ${company.name}" 
             style="background: #1e40af; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: 500;">
            Contact for Renewal
          </a>
        </div>
        
        <p style="color: #64748b; font-size: 14px; margin-top: 30px;">
          If you have any questions, please contact our support team at 
          <a href="mailto:info@talio.in" style="color: #1e40af;">info@talio.in</a>
        </p>
      </div>
      
      <div style="background: #1e293b; padding: 20px; text-align: center;">
        <p style="color: #94a3b8; margin: 0; font-size: 12px;">
          © ${new Date().getFullYear()} Talio HRMS. All rights reserved.
        </p>
      </div>
    </div>
  `;

  const emailTo = company.primaryContact?.email || company.adminEmail;
  
  if (!emailTo) {
    console.warn(`[Subscription Reminder] No email for company ${company.name}`);
    return { success: false, reason: 'No email address' };
  }

  try {
    await transporter.sendMail({
      from: '"Talio HRMS" <info@talio.in>',
      to: emailTo,
      subject: `⚠️ Subscription Reminder - ${remainingDays} days remaining`,
      html: emailHtml,
    });

    console.log(`[Subscription Reminder] Sent ${threshold}% reminder to ${company.name} (${emailTo})`);
    return { success: true };
  } catch (error) {
    console.error(`[Subscription Reminder] Failed to send to ${company.name}:`, error.message);
    return { success: false, reason: error.message };
  }
}

/**
 * Send alert to SuperAdmin about subscription expirations
 */
async function sendSuperAdminAlert(transporter, companies) {
  const emailHtml = `
    <div style="font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); padding: 30px; text-align: center;">
        <h1 style="color: white; margin: 0;">Talio SuperAdmin Alert</h1>
      </div>
      
      <div style="padding: 30px; background: #f8fafc;">
        <h2 style="color: #1e293b;">Daily Subscription Status Report</h2>
        <p style="color: #64748b;">Generated on ${new Date().toLocaleDateString('en-IN', { dateStyle: 'full' })}</p>
        
        <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
          <thead>
            <tr style="background: #1e40af;">
              <th style="padding: 12px; color: white; text-align: left;">Company</th>
              <th style="padding: 12px; color: white; text-align: center;">Progress</th>
              <th style="padding: 12px; color: white; text-align: center;">Days Left</th>
              <th style="padding: 12px; color: white; text-align: center;">End Date</th>
            </tr>
          </thead>
          <tbody>
            ${companies.map(c => `
              <tr style="border-bottom: 1px solid #e2e8f0;">
                <td style="padding: 12px;">${c.name}</td>
                <td style="padding: 12px; text-align: center;">
                  <span style="background: ${c.progress >= 95 ? '#fee2e2' : c.progress >= 90 ? '#fef3c7' : '#dcfce7'}; 
                         color: ${c.progress >= 95 ? '#dc2626' : c.progress >= 90 ? '#d97706' : '#16a34a'};
                         padding: 4px 8px; border-radius: 4px; font-weight: 500;">
                    ${Math.round(c.progress)}%
                  </span>
                </td>
                <td style="padding: 12px; text-align: center; font-weight: 500;">${c.remainingDays}</td>
                <td style="padding: 12px; text-align: center;">${new Date(c.endDate).toLocaleDateString('en-IN')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: '"Talio System" <info@talio.in>',
      to: 'info@talio.in',
      subject: `📊 Subscription Status Report - ${companies.length} companies expiring soon`,
      html: emailHtml,
    });
    console.log('[Subscription Reminder] SuperAdmin alert sent');
  } catch (error) {
    console.error('[Subscription Reminder] Failed to send SuperAdmin alert:', error.message);
  }
}

export async function POST(request) {
  try {
    // Verify cron secret
    const cronSecret = request.headers.get('x-cron-secret');
    if (cronSecret !== process.env.CRON_SECRET) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized' },
        { status: 401 }
      );
    }

    console.log('[Subscription Reminder] Starting subscription reminder job...');

    await connectSuperadminDB();
    const TenantCompany = await getTenantCompanyModel();

    // Get all active companies with subscription end dates
    const companies = await TenantCompany.find({
      isActive: true,
      serviceStatus: { $in: ['active', 'trial'] },
      'subscription.endDate': { $exists: true },
    }).lean();

    console.log(`[Subscription Reminder] Found ${companies.length} active companies`);

    const transporter = createTransporter();
    const results = {
      processed: 0,
      reminders_sent: 0,
      errors: 0,
      companies_expiring_soon: [],
    };

    for (const company of companies) {
      results.processed++;

      const progress = calculateTenureProgress(
        company.subscription.startDate,
        company.subscription.endDate
      );

      const remainingDays = getRemainingDays(company.subscription.endDate);
      const remindersSent = company.subscription.remindersSent || [];

      // Check if we need to send a reminder
      const applicableThreshold = getApplicableThreshold(progress, remindersSent);

      if (applicableThreshold) {
        // Send reminder to company
        const result = await sendReminderToCompany(
          transporter,
          company,
          applicableThreshold,
          remainingDays
        );

        if (result.success) {
          results.reminders_sent++;

          // Update company with reminder sent
          await TenantCompany.updateOne(
            { _id: company._id },
            {
              $push: { 'subscription.remindersSent': applicableThreshold },
              $set: { 'subscription.lastReminderAt': new Date() },
            }
          );

          // Log to email history
          await TenantCompany.updateOne(
            { _id: company._id },
            {
              $push: {
                emailHistory: {
                  subject: `Subscription ${applicableThreshold}% Reminder`,
                  template: 'subscription_reminder',
                  sentAt: new Date(),
                  sentBy: 'system',
                },
              },
            }
          );
        } else {
          results.errors++;
        }
      }

      // Track companies expiring soon (>80% progress)
      if (progress >= 80) {
        results.companies_expiring_soon.push({
          name: company.name,
          progress,
          remainingDays,
          endDate: company.subscription.endDate,
        });
      }
    }

    // Send daily digest to SuperAdmin if there are expiring companies
    if (results.companies_expiring_soon.length > 0) {
      await sendSuperAdminAlert(transporter, results.companies_expiring_soon);
    }

    console.log(`[Subscription Reminder] Completed: ${results.reminders_sent} reminders sent, ${results.errors} errors`);

    return NextResponse.json({
      success: true,
      message: 'Subscription reminder job completed',
      results,
    });
  } catch (error) {
    console.error('[Subscription Reminder] Error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to process subscription reminders', error: error.message },
      { status: 500 }
    );
  }
}

export async function GET(request) {
  // For testing - show current subscription status
  try {
    const cronSecret = request.headers.get('x-cron-secret');
    if (cronSecret !== process.env.CRON_SECRET) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized' },
        { status: 401 }
      );
    }

    await connectSuperadminDB();
    const TenantCompany = await getTenantCompanyModel();

    const companies = await TenantCompany.find({
      isActive: true,
      'subscription.endDate': { $exists: true },
    }).select('name subscription.startDate subscription.endDate subscription.remindersSent serviceStatus').lean();

    const status = companies.map(c => ({
      name: c.name,
      serviceStatus: c.serviceStatus,
      startDate: c.subscription?.startDate,
      endDate: c.subscription?.endDate,
      progress: calculateTenureProgress(c.subscription?.startDate, c.subscription?.endDate),
      remainingDays: getRemainingDays(c.subscription?.endDate),
      remindersSent: c.subscription?.remindersSent || [],
    }));

    return NextResponse.json({
      success: true,
      count: status.length,
      companies: status,
    });
  } catch (error) {
    console.error('[Subscription Status] Error:', error);
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 }
    );
  }
}
