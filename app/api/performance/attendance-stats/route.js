import { NextResponse } from 'next/server';
import { getAuthAndModels } from '@/lib/auth';

/**
 * GET /api/performance/attendance-stats
 * Get comprehensive attendance statistics for performance reports
 * 
 * Returns:
 * - Attendance rate (present days / working days)
 * - Punctuality rate (on-time arrivals / total arrivals)
 * - Average working hours
 * - Late arrivals count
 * - Early departures count
 * - Attendance by day of week (for heat maps)
 */
export async function GET(request) {
  try {
    const auth = await getAuthAndModels(request, ['Attendance', 'Employee', 'Company', 'Holiday', 'User', 'Department']);
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 });
    }

    const { user, models } = auth;
    const { Attendance, Employee, Company, Holiday, User, Department } = models;
    const { searchParams } = new URL(request.url);

    // Parse date range
    const startDate = searchParams.get('startDate') || new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0];
    const endDate = searchParams.get('endDate') || new Date().toISOString().split('T')[0];
    const departmentFilter = searchParams.get('department');

    // Permission check
    const isAdminOrHR = ['admin', 'hr'].includes(user.role);
    const currentUser = await User.findById(user._id).populate('employeeId');

    // Check if user is department head
    let isDeptHead = false;
    let userDepartmentIds = [];

    if (!isAdminOrHR) {
      if (currentUser?.isDepartmentHead && currentUser?.headOfDepartments?.length > 0) {
        isDeptHead = true;
        userDepartmentIds = currentUser.headOfDepartments.map(d => d.toString());
      } else if (currentUser?.employeeId?.department) {
        const userDept = await Department.findById(currentUser.employeeId.department);
        const currentEmployeeId = currentUser?.employeeId?._id?.toString();
        if (userDept) {
          const isLegacyHead = userDept.head?.toString() === currentEmployeeId;
          const isInHeadsArray = userDept.heads?.some(h => h?.toString() === currentEmployeeId);
          if (isLegacyHead || isInHeadsArray) {
            isDeptHead = true;
            userDepartmentIds = [userDept._id.toString()];
          }
        }
      }

      if (!isDeptHead) {
        return NextResponse.json({
          success: true,
          data: null,
          message: 'No permission to view team attendance stats'
        });
      }
    }

    // Build employee filter
    let employeeQuery = { status: 'active' };
    
    if (departmentFilter && departmentFilter !== 'all') {
      if (!isAdminOrHR && isDeptHead && !userDepartmentIds.includes(departmentFilter)) {
        return NextResponse.json({
          success: false,
          message: 'Not authorized to view this department'
        }, { status: 403 });
      }
      employeeQuery.department = departmentFilter;
    } else if (isDeptHead && !isAdminOrHR) {
      employeeQuery.department = { $in: userDepartmentIds };
    }

    // Get employees and company settings
    const [employees, company, holidays] = await Promise.all([
      Employee.find(employeeQuery).select('_id firstName lastName department dateOfJoining').lean(),
      Company.findOne().lean(),
      Holiday.find({
        date: { $gte: new Date(startDate), $lte: new Date(endDate) }
      }).lean()
    ]);

    const employeeIds = employees.map(e => e._id);
    const holidayDates = new Set(holidays.map(h => new Date(h.date).toISOString().split('T')[0]));
    
    // Company working hours settings
    const workingDays = company?.workingHours?.workingDays || ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
    const shiftStart = company?.workingHours?.shiftStart || '09:00';
    const shiftEnd = company?.workingHours?.shiftEnd || '18:00';
    const expectedHoursPerDay = 8;
    const gracePeriodMinutes = company?.attendanceSettings?.gracePeriod || 15;
    
    // Parse shift times
    const [shiftStartHour, shiftStartMin] = shiftStart.split(':').map(Number);
    const shiftStartMinutes = shiftStartHour * 60 + shiftStartMin + gracePeriodMinutes;

    // Get all attendance records in date range
    const attendanceRecords = await Attendance.find({
      employee: { $in: employeeIds },
      date: { $gte: new Date(startDate), $lte: new Date(endDate) }
    }).lean();

    // Calculate working days for each employee (respecting joining date)
    const dayNameMap = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    
    const calculateWorkingDays = (empJoiningDate) => {
      const effectiveStart = empJoiningDate && new Date(empJoiningDate) > new Date(startDate) 
        ? new Date(empJoiningDate) 
        : new Date(startDate);
      const end = new Date(endDate);
      
      let count = 0;
      const current = new Date(effectiveStart);
      
      while (current <= end) {
        const dayName = dayNameMap[current.getDay()];
        const dateStr = current.toISOString().split('T')[0];
        
        if (workingDays.includes(dayName) && !holidayDates.has(dateStr)) {
          count++;
        }
        current.setDate(current.getDate() + 1);
      }
      
      return count;
    };

    // Aggregate stats
    let totalWorkingDays = 0;
    let totalPresentDays = 0;
    let totalHalfDays = 0;
    let totalAbsentDays = 0;
    let totalLateArrivals = 0;
    let totalEarlyDepartures = 0;
    let totalWorkingHours = 0;
    let recordsWithHours = 0;
    
    // Day of week breakdown
    const dayOfWeekStats = {
      monday: { present: 0, absent: 0, late: 0, total: 0 },
      tuesday: { present: 0, absent: 0, late: 0, total: 0 },
      wednesday: { present: 0, absent: 0, late: 0, total: 0 },
      thursday: { present: 0, absent: 0, late: 0, total: 0 },
      friday: { present: 0, absent: 0, late: 0, total: 0 },
      saturday: { present: 0, absent: 0, late: 0, total: 0 },
      sunday: { present: 0, absent: 0, late: 0, total: 0 }
    };

    // Department breakdown
    const departmentStats = {};

    // Employee-level stats
    const employeeStats = {};

    employees.forEach(emp => {
      const empId = emp._id.toString();
      const workingDaysForEmp = calculateWorkingDays(emp.dateOfJoining);
      totalWorkingDays += workingDaysForEmp;
      
      const deptId = emp.department?.toString() || 'unknown';
      if (!departmentStats[deptId]) {
        departmentStats[deptId] = {
          workingDays: 0,
          presentDays: 0,
          halfDays: 0,
          absentDays: 0,
          lateArrivals: 0,
          totalHours: 0,
          hoursCount: 0,
          employeeCount: 0
        };
      }
      departmentStats[deptId].workingDays += workingDaysForEmp;
      departmentStats[deptId].employeeCount++;
      
      employeeStats[empId] = {
        name: `${emp.firstName} ${emp.lastName}`,
        department: deptId,
        workingDays: workingDaysForEmp,
        presentDays: 0,
        halfDays: 0,
        absentDays: 0,
        lateArrivals: 0,
        totalHours: 0,
        hoursCount: 0
      };
    });

    // Process attendance records
    attendanceRecords.forEach(record => {
      const empId = record.employee?.toString();
      const empStat = employeeStats[empId];
      if (!empStat) return;
      
      const deptStat = departmentStats[empStat.department];
      const recordDate = new Date(record.date);
      const dayName = dayNameMap[recordDate.getDay()];
      
      // Count by status
      if (record.status === 'present') {
        totalPresentDays++;
        empStat.presentDays++;
        if (deptStat) deptStat.presentDays++;
        dayOfWeekStats[dayName].present++;
      } else if (record.status === 'half-day') {
        totalHalfDays++;
        empStat.halfDays++;
        if (deptStat) deptStat.halfDays++;
        dayOfWeekStats[dayName].present += 0.5;
      } else if (record.status === 'absent') {
        totalAbsentDays++;
        empStat.absentDays++;
        if (deptStat) deptStat.absentDays++;
        dayOfWeekStats[dayName].absent++;
      }
      
      dayOfWeekStats[dayName].total++;
      
      // Check for late arrival
      if (record.checkIn) {
        const checkInDate = new Date(record.checkIn);
        const checkInMinutes = checkInDate.getHours() * 60 + checkInDate.getMinutes();
        
        if (checkInMinutes > shiftStartMinutes) {
          totalLateArrivals++;
          empStat.lateArrivals++;
          if (deptStat) deptStat.lateArrivals++;
          dayOfWeekStats[dayName].late++;
        }
      }
      
      // Track working hours
      if (record.workHours && record.workHours > 0) {
        totalWorkingHours += record.workHours;
        recordsWithHours++;
        empStat.totalHours += record.workHours;
        empStat.hoursCount++;
        if (deptStat) {
          deptStat.totalHours += record.workHours;
          deptStat.hoursCount++;
        }
      }
    });

    // Calculate final metrics
    const attendanceRate = totalWorkingDays > 0 
      ? Math.round(((totalPresentDays + (totalHalfDays * 0.5)) / totalWorkingDays) * 100) 
      : 0;
    
    const punctualityRate = (totalPresentDays + totalHalfDays) > 0
      ? Math.round(((totalPresentDays + totalHalfDays - totalLateArrivals) / (totalPresentDays + totalHalfDays)) * 100)
      : 0;
    
    const avgWorkingHours = recordsWithHours > 0
      ? (totalWorkingHours / recordsWithHours).toFixed(1)
      : '0.0';
    
    const utilizationRate = recordsWithHours > 0
      ? Math.round((totalWorkingHours / (recordsWithHours * expectedHoursPerDay)) * 100)
      : 0;

    // Process department stats
    const departmentBreakdown = Object.entries(departmentStats).map(([deptId, stats]) => ({
      departmentId: deptId,
      employeeCount: stats.employeeCount,
      attendanceRate: stats.workingDays > 0 
        ? Math.round(((stats.presentDays + (stats.halfDays * 0.5)) / stats.workingDays) * 100)
        : 0,
      punctualityRate: (stats.presentDays + stats.halfDays) > 0
        ? Math.round(((stats.presentDays + stats.halfDays - stats.lateArrivals) / (stats.presentDays + stats.halfDays)) * 100)
        : 0,
      avgWorkingHours: stats.hoursCount > 0 ? (stats.totalHours / stats.hoursCount).toFixed(1) : '0.0'
    }));

    // Process employee stats for top/bottom performers
    const employeeBreakdown = Object.entries(employeeStats).map(([empId, stats]) => ({
      employeeId: empId,
      name: stats.name,
      attendanceRate: stats.workingDays > 0
        ? Math.round(((stats.presentDays + (stats.halfDays * 0.5)) / stats.workingDays) * 100)
        : 0,
      punctualityRate: (stats.presentDays + stats.halfDays) > 0
        ? Math.round(((stats.presentDays + stats.halfDays - stats.lateArrivals) / (stats.presentDays + stats.halfDays)) * 100)
        : 100,
      avgWorkingHours: stats.hoursCount > 0 ? parseFloat((stats.totalHours / stats.hoursCount).toFixed(1)) : 0,
      lateArrivals: stats.lateArrivals,
      presentDays: stats.presentDays,
      absentDays: stats.absentDays
    })).sort((a, b) => b.attendanceRate - a.attendanceRate);

    // Day of week breakdown for heat map
    const dayOfWeekBreakdown = Object.entries(dayOfWeekStats)
      .filter(([day]) => workingDays.includes(day))
      .map(([day, stats]) => ({
        day: day.charAt(0).toUpperCase() + day.slice(1),
        attendanceRate: stats.total > 0 ? Math.round((stats.present / stats.total) * 100) : 0,
        lateRate: stats.total > 0 ? Math.round((stats.late / stats.total) * 100) : 0,
        present: Math.round(stats.present),
        absent: stats.absent,
        total: stats.total
      }));

    return NextResponse.json({
      success: true,
      data: {
        summary: {
          totalEmployees: employees.length,
          totalWorkingDays,
          presentDays: totalPresentDays,
          halfDays: totalHalfDays,
          absentDays: totalAbsentDays,
          lateArrivals: totalLateArrivals,
          attendanceRate,
          punctualityRate,
          avgWorkingHours: parseFloat(avgWorkingHours),
          utilizationRate,
          expectedHoursPerDay
        },
        departmentBreakdown,
        employeeBreakdown,
        dayOfWeekBreakdown,
        dateRange: { startDate, endDate }
      }
    });

  } catch (error) {
    console.error('Attendance stats error:', error);
    return NextResponse.json({
      success: false,
      message: 'Failed to fetch attendance stats',
      error: error.message
    }, { status: 500 });
  }
}
