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
 * Check if a user is a department head
 * Returns the department IDs they are head of
 */
async function getDepartmentsWhereUserIsHead(employeeId) {
  if (!employeeId) return [];
  
  const departments = await Department.find({
    $or: [
      { head: employeeId },
      { heads: employeeId }
    ],
    isActive: true
  }).select('_id name');
  
  return departments;
}

/**
 * Get all employees in a department (including sub-departments)
 */
async function getEmployeesInDepartments(departmentIds) {
  if (!departmentIds || departmentIds.length === 0) return [];
  
  // Get sub-departments recursively
  const allDeptIds = [...departmentIds];
  const subDepts = await Department.find({
    parentDepartment: { $in: departmentIds },
    isActive: true
  }).select('_id');
  
  subDepts.forEach(d => {
    if (!allDeptIds.some(id => id.toString() === d._id.toString())) {
      allDeptIds.push(d._id);
    }
  });
  
  // Get employees in these departments
  const employees = await Employee.find({
    $or: [
      { department: { $in: allDeptIds } },
      { departments: { $in: allDeptIds } }
    ]
  }).select('_id');
  
  return employees.map(e => e._id);
}

/**
 * GET /api/activity/captures
 * Get captures with proper role-based access control
 * 
 * Department heads can view captures of their team members
 * (identified by being in Department.head or Department.heads array)
 */
export async function GET(request) {
  try {
    // Verify JWT
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.substring(7);
    let decoded;
    try {
      decoded = await jwtVerify(token, JWT_SECRET);
    } catch {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const currentUserId = decoded.payload.userId;
    const currentUserRole = decoded.payload.role;

    await connectDB();

    const { searchParams } = new URL(request.url);
    const targetUserId = searchParams.get('userId') || currentUserId;
    const dateParam = searchParams.get('date') || new Date().toISOString().split('T')[0];
    const captureType = searchParams.get('type'); // 'automatic', 'manual', or null
    const departmentId = searchParams.get('departmentId'); // Filter by department
    
    // Permission check
    if (targetUserId !== currentUserId) {
      const isAdmin = ADMIN_ROLES.includes(currentUserRole);
      
      if (!isAdmin) {
        // Check if current user is department head of target user's department
        const currentUser = await User.findById(currentUserId).populate('employeeId');
        const targetUser = await User.findById(targetUserId).populate('employeeId');
        
        if (!currentUser?.employeeId || !targetUser?.employeeId) {
          return NextResponse.json(
            { error: 'Permission denied - Employee records not found' },
            { status: 403 }
          );
        }
        
        // Get departments where current user is head
        const headOfDepartments = await getDepartmentsWhereUserIsHead(currentUser.employeeId._id);
        
        if (headOfDepartments.length === 0) {
          return NextResponse.json(
            { error: 'Permission denied - You can only view your own captures' },
            { status: 403 }
          );
        }
        
        // Get target user's departments
        const targetDeptIds = [];
        if (targetUser.employeeId.department) {
          targetDeptIds.push(targetUser.employeeId.department.toString());
        }
        if (targetUser.employeeId.departments) {
          targetUser.employeeId.departments.forEach(d => targetDeptIds.push(d.toString()));
        }
        
        // Check if any of target's departments are headed by current user
        const headDeptIds = headOfDepartments.map(d => d._id.toString());
        const hasAccess = targetDeptIds.some(id => headDeptIds.includes(id));
        
        // Also check sub-departments
        if (!hasAccess) {
          const subDepts = await Department.find({
            parentDepartment: { $in: headOfDepartments.map(d => d._id) }
          }).select('_id');
          const subDeptIds = subDepts.map(d => d._id.toString());
          const hasSubAccess = targetDeptIds.some(id => subDeptIds.includes(id));
          
          if (!hasSubAccess) {
            return NextResponse.json(
              { error: 'Permission denied - User is not in your department' },
              { status: 403 }
            );
          }
        }
      }
    }

    // Check if target user is admin (no captures)
    const targetUser = await User.findById(targetUserId);
    if (['admin', 'god_admin'].includes(targetUser?.role)) {
      return NextResponse.json({
        success: true,
        message: 'Admin screens are not captured',
        data: { captures: [], sessions: [] },
        totalCaptures: 0
      });
    }

    // Read captures from filesystem
    const activityDir = path.join(process.cwd(), 'public', 'activity', targetUserId, dateParam);
    let captures = [];
    
    try {
      const files = await readdir(activityDir);
      const imageFiles = files.filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f));
      
      for (const file of imageFiles) {
        const filePath = path.join(activityDir, file);
        const fileStat = await stat(filePath);
        const timestamp = parseTimestamp(file);
        
        captures.push({
          path: `/activity/${targetUserId}/${dateParam}/${file}`,
          filename: file,
          timestamp: timestamp.toISOString(),
          size: fileStat.size,
          date: dateParam
        });
      }
      
      captures.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    } catch {
      // Directory doesn't exist
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

    // Filter by capture type if specified
    if (captureType && sessions.length > 0) {
      captures = captures.filter(c => {
        for (const session of sessions) {
          const sc = session.screenshots.find(s => s.path === c.path);
          if (sc) return sc.captureType === captureType;
        }
        return captureType === 'automatic';
      });
    }

    // Get user info
    const userInfo = await User.findById(targetUserId)
      .populate('employeeId', 'firstName lastName employeeCode department')
      .select('email role');

    return NextResponse.json({
      success: true,
      data: {
        captures,
        sessions: sessions.map(s => ({
          _id: s._id,
          sessionNumber: s.sessionNumber,
          date: s.date,
          startTime: s.startTime,
          endTime: s.endTime,
          screenshotCount: s.screenshotCount,
          isComplete: s.isComplete
        })),
        user: userInfo ? {
          _id: userInfo._id,
          email: userInfo.email,
          name: userInfo.employeeId ? 
            `${userInfo.employeeId.firstName} ${userInfo.employeeId.lastName}` : 
            userInfo.email,
          employeeCode: userInfo.employeeId?.employeeCode,
          role: userInfo.role,
          departmentId: userInfo.employeeId?.department
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
      { error: 'Failed to get captures', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * Parse timestamp from filename
 * Format: 2024-12-13T10-30-45-123Z.jpg
 */
function parseTimestamp(filename) {
  try {
    const name = filename.replace(/\.(jpg|jpeg|png|webp)$/i, '');
    const isoString = name.replace(/-/g, (match, offset) => {
      // Convert back to ISO format: - to : for time parts
      if (offset === 4 || offset === 7) return '-'; // Date separators stay
      if (offset === 10) return 'T'; // T separator
      if (offset === 13 || offset === 16) return ':'; // Time separators
      if (offset === 19) return '.'; // Millisecond separator
      return match;
    });
    return new Date(isoString);
  } catch {
    return new Date();
  }
}
