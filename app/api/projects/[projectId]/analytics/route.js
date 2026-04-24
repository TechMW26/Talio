import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { checkProjectAccess, getProjectTaskStats } from '@/lib/projectService'
import { generateSmartContent } from '@/lib/promptEngine'
import { parseAIJsonResponse } from '@/lib/aiJsonResponse'

export const dynamic = 'force-dynamic'
export const maxDuration = 60 // Allow up to 60 seconds for AI processing

// GET - Get comprehensive project analytics with AI insights
export async function GET(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Project', 'ProjectMember', 'Task', 'TaskAssignee', 'User', 'Employee'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Project, ProjectMember, Task, TaskAssignee, User, Employee } = models

    const { projectId } = await params

    const userDoc = await User.findById(user._id || user.userId).select('employeeId role')
    if (!userDoc || !userDoc.employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    // Get project with relationships
    const project = await Project.findById(projectId)
      .populate('projectHead', 'firstName lastName profilePicture email')
      .populate('createdBy', 'firstName lastName')
      .populate('department', 'name')

    if (!project) {
      return NextResponse.json({ success: false, message: 'Project not found' }, { status: 404 })
    }

    // Check access
    const isAdmin = ['admin', 'hr'].includes(userDoc.role)
    if (!isAdmin) {
      const { hasAccess } = await checkProjectAccess(projectId, userDoc.employeeId, 'view', models)
      if (!hasAccess) {
        return NextResponse.json({ success: false, message: 'Access denied' }, { status: 403 })
      }
    }

    // Get all members
    const members = await ProjectMember.find({
      project: projectId,
      invitationStatus: 'accepted'
    }).populate('user', 'firstName lastName profilePicture email department')

    // Get all tasks with subtasks and assignees
    const tasks = await Task.find({ project: projectId })
      .populate('createdBy', 'firstName lastName')
      .sort({ createdAt: -1 })

    // Get task assignees
    const taskIds = tasks.map(t => t._id)
    const assignees = await TaskAssignee.find({ task: { $in: taskIds } })
      .populate('user', 'firstName lastName profilePicture email')

    // Build task-to-assignee mapping
    const taskAssigneeMap = {}
    assignees.forEach(a => {
      if (!taskAssigneeMap[a.task.toString()]) {
        taskAssigneeMap[a.task.toString()] = []
      }
      taskAssigneeMap[a.task.toString()].push(a)
    })

    // Calculate member analytics
    const memberAnalytics = calculateMemberAnalytics(members, tasks, taskAssigneeMap)

    // Calculate task analytics
    const taskAnalytics = calculateTaskAnalytics(tasks)

    // Calculate timeline analytics
    const timelineAnalytics = calculateTimelineAnalytics(project, tasks)

    // Calculate completion prediction
    const completionPrediction = calculateCompletionPrediction(project, tasks, taskAnalytics)

    // Return basic analytics immediately, AI insights will be fetched separately
    return NextResponse.json({
      success: true,
      data: {
        project: {
          _id: project._id,
          name: project.name,
          description: project.description,
          status: project.status,
          priority: project.priority,
          startDate: project.startDate,
          endDate: project.endDate,
          completionPercentage: project.completionPercentage,
          projectHead: project.projectHead,
          department: project.department
        },
        memberAnalytics,
        taskAnalytics,
        timelineAnalytics,
        completionPrediction,
        summary: generateBasicSummary(project, tasks, memberAnalytics, taskAnalytics, completionPrediction)
      }
    })
  } catch (error) {
    console.error('Get project analytics error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}

// POST - Get AI-powered insights for the project
export async function POST(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['User', 'Project'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { User, Project } = models

    const { projectId } = await params
    const { analyticsData } = await request.json()

    const userDoc = await User.findById(user._id).select('employeeId role')
    if (!userDoc) {
      return NextResponse.json({ success: false, message: 'User not found' }, { status: 404 })
    }

    // Fetch previous insights from project metadata
    const project = await Project.findById(projectId).select('metadata')
    const previousInsights = project?.metadata?.lastAIInsights || null
    const previousInsightsDate = project?.metadata?.lastAIInsightsDate || null

    // Generate AI insights using Gemini with previous context
    try {
      const insights = await generateAIInsights(analyticsData, user._id, previousInsights)

      // Store the new insights in project metadata for future reference
      await Project.findByIdAndUpdate(projectId, {
        $set: {
          'metadata.lastAIInsights': {
            healthScore: insights.healthScore,
            healthStatus: insights.healthStatus,
            oneLineVerdict: insights.oneLineVerdict,
            keyMetrics: insights.keyMetrics,
            workloadDistribution: insights.workloadDistribution,
            projectionInsight: insights.projectionInsight
          },
          'metadata.lastAIInsightsDate': new Date()
        }
      })

      return NextResponse.json({
        success: true,
        insights,
        previousInsightsDate
      })
    } catch (error) {
      console.error('AI generation failed, falling back to rule-based', error)
      return NextResponse.json({
        success: true,
        insights: generateRuleBasedInsights(analyticsData)
      })
    }
  } catch (error) {
    console.error('Generate AI insights error:', error)
    return NextResponse.json({
      success: false,
      message: error.message,
      insights: generateRuleBasedInsights(null)
    }, { status: 500 })
  }
}

// Calculate per-member analytics
function calculateMemberAnalytics(members, tasks, taskAssigneeMap) {
  const memberStats = members.map(member => {
    const memberId = member.user._id.toString()

    let tasksAssigned = 0
    let tasksCompleted = 0
    let tasksInProgress = 0
    let tasksOverdue = 0
    let subtasksCompleted = 0
    let subtasksTotal = 0
    let totalEstimatedHours = 0
    let completedEstimatedHours = 0

    Object.entries(taskAssigneeMap).forEach(([taskId, assigneeList]) => {
      const isAssigned = assigneeList.some(a =>
        a.user._id.toString() === memberId && a.assignmentStatus === 'accepted'
      )

      if (isAssigned) {
        const task = tasks.find(t => t._id.toString() === taskId)
        if (task) {
          tasksAssigned++

          if (task.status === 'completed') {
            tasksCompleted++
            completedEstimatedHours += task.estimatedHours || 0
          } else if (task.status === 'in-progress') {
            tasksInProgress++
          }

          if (task.dueDate && new Date(task.dueDate) < new Date() && task.status !== 'completed') {
            tasksOverdue++
          }

          totalEstimatedHours += task.estimatedHours || 0

          // Subtask stats
          if (task.subtasks && task.subtasks.length > 0) {
            subtasksTotal += task.subtasks.length
            subtasksCompleted += task.subtasks.filter(st => st.completed).length
          }
        }
      }
    })

    const completionRate = tasksAssigned > 0 ? Math.round((tasksCompleted / tasksAssigned) * 100) : 0
    const productivityScore = calculateProductivityScore(tasksCompleted, tasksAssigned, tasksOverdue, subtasksCompleted, subtasksTotal)

    return {
      member: {
        _id: member.user._id,
        firstName: member.user.firstName,
        lastName: member.user.lastName,
        profilePicture: member.user.profilePicture,
        email: member.user.email,
        role: member.role
      },
      stats: {
        tasksAssigned,
        tasksCompleted,
        tasksInProgress,
        tasksOverdue,
        subtasksCompleted,
        subtasksTotal,
        completionRate,
        productivityScore,
        totalEstimatedHours,
        completedEstimatedHours
      }
    }
  })

  // Sort by productivity score
  memberStats.sort((a, b) => b.stats.productivityScore - a.stats.productivityScore)

  return memberStats
}

// Calculate productivity score
function calculateProductivityScore(completed, assigned, overdue, subtasksCompleted, subtasksTotal) {
  if (assigned === 0) return 0

  let score = 0

  // Task completion rate (50% weight)
  score += (completed / assigned) * 50

  // On-time delivery bonus (25% weight)
  const onTimeRate = assigned > 0 ? ((assigned - overdue) / assigned) : 1
  score += onTimeRate * 25

  // Subtask completion rate (25% weight)
  if (subtasksTotal > 0) {
    score += (subtasksCompleted / subtasksTotal) * 25
  } else {
    score += 25 // Give full points if no subtasks
  }

  return Math.round(score)
}

// Calculate task analytics
function calculateTaskAnalytics(tasks) {
  const now = new Date()

  const statusDistribution = {
    todo: 0,
    'in-progress': 0,
    review: 0,
    completed: 0,
    blocked: 0,
    rejected: 0
  }

  const priorityDistribution = {
    low: 0,
    medium: 0,
    high: 0,
    critical: 0
  }

  let overdueCount = 0
  let dueSoonCount = 0 // Due within 3 days
  let totalEstimatedHours = 0
  let completedEstimatedHours = 0
  let avgCompletionTime = 0
  let completedWithTimeData = 0

  const dailyProgress = {}
  const weeklyCreated = {}

  tasks.forEach(task => {
    // Status distribution
    if (statusDistribution[task.status] !== undefined) {
      statusDistribution[task.status]++
    }

    // Priority distribution
    if (priorityDistribution[task.priority] !== undefined) {
      priorityDistribution[task.priority]++
    }

    // Overdue and due soon
    if (task.dueDate) {
      const dueDate = new Date(task.dueDate)
      const daysUntilDue = Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24))

      if (daysUntilDue < 0 && task.status !== 'completed') {
        overdueCount++
      } else if (daysUntilDue >= 0 && daysUntilDue <= 3 && task.status !== 'completed') {
        dueSoonCount++
      }
    }

    // Estimated hours
    totalEstimatedHours += task.estimatedHours || 0
    if (task.status === 'completed') {
      completedEstimatedHours += task.estimatedHours || 0
    }

    // Completion time tracking
    if (task.status === 'completed' && task.completedAt && task.createdAt) {
      const completionDays = Math.ceil((new Date(task.completedAt) - new Date(task.createdAt)) / (1000 * 60 * 60 * 24))
      avgCompletionTime += completionDays
      completedWithTimeData++
    }

    // Daily progress (last 30 days)
    if (task.completedAt) {
      const completedDate = new Date(task.completedAt).toISOString().split('T')[0]
      dailyProgress[completedDate] = (dailyProgress[completedDate] || 0) + 1
    }

    // Weekly created tasks (last 4 weeks)
    const createdDate = new Date(task.createdAt)
    const weekStart = new Date(createdDate)
    weekStart.setDate(weekStart.getDate() - weekStart.getDay())
    const weekKey = weekStart.toISOString().split('T')[0]
    weeklyCreated[weekKey] = (weeklyCreated[weekKey] || 0) + 1
  })

  // Calculate average completion time
  avgCompletionTime = completedWithTimeData > 0
    ? Math.round(avgCompletionTime / completedWithTimeData)
    : 0

  // Generate daily progress for last 30 days
  const last30Days = []
  for (let i = 29; i >= 0; i--) {
    const date = new Date()
    date.setDate(date.getDate() - i)
    const dateStr = date.toISOString().split('T')[0]
    last30Days.push({
      date: dateStr,
      completed: dailyProgress[dateStr] || 0
    })
  }

  // Burndown chart data
  const burndownData = generateBurndownData(tasks)

  return {
    total: tasks.length,
    statusDistribution,
    priorityDistribution,
    overdueCount,
    dueSoonCount,
    totalEstimatedHours,
    completedEstimatedHours,
    avgCompletionTime,
    dailyProgress: last30Days,
    burndownData,
    subtaskStats: calculateSubtaskStats(tasks)
  }
}

// Calculate subtask statistics
function calculateSubtaskStats(tasks) {
  let totalSubtasks = 0
  let completedSubtasks = 0

  tasks.forEach(task => {
    if (task.subtasks && task.subtasks.length > 0) {
      totalSubtasks += task.subtasks.length
      completedSubtasks += task.subtasks.filter(st => st.completed).length
    }
  })

  return {
    total: totalSubtasks,
    completed: completedSubtasks,
    percentage: totalSubtasks > 0 ? Math.round((completedSubtasks / totalSubtasks) * 100) : 0
  }
}

// Generate burndown chart data
function generateBurndownData(tasks) {
  if (tasks.length === 0) return []

  // Find date range
  const dates = tasks.map(t => new Date(t.createdAt))
  const minDate = new Date(Math.min(...dates))
  const maxDate = new Date()

  const data = []
  let remainingTasks = tasks.length

  // Generate data points for each day
  for (let d = new Date(minDate); d <= maxDate; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0]

    // Count tasks completed on this day
    const completedOnDay = tasks.filter(t =>
      t.completedAt && new Date(t.completedAt).toISOString().split('T')[0] === dateStr
    ).length

    remainingTasks -= completedOnDay

    data.push({
      date: dateStr,
      remaining: Math.max(0, remainingTasks),
      completed: completedOnDay
    })
  }

  // Limit to last 30 days
  return data.slice(-30)
}

