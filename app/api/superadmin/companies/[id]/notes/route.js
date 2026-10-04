/**
 * Company Notes API
 * GET/POST /api/superadmin/companies/[id]/notes
 * 
 * Manage notes for a company
 */

import { NextResponse } from 'next/server';
import { verifySuperAdmin } from '@/lib/superadminAuth';
import { getSuperadminStore, newRecordId, mutateCompany } from '@/lib/platform/firestoreSuperadmin.server';

/**
 * GET - Get all notes for a company
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
      notes: company.notes || [],
      companyName: company.name,
    });

  } catch (error) {
    console.error('[SuperAdmin Notes GET] Error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to fetch notes', error: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST - Add a new note
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
    const { content, category } = await request.json();

    if (!content) {
      return NextResponse.json(
        { success: false, message: 'Note content is required' },
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

    const note = {
      _id: newRecordId(),
      content,
      category: category || 'general',
      createdAt: new Date(),
      createdBy: auth.superadmin._id,
    };

    await mutateCompany(database, id, current => ({ ...current, notes: [...(current.notes || []), note] }));

    return NextResponse.json({
      success: true,
      message: 'Note added successfully',
      note,
    });

  } catch (error) {
    console.error('[SuperAdmin Notes POST] Error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to add note', error: error.message },
      { status: 500 }
    );
  }
}

/**
 * DELETE - Delete a note (via body with noteId)
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
    const { noteId } = await request.json();

    if (!noteId) {
      return NextResponse.json(
        { success: false, message: 'Note ID is required' },
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

    await mutateCompany(database, id, current => ({ ...current, notes: (current.notes || []).filter(note => String(note._id) !== String(noteId)) }));

    return NextResponse.json({
      success: true,
      message: 'Note deleted successfully',
    });

  } catch (error) {
    console.error('[SuperAdmin Notes DELETE] Error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to delete note', error: error.message },
      { status: 500 }
    );
  }
}
