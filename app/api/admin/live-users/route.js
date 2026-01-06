import { NextResponse } from 'next/server';
import { getAuthAndModels } from '@/lib/auth';

/**
 * GET /api/admin/live-users
 * Get live user statistics: active on app, logged in today, checked in today
 * Admin: Full access to all users + refresh capability
 * HR: Full access to all users (view only, no refresh)
 * Department Head: Access to their department's users only (view only)
 */
export async function GET(request) {
  try {
    const auth = await getAuthAndModels(request, ['User', 'Employee', 'Attendance', 'Department']);
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 });
    }

    const { user, models } = auth;
    const { User, Employee, Attendance, Department } = models;

    const userRole = user.role;
    const isAdmin = userRole === 'admin';
    const isHR = userRole === 'hr';
    const isDepartmentHead = userRole === 'department_head';

    // Check access - admin, HR, or department_head only
    if (!isAdmin && !isHR && !isDepartmentHead) {
      return NextResponse.json({ message: 'Access denied.' }, { status: 403 });
    }

    // Get current user's employee info for department filtering
    const currentUser = await User.findById(user._id || user.userId)
      .populate('employeeId')
      .populate('headOfDepartments')
      .lean();

    // Determine which departments this user can see
    let allowedDepartmentIds = null; // null means all departments
    
    if (isDepartmentHead) {
      // Department heads can only see their department(s)
      if (currentUser?.headOfDepartments?.length > 0) {
        allowedDepartmentIds = currentUser.headOfDepartments.map(d => d._id?.toString() || d.toString());
      } else if (currentUser?.employeeId?.department) {
        allowedDepartmentIds = [currentUser.employeeId.department._id?.toString() || currentUser.employeeId.department.toString()];
      } else {
        return NextResponse.json({ message: 'No department assigned.' }, { status: 403 });
      }
    }

    // Get today's date range (IST)
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

    // Get departments (filtered for department heads)
    let departmentQuery = {};
    if (allowedDepartmentIds) {
      departmentQuery._id = { $in: allowedDepartmentIds };
    }
    const departments = await Department.find(departmentQuery).select('_id name').lean();
    const departmentMap = new Map(departments.map(d => [d._id.toString(), d.name]));

    // Get all active users with their employee info
    const users = await User.find({ isActive: true })
      .select('_id email role lastLogin employeeId isActive')
      .populate({
        path: 'employeeId',
        select: 'firstName lastName profilePicture department designation status',
        populate: [
          { path: 'department', select: 'name' },
          { path: 'designation', select: 'title' }
        ]
      })
      .lean();

    // Get today's attendance records
    // Note: Attendance model uses 'employee' field, not 'employeeId'
    const todayAttendance = await Attendance.find({
      date: { $gte: todayStart, $lt: todayEnd },
      checkIn: { $exists: true, $ne: null }
    }).select('employee checkIn checkOut status').lean();

    const checkedInEmployeeIds = new Set(
      todayAttendance.map(a => a.employee?.toString()).filter(Boolean)
    );

    // Calculate active threshold (5 minutes - for socket connection based activity)
    const activeThreshold = new Date(now.getTime() - 5 * 60 * 1000);

    // Categorize users
    const allUsers = [];
    const loggedInToday = [];
    const checkedInToday = [];
    const activeNow = []; // Users with recent lastLogin (within 5 mins) - approximation

    for (const u of users) {
      if (!u.employeeId) continue; // Skip users without employee profile

      const employee = u.employeeId;
      const employeeId = employee._id?.toString();
      const employeeDeptId = employee.department?._id?.toString() || null;
      
      // Filter by department for department heads
      if (allowedDepartmentIds && (!employeeDeptId || !allowedDepartmentIds.includes(employeeDeptId))) {
        continue; // Skip users not in allowed departments
      }
      
      const userData = {
        id: u._id.toString(),
        oderId: u._id,
        userId: u._id.toString(),
        email: u.email,
        role: u.role,
        lastLogin: u.lastLogin,
        employeeId: employeeId,
        firstName: employee.firstName || '',
        lastName: employee.lastName || '',
        fullName: `${employee.firstName || ''} ${employee.lastName || ''}`.trim(),
        profilePicture: employee.profilePicture,
        departmentId: employeeDeptId,
        departmentName: employee.department?.name || 'No Department',
        designation: employee.designation?.title || 'No Designation',
        status: employee.status || 'unknown',
        isCheckedIn: checkedInEmployeeIds.has(employeeId),
        checkInTime: null,
        checkOutTime: null,
        attendanceStatus: null,
      };

      // Add attendance info if checked in
      const attendance = todayAttendance.find(a => a.employee?.toString() === employeeId);
      if (attendance) {
        userData.checkInTime = attendance.checkIn;
        userData.checkOutTime = attendance.checkOut;
        userData.attendanceStatus = attendance.status;
      }

      allUsers.push(userData);

      // Logged in today
      if (u.lastLogin && new Date(u.lastLogin) >= todayStart) {
        loggedInToday.push(userData);
      }

      // Checked in today
      if (userData.isCheckedIn) {
        checkedInToday.push(userData);
      }

      // Active now (last login within 5 minutes - rough approximation)
      if (u.lastLogin && new Date(u.lastLogin) >= activeThreshold) {
        activeNow.push(userData);
      }
    }

    // Group by department
    const byDepartment = {};
    for (const dept of departments) {
      byDepartment[dept._id.toString()] = {
        id: dept._id.toString(),
        name: dept.name,
        users: allUsers.filter(u => u.departmentId === dept._id.toString()),
        loggedInCount: loggedInToday.filter(u => u.departmentId === dept._id.toString()).length,
        checkedInCount: checkedInToday.filter(u => u.departmentId === dept._id.toString()).length,
        activeCount: activeNow.filter(u => u.departmentId === dept._id.toString()).length,
      };
    }

    // Add "No Department" group (only for admin/HR who see all)
    if (!allowedDepartmentIds) {
      const noDeptUsers = allUsers.filter(u => !u.departmentId);
      if (noDeptUsers.length > 0) {
        byDepartment['none'] = {
          id: 'none',
          name: 'No Department',
          users: noDeptUsers,
          loggedInCount: loggedInToday.filter(u => !u.departmentId).length,
          checkedInCount: checkedInToday.filter(u => !u.departmentId).length,
          activeCount: activeNow.filter(u => !u.departmentId).length,
        };
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        summary: {
          totalUsers: allUsers.length,
          activeNow: activeNow.length,
          loggedInToday: loggedInToday.length,
          checkedInToday: checkedInToday.length,
        },
        users: {
          all: allUsers,
          activeNow,
          loggedInToday,
          checkedInToday,
        },
        byDepartment: Object.values(byDepartment),
        departments: departments.map(d => ({ id: d._id.toString(), name: d.name })),
        // Permission info for frontend
        permissions: {
          canRefresh: isAdmin, // Only admin can send refresh requests
          viewScope: isDepartmentHead ? 'department' : 'all',
          userRole: userRole,
        },
      },
      timestamp: now.toISOString(),
    });
  } catch (error) {
    console.error('[Live Users API] Error:', error);
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to fetch live users' },
      { status: 500 }
    );
  }
}