// Calculate timeline analytics
function calculateTimelineAnalytics(project, tasks) {
  const startDate = new Date(project.startDate)
  const endDate = new Date(project.endDate)
  const now = new Date()

  const totalDuration = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24))
  const elapsed = Math.ceil((now - startDate) / (1000 * 60 * 60 * 24))
  const remaining = Math.ceil((endDate - now) / (1000 * 60 * 60 * 24))

  const timeProgress = totalDuration > 0 ? Math.round((elapsed / totalDuration) * 100) : 0
  const taskProgress = project.completionPercentage || 0

  // Velocity: Tasks completed per day
  const completedTasks = tasks.filter(t => t.status === 'completed')
  const projectDaysActive = Math.max(1, elapsed)
  const velocity = completedTasks.length / projectDaysActive

  // Expected completion rate vs actual
  const expectedProgress = Math.min(100, timeProgress)
  const progressDiff = taskProgress - expectedProgress

  return {
    totalDuration,
    elapsed,
    remaining,
    timeProgress: Math.min(100, Math.max(0, timeProgress)),
    taskProgress,
    velocity: Math.round(velocity * 100) / 100,
    expectedProgress,
    progressDiff,
    isAhead: progressDiff > 0,
    isBehind: progressDiff < -10,
    isOnTrack: progressDiff >= -10 && progressDiff <= 10
  }
}

