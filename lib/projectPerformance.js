import connectDB from '@/lib/mongodb'
import Project from '@/models/Project'
import ProjectMember from '@/models/ProjectMember'
import Task from '@/models/Task'
import TaskAssignee from '@/models/TaskAssignee'

/**
 * Calculate project-based performance metrics for an employee
 * This can be used to integrate with the Performance module
 */

export async function getEmployeeProjectPerformance(employeeId, startDate, endDate) {
  await connectDB()

  // Get all projects the employee is/was a member of in the review period
  const projectMemberships = await ProjectMember.find({
    user: employeeId,
    invitationStatus: 'accepted',
    createdAt: { $lte: endDate }
  }).populate({
    path: 'project',
    match: {
      $or: [
        { startDate: { $gte: startDate, $lte: endDate } },
        { endDate: { $gte: startDate, $lte: endDate } },
        { 
          startDate: { $lte: startDate },
          endDate: { $gte: endDate }
        }
      ],
      isDeleted: false
    }
  })

  const projects = projectMemberships
    .filter(m => m.project)
    .map(m => ({
      project: m.project,
      role: m.role
    }))

  // Get all task assignments for the employee in the period
  const taskAssignments = await TaskAssignee.find({
    user: employeeId,
    assignmentStatus: { $in: ['accepted', 'pending'] },
    createdAt: { $gte: startDate, $lte: endDate }
  }).populate({
    path: 'task',
    match: { isDeleted: false },
    populate: { path: 'project', select: 'name status' }
  })

  const tasks = taskAssignments
    .filter(ta => ta.task && ta.task.project)
    .map(ta => ta.task)

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
export async function getEmployeeProjectSummaryForMira(employeeId, models = null) {
  // Use provided models or fall back to static imports (for backward compatibility)
  const ProjectMemberModel = models?.ProjectMember || ProjectMember
  const TaskAssigneeModel = models?.TaskAssignee || TaskAssignee

  if (!models) {
    // Only connect to default DB if no models provided (backward compatibility)
    await connectDB()
  }

  // Get active projects
  const activeProjects = await ProjectMemberModel.find({
    user: employeeId,
    invitationStatus: 'accepted'
  }).populate({
    path: 'project',
    match: { 
      status: { $in: ['planned', 'ongoing'] },
      isDeleted: false
    },
    select: 'name status completionPercentage endDate'
  }).limit(5)

  // Get today's tasks
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  const todayTasks = await TaskAssigneeModel.find({
    user: employeeId,
    assignmentStatus: 'accepted'
  }).populate({
    path: 'task',
    match: {
      dueDate: { $gte: today, $lt: tomorrow },
      status: { $ne: 'completed' },
      isDeleted: false
    },
    select: 'title priority status dueDate'
  }).limit(10)

  // Get pending task invitations
  const pendingInvitations = await TaskAssigneeModel.countDocuments({
    user: employeeId,
    assignmentStatus: 'pending'
  })

  // Get overdue tasks
  const overdueTasks = await TaskAssigneeModel.find({
    user: employeeId,
    assignmentStatus: 'accepted'
  }).populate({
    path: 'task',
    match: {
      dueDate: { $lt: today },
      status: { $ne: 'completed' },
      isDeleted: false
    },
    select: 'title priority status dueDate'
  }).limit(5)

  return {
    activeProjects: activeProjects
      .filter(m => m.project)
      .map(m => ({
        name: m.project.name,
        status: m.project.status,
        completion: m.project.completionPercentage,
        deadline: m.project.endDate
      })),
    todayTasks: todayTasks
      .filter(ta => ta.task)
      .map(ta => ({
        title: ta.task.title,
        priority: ta.task.priority,
        status: ta.task.status
      })),
    pendingInvitations,
    overdueTasks: overdueTasks
      .filter(ta => ta.task)
      .map(ta => ({
        title: ta.task.title,
        priority: ta.task.priority,
        dueDate: ta.task.dueDate
      }))
  }
}
