import { NextResponse } from 'next/server';
import { getAuthAndModels } from '@/lib/auth';
import mongoose from 'mongoose';

// Roles that can initiate manual captures (in addition to department heads)
const ALLOWED_INITIATOR_ROLES = ['admin', 'hr'];

// Roles that cannot be captured (even manually)
const PROTECTED_ROLES = ['admin'];

/**
 * Check if a user is a department head
 * @returns {Array} Array of department IDs they are head of
 */
async function getDepartmentsWhereUserIsHead(employeeId, Department) {
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
 * POST /api/activity/manual-capture
 * Request a manual capture of a target user's screen
 * Only Admin, HR, and Department Heads can initiate this
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

    // Get initiator's employee ID for department head check
    const initiatorUser = await User.findById(initiatorId).populate('employeeId');
    const initiatorEmployeeId = initiatorUser?.employeeId?._id || initiatorUser?.employeeId;
    
    // Check if initiator is a department head (regardless of role)
    let isDepartmentHead = false;
    let headOfDepartments = [];
    
    if (initiatorEmployeeId) {
      headOfDepartments = await getDepartmentsWhereUserIsHead(initiatorEmployeeId, Department);
      isDepartmentHead = headOfDepartments.length > 0;
    }

    // Check if initiator has permission to request manual captures
    const hasRolePermission = ALLOWED_INITIATOR_ROLES.includes(initiatorRole);
    
    if (!hasRolePermission && !isDepartmentHead) {
      console.log(`[ManualCapture] Permission denied - User ${initiatorId} (role: ${initiatorRole}) is not admin/hr and not a department head`);
      return NextResponse.json(
        { success: false, error: 'Permission denied - Only Admin, HR, or Department Heads can initiate manual captures' },
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

    // Validate targetUserId format
    if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid target user ID format' },
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

    // For Department Heads (not admin/hr), verify they can only capture users in their department
    if (isDepartmentHead && !ALLOWED_INITIATOR_ROLES.includes(initiatorRole)) {
      const targetEmployee = targetUser.employeeId;
      
      if (!targetEmployee) {
        return NextResponse.json(
          { success: false, error: 'Target employee profile not found' },
          { status: 400 }
        );
      }

      // Get target user's department(s)
      const targetDeptIds = [];
      if (targetEmployee.department) {
        targetDeptIds.push(targetEmployee.department.toString());
      }
      if (targetEmployee.departments?.length) {
        targetEmployee.departments.forEach(d => targetDeptIds.push(d.toString()));
      }
      
      // Check if any of target's departments are headed by initiator
      const headDeptIds = headOfDepartments.map(d => d._id.toString());
      const hasAccess = targetDeptIds.some(id => headDeptIds.includes(id));
      
      if (!hasAccess) {
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

    // Get current user's employee ID
    const currentUser = await User.findById(userId).populate('employeeId');
    const employeeId = currentUser?.employeeId?._id || currentUser?.employeeId;
    
    // Check if user is a department head (regardless of role)
    let isDepartmentHead = false;
    let headOfDepartments = [];
    
    if (employeeId) {
      headOfDepartments = await getDepartmentsWhereUserIsHead(employeeId, Department);
      isDepartmentHead = headOfDepartments.length > 0;
    }

    // Determine permissions based on role OR department head status
    const hasRolePermission = ALLOWED_INITIATOR_ROLES.includes(userRole);
    const canInitiateCapture = hasRolePermission || isDepartmentHead;
    const isProtectedFromCapture = PROTECTED_ROLES.includes(userRole);

    let captureScope = 'none';
    let targetableUsers = [];

    if (canInitiateCapture) {
      if (ALLOWED_INITIATOR_ROLES.includes(userRole)) {
        captureScope = 'all'; // Admin/HR can capture any non-admin user
        
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
        
      } else if (isDepartmentHead) {
        captureScope = 'department'; // Can only capture users in their department
        
        const deptIds = headOfDepartments.map(d => d._id);
        
        // Get employees in those departments (and sub-departments)
        const subDepts = await Department.find({
          parentDepartment: { $in: deptIds },
          isActive: true
        }).select('_id');
        
        const allDeptIds = [...deptIds, ...subDepts.map(d => d._id)];
        
        const employees = await Employee.find({
          $or: [
            { department: { $in: allDeptIds } },
            { departments: { $in: allDeptIds } }
          ],
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
        role: userRole,
        isDepartmentHead,
        departmentsHeaded: headOfDepartments.map(d => ({ _id: d._id, name: d.name }))
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
