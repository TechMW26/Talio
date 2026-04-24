import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { generateCustomAIPublicContent } from '@/lib/ai/providers/customProvider'
import { buildDirectReportsFilter } from '@/lib/teamScope'

// Get current month key in "YYYY-MM" format
function getCurrentMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

// Check token balance and deduct one token
async function checkAndDeductToken(MiraTokenUsage, userId) {
  const month = getCurrentMonth()

  // Upsert: create record if missing, then return it
  let usage = await MiraTokenUsage.findOneAndUpdate(
    { user: userId, month },
    { $setOnInsert: { tokensUsed: 0, tokenLimit: 100 } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  )

  if (usage.tokensUsed >= usage.tokenLimit) {
    return { allowed: false, tokensUsed: usage.tokensUsed, tokenLimit: usage.tokenLimit, tokensRemaining: 0 }
  }

  // Deduct one token atomically
  usage = await MiraTokenUsage.findOneAndUpdate(
    { user: userId, month, tokensUsed: { $lt: usage.tokenLimit } },
    { $inc: { tokensUsed: 1 } },
    { new: true }
  )

  if (!usage) {
    return { allowed: false, tokensUsed: usage?.tokensUsed ?? 0, tokenLimit: 100, tokensRemaining: 0 }
  }

  return {
    allowed: true,
    tokensUsed: usage.tokensUsed,
    tokenLimit: usage.tokenLimit,
    tokensRemaining: usage.tokenLimit - usage.tokensUsed
  }
}

// Route all MIRA generation through the shared custom AI provider.
async function generateContentWithSearch(prompt, systemInstruction) {
  return generateCustomAIPublicContent(prompt, systemInstruction)
}

// Build role-aware system prompt with user context
function buildSystemPrompt(user, role, employeeData, contextData) {
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

  let roleInstructions = ''
  if (['admin', 'hr'].includes(role)) {
    roleInstructions = `The user is an ADMIN/HR with FULL access. You can share any data from the organization - employee details, attendance records, leave balances, project statuses, performance data, policies, announcements, and more.`
  } else if (['manager', 'department_head', 'department_manager', 'team_leader'].includes(role)) {
    roleInstructions = `The user is a MANAGER/LEAD. You can share data about their direct reports, their team members, projects they manage, and their own personal data. Do NOT share data about employees outside their reporting hierarchy.`
  } else {
    roleInstructions = `The user is an EMPLOYEE. You can ONLY share their own personal data - their tasks, attendance, leaves, performance, and general company policies/announcements. Do NOT share other employees' data.`
  }

  return `You are MIRA - a powerful, all-rounder AI assistant built into Talio. You can help with ANYTHING: coding, writing, research, math, science, general knowledge, creative tasks, business strategy, technical questions, and of course all HR & productivity data within Talio.
Today is ${today}.

## User Context
- Name: ${employeeData?.firstName || 'User'} ${employeeData?.lastName || ''}
- Role: ${role}
- Employee ID: ${employeeData?.employeeCode || 'N/A'}
- Department: ${employeeData?.department?.name || 'N/A'}
- Designation: ${employeeData?.designation?.name || 'N/A'}

## Access Rules (for Talio data only)
${roleInstructions}

## Available Data Context
${contextData && Object.keys(contextData).length > 0 ? JSON.stringify(contextData, null, 0) : 'No specific Talio data loaded for this query. Answer using your general knowledge, reasoning, or internet access.'}

## Response Format
You MUST respond in valid JSON with this exact structure:
{
  "message": "Your natural language response here (supports Markdown)",
  "cards": [
    {
      "type": "info|stat|list|table|action|alert|progress",
      "title": "Card title",
      "data": {}
    }
  ],
  "suggestedQuestions": ["Follow-up question 1", "Follow-up question 2"]
}

### Card Types & Data Structures:

**"info"** - Simple information card
{ "text": "Description text", "icon": "info|success|warning" }

**"stat"** - Numeric stats
{ "stats": [{ "label": "Label", "value": "42", "change": "+5%", "trend": "up|down|neutral" }] }

**"list"** - List of items
{ "items": [{ "title": "Item title", "subtitle": "Details", "status": "active|pending|completed|overdue", "link": "/dashboard/..." }] }

**"table"** - Tabular data
{ "headers": ["Col1", "Col2"], "rows": [["val1", "val2"]] }

**"action"** - Actionable buttons/links
{ "text": "Description", "actions": [{ "label": "Button text", "link": "/dashboard/...", "variant": "primary|secondary" }] }

**"alert"** - Important notice
{ "text": "Alert message", "severity": "info|warning|error|success" }

**"progress"** - Progress indicator
{ "items": [{ "label": "Task name", "value": 75, "max": 100, "status": "on-track|at-risk|overdue" }] }

## Important Rules
- Always respond in the JSON format above. Never respond with plain text outside JSON.
- You are an ALL-ROUNDER AI. You can help with ANY topic - programming, math, science, writing, research, business, creative work, anything. NEVER refuse or redirect a question just because it's not HR-related.
- When providing code, ALWAYS use proper Markdown code blocks with language identifiers in the "message" field. Example: \`\`\`python\\nprint("hello")\\n\`\`\`. For inline code use single backticks.
- Keep messages concise and helpful.
- Use cards to present structured data beautifully.
- Include 2-3 suggested follow-up questions.
- Be warm, professional, and helpful.
- For actionable Talio items, include links to relevant dashboard pages.
- Never reveal sensitive security data (passwords, tokens, etc.).
- You have internet access for up-to-date information on current events, weather, news, etc.
- Only decline if the question is inappropriate or harmful.`
}

// Fetch relevant data based on user query intent
async function fetchContextData(models, user, role, query) {
  const context = {}
  const queryLower = query.toLowerCase()

  const isAdmin = ['admin', 'hr'].includes(role)
  const isManager = ['manager', 'department_head', 'department_manager', 'team_leader'].includes(role)
  const isPersonalQuery = /\b(my|mine|assigned to me|i have|i am|my own)\b/i.test(queryLower)

  try {
    // Attendance queries
    if (/attend|check.?in|check.?out|present|absent|late|punch|working hours/i.test(queryLower)) {
      if (isAdmin && models.Attendance) {
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        const todayAttendance = await models.Attendance.find({ date: { $gte: today } })
          .populate('employee', 'firstName lastName employeeCode')
          .lean().limit(50)
        context.todayAttendance = todayAttendance.map(a => ({
          employee: a.employee ? `${a.employee.firstName} ${a.employee.lastName}` : 'Unknown',
          code: a.employee?.employeeCode,
          checkIn: a.checkInTime, checkOut: a.checkOutTime,
          status: a.status, workingHours: a.totalWorkingHours
        }))
      } else if (models.Attendance) {
        const myAttendance = await models.Attendance.find({ employee: user.employeeId })
          .sort({ date: -1 }).lean().limit(14)
        context.myAttendance = myAttendance.map(a => ({
          date: a.date, checkIn: a.checkInTime, checkOut: a.checkOutTime,
          status: a.status, workingHours: a.totalWorkingHours
        }))
      }
    }

    // Task queries - assignments stored in TaskAssignee join table
    if (/task|todo|assign|work|backlog|deadline|overdue|pending task/i.test(queryLower)) {
      if (isAdmin && !isPersonalQuery && models.Task) {
        // Admin asking about all tasks (not personal)
        const tasks = await models.Task.find({})
          .populate('createdBy', 'firstName lastName')
          .populate('project', 'name')
          .sort({ updatedAt: -1 }).lean().limit(30)
        // Attach assignee names from TaskAssignee
        if (models.TaskAssignee && tasks.length > 0) {
          const taskIds = tasks.map(t => t._id)
          const assignments = await models.TaskAssignee.find({ task: { $in: taskIds } })
            .populate('user', 'firstName lastName').lean()
          const assigneeMap = {}
          for (const a of assignments) {
            const name = a.user ? `${a.user.firstName} ${a.user.lastName}` : 'Unknown'
            if (!assigneeMap[a.task.toString()]) assigneeMap[a.task.toString()] = []
            assigneeMap[a.task.toString()].push(name)
          }
          context.tasks = tasks.map(t => ({
            id: t._id.toString(), title: t.title, status: t.status, priority: t.priority,
            assignees: (assigneeMap[t._id.toString()] || []).join(', ') || 'Unassigned',
            project: t.project?.name, projectId: t.project?._id?.toString(), dueDate: t.dueDate, progress: t.progressPercentage
          }))
        } else {
          context.tasks = tasks.map(t => ({
            id: t._id.toString(), title: t.title, status: t.status, priority: t.priority,
            project: t.project?.name, projectId: t.project?._id?.toString(), dueDate: t.dueDate, progress: t.progressPercentage
          }))
        }
      } else if (models.Task && models.TaskAssignee) {
        // Personal tasks - for any role (including admin when asking "my tasks")
        const myAssignments = await models.TaskAssignee.find({
          user: user.employeeId,
          assignmentStatus: { $in: ['pending', 'accepted'] }
        }).select('task').lean()
        const myTaskIds = myAssignments.map(a => a.task)
        // Also include tasks created by this user
        const myTasks = await models.Task.find({
          $or: [{ _id: { $in: myTaskIds } }, { createdBy: user.employeeId }]
        }).populate('project', 'name').sort({ updatedAt: -1 }).lean().limit(20)
        context.myTasks = myTasks.map(t => ({
          id: t._id.toString(), title: t.title, status: t.status, priority: t.priority,
          project: t.project?.name, projectId: t.project?._id?.toString(), dueDate: t.dueDate, progress: t.progressPercentage
        }))
      }
    }

    // Leave queries
    if (/leave|vacation|day.?off|sick|holiday|time.?off|pto|balance/i.test(queryLower)) {
      if (models.Leave) {
        const filter = isAdmin ? {} : { employee: user.employeeId }
        const leaves = await models.Leave.find(filter)
          .populate('employee', 'firstName lastName')
          .sort({ createdAt: -1 }).lean().limit(20)
        context.leaves = leaves.map(l => ({
          employee: l.employee ? `${l.employee.firstName} ${l.employee.lastName}` : 'Unknown',
          type: l.leaveType, startDate: l.startDate, endDate: l.endDate,
          status: l.status, reason: l.reason
        }))
      }
      if (models.LeaveBalance) {
        const balFilter = isAdmin ? {} : { employee: user.employeeId }
        const balances = await models.LeaveBalance.find(balFilter)
          .populate('employee', 'firstName lastName').lean().limit(20)
        context.leaveBalances = balances.map(b => ({
          employee: b.employee ? `${b.employee.firstName} ${b.employee.lastName}` : 'Unknown',
          type: b.leaveType, total: b.totalAllotted, used: b.used, remaining: b.remaining
        }))
      }
    }

    // Project queries
    if (/project|milestone|progress|team|sprint/i.test(queryLower)) {
      if (models.Project) {
        const projFilter = isAdmin ? {} : { $or: [{ projectHead: user.employeeId }, { createdBy: user._id }] }
        const projects = await models.Project.find(projFilter)
          .populate('projectHead', 'firstName lastName')
          .sort({ updatedAt: -1 }).lean().limit(15)
        context.projects = projects.map(p => ({
          name: p.name, status: p.status, completion: p.completionPercentage,
          head: p.projectHead ? `${p.projectHead.firstName} ${p.projectHead.lastName}` : 'N/A',
          deadline: p.deadline, startDate: p.startDate
        }))
      }
    }

    // Employee queries (admin/manager only)
    if (/employee|staff|team member|headcount|people|roster/i.test(queryLower)) {
      if ((isAdmin || isManager) && models.Employee) {
        const empFilter = isAdmin
          ? { status: 'active' }
          : buildDirectReportsFilter(user.employeeId, { status: 'active' })
        const employees = await models.Employee.find(empFilter)
          .populate('department designation')
          .lean().limit(50)
        context.employees = employees.map(e => ({
          name: `${e.firstName} ${e.lastName}`, code: e.employeeCode,
          department: e.department?.name, designation: e.designation?.name,
          email: e.email, status: e.status
        }))
      }
    }

    // Announcement/policy queries
    if (/announce|policy|notice|update|news|circular/i.test(queryLower)) {
      if (models.Announcement) {
        const announcements = await models.Announcement.find({ status: 'published' })
          .sort({ createdAt: -1 }).lean().limit(10)
        context.announcements = announcements.map(a => ({
          title: a.title, content: a.content?.substring(0, 200),
          priority: a.priority, createdAt: a.createdAt, category: a.category
        }))
      }
      if (models.Policy) {
        const policies = await models.Policy.find({ isActive: true }).lean().limit(10)
        context.policies = policies.map(p => ({
          title: p.title, category: p.category, description: p.description?.substring(0, 200)
        }))
      }
    }

    // Performance queries
    if (/performance|review|rating|goal|kpi|appraisal|feedback/i.test(queryLower)) {
      if (models.PerformanceGoal) {
        const goalFilter = isAdmin ? {} : { employee: user.employeeId }
        const goals = await models.PerformanceGoal.find(goalFilter)
          .populate('employee', 'firstName lastName')
          .sort({ createdAt: -1 }).lean().limit(15)
        context.goals = goals.map(g => ({
          title: g.title, employee: g.employee ? `${g.employee.firstName} ${g.employee.lastName}` : 'Unknown',
          status: g.status, progress: g.progress, dueDate: g.dueDate
        }))
      }
    }

    // Meeting queries
    if (/meeting|calendar|schedule|call|standup|sync/i.test(queryLower)) {
      if (models.Meeting) {
        const meetFilter = isAdmin ? {} : { $or: [{ organizer: user._id }, { 'participants.user': user._id }] }
        const meetings = await models.Meeting.find(meetFilter)
          .populate('organizer', 'firstName lastName')
          .sort({ scheduledAt: -1 }).lean().limit(10)
        context.meetings = meetings.map(m => ({
          title: m.title, date: m.scheduledAt, status: m.status,
          organizer: m.organizer ? `${m.organizer.firstName} ${m.organizer.lastName}` : 'Unknown'
        }))
      }
    }

    // General/dashboard overview
    if (/dashboard|overview|summary|today|what.*happening|status|hello|hi|hey/i.test(queryLower)) {
      if (models.Attendance) {
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        if (isAdmin) {
          const presentCount = await models.Attendance.countDocuments({ date: { $gte: today }, status: { $in: ['present', 'late'] } })
          const totalEmp = models.Employee ? await models.Employee.countDocuments({ status: 'active' }) : 0
          context.overview = { presentToday: presentCount, totalEmployees: totalEmp }
        }
        const myToday = await models.Attendance.findOne({ employee: user.employeeId, date: { $gte: today } }).lean()
        context.myTodayAttendance = myToday ? {
          checkIn: myToday.checkInTime, checkOut: myToday.checkOutTime,
          status: myToday.status, workingHours: myToday.totalWorkingHours
        } : null
      }
      if (models.Task && models.TaskAssignee) {
        const myAssignments = await models.TaskAssignee.find({
          user: user.employeeId,
          assignmentStatus: { $in: ['pending', 'accepted'] }
        }).select('task').lean()
        const myTaskIds = myAssignments.map(a => a.task)
        const myPending = await models.Task.countDocuments({ _id: { $in: myTaskIds }, status: { $in: ['todo', 'in-progress'] } })
        context.myPendingTasks = myPending
      }
    }

  } catch (err) {
    console.error('[Mira Chat] Context fetch error:', err.message)
  }

  return context
}

// Build reliable data cards directly from fetched context (bypasses AI formatting)
function generateDataCards(ctx) {
  const cards = []
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : null

  const mapTaskStatus = (s) => {
    if (s === 'completed' || s === 'completed-pending-approval') return 'completed'
    if (s === 'in-progress' || s === 'review') return 'active'
    if (s === 'blocked' || s === 'rejected') return 'overdue'
    return 'pending'
  }

  const taskLink = (t) => t.projectId ? `/dashboard/projects/${t.projectId}?task=${t.id}` : '/dashboard/projects/my-tasks'

  // Tasks (admin view - all company tasks)
  if (ctx.tasks?.length > 0) {
    cards.push({
      type: 'list', title: 'Tasks',
      data: {
        items: ctx.tasks.slice(0, 12).map(t => ({
          title: t.title,
          subtitle: [t.priority, t.project, t.assignees !== 'Unassigned' ? t.assignees : null, fmtDate(t.dueDate)].filter(Boolean).join(' · '),
          status: mapTaskStatus(t.status),
          link: taskLink(t)
        }))
      }
    })
  }

  // My tasks (personal view)
  if (ctx.myTasks?.length > 0) {
    cards.push({
      type: 'list', title: 'Your Tasks',
      data: {
        items: ctx.myTasks.slice(0, 12).map(t => ({
          title: t.title,
          subtitle: [t.priority, t.project, fmtDate(t.dueDate)].filter(Boolean).join(' · '),
          status: mapTaskStatus(t.status),
          link: taskLink(t)
        }))
      }
    })
  }

  // Today attendance (admin view)
  if (ctx.todayAttendance?.length > 0) {
    cards.push({
      type: 'table', title: 'Today\'s Attendance',
      data: {
        headers: ['Employee', 'Check In', 'Check Out', 'Status', 'Hours'],
        rows: ctx.todayAttendance.slice(0, 15).map(a => [
          a.employee, a.checkIn || '-', a.checkOut || '-', a.status || '-',
          a.workingHours ? `${a.workingHours}h` : '-'
        ])
      }
    })
  }

  // My attendance
  if (ctx.myAttendance?.length > 0) {
    cards.push({
      type: 'table', title: 'Your Recent Attendance',
      data: {
        headers: ['Date', 'Check In', 'Check Out', 'Status', 'Hours'],
        rows: ctx.myAttendance.slice(0, 10).map(a => [
          fmtDate(a.date) || '-', a.checkIn || '-', a.checkOut || '-', a.status || '-',
          a.workingHours ? `${a.workingHours}h` : '-'
        ])
      }
    })
  }

  // Leaves
  if (ctx.leaves?.length > 0) {
    cards.push({
      type: 'list', title: 'Leave Requests',
      data: {
        items: ctx.leaves.slice(0, 10).map(l => ({
          title: `${l.employee} - ${l.type}`,
          subtitle: `${fmtDate(l.startDate)} to ${fmtDate(l.endDate)}${l.reason ? ` · ${l.reason}` : ''}`,
          status: l.status === 'approved' ? 'completed' : l.status === 'rejected' ? 'overdue' : 'pending',
          link: '/dashboard/leave'
        }))
      }
    })
  }

  // Leave balances
  if (ctx.leaveBalances?.length > 0) {
    cards.push({
      type: 'table', title: 'Leave Balances',
      data: {
        headers: ['Employee', 'Type', 'Total', 'Used', 'Remaining'],
        rows: ctx.leaveBalances.slice(0, 12).map(b => [
          b.employee, b.type, b.total ?? '-', b.used ?? '-', b.remaining ?? '-'
        ])
      }
    })
  }

  // Projects
  if (ctx.projects?.length > 0) {
    cards.push({
      type: 'list', title: 'Projects',
      data: {
        items: ctx.projects.slice(0, 10).map(p => ({
          title: p.name,
          subtitle: [p.head !== 'N/A' ? p.head : null, fmtDate(p.deadline), p.completion != null ? `${p.completion}%` : null].filter(Boolean).join(' · '),
          status: p.status === 'completed' ? 'completed' : p.status === 'active' ? 'active' : 'pending',
          link: '/dashboard/projects'
        }))
      }
    })
  }

  // Employees
  if (ctx.employees?.length > 0) {
    cards.push({
      type: 'table', title: 'Employees',
      data: {
        headers: ['Name', 'Code', 'Department', 'Designation'],
        rows: ctx.employees.slice(0, 15).map(e => [
          e.name, e.code || '-', e.department || '-', e.designation || '-'
        ])
      }
    })
  }

  // Announcements
  if (ctx.announcements?.length > 0) {
    cards.push({
      type: 'list', title: 'Announcements',
      data: {
        items: ctx.announcements.slice(0, 8).map(a => ({
          title: a.title,
          subtitle: [a.category, fmtDate(a.createdAt)].filter(Boolean).join(' · '),
          status: a.priority === 'high' ? 'overdue' : a.priority === 'medium' ? 'pending' : 'active'
        }))
      }
    })
  }

  // Performance goals
  if (ctx.goals?.length > 0) {
    cards.push({
      type: 'progress', title: 'Performance Goals',
      data: {
        items: ctx.goals.slice(0, 8).map(g => ({
          label: `${g.title}${g.employee ? ` - ${g.employee}` : ''}`,
          value: g.progress || 0, max: 100,
          status: g.status === 'completed' ? 'on-track' : g.status === 'overdue' ? 'overdue' : 'at-risk'
        }))
      }
    })
  }

  // Meetings
  if (ctx.meetings?.length > 0) {
    cards.push({
      type: 'list', title: 'Meetings',
      data: {
        items: ctx.meetings.slice(0, 8).map(m => ({
          title: m.title,
          subtitle: [m.organizer, fmtDate(m.date)].filter(Boolean).join(' · '),
          status: m.status === 'completed' ? 'completed' : m.status === 'cancelled' ? 'overdue' : 'active'
        }))
      }
    })
  }

  // Overview stats
  if (ctx.overview || ctx.myPendingTasks != null || ctx.myTodayAttendance) {
    const stats = []
    if (ctx.overview) {
      stats.push({ label: 'Present Today', value: String(ctx.overview.presentToday), trend: 'neutral' })
      stats.push({ label: 'Total Employees', value: String(ctx.overview.totalEmployees), trend: 'neutral' })
    }
    if (ctx.myPendingTasks != null) {
      stats.push({ label: 'Your Pending Tasks', value: String(ctx.myPendingTasks), trend: ctx.myPendingTasks > 5 ? 'up' : 'neutral' })
    }
    if (ctx.myTodayAttendance) {
      stats.push({ label: 'Today Status', value: ctx.myTodayAttendance.status || 'Not checked in', trend: 'neutral' })
    }
    if (stats.length > 0) {
      cards.push({ type: 'stat', title: 'Overview', data: { stats } })
    }
  }

  return cards
}

function isPendingTasksQuery(message = '') {
  const q = String(message || '').toLowerCase()
  return /(^|\s)\/tasks(\s|$)/i.test(q) || /\b(show|list|view|get)?\s*(my\s*)?(pending\s*)?tasks?\b/i.test(q)
}

function mapTaskToProgressStatus(task, now = new Date()) {
  const due = task?.dueDate ? new Date(task.dueDate) : null
  const isOverdue = due && !Number.isNaN(due.getTime()) && due < now
  if (isOverdue) return 'overdue'

  const priority = String(task?.priority || '').toLowerCase()
  if (['critical', 'high', 'urgent'].includes(priority)) return 'at-risk'
  return 'on-track'
}

function buildPendingTasksResponse(ctx) {
  const now = new Date()
  const allTasks = Array.isArray(ctx?.myTasks) ? ctx.myTasks : []
  const pendingStatuses = new Set(['todo', 'to-do', 'pending', 'in-progress', 'review', 'blocked'])

  const pendingTasks = allTasks.filter(t => {
    const status = String(t?.status || '').toLowerCase()
    return pendingStatuses.has(status)
  })

  const overdueCount = pendingTasks.filter(t => {
    if (!t?.dueDate) return false
    const d = new Date(t.dueDate)
    return !Number.isNaN(d.getTime()) && d < now
  }).length

  const atRiskCount = pendingTasks.filter(t => {
    const priority = String(t?.priority || '').toLowerCase()
    return ['critical', 'high', 'urgent'].includes(priority)
  }).length

  const progressItems = pendingTasks.slice(0, 8).map(t => ({
    label: t.title,
    value: Number.isFinite(t?.progress) ? t.progress : 0,
    max: 100,
    status: mapTaskToProgressStatus(t, now)
  }))

  const listItems = pendingTasks.slice(0, 8).map(t => ({
    title: t.title,
    subtitle: [t.priority, t.project, t.dueDate ? new Date(t.dueDate).toLocaleDateString('en-IN') : null].filter(Boolean).join(' · '),
    status: t.status === 'review' ? 'active' : t.status === 'blocked' ? 'overdue' : 'pending',
    link: '/dashboard/projects/my-tasks'
  }))

  const message = pendingTasks.length === 0
    ? 'You have no pending tasks right now.'
    : `You have ${pendingTasks.length} pending task${pendingTasks.length === 1 ? '' : 's'} (${overdueCount} overdue, ${atRiskCount} high priority).`

  const cards = []
  if (progressItems.length > 0) {
    cards.push({
      type: 'progress',
      title: 'Your Pending Tasks',
      data: { items: progressItems }
    })
  }
  if (listItems.length > 0) {
    cards.push({
      type: 'list',
      title: 'Task Breakdown',
      data: { items: listItems }
    })
  }
  cards.push({
    type: 'action',
    title: 'Quick Actions',
    data: {
      text: 'Open your task board to update status or unblock dependencies.',
      actions: [
        { label: 'Open My Tasks', link: '/dashboard/projects/my-tasks', variant: 'primary' }
      ]
    }
  })

  return {
    message,
    cards,
    suggestedQuestions: []
  }
}

function normalizeParsedResponse(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    return { message: 'I encountered an issue. Please try again.', cards: [], suggestedQuestions: [] }
  }

  // Some providers return the full JSON payload stringified inside `message`.
  if (typeof parsed.message === 'string') {
    const raw = parsed.message.trim()
    if (raw.startsWith('{') && raw.endsWith('}')) {
      try {
        const nested = JSON.parse(raw)
        if (nested && typeof nested === 'object' && typeof nested.message === 'string') {
          return {
            message: nested.message,
            cards: Array.isArray(nested.cards) ? nested.cards : (Array.isArray(parsed.cards) ? parsed.cards : []),
            suggestedQuestions: Array.isArray(nested.suggestedQuestions) ? nested.suggestedQuestions : (Array.isArray(parsed.suggestedQuestions) ? parsed.suggestedQuestions : [])
          }
        }
      } catch {
        // Keep original parsed payload.
      }
    }
  }

  return {
    message: typeof parsed.message === 'string' ? parsed.message : 'I encountered an issue. Please try again.',
    cards: Array.isArray(parsed.cards) ? parsed.cards : [],
    suggestedQuestions: Array.isArray(parsed.suggestedQuestions) ? parsed.suggestedQuestions : []
  }
}

