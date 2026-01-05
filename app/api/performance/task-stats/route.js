import { NextResponse } from 'next/server';
import { getAuthAndModels } from '@/lib/auth';

/**
 * GET /api/performance/task-stats
 * Get comprehensive task statistics for performance reports
 * 
 * Returns:
 * - Task completion rate
 * - On-time delivery rate
 * - Overdue tasks count
 * - Tasks by status breakdown
 * - Tasks by priority breakdown
 * - Department and employee level stats
 */
export async function GET(request) {
  try {
    const auth = await getAuthAndModels(request, ['Task', 'Employee', 'User', 'Department', 'Project']);
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 });
    }

    const { user, models } = auth;
    const { Task, Employee, User, Department, Project } = models;
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
          message: 'No permission to view team task stats'
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

    // Get employees
    const employees = await Employee.find(employeeQuery)
      .select('_id firstName lastName department')
      .populate('department', 'name')
      .lean();

    const employeeIds = employees.map(e => e._id);
    const employeeMap = {};
    employees.forEach(emp => {
      employeeMap[emp._id.toString()] = {
        name: `${emp.firstName} ${emp.lastName}`,
        department: emp.department?.name || 'Unknown',
        departmentId: emp.department?._id?.toString() || 'unknown'
      };
    });

    // Get all tasks assigned to these employees in the date range
    // Tasks created OR due within the date range
    const tasks = await Task.find({
      assignee: { $in: employeeIds },
      $or: [
        { createdAt: { $gte: new Date(startDate), $lte: new Date(endDate) } },
        { dueDate: { $gte: new Date(startDate), $lte: new Date(endDate) } }
      ]
    }).lean();

    // Initialize counters
    let totalTasks = tasks.length;
    let completedTasks = 0;
    let onTimeTasks = 0;
    let overdueTasks = 0;
    let inProgressTasks = 0;
    let pendingTasks = 0;
    let todoTasks = 0;
    
    // Priority breakdown
    const priorityStats = {
      critical: { total: 0, completed: 0, overdue: 0 },
      high: { total: 0, completed: 0, overdue: 0 },
      medium: { total: 0, completed: 0, overdue: 0 },
      low: { total: 0, completed: 0, overdue: 0 }
    };

    // Status breakdown
    const statusStats = {
      todo: 0,
      'in-progress': 0,
      'in-review': 0,
      completed: 0,
      blocked: 0
    };

    // Department breakdown
    const departmentStats = {};
    
    // Employee breakdown
    const employeeStats = {};
    
    // Initialize employee stats
    employees.forEach(emp => {
      const empId = emp._id.toString();
      employeeStats[empId] = {
        name: employeeMap[empId]?.name || 'Unknown',
        department: employeeMap[empId]?.department || 'Unknown',
        totalTasks: 0,
        completedTasks: 0,
        onTimeTasks: 0,
        overdueTasks: 0,
        inProgressTasks: 0
      };
      
      const deptId = employeeMap[empId]?.departmentId || 'unknown';
      if (!departmentStats[deptId]) {
        departmentStats[deptId] = {
          name: employeeMap[empId]?.department || 'Unknown',
          totalTasks: 0,
          completedTasks: 0,
          onTimeTasks: 0,
          overdueTasks: 0,
          employeeCount: 0
        };
      }
      departmentStats[deptId].employeeCount++;
    });

    const now = new Date();

    // Process each task
    tasks.forEach(task => {
      const empId = task.assignee?.toString();
      const empStat = employeeStats[empId];
      const deptId = empStat ? employeeMap[empId]?.departmentId : 'unknown';
      const deptStat = departmentStats[deptId];
      
      // Count by status
      const status = task.status || 'todo';
      if (statusStats[status] !== undefined) {
        statusStats[status]++;
      }
      
      // Count by priority
      const priority = task.priority || 'medium';
      if (priorityStats[priority]) {
        priorityStats[priority].total++;
      }

      // Track totals
      if (empStat) empStat.totalTasks++;
      if (deptStat) deptStat.totalTasks++;

      // Check completion
      if (status === 'completed' || status === 'done') {
        completedTasks++;
        if (empStat) empStat.completedTasks++;
        if (deptStat) deptStat.completedTasks++;
        if (priorityStats[priority]) priorityStats[priority].completed++;
        
        // Check if completed on time
        if (task.dueDate && task.completedAt) {
          const dueDate = new Date(task.dueDate);
          const completedAt = new Date(task.completedAt);
          if (completedAt <= dueDate) {
            onTimeTasks++;
            if (empStat) empStat.onTimeTasks++;
            if (deptStat) deptStat.onTimeTasks++;
          }
        } else if (task.dueDate) {
          // If no completedAt, assume it was completed on time if status is completed
          onTimeTasks++;
          if (empStat) empStat.onTimeTasks++;
          if (deptStat) deptStat.onTimeTasks++;
        }
      } else if (status === 'in-progress' || status === 'in-review') {
        inProgressTasks++;
        if (empStat) empStat.inProgressTasks++;
        
        // Check if overdue
        if (task.dueDate && new Date(task.dueDate) < now) {
          overdueTasks++;
          if (empStat) empStat.overdueTasks++;
          if (deptStat) deptStat.overdueTasks++;
          if (priorityStats[priority]) priorityStats[priority].overdue++;
        }
      } else if (status === 'todo') {
        todoTasks++;
        
        // Check if overdue
        if (task.dueDate && new Date(task.dueDate) < now) {
          overdueTasks++;
          if (empStat) empStat.overdueTasks++;
          if (deptStat) deptStat.overdueTasks++;
          if (priorityStats[priority]) priorityStats[priority].overdue++;
        }
      } else if (status === 'blocked') {
        // Check if overdue
        if (task.dueDate && new Date(task.dueDate) < now) {
          overdueTasks++;
          if (empStat) empStat.overdueTasks++;
          if (deptStat) deptStat.overdueTasks++;
          if (priorityStats[priority]) priorityStats[priority].overdue++;
        }
      }
    });

    // Calculate rates
    const taskCompletionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
    const onTimeDeliveryRate = completedTasks > 0 ? Math.round((onTimeTasks / completedTasks) * 100) : 0;
    const overdueRate = totalTasks > 0 ? Math.round((overdueTasks / totalTasks) * 100) : 0;

    // Process department breakdown
    const departmentBreakdown = Object.entries(departmentStats).map(([deptId, stats]) => ({
      departmentId: deptId,
      name: stats.name,
      employeeCount: stats.employeeCount,
      totalTasks: stats.totalTasks,
      completedTasks: stats.completedTasks,
      taskCompletionRate: stats.totalTasks > 0 ? Math.round((stats.completedTasks / stats.totalTasks) * 100) : 0,
      onTimeDeliveryRate: stats.completedTasks > 0 ? Math.round((stats.onTimeTasks / stats.completedTasks) * 100) : 0,
      overdueTasks: stats.overdueTasks
    }));

    // Process employee breakdown (sorted by completion rate)
    const employeeBreakdown = Object.entries(employeeStats)
      .map(([empId, stats]) => ({
        employeeId: empId,
        name: stats.name,
        department: stats.department,
        totalTasks: stats.totalTasks,
        completedTasks: stats.completedTasks,
        taskCompletionRate: stats.totalTasks > 0 ? Math.round((stats.completedTasks / stats.totalTasks) * 100) : 0,
        onTimeDeliveryRate: stats.completedTasks > 0 ? Math.round((stats.onTimeTasks / stats.completedTasks) * 100) : 0,
        overdueTasks: stats.overdueTasks,
        inProgressTasks: stats.inProgressTasks
      }))
      .sort((a, b) => b.taskCompletionRate - a.taskCompletionRate);

    // Status breakdown for pie chart
    const statusBreakdown = [
      { status: 'Completed', count: completedTasks, color: '#10B981' },
      { status: 'In Progress', count: statusStats['in-progress'], color: '#3B82F6' },
      { status: 'In Review', count: statusStats['in-review'], color: '#8B5CF6' },
      { status: 'To Do', count: statusStats['todo'], color: '#F59E0B' },
      { status: 'Blocked', count: statusStats['blocked'], color: '#EF4444' }
    ].filter(s => s.count > 0);

    // Priority breakdown for chart
    const priorityBreakdown = [
      { priority: 'Critical', ...priorityStats.critical, color: '#DC2626' },
      { priority: 'High', ...priorityStats.high, color: '#F97316' },
      { priority: 'Medium', ...priorityStats.medium, color: '#EAB308' },
      { priority: 'Low', ...priorityStats.low, color: '#22C55E' }
    ];

    return NextResponse.json({
      success: true,
      data: {
        summary: {
          totalTasks,
          completedTasks,
          inProgressTasks,
          todoTasks,
          overdueTasks,
          onTimeTasks,
          taskCompletionRate,
          onTimeDeliveryRate,
          overdueRate,
          blockedTasks: statusStats['blocked']
        },
        statusBreakdown,
        priorityBreakdown,
        departmentBreakdown,
        employeeBreakdown,
        dateRange: { startDate, endDate }
      }
    });

  } catch (error) {
    console.error('Task stats error:', error);
    return NextResponse.json({
      success: false,
      message: 'Failed to fetch task stats',
      error: error.message
    }, { status: 500 });
  }
}
