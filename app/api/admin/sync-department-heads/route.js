import { NextResponse } from 'next/server';
import { getAuthAndModels } from '@/lib/auth';
import { syncDepartmentHeadStatus, getAllDepartmentHeads } from '@/lib/departmentHeadSync';

/**
 * GET /api/admin/sync-department-heads
 * Get all department heads
 * 
 * POST /api/admin/sync-department-heads
 * Manually trigger sync of department head status for all users
 * Only accessible by admin
 */

export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['User', 'Employee', 'Department'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { User, Employee, Department } = models

    // Only admin can access
    if (!['admin'].includes(user.role)) {
      return NextResponse.json(
        { success: false, message: 'Access denied' },
        { status: 403 }
      );
    }

    const result = await getAllDepartmentHeads({ User });
    return NextResponse.json(result);

  } catch (error) {
    console.error('[SyncDepartmentHeads] Error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to get department heads', error: error.message },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['User', 'Employee', 'Department'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { User, Employee, Department } = models

    // Only admin can trigger sync
    if (!['admin'].includes(user.role)) {
      return NextResponse.json(
        { success: false, message: 'Access denied' },
        { status: 403 }
      );
    }

    console.log(`[SyncDepartmentHeads] Manual sync triggered by ${user.email}`);

    const result = await syncDepartmentHeadStatus(null, { User, Employee, Department });
    
    return NextResponse.json({
      success: result.success,
      message: result.message,
      updated: result.updated
    });

  } catch (error) {
    console.error('[SyncDepartmentHeads] Error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to sync department heads', error: error.message },
      { status: 500 }
    );
  }
}
