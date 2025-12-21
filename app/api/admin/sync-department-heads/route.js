import { NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';
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
    await connectDB();

    // Verify authentication
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized' },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7);
    const secret = new TextEncoder().encode(process.env.JWT_SECRET);
    const { payload: decoded } = await jwtVerify(token, secret);

    // Get current user
    const currentUser = await User.findById(decoded.userId);
    if (!currentUser || !currentUser.isActive) {
      return NextResponse.json(
        { success: false, message: 'User not found' },
        { status: 404 }
      );
    }

    // Only admin can access
    if (!['admin'].includes(currentUser.role)) {
      return NextResponse.json(
        { success: false, message: 'Access denied' },
        { status: 403 }
      );
    }

    const result = await getAllDepartmentHeads();
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
    await connectDB();

    // Verify authentication
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized' },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7);
    const secret = new TextEncoder().encode(process.env.JWT_SECRET);
    const { payload: decoded } = await jwtVerify(token, secret);

    // Get current user
    const currentUser = await User.findById(decoded.userId);
    if (!currentUser || !currentUser.isActive) {
      return NextResponse.json(
        { success: false, message: 'User not found' },
        { status: 404 }
      );
    }

    // Only admin can trigger sync
    if (!['admin'].includes(currentUser.role)) {
      return NextResponse.json(
        { success: false, message: 'Access denied' },
        { status: 403 }
      );
    }

    console.log(`[SyncDepartmentHeads] Manual sync triggered by ${currentUser.email}`);

    const result = await syncDepartmentHeadStatus();
    
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
