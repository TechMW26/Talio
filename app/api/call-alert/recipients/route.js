import { NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';
import Employee from '@/models/Employee';
import Department from '@/models/Department';

/**
 * GET /api/call-alert/recipients
 * Get list of eligible recipients for call alerts
 * Based on role-based permissions
 * 
 * Access Control:
 * - Admin, God Admin, HR: Full access to all employees and departments
 * - Department Head (via user.isDepartmentHead or role='department_head'): Full access (same as admin)
 * - Manager: NO access unless they are a department head
 * - Employee: NO access unless they are a department head
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

    // Get current user with department head fields
    const currentUser = await User.findById(decoded.userId);
    if (!currentUser || !currentUser.isActive) {
      return NextResponse.json(
        { success: false, message: 'User not found' },
        { status: 404 }
      );
    }

    // Get current employee
    const currentEmployee = await Employee.findById(currentUser.employeeId);
    
    console.log('[CallAlert Recipients] User:', currentUser.email, 'Role:', currentUser.role);
    console.log('[CallAlert Recipients] isDepartmentHead from DB:', currentUser.isDepartmentHead);
    console.log('[CallAlert Recipients] headOfDepartments from DB:', currentUser.headOfDepartments);
    
    // Check if department head - PRIORITY ORDER:
    // 1. User meta isDepartmentHead flag (preferred - set during login or department update)
    // 2. User role === 'department_head'
    // 3. Fallback: Check Department model directly (for backward compatibility)
    
    let isDepartmentHead = currentUser.isDepartmentHead === true;
    let headOfDepartments = currentUser.headOfDepartments || [];
    
    // Fallback check if user meta not synced yet
    if (!isDepartmentHead && currentEmployee) {
      console.log('[CallAlert Recipients] Checking Department model for employee:', currentEmployee._id);
      const deptHeadCheck = await Department.find({
        isActive: true,
        $or: [
          { head: currentEmployee._id },
          { heads: currentEmployee._id }
        ]
      }).select('_id').lean();
      
      console.log('[CallAlert Recipients] Department head check result:', deptHeadCheck.length, 'departments');
      
      if (deptHeadCheck.length > 0) {
        isDepartmentHead = true;
        headOfDepartments = deptHeadCheck.map(d => d._id);
        
        // Sync to user meta (fire and forget)
        User.updateOne(
          { _id: currentUser._id },
          { $set: { isDepartmentHead: true, headOfDepartments } }
        ).catch(err => console.error('Failed to sync department head status:', err));
      }
    }
    
    // Also check role === 'department_head'
    if (!isDepartmentHead && currentUser.role === 'department_head') {
      isDepartmentHead = true;
    }

    console.log('[CallAlert Recipients] Final isDepartmentHead:', isDepartmentHead);

    // Admin, God Admin, and HR have full access
    const isAdmin = ['admin', 'hr'].includes(currentUser.role);
    
    // IMPORTANT: Department heads get FULL ACCESS (same as admin)
    // They can see ALL departments and ALL employees
    const hasFullAccess = isAdmin || isDepartmentHead;
    
    console.log('[CallAlert Recipients] isAdmin:', isAdmin, 'hasFullAccess:', hasFullAccess);

    // Permission check - Admin, God Admin, HR, and Department Head can send alerts
    // Manager role does NOT get access unless they are a department head
    if (!hasFullAccess) {
      console.log('[CallAlert Recipients] Access DENIED for user:', currentUser.email);
      return NextResponse.json(
        { success: false, message: 'You do not have permission to view recipients' },
        { status: 403 }
      );
    }

    // ALL users with permission get full access to all employees
    let employeeQuery = { isActive: { $ne: false } };

    // Get employees
    const employees = await Employee.find(employeeQuery)
      .populate('department', 'name')
      .populate('designation', 'title')
      .select('firstName lastName employeeCode department designation profilePicture')
      .sort({ firstName: 1 });

    // Get corresponding users
    const users = await User.find({
      employeeId: { $in: employees.map(e => e._id) },
      isActive: true
    }).select('_id email role employeeId');

    // Create user map for quick lookup
    const userMap = new Map();
    users.forEach(u => {
      if (u.employeeId) {
        userMap.set(u.employeeId.toString(), u);
      }
    });

    // Build recipients list
    const recipients = employees
      .map(emp => {
        const user = userMap.get(emp._id.toString());
        if (!user) return null;

        // Don't include self
        if (user._id.toString() === decoded.userId) return null;

        return {
          userId: user._id,
          employeeId: emp._id,
          name: `${emp.firstName} ${emp.lastName}`,
          email: user.email,
          employeeCode: emp.employeeCode,
          role: user.role,
          department: emp.department?.name || 'No Department',
          departmentId: emp.department?._id,
          designation: emp.designation?.title || 'No Designation',
          profilePicture: emp.profilePicture
        };
      })
      .filter(Boolean);

    // Get ALL departments for filtering dropdown
    // Both admin and department heads can see and select all departments
    const departments = await Department.find({ isActive: true })
      .select('name')
      .sort({ name: 1 });

    return NextResponse.json({
      success: true,
      data: {
        recipients,
        departments,
        permissions: {
          isAdmin,
          isDepartmentHead,
          hasFullAccess,
          headOfDepartments: headOfDepartments.map(d => d.toString())
        }
      }
    });

  } catch (error) {
    console.error('[CallAlert] Error fetching recipients:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to fetch recipients', error: error.message },
      { status: 500 }
    );
  }
}
