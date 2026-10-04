/**
 * Company Reminders API
 * GET/POST/PATCH /api/superadmin/companies/[id]/reminders
 * 
 * Manage reminders for subscription tracking and follow-ups
 */

import { NextResponse } from 'next/server';
import { verifySuperAdmin } from '@/lib/superadminAuth';
import { getSuperadminStore, newRecordId, mutateCompany } from '@/lib/platform/firestoreSuperadmin.server';

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
    const database = await getSuperadminStore();

    const company = await database.get('tenantcompanies', id);

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
      { status: error.status || 500 }
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

    if (typeof title !== 'string' || !title.trim() || !dueDate || !Number.isFinite(new Date(dueDate).getTime()) || (priority && !['low', 'medium', 'high', 'urgent'].includes(priority))) {
      return NextResponse.json(
        { success: false, message: 'Title and due date are required' },
        { status: 400 }
      );
    }

    const database = await getSuperadminStore();
    const company = await database.get('tenantcompanies', id);

    if (!company) {
      return NextResponse.json(
        { success: false, message: 'Company not found' },
        { status: 404 }
      );
    }

    const reminder = {
      _id: newRecordId(),
      title,
      description,
      dueDate: new Date(dueDate),
      priority: priority || 'medium',
      status: 'pending',
      createdAt: new Date(),
      createdBy: auth.superadmin._id,
    };

    await mutateCompany(database, id, current => ({ ...current, reminders: [...(current.reminders || []), reminder] }));

    return NextResponse.json({
      success: true,
      message: 'Reminder added successfully',
      reminder,
    });

  } catch (error) {
    console.error('[SuperAdmin Reminders POST] Error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to add reminder', error: error.message },
      { status: error.status || 500 }
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

    const database = await getSuperadminStore();
    const company = await database.get('tenantcompanies', id);

    if (!company) {
      return NextResponse.json(
        { success: false, message: 'Company not found' },
        { status: 404 }
      );
    }

    const reminder = (company.reminders || []).find(row => String(row._id) === String(reminderId));
    if (!reminder) {
      return NextResponse.json(
        { success: false, message: 'Reminder not found' },
        { status: 404 }
      );
    }

    if ((status && !['pending', 'completed', 'cancelled'].includes(status)) ||
      (priority && !['low', 'medium', 'high', 'urgent'].includes(priority)) ||
      (dueDate && !Number.isFinite(new Date(dueDate).getTime())) ||
      (title !== undefined && (typeof title !== 'string' || !title.trim()))) {
      return NextResponse.json({ success: false, message: 'Invalid reminder fields' }, { status: 400 });
    }
    const updated = await mutateCompany(database, id, current => {
      if (!(current.reminders || []).some(row => String(row._id) === String(reminderId))) throw Object.assign(new Error('Reminder not found'), { status: 404 });
      return { ...current, reminders: current.reminders.map(row => String(row._id) === String(reminderId) ? {
        ...row, ...(status ? { status, ...(status === 'completed' ? { completedAt: new Date() } : { completedAt: null }) } : {}),
        ...(title !== undefined ? { title } : {}), ...(description !== undefined ? { description } : {}),
        ...(dueDate ? { dueDate: new Date(dueDate) } : {}), ...(priority ? { priority } : {}),
      } : row) };
    });
    const savedReminder = updated.reminders.find(row => String(row._id) === String(reminderId));

    return NextResponse.json({
      success: true,
      message: 'Reminder updated successfully',
      reminder: savedReminder,
    });

  } catch (error) {
    console.error('[SuperAdmin Reminders PATCH] Error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to update reminder', error: error.message },
      { status: error.status || 500 }
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

    const database = await getSuperadminStore();
    const company = await database.get('tenantcompanies', id);

    if (!company) {
      return NextResponse.json(
        { success: false, message: 'Company not found' },
        { status: 404 }
      );
    }

    await mutateCompany(database, id, current => ({ ...current, reminders: (current.reminders || []).filter(row => String(row._id) !== String(reminderId)) }));

    return NextResponse.json({
      success: true,
      message: 'Reminder deleted successfully',
    });

  } catch (error) {
    console.error('[SuperAdmin Reminders DELETE] Error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to delete reminder', error: error.message },
      { status: error.status || 500 }
    );
  }
}