// Calculate completion prediction
function calculateCompletionPrediction(project, tasks, taskAnalytics) {
  const now = new Date()
  const endDate = new Date(project.endDate)
  const startDate = new Date(project.startDate)

  const totalTasks = tasks.length
  const completedTasks = tasks.filter(t => t.status === 'completed').length
  const remainingTasks = totalTasks - completedTasks

  // No tasks at all - project hasn't started
  if (totalTasks === 0) {
    return {
      status: 'yet-to-start',
      message: 'No tasks created yet. Add tasks to track progress.',
      projectedDate: null,
      daysVariance: 0,
      confidence: 0
    }
  }

  // All tasks completed — awaiting review/approval or new task scope
  if (remainingTasks === 0) {
    return {
      status: 'waiting-for-review',
      message: 'All tasks are done! Project is awaiting review, approval, or new task scope before closing.',
      projectedDate: null,
      daysVariance: 0,
      confidence: 100
    }
  }

  // Calculate velocity (tasks per day)
  const elapsedDays = Math.max(1, Math.ceil((now - startDate) / (1000 * 60 * 60 * 24)))
  const velocity = completedTasks / elapsedDays

  // Estimate days needed for remaining tasks
  let estimatedDaysRemaining = velocity > 0
    ? Math.ceil(remainingTasks / velocity)
    : remainingTasks * 3 // Default: 3 days per task if no velocity

  // Factor in estimated hours
  if (taskAnalytics.totalEstimatedHours > 0 && taskAnalytics.completedEstimatedHours > 0) {
    const remainingHours = taskAnalytics.totalEstimatedHours - taskAnalytics.completedEstimatedHours
    const hoursPerDay = 6 // Assume 6 productive hours per day
    const etaBasedDays = Math.ceil(remainingHours / hoursPerDay)

    // Blend velocity and ETA based estimates
    estimatedDaysRemaining = Math.ceil((estimatedDaysRemaining + etaBasedDays) / 2)
  }

  // Calculate projected completion date
  const projectedDate = new Date(now)
  projectedDate.setDate(projectedDate.getDate() + estimatedDaysRemaining)

  // Calculate variance from deadline
  const daysVariance = Math.ceil((endDate - projectedDate) / (1000 * 60 * 60 * 24))

  // Calculate confidence based on velocity consistency and data points
  let confidence = 50 // Base confidence
  if (completedTasks >= 5) confidence += 20 // More data points
  if (velocity > 0.2) confidence += 15 // Good velocity
  if (taskAnalytics.overdueCount === 0) confidence += 15 // No overdue tasks
  confidence = Math.min(95, confidence)

  let status, message
  if (daysVariance > 7) {
    status = 'ahead'
    message = `Project is on track to complete ${Math.abs(daysVariance)} days early`
  } else if (daysVariance >= 0) {
    status = 'on-track'
    message = 'Project is expected to complete on time'
  } else if (daysVariance >= -7) {
    status = 'at-risk'
    message = `Project may be delayed by ${Math.abs(daysVariance)} days`
  } else {
    status = 'delayed'
    message = `Project is projected to be ${Math.abs(daysVariance)} days overdue`
  }

  return {
    status,
    message,
    projectedDate,
    daysVariance,
    confidence,
    estimatedDaysRemaining,
    remainingTasks,
    velocity: Math.round(velocity * 100) / 100
  }
}

