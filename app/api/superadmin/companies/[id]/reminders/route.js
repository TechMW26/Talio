/**
 * Company Reminders API
 * GET/POST/PATCH /api/superadmin/companies/[id]/reminders
 * 
 * Manage reminders for subscription tracking and follow-ups
 */

import { NextResponse } from 'next/server';
import { verifySuperAdmin } from '@/lib/superadminAuth';
import getTenantCompanyModel from '@/models/TenantCompany';

/**
 * GET - Get all reminders for a company
 */
export async function GET(request, { params }) {
  try {
    const auth = await verifySuperAdmin(request);
    if (!auth.success) {
      return NextResponse.json(
        { success: false, message: auth.message },
        { status: 401 }
      );
    }

    const { id } = await params;
    const TenantCompany = await getTenantCompanyModel();

    const company = await TenantCompany.findById(id).select('reminders name').lean();

    if (!company) {
      return NextResponse.json(
        { success: false, message: 'Company not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      reminders: company.reminders || [],
      companyName: company.name,
    });

  } catch (error) {
    console.error('[SuperAdmin Reminders GET] Error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to fetch reminders', error: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST - Add a new reminder
 */
export async function POST(request, { params }) {
  try {
    const auth = await verifySuperAdmin(request);
    if (!auth.success) {
      return NextResponse.json(
        { success: false, message: auth.message },
        { status: 401 }
      );
    }

    const { id } = await params;
    const { title, description, dueDate, priority } = await request.json();

    if (!title || !dueDate) {
      return NextResponse.json(
        { success: false, message: 'Title and due date are required' },
        { status: 400 }
      );
    }

    const TenantCompany = await getTenantCompanyModel();
    const company = await TenantCompany.findById(id);

    if (!company) {
      return NextResponse.json(
        { success: false, message: 'Company not found' },
        { status: 404 }
      );
    }

    const reminder = {
      title,
      description,
      dueDate: new Date(dueDate),
      priority: priority || 'medium',
      status: 'pending',
      createdAt: new Date(),
      createdBy: auth.superadmin._id,
    };

    company.reminders.push(reminder);
    await company.save();

    return NextResponse.json({
      success: true,
      message: 'Reminder added successfully',
      reminder: company.reminders[company.reminders.length - 1],
    });

  } catch (error) {
    console.error('[SuperAdmin Reminders POST] Error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to add reminder', error: error.message },
      { status: 500 }
    );
  }
}

/**
 * PATCH - Update a reminder (mark complete, etc.)
 */
export async function PATCH(request, { params }) {
  try {
    const auth = await verifySuperAdmin(request);
    if (!auth.success) {
      return NextResponse.json(
        { success: false, message: auth.message },
        { status: 401 }
      );
    }

    const { id } = await params;
    const { reminderId, status, title, description, dueDate, priority } = await request.json();

    if (!reminderId) {
      return NextResponse.json(
        { success: false, message: 'Reminder ID is required' },
        { status: 400 }
      );
    }

    const TenantCompany = await getTenantCompanyModel();
    const company = await TenantCompany.findById(id);

    if (!company) {
      return NextResponse.json(
        { success: false, message: 'Company not found' },
        { status: 404 }
      );
    }

    const reminder = company.reminders.id(reminderId);
    if (!reminder) {
      return NextResponse.json(
        { success: false, message: 'Reminder not found' },
        { status: 404 }
      );
    }

    // Update fields
    if (status) {
      reminder.status = status;
      if (status === 'completed') {
        reminder.completedAt = new Date();
      }
    }
    if (title) reminder.title = title;
    if (description !== undefined) reminder.description = description;
    if (dueDate) reminder.dueDate = new Date(dueDate);
    if (priority) reminder.priority = priority;

    await company.save();

    return NextResponse.json({
      success: true,
      message: 'Reminder updated successfully',
      reminder,
    });

  } catch (error) {
    console.error('[SuperAdmin Reminders PATCH] Error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to update reminder', error: error.message },
      { status: 500 }
    );
  }
}

/**
 * DELETE - Delete a reminder
 */
export async function DELETE(request, { params }) {
  try {
    const auth = await verifySuperAdmin(request);
    if (!auth.success) {
      return NextResponse.json(
        { success: false, message: auth.message },
        { status: 401 }
      );
    }

    const { id } = await params;
    const { reminderId } = await request.json();

    if (!reminderId) {
      return NextResponse.json(
        { success: false, message: 'Reminder ID is required' },
        { status: 400 }
      );
    }

    const TenantCompany = await getTenantCompanyModel();
    const company = await TenantCompany.findById(id);

    if (!company) {
      return NextResponse.json(
        { success: false, message: 'Company not found' },
        { status: 404 }
      );
    }

    company.reminders = company.reminders.filter(r => r._id.toString() !== reminderId);
    await company.save();

    return NextResponse.json({
      success: true,
      message: 'Reminder deleted successfully',
    });

  } catch (error) {
    console.error('[SuperAdmin Reminders DELETE] Error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to delete reminder', error: error.message },
      { status: 500 }
    );
  }
}
