import { NextResponse } from 'next/server';
import { getAuthAndModels } from '@/lib/auth';

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
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['User', 'Employee', 'Department']);
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 });
    }
    const { user, models } = auth;
    const { User, Employee, Department } = models;

    const initiatorId = user._id.toString();
    const initiatorRole = user.role;

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
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['User', 'Employee', 'Department']);
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 });
    }
    const { user, models } = auth;
    const { User, Employee, Department } = models;

    const userId = user._id.toString();
    const userRole = user.role;

    // Determine permissions based on role
    const canInitiateCapture = ALLOWED_INITIATOR_ROLES.includes(userRole);
    const isProtectedFromCapture = PROTECTED_ROLES.includes(userRole);

    let captureScope = 'none';
    let targetableUsers = [];

    if (canInitiateCapture) {
      if (['admin'].includes(userRole)) {
        captureScope = 'all'; // Can capture any non-admin user
        
        // Get all non-admin users
        const users = await User.find({
          role: { $nin: PROTECTED_ROLES },
          isActive: true,
          _id: { $ne: userId }
        }).populate('employeeId', 'firstName lastName employeeCode department').select('email role');
        
        targetableUsers = users.map(u => ({
          _id: u._id,
          email: u.email,
          name: u.employeeId ? `${u.employeeId.firstName || ''} ${u.employeeId.lastName || ''}`.trim() : u.email,
          employeeCode: u.employeeId?.employeeCode,
          role: u.role
        }));
        
      } else if (userRole === 'department_head') {
        captureScope = 'department'; // Can only capture users in their department
        
        // Get department head's departments
        const currentUser = await User.findById(userId).populate('employeeId');
        const employeeId = currentUser?.employeeId?._id || currentUser?.employeeId;
        
        if (!employeeId) {
          return NextResponse.json({
            success: true,
            permissions: {
              canInitiateCapture,
              isProtectedFromCapture,
              captureScope: 'none',
              role: userRole
            },
            targetableUsers: []
          });
        }
        
        // Find departments where user is head
        const depts = await Department.find({
          $or: [
            { head: employeeId },
            { heads: employeeId }
          ],
          isActive: true
        }).select('_id');
        
        const deptIds = depts.map(d => d._id);
        
        if (deptIds.length === 0) {
          return NextResponse.json({
            success: true,
            permissions: {
              canInitiateCapture,
              isProtectedFromCapture,
              captureScope: 'none',
              role: userRole
            },
            targetableUsers: []
          });
        }
        
        // Get employees in those departments
        const employees = await Employee.find({
          department: { $in: deptIds },
          status: 'active'
        }).select('firstName lastName employeeCode');
        
        // Get users for these employees
        const employeeIds = employees.map(e => e._id);
        const users = await User.find({
          employeeId: { $in: employeeIds },
          role: { $nin: PROTECTED_ROLES },
          isActive: true,
          _id: { $ne: userId }
        }).populate('employeeId', 'firstName lastName employeeCode');
        
        targetableUsers = users.map(u => ({
          _id: u._id,
          email: u.email,
          name: u.employeeId ? `${u.employeeId.firstName || ''} ${u.employeeId.lastName || ''}`.trim() : u.email,
          employeeCode: u.employeeId?.employeeCode,
          role: u.role
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