// Generate basic summary without AI
function generateBasicSummary(project, tasks, memberAnalytics, taskAnalytics, completionPrediction) {
  const completedTasks = tasks.filter(t => t.status === 'completed').length
  const topPerformer = memberAnalytics[0]

  return {
    overview: `Project has ${tasks.length} total tasks with ${completedTasks} completed (${project.completionPercentage || 0}% complete).`,
    teamSize: memberAnalytics.length,
    topPerformer: topPerformer ? {
      name: `${topPerformer.member.firstName} ${topPerformer.member.lastName}`,
      score: topPerformer.stats.productivityScore
    } : null,
    criticalItems: taskAnalytics.overdueCount,
    upcomingDeadlines: taskAnalytics.dueSoonCount,
    projectionStatus: completionPrediction.status
  }
}

// Generate rule-based insights when AI is unavailable
function generateRuleBasedInsights(data) {
  const insights = {
    summary: '',
    strengths: [],
    improvements: [],
    recommendations: [],
    taskPrioritization: []
  }

  if (!data) {
    insights.summary = 'Unable to analyze project data at this time.'
    return insights
  }

  const { taskAnalytics, memberAnalytics, completionPrediction, project } = data

  // Generate summary
  insights.summary = `The project is ${completionPrediction?.status || 'in progress'}. Current completion rate is ${project?.completionPercentage || 0}%.`

  // Strengths
  if (taskAnalytics?.overdueCount === 0) {
    insights.strengths.push('No overdue tasks - excellent time management')
  }
  if (completionPrediction?.status === 'ahead') {
    insights.strengths.push('Project is ahead of schedule')
  }
  if (memberAnalytics?.some(m => m.stats.productivityScore > 80)) {
    insights.strengths.push('High-performing team members driving progress')
  }

  // Improvements
  if (taskAnalytics?.overdueCount > 0) {
    insights.improvements.push(`${taskAnalytics.overdueCount} overdue tasks need immediate attention`)
  }
  if (taskAnalytics?.priorityDistribution?.critical > 0) {
    insights.improvements.push(`${taskAnalytics.priorityDistribution.critical} critical priority tasks pending`)
  }
  if (completionPrediction?.status === 'delayed') {
    insights.improvements.push('Project is behind schedule - consider reallocating resources')
  }

  // Recommendations
  if (taskAnalytics?.dueSoonCount > 0) {
    insights.recommendations.push(`Focus on ${taskAnalytics.dueSoonCount} tasks due within 3 days`)
  }
  if (taskAnalytics?.statusDistribution?.blocked > 0) {
    insights.recommendations.push(`Unblock ${taskAnalytics.statusDistribution.blocked} blocked tasks`)
  }
  insights.recommendations.push('Schedule regular check-ins with team members')
  insights.recommendations.push('Update task ETAs for accurate project forecasting')

  // Task prioritization
  insights.taskPrioritization = [
    { priority: 1, action: 'Complete overdue tasks' },
    { priority: 2, action: 'Address critical priority items' },
    { priority: 3, action: 'Unblock any blocked tasks' },
    { priority: 4, action: 'Review tasks due this week' }
  ]

  return insights
}

