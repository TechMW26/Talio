import { NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';
import Employee from '@/models/Employee';
import Department from '@/models/Department';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET);

// Roles that can initiate manual captures
const ALLOWED_INITIATOR_ROLES = ['admin', 'department_head'];

// Roles that cannot be captured (even manually)
const PROTECTED_ROLES = ['admin'];

/**
 * POST /api/activity/manual-capture
 * Request a manual capture of a target user's screen
 * Only Admin and Department Heads can initiate this
 */
export async function POST(request) {
  try {
    // Verify JWT token
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - No token provided' },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7);
    
    let decoded;
    try {
      decoded = await jwtVerify(token, JWT_SECRET);
    } catch {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - Invalid token' },
        { status: 401 }
      );
    }
    
    const initiatorId = decoded.payload.userId;
    const initiatorRole = decoded.payload.role;

    if (!initiatorId) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - User not found' },
        { status: 401 }
      );
    }

    // Check if initiator has permission to request manual captures
    if (!ALLOWED_INITIATOR_ROLES.includes(initiatorRole)) {
      console.log(`[ManualCapture] Permission denied - Role '${initiatorRole}' cannot initiate captures`);
      return NextResponse.json(
        { success: false, error: 'Permission denied - Only Admin or Department Head can initiate manual captures' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { targetUserId } = body;

    if (!targetUserId) {
      return NextResponse.json(
        { success: false, error: 'Target user ID is required' },
        { status: 400 }
      );
    }

    // CRITICAL: Admin cannot capture their own screen
    if (targetUserId === initiatorId && PROTECTED_ROLES.includes(initiatorRole)) {
      console.log(`[ManualCapture] BLOCKED - Admin cannot capture their own screen`);
      return NextResponse.json(
        { success: false, error: 'Admin cannot capture their own screen' },
        { status: 403 }
      );
    }

    await connectDB();

    // Get target user info
    const targetUser = await User.findById(targetUserId).populate('employeeId');
    
    if (!targetUser) {
      return NextResponse.json(
        { success: false, error: 'Target user not found' },
        { status: 404 }
      );
    }

    // Check if target user is an admin (protected from capture)
    if (PROTECTED_ROLES.includes(targetUser.role)) {
      console.log(`[ManualCapture] BLOCKED - Cannot capture admin user`);
      return NextResponse.json(
        { success: false, error: 'Admin screens cannot be captured' },
        { status: 403 }
      );
    }

    // For Department Head, verify they can only capture users in their department
    if (initiatorRole === 'department_head') {
      const initiatorUser = await User.findById(initiatorId).populate('employeeId');
      const initiatorEmployee = initiatorUser?.employeeId;
      
      if (!initiatorEmployee) {
        return NextResponse.json(
          { success: false, error: 'Initiator employee profile not found' },
          { status: 400 }
        );
      }

      const targetEmployee = targetUser.employeeId;
      
      if (!targetEmployee) {
        return NextResponse.json(
          { success: false, error: 'Target employee profile not found' },
          { status: 400 }
        );
      }

      // Check if initiator is head of target's department
      const targetDeptId = targetEmployee.department?.toString();
      
      if (targetDeptId) {
        const targetDept = await Department.findById(targetDeptId);
        
        if (targetDept) {
          const allHeads = targetDept.allHeads || [];
          const isHeadOfDept = allHeads.some(
            headId => headId.toString() === initiatorEmployee._id.toString()
          );
          
          if (!isHeadOfDept) {
            console.log(`[ManualCapture] BLOCKED - Department Head cannot capture users outside their department`);
            return NextResponse.json(
              { 
                success: false, 
                error: 'You can only capture screens of users in your department' 
              },
              { status: 403 }
            );
          }
        }
      }
    }

    // Log the manual capture request
    console.log(`[ManualCapture] Request approved - Initiator: ${initiatorId} (${initiatorRole}), Target: ${targetUserId}`);

    // Return success with capture authorization
    // The actual capture is triggered via Socket.IO to the target user's desktop app
    const captureRequest = {
      requestId: `mcr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      targetUserId,
      targetUserName: targetUser.employeeId?.name || targetUser.email,
      initiatorId,
      initiatorRole,
      requestedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString() // 5 minute expiry
    };

    // Emit Socket.IO event to target user's desktop app
    if (global.io) {
      global.io.to(`user:${targetUserId}`).emit('manual-capture-request', captureRequest);
      console.log(`[ManualCapture] Sent capture request to user ${targetUserId}`);
    }

    return NextResponse.json({
      success: true,
      message: 'Manual capture request sent',
      request: captureRequest
    });

  } catch (error) {
    console.error('[ManualCapture] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to process manual capture request', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * GET /api/activity/manual-capture
 * Get manual capture permissions for current user
 */
export async function GET(request) {
  try {
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

    const userId = decoded.payload.userId;
    const userRole = decoded.payload.role;

    // Determine permissions based on role
    const canInitiateCapture = ALLOWED_INITIATOR_ROLES.includes(userRole);
    const isProtectedFromCapture = PROTECTED_ROLES.includes(userRole);

    let captureScope = 'none';
    let targetableUsers = [];

    if (canInitiateCapture) {
      await connectDB();
      
      if (['admin'].includes(userRole)) {
        captureScope = 'all'; // Can capture any non-admin user
        
        // Get all non-admin users
        const users = await User.find({
          role: { $nin: PROTECTED_ROLES },
          isActive: true,
          _id: { $ne: userId }
        }).populate('employeeId', 'name employeeId department').select('email role');
        
        targetableUsers = users.map(u => ({
          _id: u._id,
          email: u.email,
          name: u.employeeId?.name || u.email,
          employeeCode: u.employeeId?.employeeId,
          role: u.role
        }));
        
      } else if (userRole === 'department_head') {
        captureScope = 'department'; // Can only capture users in their department
        
        // Get department head's departments
        const currentUser = await User.findById(userId).populate('employeeId');
        const deptIds = currentUser?.employeeId?.departments || [];
        
        if (currentUser?.employeeId?.department) {
          deptIds.push(currentUser.employeeId.department);
        }
        
        // Get users in those departments
        const employees = await Employee.find({
          $or: [
            { department: { $in: deptIds } },
            { departments: { $in: deptIds } }
          ],
          status: 'active'
        }).populate('userId', 'role email');
        
        targetableUsers = employees
          .filter(e => e.userId && !PROTECTED_ROLES.includes(e.userId.role) && e.userId._id.toString() !== userId)
          .map(e => ({
            _id: e.userId._id,
            email: e.userId.email,
            name: e.name,
            employeeCode: e.employeeId,
            role: e.userId.role
          }));
      }
    }

    return NextResponse.json({
      success: true,
      permissions: {
        canInitiateCapture,
        isProtectedFromCapture,
        captureScope,
        role: userRole
      },
      targetableUsers: canInitiateCapture ? targetableUsers : []
    });

  } catch (error) {
    console.error('[ManualCapture] Get permissions error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to get permissions', details: error.message },
      { status: 500 }
    );
  }
}
