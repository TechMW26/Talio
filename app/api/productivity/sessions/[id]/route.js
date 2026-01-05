import { NextResponse } from 'next/server';
import { getAuthAndModels } from '@/lib/auth';

/**
 * GET /api/productivity/sessions/[id]
 * Get a single session by ID (with permission check)
 */
export async function GET(request, { params }) {
  try {
    const { id: sessionId } = await params;
    
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['ProductivitySession', 'User', 'Employee', 'Department']);
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 });
    }
    const { user, models } = auth;
    const { ProductivitySession, User, Employee, Department } = models;

    const currentUserId = (user._id || user.userId).toString();
    const currentUserRole = user.role;
    
    // Get session
    const session = await ProductivitySession.findById(sessionId).lean();
    
    if (!session) {
      return NextResponse.json(
        { success: false, error: 'Session not found' },
        { status: 404 }
      );
    }
    
    const sessionUserId = session.user?.toString();
    const sessionEmployeeId = session.employee?.toString();
    
    // Permission check - check ownership by user ID or employee ID
    let isOwner = sessionUserId === currentUserId;
    if (!isOwner && sessionEmployeeId && user.employeeId) {
      const currentEmployeeId = user.employeeId._id?.toString() || user.employeeId?.toString();
      isOwner = sessionEmployeeId === currentEmployeeId;
    }
    
    const isAdminOrHR = ['admin', 'hr', 'manager', 'department_head'].includes(currentUserRole);
    const isDeptHeadByRole = user.isDepartmentHead === true;
    
    // Check if current user is department head of the session owner
    let isDeptHead = isDeptHeadByRole;
    if (!isOwner && !isAdminOrHR && !isDeptHead) {
      const currentUser = await User.findById(currentUserId).populate('employeeId');
      
      // Get the session owner's department
      let targetDepartmentId = null;
      if (sessionUserId) {
        const sessionOwner = await User.findById(sessionUserId).populate('employeeId');
        targetDepartmentId = sessionOwner?.employeeId?.department;
      } else if (sessionEmployeeId) {
        const sessionEmployee = await Employee.findById(sessionEmployeeId);
        targetDepartmentId = sessionEmployee?.department;
      }
      
      if (currentUser?.employeeId && targetDepartmentId) {
        const dept = await Department.findById(targetDepartmentId);
        if (dept) {
          const currentEmployeeId = currentUser.employeeId._id?.toString();
          const headId = dept.head?.toString();
          const headsArray = (dept.heads || []).map(h => h.toString());
          isDeptHead = currentEmployeeId === headId || headsArray.includes(currentEmployeeId);
        }
      }
    }
    
    if (!isOwner && !isAdminOrHR && !isDeptHead) {
      return NextResponse.json(
        { success: false, error: 'Permission denied' },
        { status: 403 }
      );
    }
    
    // Get owner info for context
    let ownerName = 'Unknown';
    if (sessionUserId) {
      const sessionOwnerUser = await User.findById(sessionUserId)
        .select('email')
        .populate('employeeId', 'firstName lastName');
      ownerName = sessionOwnerUser?.employeeId 
        ? `${sessionOwnerUser.employeeId.firstName} ${sessionOwnerUser.employeeId.lastName}`
        : sessionOwnerUser?.email || 'Unknown';
    } else if (sessionEmployeeId) {
      const employee = await Employee.findById(sessionEmployeeId);
      if (employee) {
        ownerName = `${employee.firstName} ${employee.lastName}`;
      }
    }
    
    return NextResponse.json({
      success: true,
      data: {
        ...session,
        ownerName
      }
    });
    
  } catch (error) {
    console.error('Get session by ID error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to get session', details: error.message },
      { status: 500 }
    );
  }
}
