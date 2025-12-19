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

    // Get current user
    const currentUser = await User.findById(decoded.userId);
    if (!currentUser || !currentUser.isActive) {
      return NextResponse.json(
        { success: false, message: 'User not found' },
        { status: 404 }
      );
    }

    // Get current employee
    const currentEmployee = await Employee.findById(currentUser.employeeId);
    
    // Check if department head
    let userDepartment = null;
    if (currentEmployee) {
      userDepartment = await Department.findOne({
        head: currentEmployee._id,
        isActive: true
      });
    }

    const isAdmin = ['admin', 'god_admin'].includes(currentUser.role);
    const isDepartmentHead = currentUser.role === 'department_head' || !!userDepartment;

    // Permission check
    if (!isAdmin && !isDepartmentHead) {
      return NextResponse.json(
        { success: false, message: 'You do not have permission to view recipients' },
        { status: 403 }
      );
    }

    // Build query based on permissions
    let employeeQuery = { isActive: { $ne: false } };

    if (!isAdmin && isDepartmentHead && userDepartment) {
      // Department head can only see their department employees
      employeeQuery.department = userDepartment._id;
    }

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

    // Get departments for filtering (admin only sees all departments)
    let departments = [];
    if (isAdmin) {
      departments = await Department.find({ isActive: true })
        .select('name')
        .sort({ name: 1 });
    } else if (userDepartment) {
      departments = [{ _id: userDepartment._id, name: userDepartment.name }];
    }

    return NextResponse.json({
      success: true,
      data: {
        recipients,
        departments,
        permissions: {
          isAdmin,
          isDepartmentHead,
          departmentId: userDepartment?._id
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
