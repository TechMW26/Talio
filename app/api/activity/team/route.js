import { NextResponse } from 'next/server';
import { getAuthAndModels } from '@/lib/auth';
import mongoose from 'mongoose';

// Roles that can view all team members
const ADMIN_ROLES = ['admin', 'hr'];

/**
 * GET /api/activity/team
 * Get team members that current user can view captures for
 * 
 * - Admin/HR: All employees
 * - Department Head: Employees in their department(s)
 * - Regular Employee: Only themselves
 */
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['User', 'Employee', 'Department'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { User, Employee, Department } = models

    const currentUserId = user._id || user.userId;
    const currentUserRole = user.role;

    if (!currentUserId) {
      return NextResponse.json({ error: 'User ID not found' }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const departmentId = searchParams.get('departmentId');

    // Validate departmentId format if provided
    if (departmentId && !mongoose.Types.ObjectId.isValid(departmentId)) {
      return NextResponse.json({ error: 'Invalid department ID format' }, { status: 400 });
    }

    // Get current user with employee info
    const currentUser = await User.findById(currentUserId).populate('employeeId');
    
    const isAdmin = ADMIN_ROLES.includes(currentUserRole);
    
    // For admin/HR, return all employees (optionally filtered by department)
    if (isAdmin) {
      let query = {};
      if (departmentId) {
        query = {
          $or: [
            { department: departmentId },
            { departments: departmentId }
          ]
        };
      }
      
      const employees = await Employee.find(query)
        .populate('department', 'name code')
        .select('firstName lastName employeeCode department departments')
        .limit(100);
      
      // Get user IDs for these employees
      const userMap = await User.find({
        employeeId: { $in: employees.map(e => e._id) }
      }).select('_id employeeId role');
      
      const userIdMap = {};
      userMap.forEach(u => {
        if (u.employeeId) userIdMap[u.employeeId.toString()] = { 
          _id: u._id.toString(), 
          role: u.role 
        };
      });
      
      // Get all departments for filter
      const departments = await Department.find({ isActive: true })
        .select('_id name code')
        .sort({ name: 1 });
      
      return NextResponse.json({
        success: true,
        isAdmin: true,
        departments,
        team: employees.map(e => ({
          employeeId: e._id,
          userId: userIdMap[e._id.toString()]?._id,
          name: `${e.firstName} ${e.lastName}`,
          employeeCode: e.employeeCode,
          department: e.department,
          role: userIdMap[e._id.toString()]?.role,
          canCapture: !['admin'].includes(userIdMap[e._id.toString()]?.role)
        })).filter(e => e.userId) // Only include users with accounts
      });
    }
    
    // For regular users, check if they're a department head
    if (!currentUser?.employeeId) {
      // No employee record - can only see self
      return NextResponse.json({
        success: true,
        isAdmin: false,
        isDepartmentHead: false,
        departments: [],
        team: [{
          employeeId: null,
          userId: currentUserId,
          name: currentUser?.email || 'Current User',
          employeeCode: null,
          department: null,
          role: currentUserRole,
          canCapture: !['admin'].includes(currentUserRole)
        }]
      });
    }
    
    // Check if user is a department head
    const headOfDepartments = await Department.find({
      $or: [
        { head: currentUser.employeeId._id },
        { heads: currentUser.employeeId._id }
      ],
      isActive: true
    }).select('_id name code');
    
    if (headOfDepartments.length === 0) {
      // Not a department head - can only see self
      return NextResponse.json({
        success: true,
        isAdmin: false,
        isDepartmentHead: false,
        departments: [],
        team: [{
          employeeId: currentUser.employeeId._id,
          userId: currentUserId,
          name: `${currentUser.employeeId.firstName || ''} ${currentUser.employeeId.lastName || ''}`.trim() || currentUser.email,
          employeeCode: currentUser.employeeId.employeeCode,
          department: currentUser.employeeId.department,
          role: currentUserRole,
          canCapture: true
        }]
      });
    }
    
    // Department head - get team members
    const deptIds = headOfDepartments.map(d => d._id);
    
    // Also get sub-departments
    const subDepts = await Department.find({
      parentDepartment: { $in: deptIds },
      isActive: true
    }).select('_id name code');
    
    const allDeptIds = [...deptIds, ...subDepts.map(d => d._id)];
    const allDepartments = [...headOfDepartments, ...subDepts];
    
    // Filter by specific department if requested
    let employeeQuery = {
      $or: [
        { department: { $in: allDeptIds } },
        { departments: { $in: allDeptIds } }
      ]
    };
    
    if (departmentId) {
      const reqDeptId = departmentId;
      if (allDeptIds.some(id => id.toString() === reqDeptId)) {
        employeeQuery = {
          $or: [
            { department: reqDeptId },
            { departments: reqDeptId }
          ]
        };
      }
    }
    
    const employees = await Employee.find(employeeQuery)
      .populate('department', 'name code')
      .select('firstName lastName employeeCode department departments')
      .limit(100);
    
    // Get user IDs
    const userMap = await User.find({
      employeeId: { $in: employees.map(e => e._id) }
    }).select('_id employeeId role');
    
    const userIdMap = {};
    userMap.forEach(u => {
      if (u.employeeId) userIdMap[u.employeeId.toString()] = {
        _id: u._id.toString(),
        role: u.role
      };
    });
    
    return NextResponse.json({
      success: true,
      isAdmin: false,
      isDepartmentHead: true,
      departments: allDepartments.map(d => ({
        _id: d._id,
        name: d.name,
        code: d.code,
        isSubDepartment: subDepts.some(s => s._id.toString() === d._id.toString())
      })),
      team: employees.map(e => ({
        employeeId: e._id,
        userId: userIdMap[e._id.toString()]?._id,
        name: `${e.firstName} ${e.lastName}`,
        employeeCode: e.employeeCode,
        department: e.department,
        role: userIdMap[e._id.toString()]?.role,
        canCapture: !['admin'].includes(userIdMap[e._id.toString()]?.role)
      })).filter(e => e.userId)
    });

  } catch (error) {
    console.error('[Team] Error:', error);
    return NextResponse.json(
      { error: 'Failed to get team', details: error.message },
      { status: 500 }
    );
  }
}