// Generate AI insights using Gemini
async function generateAIInsights(analyticsData, userId, previousInsights = null) {
  try {
    const { project, taskAnalytics, memberAnalytics, completionPrediction, timelineAnalytics } = analyticsData

    // Calculate days until deadline and urgency
    const today = new Date()
    const deadline = new Date(project.endDate)
    const startDate = new Date(project.startDate)
    const daysUntilDeadline = Math.ceil((deadline - today) / (1000 * 60 * 60 * 24))
    const totalProjectDays = Math.ceil((deadline - startDate) / (1000 * 60 * 60 * 24))
    const daysElapsed = Math.ceil((today - startDate) / (1000 * 60 * 60 * 24))
    const isOverdue = daysUntilDeadline < 0
    const deadlineUrgency = isOverdue ? 'OVERDUE' : daysUntilDeadline <= 3 ? 'CRITICAL' : daysUntilDeadline <= 7 ? 'URGENT' : daysUntilDeadline <= 14 ? 'APPROACHING' : 'COMFORTABLE'

    // Calculate expected completion % based on time elapsed
    const expectedCompletion = Math.min(100, Math.round((daysElapsed / totalProjectDays) * 100))
    const completionGap = expectedCompletion - (project.completionPercentage || 0)

    // Calculate task density (tasks per team member)
    const tasksPerMember = memberAnalytics.length > 0 ? (taskAnalytics.total / memberAnalytics.length).toFixed(1) : 0
    const isUnderdeveloped = taskAnalytics.total < 5 || tasksPerMember < 2

    // Calculate team utilization
    const membersWithTasks = memberAnalytics.filter(m => m.stats.tasksAssigned > 0).length
    const underutilizedMembers = memberAnalytics.length - membersWithTasks

    // Build previous context section if available
    let previousContextSection = ''
    if (previousInsights) {
      previousContextSection = `
PREVIOUS ANALYSIS (for consistency reference only):
Previous Health Score: ${previousInsights.healthScore || 'N/A'}
Previous Status: ${previousInsights.healthStatus || 'N/A'}`
    }

    const prompt = `You are a project health evaluator. Your job is to give ACCURATE, EVIDENCE-BASED scores from the metrics below.

TODAY: ${today.toLocaleDateString()}
${previousContextSection}

  ===== SCORING PRINCIPLES (MUST FOLLOW) =====

  1) Evidence over tone. Every conclusion must be supported by provided metrics.
  2) Avoid contradictions:
  - If completion is >= 95% and overdue tasks = 0 and blocked tasks = 0, healthScore MUST be >= 70.
  - If completion is 100% and all tasks are completed, do not classify as critical.
  3) Task count alone is NOT a reason for critical status.
  - A low task count can reduce confidence or produce warning, but cannot by itself force critical.
  4) If project is overdue but completed, classify as warning or good based on execution quality, not critical by default.
  5) Keep the score calibrated to current state, not hypothetical ideal process.

  CRITICAL SIGNALS (usually healthScore 0-39):
  - Completion gap > 30% behind schedule (expected ${expectedCompletion}%, actual ${project.completionPercentage}%)
  - More than 50% of tasks are overdue
  - Multiple blocked tasks + low progress
  - High underutilization with low completion

  WARNING SIGNALS (usually healthScore 40-69):
- Completion gap 10-30% behind schedule
- Any overdue tasks exist (${taskAnalytics.overdueCount} overdue)
- Any blocked tasks exist (${taskAnalytics.statusDistribution.blocked} blocked)
  - Tasks per member < 3 (currently ${tasksPerMember}) may indicate planning weakness
- Deadline within 14 days with < 70% completion

  GOOD SIGNALS (usually healthScore 70-100):
- Only if NONE of the above conditions apply
- On track or ahead of schedule
- No overdue tasks
- Well-distributed workload
 - Projection status is "waiting-for-review" (ALL tasks completed, project pending approval/review/new scope)

SPECIAL CASE — WAITING FOR REVIEW (projection status = "waiting-for-review"):
- This means 100% of existing tasks are done. The project is NOT failing.
- The project is simply awaiting formal sign-off, stakeholder approval, or new task scope.
- healthScore MUST be >= 75 in this state unless there are other critical problems (e.g., many blocked/overdue tasks before completion).
- Do NOT penalise for "low task count" or "wasted capacity" when status is waiting-for-review.
- oneLineVerdict should reflect completion and pending approval, not criticise task scope or team utilization.
Start: ${startDate.toLocaleDateString()} | Deadline: ${deadline.toLocaleDateString()}
Days Remaining: ${isOverdue ? `${Math.abs(daysUntilDeadline)} days OVERDUE!` : daysUntilDeadline + ' days'}
Deadline Urgency: ${deadlineUrgency}

COMPLETION ANALYSIS:
- Time Elapsed: ${daysElapsed} of ${totalProjectDays} days (${timelineAnalytics?.timeProgress || 0}%)
- Expected Completion by now: ${expectedCompletion}%
- Actual Completion: ${project.completionPercentage}%
- Completion Gap: ${completionGap > 0 ? completionGap + '% BEHIND' : Math.abs(completionGap) + '% ahead'}

TASK HEALTH:
- Total Tasks: ${taskAnalytics.total} ${isUnderdeveloped ? '⚠️ SEVERELY UNDERDEVELOPED (< 5 tasks)' : ''}
- Tasks per Team Member: ${tasksPerMember} ${tasksPerMember < 2 ? '⚠️ TOO FEW' : ''}
- Completed: ${taskAnalytics.statusDistribution.completed} | In Progress: ${taskAnalytics.statusDistribution['in-progress']}
- Overdue: ${taskAnalytics.overdueCount} ${taskAnalytics.overdueCount > 0 ? '⚠️ PROBLEM' : '✓'}
- Due Soon (3 days): ${taskAnalytics.dueSoonCount}
- Blocked: ${taskAnalytics.statusDistribution.blocked} ${taskAnalytics.statusDistribution.blocked > 0 ? '⚠️ BLOCKERS' : '✓'}

TEAM UTILIZATION (${memberAnalytics.length} members):
- Members with tasks: ${membersWithTasks}
- Underutilized (0 tasks): ${underutilizedMembers} ${underutilizedMembers > 0 ? '⚠️ WASTED CAPACITY' : '✓'}
${memberAnalytics.slice(0, 8).map(m =>
      `• ${m.member.firstName} ${m.member.lastName}: ${m.stats.tasksAssigned} assigned, ${m.stats.tasksCompleted} done, ${m.stats.tasksOverdue} overdue`
    ).join('\n')}

PROJECTION: ${completionPrediction.status} | Confidence: ${completionPrediction.confidence}%

===== YOUR ASSESSMENT =====

Based on the SCORING PRINCIPLES above, determine:
1. Is this CRITICAL? (score 0-39) - Check all critical conditions
2. Is this WARNING? (score 40-69) - Check all warning conditions  
3. Only if NO issues, rate as GOOD (score 70-100)

Respond with ONLY valid JSON. healthScore and healthStatus MUST be consistent (critical=0-39, warning=40-69, good=70-100):
{
  "healthScore": "<number 0-100: critical=0-39, warning=40-69, good=70-100>",
  "healthStatus": "critical|warning|good (MUST match healthScore range)",
  "oneLineVerdict": "Brutally honest one-sentence assessment",
  "keyMetrics": [
    {"label": "Metric Name", "value": "42", "trend": "up|down|stable", "status": "good|warning|critical"}
  ],
  "immediateActions": [
    {"action": "Specific action with task/person name", "owner": "Role or Name", "deadline": "Today/Tomorrow/This Week", "impact": "high|medium"}
  ],
  "employeeInsights": [
    {"name": "Employee Name", "status": "star|ontrack|attention|overloaded", "insight": "Brief specific observation", "suggestion": "Concrete action"}
  ],
  "blockers": [
    {"issue": "Specific blocker", "affectedTasks": 3, "suggestedFix": "Solution"}
  ],
  "riskRadar": [
    {"risk": "Specific risk", "probability": "high|medium|low", "impact": "high|medium|low", "mitigation": "Action"}
  ],
  "quickWins": [
    {"action": "Easy win action", "effort": "low", "impact": "high", "timeToComplete": "1-2 hours"}
  ],
  "bottlenecks": [
    {"area": "Where", "cause": "Why", "recommendation": "What to do"}
  ],
  "weeklyFocus": {
    "priority1": "Most critical this week",
    "priority2": "Second focus",
    "priority3": "If time permits"
  },
  "workloadDistribution": {
    "overloaded": ["Name1"],
    "balanced": ["Name2", "Name3"],
    "underutilized": ["Name4"]
  },
  "projectionInsight": "One line about timeline - will it finish on time?"
}`

    const text = await generateSmartContent(prompt, {
      userId,
      feature: 'project-analytics',
      skipRefinement: true,
      skipGuardrails: true,
      skipContext: true
    });
    const parsed = parseAIJsonResponse(text, { expectedRoot: 'object' })
    return normalizeProjectInsights(parsed, analyticsData)
  } catch (error) {
    console.error('Error generating AI insights:', error)
    return generateRuleBasedInsights(analyticsData)
  }
}

