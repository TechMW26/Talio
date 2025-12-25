import { NextResponse } from 'next/server'
import { verifyToken, getAuthAndModels } from '@/lib/auth'
import { checkProjectAccess, getProjectTaskStats } from '@/lib/projectService'
import { generateSmartContent } from '@/lib/promptEngine'

export const dynamic = 'force-dynamic'
export const maxDuration = 60 // Allow up to 60 seconds for AI processing

// GET - Get comprehensive project analytics with AI insights
export async function GET(request, { params }) {
  try {
    const token = request.headers.get('authorization')?.split(' ')[1]
    if (!token) {
      return NextResponse.json({ success: false, message: 'No token provided' }, { status: 401 })
    }

    const decoded = await verifyToken(token)
    if (!decoded) {
      return NextResponse.json({ success: false, message: 'Invalid token' }, { status: 401 })
    }

    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Project', 'ProjectMember', 'Task', 'TaskAssignee', 'User', 'Employee'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Project, ProjectMember, Task, TaskAssignee, User, Employee } = models

    const { projectId } = await params

    const user = await User.findById(decoded.userId).select('employeeId role')
    if (!user || !user.employeeId) {
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
    const isAdmin = ['admin', 'hr'].includes(user.role)
    if (!isAdmin) {
      const { hasAccess } = await checkProjectAccess(projectId, user.employeeId, 'view')
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
    const token = request.headers.get('authorization')?.split(' ')[1]
    if (!token) {
      return NextResponse.json({ success: false, message: 'No token provided' }, { status: 401 })
    }

    const decoded = await verifyToken(token)
    if (!decoded) {
      return NextResponse.json({ success: false, message: 'Invalid token' }, { status: 401 })
    }

    const { projectId } = await params
    const { analyticsData } = await request.json()

    const user = await User.findById(decoded.userId).select('employeeId role')
    if (!user) {
      return NextResponse.json({ success: false, message: 'User not found' }, { status: 404 })
    }

    // Generate AI insights using Gemini
    try {
      const insights = await generateAIInsights(analyticsData, decoded.userId)
      return NextResponse.json({
        success: true,
        insights
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

  if (remainingTasks === 0) {
    return {
      status: 'completed',
      message: 'Project is complete!',
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
async function generateAIInsights(analyticsData, userId) {
  try {
    const { project, taskAnalytics, memberAnalytics, completionPrediction, timelineAnalytics } = analyticsData

    const prompt = `You are a project management AI assistant. Analyze this project data and provide actionable insights in JSON format.

PROJECT DATA:
- Name: ${project.name}
- Status: ${project.status}
- Priority: ${project.priority}
- Completion: ${project.completionPercentage}%
- Deadline: ${new Date(project.endDate).toLocaleDateString()}
- Days Remaining: ${timelineAnalytics?.remaining || 'N/A'}

TASK METRICS:
- Total Tasks: ${taskAnalytics.total}
- Completed: ${taskAnalytics.statusDistribution.completed}
- In Progress: ${taskAnalytics.statusDistribution['in-progress']}
- Overdue: ${taskAnalytics.overdueCount}
- Due Soon: ${taskAnalytics.dueSoonCount}
- Critical Priority: ${taskAnalytics.priorityDistribution.critical}
- High Priority: ${taskAnalytics.priorityDistribution.high}
- Blocked: ${taskAnalytics.statusDistribution.blocked}
- Avg Completion Time: ${taskAnalytics.avgCompletionTime} days

TEAM PERFORMANCE:
${memberAnalytics.slice(0, 5).map(m => 
  `- ${m.member.firstName} ${m.member.lastName}: ${m.stats.tasksCompleted}/${m.stats.tasksAssigned} tasks (${m.stats.productivityScore}% productivity)`
).join('\n')}

TIMELINE:
- Time Progress: ${timelineAnalytics?.timeProgress}%
- Task Progress: ${timelineAnalytics?.taskProgress}%
- Velocity: ${timelineAnalytics?.velocity} tasks/day
- Progress Status: ${timelineAnalytics?.isAhead ? 'Ahead' : timelineAnalytics?.isBehind ? 'Behind' : 'On Track'}

PROJECTION:
- Status: ${completionPrediction.status}
- Projected Completion: ${completionPrediction.projectedDate ? new Date(completionPrediction.projectedDate).toLocaleDateString() : 'N/A'}
- Days Variance: ${completionPrediction.daysVariance} days
- Confidence: ${completionPrediction.confidence}%

Provide your response ONLY as valid JSON with this exact structure:
{
  "summary": "2-3 sentence executive summary of project health",
  "strengths": ["strength 1", "strength 2", "strength 3"],
  "improvements": ["area 1", "area 2", "area 3"],
  "recommendations": ["recommendation 1", "recommendation 2", "recommendation 3", "recommendation 4"],
  "taskPrioritization": [
    {"priority": 1, "action": "most important action", "reason": "why this is urgent"},
    {"priority": 2, "action": "second action", "reason": "why this matters"},
    {"priority": 3, "action": "third action", "reason": "benefit of doing this"}
  ],
  "riskFactors": ["risk 1", "risk 2"],
  "teamInsights": "analysis of team performance and suggestions"
}`

    const text = await generateSmartContent(prompt, { userId, feature: 'project-analytics' });
    
    // Clean up markdown code blocks if present
    const jsonStr = text.replace(/```json\n?|\n?```/g, '').trim()
    
    return JSON.parse(jsonStr)
  } catch (error) {
    console.error('Error generating AI insights:', error)
    return generateRuleBasedInsights(analyticsData)
  }
}
