import { projectDatabase, projectRows, projectRecords, projectFilter as f, projectId as id } from './projects.server'

/**
 * Calculate project-based performance metrics for an employee
 * This can be used to integrate with the Performance module
 */

export async function getEmployeeProjectPerformance(employeeId, startDate, endDate, database) {
  const db = await projectDatabase(database), start = new Date(startDate), end = new Date(endDate)
  if (!Number.isFinite(+start) || !Number.isFinite(+end) || start > end) throw new Error('Invalid performance review date range')
  const memberships = (await projectRows(db, 'projectmembers', [f('user', id(employeeId)), f('invitationStatus', 'accepted')])).filter(row => new Date(row.createdAt) <= end)
  const projectMap = new Map((await projectRecords(db, 'projects', memberships.map(row => row.project))).filter(row => !row.deletedAt && !row.isDeleted && new Date(row.startDate) <= end && new Date(row.endDate) >= start).map(row => [id(row), row]))
  const projects = memberships.filter(row => projectMap.has(id(row.project))).map(row => ({ project: projectMap.get(id(row.project)), role: row.role }))
  const assignments = (await projectRows(db, 'taskassignees', [f('user', id(employeeId)), f('assignmentStatus', ['accepted', 'pending'], 'in')])).filter(row => new Date(row.createdAt) >= start && new Date(row.createdAt) <= end)
  const rawTasks = (await projectRecords(db, 'tasks', assignments.map(row => row.task))).filter(row => !row.deletedAt && !row.isDeleted && row.project)
  const taskProjects = new Map((await projectRecords(db, 'projects', rawTasks.map(row => row.project))).filter(row => !row.deletedAt).map(row => [id(row), row]))
  const tasks = rawTasks.filter(row => taskProjects.has(id(row.project))).map(row => ({ ...row, project: taskProjects.get(id(row.project)) }))

  // Calculate metrics
  const metrics = {
    // Project involvement metrics
    totalProjects: projects.length,
    projectsAsHead: projects.filter(p => p.role === 'head').length,
    projectsAsMember: projects.filter(p => p.role === 'member').length,
    completedProjects: projects.filter(p => 
      ['completed', 'approved'].includes(p.project.status)
    ).length,
    
    // Task metrics
    totalTasksAssigned: tasks.length,
    tasksCompleted: tasks.filter(t => t.status === 'completed').length,
    tasksInProgress: tasks.filter(t => t.status === 'in-progress').length,
    tasksOverdue: tasks.filter(t => 
      t.dueDate && 
      new Date(t.dueDate) < new Date() && 
      t.status !== 'completed'
    ).length,

    // Calculate completion rates
    taskCompletionRate: tasks.length > 0 
      ? Math.round((tasks.filter(t => t.status === 'completed').length / tasks.length) * 100)
      : 0,
    projectSuccessRate: projects.length > 0
      ? Math.round((projects.filter(p => 
          ['completed', 'approved'].includes(p.project.status)
        ).length / projects.length) * 100)
      : 0,

    // On-time delivery
    tasksCompletedOnTime: tasks.filter(t => 
      t.status === 'completed' && 
      t.dueDate && 
      t.completedAt &&
      new Date(t.completedAt) <= new Date(t.dueDate)
    ).length,

    // Priority handling
    criticalTasksCompleted: tasks.filter(t => 
      t.priority === 'critical' && t.status === 'completed'
    ).length,
    highPriorityTasksCompleted: tasks.filter(t => 
      t.priority === 'high' && t.status === 'completed'
    ).length,

    // Detailed project list
    projectDetails: projects.map(p => ({
      projectId: p.project._id,
      projectName: p.project.name,
      role: p.role,
      status: p.project.status,
      completionPercentage: p.project.completionPercentage,
      startDate: p.project.startDate,
      endDate: p.project.endDate
    })),

    // Detailed task list
    taskDetails: tasks.map(t => ({
      taskId: t._id,
      title: t.title,
      projectName: t.project.name,
      status: t.status,
      priority: t.priority,
      dueDate: t.dueDate,
      completedAt: t.completedAt
    }))
  }

  // Calculate an overall project performance score (0-5)
  let score = 2.5 // Base score

  // Task completion rate contribution (up to +1.5)
  score += (metrics.taskCompletionRate / 100) * 1.5

  // On-time delivery contribution (up to +0.5)
  if (metrics.tasksCompleted > 0) {
    const onTimeRate = metrics.tasksCompletedOnTime / metrics.tasksCompleted
    score += onTimeRate * 0.5
  }

  // Penalty for overdue tasks (up to -0.5)
  if (metrics.totalTasksAssigned > 0) {
    const overdueRate = metrics.tasksOverdue / metrics.totalTasksAssigned
    score -= overdueRate * 0.5
  }

  // Leadership bonus for project head roles (+0.25 per project)
  score += Math.min(metrics.projectsAsHead * 0.25, 0.5)

  // Clamp to 1-5 range
  metrics.projectPerformanceScore = Math.max(1, Math.min(5, Math.round(score * 10) / 10))

  return metrics
}

