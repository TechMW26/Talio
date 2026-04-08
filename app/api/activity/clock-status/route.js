import { NextResponse } from 'next/server';
import { getAuthAndModels } from '@/lib/auth';

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * GET /api/activity/clock-status
 * Check if user is currently clocked in (has checkIn but no checkOut for today)
 * Used by desktop app to determine if screenshots should be taken
 */
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models - include Employee for populate
    const auth = await getAuthAndModels(request, ['Attendance', 'User', 'Employee']);
    if (!auth.success) {
      return NextResponse.json({ error: auth.message }, { status: 401 });
    }
    const { user: authUser, models } = auth;
    const { Attendance, User } = models;

    const userId = authUser._id || authUser.userId;
    if (!userId) {
      return NextResponse.json({
        success: true,
        isClockedIn: false,
        reason: 'User ID not found'
      }, {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        },
      });
    }

    // Get user with employee reference
    const userWithEmployee = await User.findById(userId).select('employeeId');
    
    if (!userWithEmployee || !userWithEmployee.employeeId) {
      return NextResponse.json({
        success: true,
        isClockedIn: false,
        reason: 'No employee profile linked'
      }, {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        },
      });
    }

    // Get today's date range (IST)
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);

    // Check for today's attendance record
    const attendance = await Attendance.findOne({
      employee: userWithEmployee.employeeId,
      date: { $gte: todayStart, $lte: todayEnd }
    }).select('checkIn checkOut status');

    // User is clocked in if they have checkIn but no checkOut
    const isClockedIn = attendance && attendance.checkIn && !attendance.checkOut;

    return NextResponse.json({
      success: true,
      isClockedIn,
      status: attendance?.status || null,
      checkIn: attendance?.checkIn || null,
      checkOut: attendance?.checkOut || null,
      userId: authUser._id
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      },
    });

  } catch (error) {
    console.error('Clock status check error:', error);
    return NextResponse.json(
      { error: 'Failed to check clock status', details: error.message },
      { status: 500 }
    );
  }
}
