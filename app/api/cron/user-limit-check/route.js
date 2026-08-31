/**
 * User Limit Notification Cron Job
 * Checks companies that have reached their user limits and sends notifications
 * 
 * Run daily via external cron service
 * Endpoint: POST /api/cron/user-limit-check
 * Required Header: x-cron-secret: {CRON_SECRET}
 */

import { NextResponse } from 'next/server';
import { connectSuperadminDB } from '@/lib/superadminDb';
import { getCronAuthErrorResponse } from '@/lib/cronAuth';
import getTenantCompanyModel from '@/models/TenantCompany';
import { getTenantConnection } from '@/lib/tenantDb';
import nodemailer from 'nodemailer';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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
 * Send user limit notification to company admin
 */
async function sendLimitNotification(transporter, company, currentCount, maxUsers, usagePercent) {
  const isAtLimit = currentCount >= maxUsers;
  const isNearLimit = usagePercent >= 80;

  if (!isAtLimit && !isNearLimit) return null;

  const emailHtml = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); padding: 30px; text-align: center;">
        <h1 style="color: white; margin: 0;">Talio HRMS</h1>
      </div>
      
      <div style="padding: 30px; background: #f8fafc;">
        <h2 style="color: #1e293b;">User Limit ${isAtLimit ? 'Reached' : 'Warning'}</h2>
        
        <div style="background: ${isAtLimit ? '#fee2e2' : '#fef3c7'}; border-left: 4px solid ${isAtLimit ? '#dc2626' : '#f59e0b'}; padding: 15px; margin: 20px 0;">
          <p style="margin: 0; color: ${isAtLimit ? '#dc2626' : '#92400e'};">
            ${isAtLimit
      ? '🚫 You have reached your maximum user limit. New employee creation is blocked.'
      : `⚠️ You are using ${Math.round(usagePercent)}% of your user quota.`
    }
          </p>
        </div>
        
        <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="color: #1e293b; margin-top: 0;">Usage Summary</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; color: #64748b;">Current Users:</td>
              <td style="padding: 8px 0; color: #1e293b; font-weight: 500;">${currentCount}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #64748b;">Maximum Allowed:</td>
              <td style="padding: 8px 0; color: #1e293b; font-weight: 500;">${maxUsers}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #64748b;">Usage:</td>
              <td style="padding: 8px 0;">
                <div style="background: #e2e8f0; border-radius: 10px; height: 20px; overflow: hidden;">
                  <div style="background: ${isAtLimit ? '#dc2626' : usagePercent >= 80 ? '#f59e0b' : '#22c55e'}; 
                              height: 100%; width: ${Math.min(usagePercent, 100)}%; 
                              display: flex; align-items: center; justify-content: center; color: white; font-size: 12px;">
                    ${Math.round(usagePercent)}%
                  </div>
                </div>
              </td>
            </tr>
          </table>
        </div>
        
        ${isAtLimit ? `
          <div style="background: #f8fafc; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <h4 style="color: #1e293b; margin-top: 0;">What happens now?</h4>
            <ul style="color: #3f3f46; padding-left: 20px;">
              <li>New employee creation is blocked</li>
              <li>Existing employees are not affected</li>
              <li>Contact Talio to increase your limit</li>
            </ul>
          </div>
        ` : ''}
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="mailto:info@talio.in?subject=Increase User Limit - ${company.name}" 
             style="background: #1e40af; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: 500;">
            Request Limit Increase
          </a>
        </div>
        
        <p style="color: #64748b; font-size: 14px;">
          Contact us at <a href="mailto:info@talio.in" style="color: #1e40af;">info@talio.in</a> to upgrade your plan.
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
    return { success: false, reason: 'No email address' };
  }

  try {
    await transporter.sendMail({
      from: '"Talio HRMS" <info@talio.in>',
      to: emailTo,
      subject: `${isAtLimit ? '🚫' : '⚠️'} User Limit ${isAtLimit ? 'Reached' : 'Warning'} - ${company.name}`,
      html: emailHtml,
    });

    return { success: true, type: isAtLimit ? 'limit_reached' : 'near_limit' };
  } catch (error) {
    return { success: false, reason: error.message };
  }
}