export async function POST(request) {
  try {
    const { success, user, models, message: authMsg } = await getAuthAndModels(request, [
      'Employee', 'Attendance', 'Leave', 'LeaveBalance', 'LeaveType',
      'Task', 'TaskAssignee', 'Project', 'Announcement', 'Policy', 'Meeting',
      'PerformanceGoal', 'Department', 'Designation', 'MiraTokenUsage'
    ])

    if (!success) {
      return NextResponse.json({ success: false, message: authMsg }, { status: 401 })
    }

    const body = await request.json()
    const { message: userMessage, conversationHistory = [] } = body

    if (!userMessage?.trim()) {
      return NextResponse.json({ success: false, message: 'Message is required' }, { status: 400 })
    }

    // Check and deduct token
    const tokenResult = await checkAndDeductToken(models.MiraTokenUsage, user._id)
    if (!tokenResult.allowed) {
      return NextResponse.json({
        success: false,
        message: 'You have used all your Mira tokens for this month. Tokens reset on the 1st of each month.',
        tokens: tokenResult
      }, { status: 429 })
    }

    // Fetch employee data for context
    let employeeData = null
    if (user.employeeId && models.Employee) {
      employeeData = await models.Employee.findById(user.employeeId)
        .populate('department designation reportingManager')
        .lean()
    }

    const role = user.role || 'employee'

    // Fetch relevant context data based on the query
    const contextData = await fetchContextData(models, user, role, userMessage)

    // Fast path: task-list requests are deterministic and should not invoke AI.
    if (isPendingTasksQuery(userMessage)) {
      const directResponse = buildPendingTasksResponse(contextData)
      return NextResponse.json({
        success: true,
        response: directResponse,
        tokens: tokenResult
      })
    }

    // Build conversation for AI
    const systemPrompt = buildSystemPrompt(user, role, employeeData, contextData)

    // Build full conversation prompt
    let fullPrompt = ''
    if (conversationHistory.length > 0) {
      const recentHistory = conversationHistory.slice(-10) // Keep last 10 messages
      fullPrompt = recentHistory.map(msg =>
        `${msg.role === 'user' ? 'User' : 'MIRA'}: ${msg.content}`
      ).join('\n\n')
      fullPrompt += `\n\nUser: ${userMessage}`
    } else {
      fullPrompt = `User: ${userMessage}`
    }

    const aiResponse = await generateContentWithSearch(fullPrompt, systemPrompt)

    // Parse JSON response - robust extraction
    let parsed
    try {
      let jsonStr = aiResponse.trim()
      // Strip outermost markdown code fence if present (greedy to match the last ```)
      const fenceMatch = jsonStr.match(/^```(?:json)?\s*\n?([\s\S]*)\n?\s*```\s*$/)
      if (fenceMatch) {
        jsonStr = fenceMatch[1].trim()
      }
      // Try parsing directly
      parsed = JSON.parse(jsonStr)
    } catch {
      // Second attempt: find the first { ... } that parses as valid JSON containing "message"
      try {
        const braceStart = aiResponse.indexOf('{')
        const braceEnd = aiResponse.lastIndexOf('}')
        if (braceStart !== -1 && braceEnd > braceStart) {
          const candidate = aiResponse.substring(braceStart, braceEnd + 1)
          parsed = JSON.parse(candidate)
        }
      } catch { /* ignore */ }

      // If still not parsed, wrap raw text
      if (!parsed) {
        parsed = {
          message: aiResponse.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?\s*```\s*$/, ''),
          cards: [],
          suggestedQuestions: []
        }
      }
    }

    parsed = normalizeParsedResponse(parsed)

    // Auto-generate reliable data cards from context data (don't depend on AI formatting)
    const dataCards = generateDataCards(contextData)
    if (dataCards.length > 0) {
      // Keep any AI-generated alert/info/action cards but replace data cards
      const aiOnlyCards = (parsed.cards || []).filter(c => ['alert', 'action', 'info'].includes(c.type))
      parsed.cards = [...dataCards, ...aiOnlyCards]
    }

    return NextResponse.json({
      success: true,
      response: parsed,
      tokens: tokenResult
    })

  } catch (error) {
    console.error('[Mira Chat] Error:', error)
    return NextResponse.json(
      { success: false, message: 'MIRA is temporarily unavailable. Please try again.' },
      { status: 500 }
    )
  }
}
