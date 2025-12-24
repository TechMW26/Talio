/**
 * SuperAdmin Email API
 * POST /api/superadmin/email
 * 
 * Send emails to companies or compose custom emails
 */

import { NextResponse } from 'next/server';
import { verifySuperAdmin } from '@/lib/superadminAuth';
import getTenantCompanyModel from '@/models/TenantCompany';
import nodemailer from 'nodemailer';

// Create email transporter
const createTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.hostinger.com',
    port: parseInt(process.env.EMAIL_PORT || '465'),
    secure: true,
    auth: {
      user: process.env.EMAIL_USER || 'info@talio.in',
      pass: process.env.EMAIL_PASSWORD,
    },
  });
};

/**
 * POST - Send email to a company or custom recipient
 */
export async function POST(request) {
  try {
    const auth = await verifySuperAdmin(request);
    if (!auth.success) {
      return NextResponse.json(
        { success: false, message: auth.message },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { companyId, to, subject, body: emailBody, cc, bcc, isHtml } = body;

    // Validate required fields
    if (!to || !subject || !emailBody) {
      return NextResponse.json(
        { success: false, message: 'Recipient (to), subject, and body are required' },
        { status: 400 }
      );
    }

    // If companyId is provided, log the email activity
    let company = null;
    if (companyId) {
      const TenantCompany = await getTenantCompanyModel();
      company = await TenantCompany.findById(companyId);
      if (!company) {
        return NextResponse.json(
          { success: false, message: 'Company not found' },
          { status: 404 }
        );
      }
    }

    // Create transporter
    const transporter = createTransporter();

    // Build email options
    const mailOptions = {
      from: `"Talio" <${process.env.EMAIL_USER || 'info@talio.in'}>`,
      to,
      subject,
      ...(cc && { cc }),
      ...(bcc && { bcc }),
      ...(isHtml ? { html: emailBody } : { text: emailBody }),
    };

    // Send email
    await transporter.sendMail(mailOptions);

    // Log email activity to company if applicable
    if (company) {
      // Add to company communication history
      if (!company.communicationHistory) {
        company.communicationHistory = [];
      }
      company.communicationHistory.push({
        type: 'email',
        subject,
        sentAt: new Date(),
        sentBy: auth.superadmin._id,
        recipient: to,
      });
      await company.save();
    }

    console.log(`[SuperAdmin Email] Email sent to ${to} by ${auth.superadmin.email}`);

    return NextResponse.json({
      success: true,
      message: 'Email sent successfully',
    });

  } catch (error) {
    console.error('[SuperAdmin Email POST] Error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to send email', error: error.message },
      { status: 500 }
    );
  }
}

/**
 * GET - Get email templates or history
 */
export async function GET(request) {
  try {
    const auth = await verifySuperAdmin(request);
    if (!auth.success) {
      return NextResponse.json(
        { success: false, message: auth.message },
        { status: 401 }
      );
    }

    // Return email templates for quick compose
    const templates = [
      {
        id: 'subscription_reminder',
        name: 'Subscription Reminder',
        subject: 'Subscription Renewal Reminder - Talio HRMS',
        body: `Dear {companyName},

Your Talio HRMS subscription is approaching its renewal date. Please ensure timely payment to avoid any service interruption.

Subscription Details:
- Plan: {plan}
- Amount: ₹{amount}
- Expiry Date: {expiryDate}

To renew your subscription or discuss your requirements, please contact us at info@talio.in.

Thank you for choosing Talio HRMS.

Best Regards,
Talio Team`,
      },
      {
        id: 'payment_received',
        name: 'Payment Received',
        subject: 'Payment Confirmation - Talio HRMS',
        body: `Dear {companyName},

Thank you for your payment. We have successfully received your payment.

Payment Details:
- Amount: ₹{amount}
- Date: {date}
- Transaction ID: {transactionId}

Your subscription has been extended accordingly.

Thank you for choosing Talio HRMS.

Best Regards,
Talio Team`,
      },
      {
        id: 'user_limit_warning',
        name: 'User Limit Warning',
        subject: 'User Limit Reached - Talio HRMS',
        body: `Dear {companyName},

Your company has reached the maximum user limit allowed by your current subscription plan.

Current Limit: {maxUsers} users
Current Usage: {currentUsers} users

To add more users, please upgrade your plan or contact us to discuss your requirements.

Best Regards,
Talio Team`,
      },
      {
        id: 'welcome',
        name: 'Welcome Email',
        subject: 'Welcome to Talio HRMS!',
        body: `Dear {companyName},

Welcome to Talio HRMS! We're excited to have you on board.

Your account has been successfully created. You can access your dashboard using the setup link that was shared with you.

If you have any questions or need assistance, please don't hesitate to reach out to us at info@talio.in.

Best Regards,
Talio Team`,
      },
      {
        id: 'service_paused',
        name: 'Service Paused Notification',
        subject: 'Service Paused - Talio HRMS',
        body: `Dear {companyName},

Your Talio HRMS service has been paused. This could be due to:
- Pending payment
- Subscription expiry
- Administrative action

Please contact us at info@talio.in to resolve this and restore your service.

Best Regards,
Talio Team`,
      },
    ];

    return NextResponse.json({
      success: true,
      templates,
    });

  } catch (error) {
    console.error('[SuperAdmin Email GET] Error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to fetch email templates', error: error.message },
      { status: 500 }
    );
  }
}
