import { NextResponse } from 'next/server';
import { getAuthAndModels } from '@/lib/auth'
import { jwtVerify } from 'jose';
;
;
;

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET);

/**
 * GET /api/activity/clock-status
 * Check if user is currently clocked in (has checkIn but no checkOut for today)
 * Used by desktop app to determine if screenshots should be taken
 */
export async function GET(request) {
  try {
    // Verify JWT token
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Unauthorized - No token provided' },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7);
    
    let decoded;
    try {
      decoded = await jwtVerify(token, JWT_SECRET);
    } catch {
      return NextResponse.json(
        { error: 'Unauthorized - Invalid token' },
        { status: 401 }
      );
    }
    
    const userId = decoded.payload.userId;

    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized - User not found' },
        { status: 401 }
      );
    }

    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Attendance', 'User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Attendance, User } = models

    ;

    // Get user with employee reference
    const user = await User.findById(userId).select('employeeId');
    
    if (!user || !user.employeeId) {
      return NextResponse.json({
        success: true,
        isClockedIn: false,
        reason: 'No employee profile linked'
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
      employee: user.employeeId,
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
      userId
    });

  } catch (error) {
    console.error('Clock status check error:', error);
    return NextResponse.json(
      { error: 'Failed to check clock status', details: error.message },
      { status: 500 }
    );
  }
}
