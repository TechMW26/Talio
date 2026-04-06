import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// GET - Get filtered tasks for a team member
export async function GET(request, { params }) {
  try {
    const auth = await getAuthAndModels(request, ['Employee', 'Department', 'User', 'Task', 'TaskAssignee', 'Project', 'Team'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Employee, Department, User, Task, TaskAssignee, Project, Team } = models

    const { id } = await params

    // --- Access check (same as member detail API) ---
    const userRecord = await User.findById(user._id || user.userId)
      .select('employeeId isDepartmentHead headOfDepartments teamLeaderOf')
      .lean()

    if (!userRecord || !userRecord.employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    let departmentIds = []
    if (userRecord?.isDepartmentHead && userRecord?.headOfDepartments?.length > 0) {
      departmentIds = userRecord.headOfDepartments.map(d => d.toString())
    }
    if (departmentIds.length === 0) {
      const headDepartments = await Department.find({
        isActive: true,
        $or: [{ head: userRecord.employeeId }, { heads: userRecord.employeeId }]
      }).select('_id').lean()
      departmentIds = headDepartments.map(d => d._id.toString())
    }

    let hasAccess = false
    if (departmentIds.length > 0) {
      const teamMember = await Employee.findById(id).select('department').lean()
      const memberDeptId = teamMember?.department?.toString()
      hasAccess = departmentIds.includes(memberDeptId)
      if (!hasAccess) {
        const deptWhereHead = await Department.findOne({
          _id: { $in: departmentIds },
          isActive: true,
          $or: [{ head: id }, { heads: id }]
        }).lean()
        if (deptWhereHead) hasAccess = true
      }
    }

    if (!hasAccess && Team) {
      if (userRecord.teamLeaderOf?.length > 0) {
        const leaderTeams = await Team.find({
          _id: { $in: userRecord.teamLeaderOf },
          isActive: true,
          $or: [{ members: id }, { teamLeaders: id }]
        }).select('_id').lean()
        if (leaderTeams.length > 0) hasAccess = true
      }
    }

    if (!hasAccess) {
      return NextResponse.json({ success: false, message: 'Access denied' }, { status: 403 })
    }

    // --- Parse filters ---
    const { searchParams } = new URL(request.url)
    const month = parseInt(searchParams.get('month')) // 0-indexed
    const year = parseInt(searchParams.get('year'))
    const status = searchParams.get('status') // 'all' or specific status
    const projectId = searchParams.get('projectId') // 'all' or specific project ID
    const assignedById = searchParams.get('assignedById') // 'all' or specific employee ID

    // Build date range for the month
    const now = new Date()
    const filterYear = !isNaN(year) ? year : now.getFullYear()
    const filterMonth = !isNaN(month) ? month : now.getMonth()
    const monthStart = new Date(filterYear, filterMonth, 1)
    const monthEnd = new Date(filterYear, filterMonth + 1, 0, 23, 59, 59, 999)

    // Get all task assignments for this employee (include assignment status)
    const taskAssignments = await TaskAssignee.find({ user: id })
      .select('task assignmentStatus assignedAt')
      .lean()
    const taskIds = taskAssignments.map(ta => ta.task)

    // Build assignment status lookup
    const assignmentMap = {}
    taskAssignments.forEach(ta => {
      assignmentMap[ta.task.toString()] = {
        assignmentStatus: ta.assignmentStatus,
        assignedAt: ta.assignedAt
      }
    })

    // Build task query - match tasks where createdAt OR dueDate OR assignedAt falls in the month
    // First get all tasks, then filter by date range including assignment date
    const baseTaskQuery = { _id: { $in: taskIds } }

    if (status && status !== 'all') {
      baseTaskQuery.status = status
    }

    if (projectId && projectId !== 'all') {
      if (projectId === 'standalone') {
        baseTaskQuery.project = { $exists: false }
      } else {
        baseTaskQuery.project = projectId
      }
    }

    if (assignedById && assignedById !== 'all') {
      baseTaskQuery.assignedBy = assignedById
    }

    // Use $or to match tasks relevant to this month by any date field
    // Incomplete tasks carry over from previous months until completed
    baseTaskQuery.$or = [
      // Tasks created in this month
      { createdAt: { $gte: monthStart, $lte: monthEnd } },
      // Tasks with due date in this month
      { dueDate: { $gte: monthStart, $lte: monthEnd } },
      // Carry-over: incomplete tasks created on or before this month (not yet completed)
      { status: { $nin: ['completed'] }, createdAt: { $lte: monthEnd } },
      // Tasks completed during this month (show in the month they were finished)
      { status: 'completed', updatedAt: { $gte: monthStart, $lte: monthEnd } },
    ]

    // Fetch tasks
    const tasks = await Task.find(baseTaskQuery)
      .populate('project', 'name')
      .populate('assignedBy', 'firstName lastName')
      .populate('createdBy', 'firstName lastName')
      .sort({ createdAt: -1 })
      .lean()

    // Enrich tasks with assignment status
    const enrichedTasks = tasks.map(t => ({
      ...t,
      assignmentStatus: assignmentMap[t._id.toString()]?.assignmentStatus || 'unknown',
      assignedAt: assignmentMap[t._id.toString()]?.assignedAt
    }))

    // Get unique projects and assigners for filter options
    const allTaskIds = taskAssignments.map(ta => ta.task)
    const [allProjects, allAssigners] = await Promise.all([
      Task.distinct('project', { _id: { $in: allTaskIds }, project: { $exists: true, $ne: null } }),
      Task.distinct('assignedBy', { _id: { $in: allTaskIds }, assignedBy: { $exists: true, $ne: null } })
    ])

    const [projectOptions, assignerOptions] = await Promise.all([
      Project.find({ _id: { $in: allProjects } }).select('name').lean(),
      Employee.find({ _id: { $in: allAssigners } }).select('firstName lastName').lean()
    ])

    // Stats for the current filtered month
    const stats = {
      total: enrichedTasks.length,
      todo: enrichedTasks.filter(t => t.status === 'todo').length,
      inProgress: enrichedTasks.filter(t => t.status === 'in-progress').length,
      review: enrichedTasks.filter(t => t.status === 'review' || t.status === 'completed-pending-approval').length,
      completed: enrichedTasks.filter(t => t.status === 'completed').length,
      blocked: enrichedTasks.filter(t => t.status === 'blocked').length,
      pendingAcceptance: enrichedTasks.filter(t => t.assignmentStatus === 'pending').length
    }

    return NextResponse.json({
      success: true,
      data: {
        tasks: enrichedTasks,
        stats,
        filterOptions: {
          projects: projectOptions,
          assigners: assignerOptions
        }
      }
    })
  } catch (error) {
    console.error('Error fetching member tasks:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