function normalizeProjectInsights(insights, analyticsData) {
  const safeInsights = insights && typeof insights === 'object' ? { ...insights } : {}
  const project = analyticsData?.project || {}
  const taskAnalytics = analyticsData?.taskAnalytics || {}

  const completion = Number(project.completionPercentage || 0)
  const overdue = Number(taskAnalytics.overdueCount || 0)
  const blocked = Number(taskAnalytics?.statusDistribution?.blocked || 0)
  const total = Number(taskAnalytics.total || 0)
  const completed = Number(taskAnalytics?.statusDistribution?.completed || 0)
  const allCompleted = total > 0 && completed >= total
  const isWaitingForReview = analyticsData?.completionPrediction?.status === 'waiting-for-review'
  const isHighExecution = completion >= 95 && overdue === 0 && blocked === 0

  let score = Number(safeInsights.healthScore)
  if (!Number.isFinite(score)) score = 60
  score = Math.max(0, Math.min(100, Math.round(score)))

  // Deterministic consistency guards to avoid contradictory scoring.
  if (allCompleted || isWaitingForReview || isHighExecution) {
    score = Math.max(score, 75)
  }

  let status = String(safeInsights.healthStatus || '').toLowerCase()
  if (!['critical', 'warning', 'good'].includes(status)) {
    status = score < 40 ? 'critical' : score < 70 ? 'warning' : 'good'
  }

  if (status === 'critical' && score >= 40) score = 39
  if (status === 'warning' && (score < 40 || score >= 70)) score = Math.min(69, Math.max(40, score))
  if (status === 'good' && score < 70) score = 70

  status = score < 40 ? 'critical' : score < 70 ? 'warning' : 'good'

  if (!safeInsights.oneLineVerdict || typeof safeInsights.oneLineVerdict !== 'string') {
    if (isWaitingForReview) {
      safeInsights.oneLineVerdict = 'All tasks are complete — project is awaiting review, stakeholder approval, or new scope before closure.'
    } else if (status === 'good') {
      safeInsights.oneLineVerdict = 'Project execution is strong with minimal delivery risk based on current metrics.'
    } else if (status === 'warning') {
      safeInsights.oneLineVerdict = 'Project needs targeted corrections to reduce schedule and execution risk.'
    } else {
      safeInsights.oneLineVerdict = 'Project is at critical risk and requires immediate intervention on delivery blockers.'
    }
  }

  safeInsights.healthScore = score
  safeInsights.healthStatus = status

  if (!Array.isArray(safeInsights.keyMetrics)) safeInsights.keyMetrics = []
  if (!Array.isArray(safeInsights.immediateActions)) safeInsights.immediateActions = []
  if (!Array.isArray(safeInsights.employeeInsights)) safeInsights.employeeInsights = []
  if (!Array.isArray(safeInsights.blockers)) safeInsights.blockers = []
  if (!Array.isArray(safeInsights.riskRadar)) safeInsights.riskRadar = []
  if (!Array.isArray(safeInsights.quickWins)) safeInsights.quickWins = []
  if (!Array.isArray(safeInsights.bottlenecks)) safeInsights.bottlenecks = []
  if (!safeInsights.weeklyFocus || typeof safeInsights.weeklyFocus !== 'object') {
    safeInsights.weeklyFocus = {
      priority1: 'Resolve highest-impact delivery blocker',
      priority2: 'Stabilize workload allocation across members',
      priority3: 'Update task statuses and ETAs for forecast accuracy'
    }
  }
  if (!safeInsights.workloadDistribution || typeof safeInsights.workloadDistribution !== 'object') {
    safeInsights.workloadDistribution = { overloaded: [], balanced: [], underutilized: [] }
  }
  if (!safeInsights.projectionInsight || typeof safeInsights.projectionInsight !== 'string') {
    safeInsights.projectionInsight = 'Projection is based on current completion, overdue tasks, and blockers.'
  }

  return safeInsights
}