/**
 * Get project KPIs for performance review
 */
export function getProjectKPIs(projectMetrics) {
  return [
    {
      title: 'Task Completion Rate',
      description: 'Percentage of assigned tasks completed',
      target: 90,
      achieved: projectMetrics.taskCompletionRate,
      unit: '%',
      rating: calculateKPIRating(projectMetrics.taskCompletionRate, 90),
      comments: projectMetrics.taskCompletionRate >= 90 
        ? 'Excellent task completion rate' 
        : projectMetrics.taskCompletionRate >= 70 
        ? 'Good completion rate, room for improvement'
        : 'Task completion needs attention'
    },
    {
      title: 'On-Time Delivery',
      description: 'Percentage of tasks completed before or on due date',
      target: 85,
      achieved: projectMetrics.tasksCompleted > 0 
        ? Math.round((projectMetrics.tasksCompletedOnTime / projectMetrics.tasksCompleted) * 100)
        : 0,
      unit: '%',
      rating: calculateKPIRating(
        projectMetrics.tasksCompleted > 0 
          ? (projectMetrics.tasksCompletedOnTime / projectMetrics.tasksCompleted) * 100
          : 0,
        85
      ),
      comments: ''
    },
    {
      title: 'Project Participation',
      description: 'Number of projects contributed to',
      target: 3,
      achieved: projectMetrics.totalProjects,
      unit: 'projects',
      rating: calculateKPIRating(projectMetrics.totalProjects, 3, true),
      comments: ''
    },
    {
      title: 'Leadership Roles',
      description: 'Number of projects led as project head',
      target: 1,
      achieved: projectMetrics.projectsAsHead,
      unit: 'projects',
      rating: calculateKPIRating(projectMetrics.projectsAsHead, 1, true),
      comments: projectMetrics.projectsAsHead > 0 
        ? 'Demonstrated leadership capability'
        : ''
    },
    {
      title: 'Critical Task Handling',
      description: 'Critical and high priority tasks completed',
      target: 5,
      achieved: projectMetrics.criticalTasksCompleted + projectMetrics.highPriorityTasksCompleted,
      unit: 'tasks',
      rating: calculateKPIRating(
        projectMetrics.criticalTasksCompleted + projectMetrics.highPriorityTasksCompleted,
        5,
        true
      ),
      comments: ''
    }
  ]
}

/**
 * Calculate KPI rating (1-5) based on achieved vs target
 */
function calculateKPIRating(achieved, target, isAbsolute = false) {
  let ratio = achieved / target
  
  if (isAbsolute) {
    // For absolute values, cap at 100% achievement
    ratio = Math.min(ratio, 1.5)
  }

  if (ratio >= 1.1) return 5 // Exceeded by 10%+
  if (ratio >= 1.0) return 4 // Met target
  if (ratio >= 0.8) return 3 // Within 80%
  if (ratio >= 0.6) return 2 // Within 60%
  return 1 // Below 60%
}

/**
 * Get employee's project summary for MIRA
 * @param {string} employeeId - Employee ID
 * @param {Object} models - Tenant-specific models { ProjectMember, TaskAssignee }
 */
export async function getEmployeeProjectSummaryForMira(employeeId, database) {
  const db = await projectDatabase(database)
  const memberships = await projectRows(db, 'projectmembers', [f('user', id(employeeId)), f('invitationStatus', 'accepted')])
  const projects = (await projectRecords(db, 'projects', memberships.map(row => row.project))).filter(row => !row.deletedAt && !row.isDeleted && ['planned', 'ongoing'].includes(row.status)).slice(0, 5)
  const assignments = await projectRows(db, 'taskassignees', [f('user', id(employeeId)), f('assignmentStatus', 'accepted')])
  const tasks = (await projectRecords(db, 'tasks', assignments.map(row => row.task))).filter(row => !row.deletedAt && !row.isDeleted && !['completed', 'archived'].includes(row.status))
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1)
  return {
    activeProjects: projects.map(row => ({ name: row.name, status: row.status, completion: row.completionPercentage, deadline: row.endDate })),
    todayTasks: tasks.filter(row => row.dueDate && new Date(row.dueDate) >= today && new Date(row.dueDate) < tomorrow).slice(0, 10).map(row => ({ title: row.title, priority: row.priority, status: row.status })),
    pendingInvitations: await db.count('taskassignees', [f('user', id(employeeId)), f('assignmentStatus', 'pending')]),
    overdueTasks: tasks.filter(row => row.dueDate && new Date(row.dueDate) < today).slice(0, 5).map(row => ({ title: row.title, priority: row.priority, dueDate: row.dueDate }))
  }
}
