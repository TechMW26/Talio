import { NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { readdir, stat } from 'fs/promises';
import path from 'path';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';
import Employee from '@/models/Employee';
import Department from '@/models/Department';
import ProductivitySession from '@/models/ProductivitySession';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET);

// Roles that can view all captures
const ADMIN_ROLES = ['admin', 'god_admin', 'hr'];

/**
 * GET /api/activity/captures
 * Get raw captures for a user, with role-based access control
 */
export async function GET(request) {
  try {
    // Verify JWT token
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7);
    
    let decoded;
    try {
      decoded = await jwtVerify(token, JWT_SECRET);
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid token' },
        { status: 401 }
      );
    }

    const currentUserId = decoded.payload.userId;
    const currentUserRole = decoded.payload.role;

    await connectDB();

    const { searchParams } = new URL(request.url);
    const targetUserId = searchParams.get('userId') || currentUserId;
    const dateParam = searchParams.get('date') || new Date().toISOString().split('T')[0];
    const captureType = searchParams.get('type'); // 'automatic', 'manual', or null for all
    
    // Permission check: Can only view others' captures if admin/hr or department head
    if (targetUserId !== currentUserId) {
      const isAdmin = ADMIN_ROLES.includes(currentUserRole);
      
      // Check if current user is department head of target user's department
      let isDeptHead = false;
      if (!isAdmin && currentUserRole === 'department_head') {
        const currentUser = await User.findById(currentUserId).populate('employeeId');
        const targetUser = await User.findById(targetUserId).populate('employeeId');
        
        if (targetUser?.employeeId?.department) {
          const dept = await Department.findById(targetUser.employeeId.department);
          if (dept) {
            const allHeads = dept.allHeads || [];
            isDeptHead = allHeads.some(
              headId => headId.toString() === currentUser?.employeeId?._id?.toString()
            );
          }
        }
      }
      
      if (!isAdmin && !isDeptHead) {
        return NextResponse.json(
          { success: false, error: 'Permission denied - You can only view your own captures' },
          { status: 403 }
        );
      }
    }

    // Check if target user is admin (their captures don't exist)
    const targetUser = await User.findById(targetUserId);
    if (['admin', 'god_admin'].includes(targetUser?.role)) {
      return NextResponse.json({
        success: true,
        message: 'Admin screens are not captured',
        captures: [],
        sessions: [],
        totalCaptures: 0
      });
    }

    // Build the directory path
    const activityDir = path.join(process.cwd(), 'public', 'activity', targetUserId);
    const datePath = path.join(activityDir, dateParam);
    
    let captures = [];
    
    try {
      const files = await readdir(datePath);
      const imageFiles = files.filter(f => /\.(webp|png|jpg|jpeg)$/i.test(f));
      
      for (const file of imageFiles) {
        const filePath = path.join(datePath, file);
        const fileStat = await stat(filePath);
        const timestamp = parseScreenshotTimestamp(file);
        
        captures.push({
          path: `/activity/${targetUserId}/${dateParam}/${file}`,
          filename: file,
          timestamp: timestamp.toISOString(),
          size: fileStat.size,
          date: dateParam
        });
      }
      
      // Sort by timestamp
      captures.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      
    } catch (error) {
      // Directory doesn't exist or is empty
      console.log(`[Captures] No captures found for user ${targetUserId} on ${dateParam}`);
    }

    // Get sessions from database
    const dateStart = new Date(dateParam);
    dateStart.setHours(0, 0, 0, 0);
    const dateEnd = new Date(dateParam);
    dateEnd.setHours(23, 59, 59, 999);
    
    const sessions = await ProductivitySession.find({
      user: targetUserId,
      date: { $gte: dateStart, $lte: dateEnd }
    }).sort({ sessionNumber: 1 });

    // Apply capture type filter if specified
    if (captureType) {
      captures = captures.filter(c => {
        // Check in sessions for capture type
        for (const session of sessions) {
          const sessionCapture = session.screenshots.find(s => s.path === c.path);
          if (sessionCapture) {
            return sessionCapture.captureType === captureType;
          }
        }
        // Default to automatic if not found in session
        return captureType === 'automatic';
      });
    }

    // Get user info
    const userInfo = await User.findById(targetUserId)
      .populate('employeeId', 'name employeeId department')
      .select('email role');

    return NextResponse.json({
      success: true,
      data: {
        captures,
        sessions: sessions.map(s => ({
          _id: s._id,
          sessionId: s._id,
          sessionNumber: s.sessionNumber,
          date: s.date,
          startTime: s.startTime,
          endTime: s.endTime,
          screenshotCount: s.screenshotCount,
          isComplete: s.isComplete,
          estimatedDuration: s.estimatedDuration,
          analysis: s.analysis
        })),
        user: userInfo ? {
          _id: userInfo._id,
          email: userInfo.email,
          name: userInfo.employeeId?.name,
          employeeCode: userInfo.employeeId?.employeeId,
          role: userInfo.role
        } : null
      },
      date: dateParam,
      userId: targetUserId,
      totalCaptures: captures.length,
      totalSessions: sessions.length
    });

  } catch (error) {
    console.error('[Captures] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to get captures', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * Parse screenshot filename to get timestamp
 * Format: 2024-12-13T10-30-45-123Z.webp
 */
function parseScreenshotTimestamp(filename) {
  try {
    // Remove extension and convert back to ISO format
    const nameWithoutExt = filename.replace(/\.(webp|png|jpg|jpeg)$/i, '');
    // Replace dashes back to colons/dots for ISO format
    const isoString = nameWithoutExt
      .replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/, 'T$1:$2:$3.$4Z');
    return new Date(isoString);
  } catch {
    return new Date();
  }
}
