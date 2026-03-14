import { NextResponse } from 'next/server';
import { getAuthAndModels } from '@/lib/auth';
import mongoose from 'mongoose';

/**
 * POST /api/admin/broadcast-refresh
 * Send a force-refresh event to users via Socket.IO (or DB fallback)
 * ADMIN ONLY - HR and Department Heads can view but not refresh
 * 
 * Body:
 * - target: 'all' | 'department' | 'user'
 * - departmentId?: string (required if target is 'department')
 * - userId?: string (required if target is 'user')
 * - userIds?: string[] (for multiple users)
 * - message?: string (optional message to show before refresh)
 */
export async function POST(request) {
  try {
    const auth = await getAuthAndModels(request, ['User', 'Employee', 'Department', 'ForceRefresh']);
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 });
    }

    const { user, models } = auth;
    const { User, Employee, Department, ForceRefresh } = models;

    // ONLY admin can broadcast refresh - HR and department heads can view but not refresh
    if (user.role !== 'admin') {
      return NextResponse.json({ message: 'Access denied. Admin only.' }, { status: 403 });
    }

    const body = await request.json();
    const { target, departmentId, userId, userIds, message } = body;

    if (!target || !['all', 'department', 'user'].includes(target)) {
      return NextResponse.json(
        { success: false, message: 'Invalid target. Must be "all", "department", or "user".' },
        { status: 400 }
      );
    }

    // Validate departmentId if target is department
    if (target === 'department' && departmentId && !mongoose.Types.ObjectId.isValid(departmentId)) {
      return NextResponse.json(
        { success: false, message: 'Invalid department ID format.' },
        { status: 400 }
      );
    }

    // Validate userId(s) if target is user
    if (target === 'user') {
      if (userIds && Array.isArray(userIds)) {
        for (const uid of userIds) {
          if (!mongoose.Types.ObjectId.isValid(uid)) {
            return NextResponse.json(
              { success: false, message: 'Invalid user ID format in userIds array.' },
              { status: 400 }
            );
          }
        }
      } else if (userId && !mongoose.Types.ObjectId.isValid(userId)) {
        return NextResponse.json(
          { success: false, message: 'Invalid user ID format.' },
          { status: 400 }
        );
      }
    }

    // Check if Socket.IO is available
    const hasSocketIO = !!global.io;

    let targetUserIds = [];
    let targetDescription = '';

    if (target === 'all') {
      // Get all active users
      const allUsers = await User.find({ isActive: true }).select('_id').lean();
      targetUserIds = allUsers.map(u => u._id.toString());
      targetDescription = 'all users';
    } else if (target === 'department') {
      if (!departmentId) {
        return NextResponse.json(
          { success: false, message: 'Department ID is required for department target.' },
          { status: 400 }
        );
      }

      // Get department name
      const department = await Department.findById(departmentId).select('name').lean();
      if (!department) {
        return NextResponse.json(
          { success: false, message: 'Department not found.' },
          { status: 404 }
        );
      }

      // Get all employees in the department
      const employees = await Employee.find({ 
        department: departmentId,
        status: 'active'
      }).select('userId').lean();

      targetUserIds = employees.map(e => e.userId?.toString()).filter(Boolean);
      targetDescription = `${department.name} department`;
    } else if (target === 'user') {
      if (userIds && Array.isArray(userIds) && userIds.length > 0) {
        targetUserIds = userIds;
        targetDescription = `${userIds.length} selected user(s)`;
      } else if (userId) {
        targetUserIds = [userId];
        targetDescription = '1 user';
      } else {
        return NextResponse.json(
          { success: false, message: 'User ID is required for user target.' },
          { status: 400 }
        );
      }
    }

    if (targetUserIds.length === 0) {
      return NextResponse.json(
        { success: false, message: 'No users found to send refresh to.' },
        { status: 404 }
      );
    }

    // Emit force-refresh event to each user's room
    const refreshPayload = {
      type: 'force-refresh',
      message: message || 'The administrator has requested a page refresh. Your page will reload shortly.',
      initiatedBy: {
        userId: user._id?.toString() || user.userId,
        email: user.email,
        role: user.role,
      },
      timestamp: new Date().toISOString(),
      hard: true, // Indicates a hard refresh (clear cache)
    };

    let sentCount = 0;

    if (hasSocketIO) {
      // Primary path: Send via Socket.IO (custom server / npm run dev)
      for (const uid of targetUserIds) {
        global.io.to(`user:${uid}`).emit('force-refresh', refreshPayload);
        sentCount++;
      }
      console.log(`[Broadcast Refresh] ${user.email} sent refresh via Socket.IO to ${sentCount} users (${targetDescription})`);
    } else {
      // Fallback path: Store in DB for polling clients
      const docs = targetUserIds.map(uid => ({
        userId: uid,
        message: refreshPayload.message,
        hard: refreshPayload.hard,
        initiatedBy: refreshPayload.initiatedBy,
        consumed: false,
      }));
      await ForceRefresh.insertMany(docs);
      sentCount = docs.length;
      console.log(`[Broadcast Refresh] ${user.email} stored refresh in DB for ${sentCount} users (${targetDescription}) — Socket.IO unavailable`);
    }

    return NextResponse.json({
      success: true,
      message: `Refresh request sent to ${sentCount} users (${targetDescription}).`,
      data: {
        targetCount: sentCount,
        targetDescription,
        timestamp: refreshPayload.timestamp,
      }
    });
  } catch (error) {
    console.error('[Broadcast Refresh API] Error:', error);
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to broadcast refresh' },
      { status: 500 }
    );
  }
}
