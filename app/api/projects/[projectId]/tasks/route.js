import { NextResponse } from 'next/server'
import { verifyToken, getAuthAndModels } from '@/lib/auth'
import mongoose from 'mongoose'
import { 
  checkProjectAccess, 
  calculateCompletionPercentage,
  createTimelineEvent 
} from '@/lib/projectService'
import { notifyTaskAssigned, getProjectMemberUserIds } from '@/lib/projectNotifications'
import { emitTaskUpdate } from '@/lib/realtimeEvents'

// GET - Get tasks for a project
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
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const assignedTo = searchParams.get('assignedTo')

    const user = await User.findById(decoded.userId).select('employeeId role')
    if (!user || !user.employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    // Check access
    const isAdmin = ['admin', 'hr'].includes(user.role)
    if (!isAdmin) {
      const { hasAccess } = await checkProjectAccess(projectId, user.employeeId, 'view')
      if (!hasAccess) {
        return NextResponse.json({ success: false, message: 'Access denied' }, { status: 403 })
      }
    }

    const query = { project: projectId }
    if (status && status !== 'all') {
      query.status = status
    }
    if (!status) {
      query.status = { $ne: 'archived' }
    }

    let tasks = await Task.find(query)
      .populate('createdBy', 'firstName lastName profilePicture')
      .populate('assignedBy', 'firstName lastName')
      .populate('parentTask', 'title')
      .sort({ order: 1, createdAt: -1 })

    // Get assignees for each task
    const taskIds = tasks.map(t => t._id)
    const assignees = await TaskAssignee.find({ task: { $in: taskIds } })
      .populate('user', 'firstName lastName profilePicture employeeCode')
      .populate('assignedBy', 'firstName lastName')

    // Filter by assignee if requested
    if (assignedTo) {
      const assignedTaskIds = assignees
        .filter(a => a.user._id.toString() === assignedTo)
        .map(a => a.task.toString())
      tasks = tasks.filter(t => assignedTaskIds.includes(t._id.toString()))
    }

    // Attach assignees to tasks
    const tasksWithAssignees = tasks.map(task => ({
      ...task.toObject(),
      assignees: assignees.filter(a => a.task.toString() === task._id.toString())
    }))

    return NextResponse.json({
      success: true,
      data: tasksWithAssignees,
      currentEmployeeId: user.employeeId.toString()
    })
  } catch (error) {
    console.error('Get tasks error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}

// POST - Create a new task
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

    const user = await User.findById(decoded.userId).select('employeeId role')
    if (!user || !user.employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    const project = await Project.findById(projectId)
    if (!project) {
      return NextResponse.json({ success: false, message: 'Project not found' }, { status: 404 })
    }

    // Check if user can create tasks (must be accepted member)
    const isAdmin = ['admin'].includes(user.role)
    if (!isAdmin) {
      const { hasAccess } = await checkProjectAccess(projectId, user.employeeId, 'participate')
      if (!hasAccess) {
        return NextResponse.json({ 
          success: false, 
          message: 'You must accept the project invitation to create tasks' 
        }, { status: 403 })
      }
    }

    const body = await request.json()
    const { 
      title, 
      description, 
      priority, 
      dueDate, 
      startDate,
      assigneeIds = [],
      tags,
      estimatedHours,
      parentTask,
      subtasks = []
    } = body

    if (!title) {
      return NextResponse.json({ success: false, message: 'Task title is required' }, { status: 400 })
    }

    // Get highest order for new task
    const lastTask = await Task.findOne({ project: projectId }).sort({ order: -1 })
    const order = lastTask ? lastTask.order + 1 : 0

    // Prepare subtasks if provided - ensure each has an _id
    const formattedSubtasks = subtasks.map((st, index) => ({
      _id: new mongoose.Types.ObjectId(),
      title: st.title,
      completed: false,
      order: index,
      createdAt: new Date()
    }))

    // Calculate initial progress if subtasks exist
    const progressPercentage = formattedSubtasks.length > 0 
      ? 0 // All subtasks start incomplete
      : 0

    // Calculate dates if ETA is provided and user is assigning to themselves
    let calculatedStartDate = startDate ? new Date(startDate) : undefined
    let calculatedDueDate = dueDate ? new Date(dueDate) : undefined
    
    if (estimatedHours && assigneeIds.includes(user.employeeId.toString())) {
      calculatedStartDate = new Date()
      const workDays = Math.ceil(estimatedHours / 8)
      calculatedDueDate = new Date()
      calculatedDueDate.setDate(calculatedDueDate.getDate() + workDays)
    }

    // Create the task
    const task = await Task.create({
      project: projectId,
      title,
      description,
      status: 'todo',
      priority: priority || 'medium',
      createdBy: user.employeeId,
      assignedBy: assigneeIds.length > 0 ? user.employeeId : undefined,
      dueDate: calculatedDueDate,
      startDate: calculatedStartDate,
      tags: tags || [],
      estimatedHours,
      parentTask,
      order,
      subtasks: formattedSubtasks,
      progressPercentage
    })

    const creatorEmployee = await Employee.findById(user.employeeId)

    // Create task_created timeline event
    const taskDescription = estimatedHours && assigneeIds.includes(user.employeeId.toString())
      ? `Task "${title}" was created with ${estimatedHours}h ETA (Due: ${calculatedDueDate.toLocaleDateString()})`
      : `Task "${title}" was created`
    
    await createTimelineEvent({
      project: projectId,
      type: 'task_created',
      createdBy: user.employeeId,
      relatedTask: task._id,
      description: taskDescription,
      metadata: { taskTitle: title, priority, estimatedHours }
    })

    // Assign to users
    const assignedNames = []
    for (const assigneeId of assigneeIds) {
      const assigneeIdStr = assigneeId.toString()
      
      // Verify assignee is an accepted member
      const isMember = await ProjectMember.findOne({
        project: projectId,
        user: assigneeIdStr,
        invitationStatus: 'accepted'
      })

      if (!isMember && assigneeIdStr !== user.employeeId.toString()) {
        continue // Skip non-members
      }

      const assignee = await TaskAssignee.create({
        task: task._id,
        user: assigneeIdStr,
        assignedBy: user.employeeId,
        assignmentStatus: assigneeIdStr === user.employeeId.toString() ? 'accepted' : 'pending'
      })

      const assigneeEmployee = await Employee.findById(assigneeIdStr)
      assignedNames.push(`${assigneeEmployee.firstName} ${assigneeEmployee.lastName}`)

      // Create task_assigned timeline event
      await createTimelineEvent({
        project: projectId,
        type: 'task_assigned',
        createdBy: user.employeeId,
        relatedTask: task._id,
        relatedMember: assigneeIdStr,
        description: `Task "${title}" was assigned to ${assigneeEmployee.firstName} ${assigneeEmployee.lastName}`,
        metadata: { taskTitle: title, assigneeName: `${assigneeEmployee.firstName} ${assigneeEmployee.lastName}` }
      })

      // Send notification if not self-assignment
      if (assigneeIdStr !== user.employeeId.toString()) {
        await notifyTaskAssigned(project, task, assigneeEmployee, creatorEmployee)
      }
    }

    // Recalculate project completion percentage
    await calculateCompletionPercentage(projectId)

    // Fetch populated task
    const populatedTask = await Task.findById(task._id)
      .populate('createdBy', 'firstName lastName profilePicture')
      .populate('assignedBy', 'firstName lastName')

    const taskAssignees = await TaskAssignee.find({ task: task._id })
      .populate('user', 'firstName lastName profilePicture employeeCode')

    // Emit real-time task creation to all project members
    try {
      const memberUserIds = await getProjectMemberUserIds(projectId)
      
      emitTaskUpdate(
        {
          _id: task._id,
          title: task.title,
          status: task.status,
          priority: task.priority,
          project: projectId,
          createdBy: populatedTask.createdBy,
          assignees: taskAssignees.map(a => ({ _id: a.user._id, firstName: a.user.firstName, lastName: a.user.lastName })),
          dueDate: task.dueDate
        },
        memberUserIds.map(id => id.toString()),
        { isNew: true, action: 'create' }
      )
    } catch (emitError) {
      console.error('Failed to emit task update:', emitError)
    }

    return NextResponse.json({
      success: true,
      message: 'Task created successfully',
      data: {
        ...populatedTask.toObject(),
        assignees: taskAssignees
      }
    }, { status: 201 })
  } catch (error) {
    console.error('Create task error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
