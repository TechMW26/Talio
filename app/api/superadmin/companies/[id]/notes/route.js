/**
 * Company Notes API
 * GET/POST /api/superadmin/companies/[id]/notes
 * 
 * Manage notes for a company
 */

import { NextResponse } from 'next/server';
import { verifySuperAdmin } from '@/lib/superadminAuth';
import getTenantCompanyModel from '@/models/TenantCompany';

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
    const TenantCompany = await getTenantCompanyModel();

    const company = await TenantCompany.findById(id).select('notes name').lean();

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

    const TenantCompany = await getTenantCompanyModel();
    const company = await TenantCompany.findById(id);

    if (!company) {
      return NextResponse.json(
        { success: false, message: 'Company not found' },
        { status: 404 }
      );
    }

    const note = {
      content,
      category: category || 'general',
      createdAt: new Date(),
      createdBy: auth.superadmin._id,
    };

    company.notes.push(note);
    await company.save();

    return NextResponse.json({
      success: true,
      message: 'Note added successfully',
      note: company.notes[company.notes.length - 1],
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

    const TenantCompany = await getTenantCompanyModel();
    const company = await TenantCompany.findById(id);

    if (!company) {
      return NextResponse.json(
        { success: false, message: 'Company not found' },
        { status: 404 }
      );
    }

    company.notes = company.notes.filter(n => n._id.toString() !== noteId);
    await company.save();

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
