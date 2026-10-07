import { performanceDatabase, performanceEmployees, joinPerformanceEmployees, scopedPerformanceRecords, performanceDates, assertTeamStatisticsAccess, performanceLinkedRecords, filter } from '@/lib/performanceStore.server'
import { collectFirestorePages, readFirestoreReferences } from '@/lib/platform/firestoreQueries.server'
import { NextResponse } from 'next/server';
import { completedTaskTrend } from '@/lib/client/reportTrends';
import { getAuthAndDatabase } from '@/lib/auth';
import { getDateTimePartsInTimezone, getTodayDateString } from '@/lib/timezone';

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
    const auth = await getAuthAndDatabase(request);
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 });
    }

    const { user } = auth
    const database = await performanceDatabase(auth)
    const { searchParams } = new URL(request.url);

    // Parse date range
    const currentYear = getDateTimePartsInTimezone().year;
    const startDate = searchParams.get('startDate') || `${currentYear}-01-01`;
    const endDate = searchParams.get('endDate') || getTodayDateString();
    const departmentFilter = searchParams.get('department');
    const departmentsFilter = searchParams.get('departments'); // Comma-separated list of department IDs

    await assertTeamStatisticsAccess(database, user)
    const { start: rangeStart, end: rangeEnd } = performanceDates(searchParams, new Date(startDate), new Date(endDate))
    const employees = await joinPerformanceEmployees(database, await performanceEmployees(database, user, searchParams))

    const employeeIds = employees.map(e => e._id);
    const employeeMap = {};
    employees.forEach(emp => {
      employeeMap[emp._id.toString()] = {
        name: `${emp.firstName} ${emp.lastName}`,
        department: emp.department?.name || 'Unknown',
        departmentId: emp.department?._id?.toString() || 'unknown'
      };
    });

    // Get all task assignments for these employees
    const taskAssignments = await scopedPerformanceRecords(database, 'taskassignees', employees, [filter('assignmentStatus', ['pending', 'accepted'], 'in')], { employeeField: 'user' });
    
    const taskIds = [...new Set(taskAssignments.map(a => a.task.toString()))];
    
    // Build assignment map: taskId -> [employeeId, ...]
    const taskToEmployeesMap = {};
    taskAssignments.forEach(assignment => {
      const taskId = assignment.task.toString();
      const empId = assignment.user.toString();
      if (!taskToEmployeesMap[taskId]) {
        taskToEmployeesMap[taskId] = [];
      }
      taskToEmployeesMap[taskId].push(empId);
    });

    // Get all tasks that are assigned to these employees
    // Filter by date range (created OR due within the range)
    const tasks = [...(await readFirestoreReferences(database, 'tasks', taskIds)).values()].filter(task => task.status !== 'archived' && ['createdAt', 'dueDate', 'completedAt'].some(field => task[field] && new Date(task[field]) >= rangeStart && new Date(task[field]) <= rangeEnd));

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

    // Status breakdown - matches TaskSchema status enum
    const statusStats = {
      'todo': 0,
      'in-progress': 0,
      'review': 0,
      'completed': 0,
      'completed-pending-approval': 0,
      'rejected': 0,
      'blocked': 0
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
      const taskId = task._id.toString();
      const assignedEmployeeIds = taskToEmployeesMap[taskId] || [];
      
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

      // Track totals for each assigned employee
      assignedEmployeeIds.forEach(empId => {
        const empStat = employeeStats[empId];
        const deptId = employeeMap[empId]?.departmentId || 'unknown';
        const deptStat = departmentStats[deptId];
        
        if (empStat) empStat.totalTasks++;
        if (deptStat) deptStat.totalTasks++;
      });

      // Check completion
      if (status === 'completed' || status === 'done' || status === 'completed-pending-approval') {
        completedTasks++;
        if (priorityStats[priority]) priorityStats[priority].completed++;
        
        // Update employee/dept stats
        assignedEmployeeIds.forEach(empId => {
          const empStat = employeeStats[empId];
          const deptId = employeeMap[empId]?.departmentId || 'unknown';
          const deptStat = departmentStats[deptId];
          if (empStat) empStat.completedTasks++;
          if (deptStat) deptStat.completedTasks++;
        });
        
        // Check if completed on time
        if (task.dueDate && task.completedAt) {
          const dueDate = new Date(task.dueDate);
          const completedAt = new Date(task.completedAt);
          if (completedAt <= dueDate) {
            onTimeTasks++;
            assignedEmployeeIds.forEach(empId => {
              const empStat = employeeStats[empId];
              const deptId = employeeMap[empId]?.departmentId || 'unknown';
              const deptStat = departmentStats[deptId];
              if (empStat) empStat.onTimeTasks++;
              if (deptStat) deptStat.onTimeTasks++;
            });
          }
        } else if (task.dueDate) {
          // If no completedAt, assume it was completed on time if status is completed
          onTimeTasks++;
          assignedEmployeeIds.forEach(empId => {
            const empStat = employeeStats[empId];
            const deptId = employeeMap[empId]?.departmentId || 'unknown';
            const deptStat = departmentStats[deptId];
            if (empStat) empStat.onTimeTasks++;
            if (deptStat) deptStat.onTimeTasks++;
          });
        }
      } else if (status === 'in-progress' || status === 'in-review' || status === 'review') {
        inProgressTasks++;
        assignedEmployeeIds.forEach(empId => {
          const empStat = employeeStats[empId];
          if (empStat) empStat.inProgressTasks++;
        });
        
        // Check if overdue
        if (task.dueDate && new Date(task.dueDate) < now) {
          overdueTasks++;
          if (priorityStats[priority]) priorityStats[priority].overdue++;
          assignedEmployeeIds.forEach(empId => {
            const empStat = employeeStats[empId];
            const deptId = employeeMap[empId]?.departmentId || 'unknown';
            const deptStat = departmentStats[deptId];
            if (empStat) empStat.overdueTasks++;
            if (deptStat) deptStat.overdueTasks++;
          });
        }
      } else if (status === 'todo') {
        todoTasks++;
        
        // Check if overdue
        if (task.dueDate && new Date(task.dueDate) < now) {
          overdueTasks++;
          if (priorityStats[priority]) priorityStats[priority].overdue++;
          assignedEmployeeIds.forEach(empId => {
            const empStat = employeeStats[empId];
            const deptId = employeeMap[empId]?.departmentId || 'unknown';
            const deptStat = departmentStats[deptId];
            if (empStat) empStat.overdueTasks++;
            if (deptStat) deptStat.overdueTasks++;
          });
        }
      } else if (status === 'blocked') {
        // Check if overdue
        if (task.dueDate && new Date(task.dueDate) < now) {
          overdueTasks++;
          if (priorityStats[priority]) priorityStats[priority].overdue++;
          assignedEmployeeIds.forEach(empId => {
            const empStat = employeeStats[empId];
            const deptId = employeeMap[empId]?.departmentId || 'unknown';
            const deptStat = departmentStats[deptId];
            if (empStat) empStat.overdueTasks++;
            if (deptStat) deptStat.overdueTasks++;
          });
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

    // Status breakdown for pie chart (combining similar statuses)
    const statusBreakdown = [
      { status: 'Completed', count: statusStats['completed'] + statusStats['completed-pending-approval'], color: '#10B981' },
      { status: 'In Progress', count: statusStats['in-progress'], color: '#3B82F6' },
      { status: 'In Review', count: statusStats['review'], color: '#8B5CF6' },
      { status: 'To Do', count: statusStats['todo'], color: '#F59E0B' },
      { status: 'Blocked', count: statusStats['blocked'], color: '#EF4444' },
      { status: 'Rejected', count: statusStats['rejected'], color: '#DC2626' }
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
        dailyTrend: completedTaskTrend(tasks, startDate, endDate),
        dateRange: { startDate, endDate }
      }
    });

  } catch (error) {
    console.error('Task stats error:', error);
    return NextResponse.json({
      success: false,
      message: 'Failed to fetch task stats',
      error: error.message
    }, { status: error.status || 500 });
  }
}