export async function POST(request) {
  try {
    const authError = getCronAuthErrorResponse(request);
    if (authError) return authError;

    console.log('[User Limit Check] Starting user limit check job...');

    await connectSuperadminDB();
    const TenantCompany = await getTenantCompanyModel();
    const mongoose = await import('mongoose');

    // Get all active companies
    const companies = await TenantCompany.find({
      isActive: true,
      serviceStatus: 'active',
      isSetupComplete: true,
    }).lean();

    console.log(`[User Limit Check] Checking ${companies.length} companies`);

    const transporter = createTransporter();
    const results = {
      checked: 0,
      at_limit: 0,
      near_limit: 0,
      notifications_sent: 0,
      errors: [],
    };

    for (const company of companies) {
      results.checked++;
      const maxUsers = company.subscription?.maxUsers || 10;

      try {
        // Get current user count from tenant database
        const tenantConnection = await getTenantConnection(company.databaseName);
        const currentCount = await tenantConnection.db.collection('users').countDocuments({ isActive: true });

        const usagePercent = (currentCount / maxUsers) * 100;

        // Update company with current count
        await TenantCompany.updateOne(
          { _id: company._id },
          {
            $set: {
              'subscription.currentUserCount': currentCount,
              'analytics.lastUserCountCheck': new Date(),
            }
          }
        );

        // Check if at limit
        if (currentCount >= maxUsers) {
          results.at_limit++;

          // Check if we already notified today
          const lastNotified = company.analytics?.userLimitNotifiedAt;
          const today = new Date().toDateString();
          const wasNotifiedToday = lastNotified && new Date(lastNotified).toDateString() === today;

          if (!wasNotifiedToday) {
            const notifResult = await sendLimitNotification(transporter, company, currentCount, maxUsers, usagePercent);
            if (notifResult?.success) {
              results.notifications_sent++;
              await TenantCompany.updateOne(
                { _id: company._id },
                {
                  $set: {
                    'analytics.userLimitReachedAt': new Date(),
                    'analytics.userLimitNotifiedAt': new Date(),
                  }
                }
              );
            }
          }
        } else if (usagePercent >= 80) {
          results.near_limit++;

          // Only notify once when crossing 80% threshold
          const wasNearLimit = company.analytics?.userLimitWarningAt;
          const lastCount = company.subscription?.currentUserCount || 0;
          const lastPercent = (lastCount / maxUsers) * 100;

          if (!wasNearLimit || lastPercent < 80) {
            const notifResult = await sendLimitNotification(transporter, company, currentCount, maxUsers, usagePercent);
            if (notifResult?.success) {
              results.notifications_sent++;
              await TenantCompany.updateOne(
                { _id: company._id },
                { $set: { 'analytics.userLimitWarningAt': new Date() } }
              );
            }
          }
        }
      } catch (error) {
        console.error(`[User Limit Check] Error for ${company.name}:`, error.message);
        results.errors.push({ company: company.name, error: error.message });
      }
    }

    console.log(`[User Limit Check] Completed: ${results.at_limit} at limit, ${results.near_limit} near limit`);

    return NextResponse.json({
      success: true,
      message: 'User limit check completed',
      results,
    });
  } catch (error) {
    console.error('[User Limit Check] Error:', error);
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 }
    );
  }
}

export async function GET(request) {
  // Get current user counts for all companies
  try {
    const authError = getCronAuthErrorResponse(request);
    if (authError) return authError;

    await connectSuperadminDB();
    const TenantCompany = await getTenantCompanyModel();

    const companies = await TenantCompany.find({
      isActive: true,
      isSetupComplete: true,
    }).select('name subscription.maxUsers subscription.currentUserCount analytics.userLimitReachedAt').lean();

    const status = companies.map(c => ({
      name: c.name,
      currentUsers: c.subscription?.currentUserCount || 0,
      maxUsers: c.subscription?.maxUsers || 10,
      usagePercent: Math.round(((c.subscription?.currentUserCount || 0) / (c.subscription?.maxUsers || 10)) * 100),
      limitReachedAt: c.analytics?.userLimitReachedAt || null,
    }));

    return NextResponse.json({
      success: true,
      count: status.length,
      companies: status,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 }
    );
  }
}
