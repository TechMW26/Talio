import { NextResponse } from 'next/server'
import { verifyToken, getAuthAndModels } from '@/lib/auth'
import { createTimelineEvent } from '@/lib/projectService'
import { 
  notifyTaskAssigned,
  notifyTaskAssignmentAccepted,
  notifyTaskAssignmentRejected
} from '@/lib/projectNotifications'

// GET - Get assignees for a task
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

    const { projectId, taskId } = await params

    const assignees = await TaskAssignee.find({ task: taskId })
      .populate('user', 'firstName lastName profilePicture employeeCode email')
      .populate('assignedBy', 'firstName lastName')
      .sort({ createdAt: 1 })

    return NextResponse.json({
      success: true,
      data: assignees
    })
  } catch (error) {
    console.error('Get assignees error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}

// POST - Assign task to users
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

    const { projectId, taskId } = await params

    const user = await User.findById(decoded.userId).select('employeeId role')
    if (!user || !user.employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    const task = await Task.findById(taskId)
    if (!task || task.project.toString() !== projectId) {
      return NextResponse.json({ success: false, message: 'Task not found' }, { status: 404 })
    }

    const project = await Project.findById(projectId)
    if (!project) {
      return NextResponse.json({ success: false, message: 'Project not found' }, { status: 404 })
    }

    // Check if user can assign tasks
    const isAdmin = ['admin'].includes(user.role)
    const membership = await ProjectMember.findOne({
      project: projectId,
      user: user.employeeId,
      invitationStatus: 'accepted'
    })

    if (!isAdmin && !membership) {
      return NextResponse.json({ 
        success: false, 
        message: 'You must be an accepted member to assign tasks' 
      }, { status: 403 })
    }

    const body = await request.json()
    const { assigneeIds } = body

    if (!assigneeIds || !Array.isArray(assigneeIds) || assigneeIds.length === 0) {
      return NextResponse.json({ 
        success: false, 
        message: 'At least one assignee is required' 
      }, { status: 400 })
    }

    const assignerEmployee = await Employee.findById(user.employeeId)
    const createdAssignees = []

    for (const assigneeId of assigneeIds) {
      const assigneeIdStr = assigneeId.toString()
      
      // Check if already assigned
      const existingAssignment = await TaskAssignee.findOne({
        task: taskId,
        user: assigneeIdStr
      })

      if (existingAssignment) {
        continue // Skip existing assignees
      }

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
        task: taskId,
        user: assigneeIdStr,
        assignedBy: user.employeeId,
        assignmentStatus: assigneeIdStr === user.employeeId.toString() ? 'accepted' : 'pending'
      })

      const assigneeEmployee = await Employee.findById(assigneeIdStr)

      // Create timeline event
      await createTimelineEvent({
        project: projectId,
        type: 'task_assigned',
        createdBy: user.employeeId,
        relatedTask: taskId,
        relatedMember: assigneeIdStr,
        description: `Task "${task.title}" was assigned to ${assigneeEmployee.firstName} ${assigneeEmployee.lastName}`,
        metadata: { 
          taskTitle: task.title, 
          assigneeName: `${assigneeEmployee.firstName} ${assigneeEmployee.lastName}` 
        }
      })

      // Send notification if not self-assignment
      if (assigneeIdStr !== user.employeeId.toString()) {
        await notifyTaskAssigned(project, task, assigneeEmployee, assignerEmployee)
      }

      createdAssignees.push(assignee)
    }

    // Update task's assignedBy if not set
    if (!task.assignedBy) {
      task.assignedBy = user.employeeId
      await task.save()
    }

    // Fetch all assignees
    const allAssignees = await TaskAssignee.find({ task: taskId })
      .populate('user', 'firstName lastName profilePicture employeeCode')
      .populate('assignedBy', 'firstName lastName')

    return NextResponse.json({
      success: true,
      message: `${createdAssignees.length} assignee(s) added successfully`,
      data: allAssignees
    })
  } catch (error) {
    console.error('Assign task error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}

// DELETE - Remove assignee from task
export async function DELETE(request, { params }) {
  try {
    const token = request.headers.get('authorization')?.split(' ')[1]
    if (!token) {
      return NextResponse.json({ success: false, message: 'No token provided' }, { status: 401 })
    }

    const decoded = await verifyToken(token)
    if (!decoded) {
      return NextResponse.json({ success: false, message: 'Invalid token' }, { status: 401 })
    }

    const { projectId, taskId } = await params
    const { searchParams } = new URL(request.url)
    const assigneeId = searchParams.get('assigneeId')

    if (!assigneeId) {
      return NextResponse.json({ success: false, message: 'Assignee ID is required' }, { status: 400 })
    }

    const user = await User.findById(decoded.userId).select('employeeId role')
    if (!user || !user.employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    const task = await Task.findById(taskId)
    if (!task || task.project.toString() !== projectId) {
      return NextResponse.json({ success: false, message: 'Task not found' }, { status: 404 })
    }

    const project = await Project.findById(projectId)
    if (!project) {
      return NextResponse.json({ success: false, message: 'Project not found' }, { status: 404 })
    }

    const assignment = await TaskAssignee.findById(assigneeId).populate('user')
    if (!assignment || assignment.task.toString() !== taskId) {
      return NextResponse.json({ success: false, message: 'Assignment not found' }, { status: 404 })
    }

    // Check permission
    const isAdmin = ['admin'].includes(user.role)
    const isCreator = task.createdBy.toString() === user.employeeId.toString()
    const isProjectHead = project.projectHead.toString() === user.employeeId.toString()
    const isAssigner = assignment.assignedBy.toString() === user.employeeId.toString()
    const isSelf = assignment.user._id.toString() === user.employeeId.toString()

    if (!isAdmin && !isCreator && !isProjectHead && !isAssigner && !isSelf) {
      return NextResponse.json({ 
        success: false, 
        message: 'You do not have permission to remove this assignee' 
      }, { status: 403 })
    }

    await TaskAssignee.findByIdAndDelete(assigneeId)

    await createTimelineEvent({
      project: projectId,
      type: 'task_assigned',
      createdBy: user.employeeId,
      relatedTask: taskId,
      relatedMember: assignment.user._id,
      description: `${assignment.user.firstName} ${assignment.user.lastName} was unassigned from task "${task.title}"`,
      metadata: { taskTitle: task.title, action: 'unassigned' }
    })

    return NextResponse.json({
      success: true,
      message: 'Assignee removed successfully'
    })
  } catch (error) {
    console.error('Remove assignee error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
