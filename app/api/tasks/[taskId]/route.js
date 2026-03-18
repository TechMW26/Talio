import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// GET - Get single standalone task details
export async function GET(request, { params }) {
  try {
    const auth = await getAuthAndModels(request, ['Task', 'TaskAssignee', 'User', 'Employee'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Task, TaskAssignee, User } = models

    const { taskId } = await params

    const userRecord = await User.findById(user._id || user.userId).select('employeeId role')
    if (!userRecord || !userRecord.employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    const task = await Task.findById(taskId)
      .populate('project', 'name status projectHead')
      .populate('createdBy', 'firstName lastName profilePicture')
      .populate('assignedBy', 'firstName lastName')

    if (!task) {
      return NextResponse.json({ success: false, message: 'Task not found' }, { status: 404 })
    }

    const assignees = await TaskAssignee.find({ task: taskId })
      .populate('user', 'firstName lastName profilePicture employeeCode email')
      .populate('assignedBy', 'firstName lastName')

    const userAssignment = assignees.find(a =>
      a.user._id.toString() === userRecord.employeeId.toString()
    )

    return NextResponse.json({
      success: true,
      data: {
        ...task.toObject(),
        assignees,
        isAssignee: !!userAssignment,
        userAssignmentStatus: userAssignment?.assignmentStatus,
        isCreator: task.createdBy._id.toString() === userRecord.employeeId.toString()
      }
    })
  } catch (error) {
    console.error('Get standalone task error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}

// PUT - Update standalone task
export async function PUT(request, { params }) {
  try {
    const auth = await getAuthAndModels(request, ['Task', 'TaskAssignee', 'User', 'Employee'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Task, TaskAssignee, User, Employee } = models

    const { taskId } = await params

    const userRecord = await User.findById(user._id || user.userId).select('employeeId role')
    if (!userRecord || !userRecord.employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    const task = await Task.findById(taskId)
    if (!task) {
      return NextResponse.json({ success: false, message: 'Task not found' }, { status: 404 })
    }

    // For standalone tasks, if it has a project, reject - use project route instead
    if (task.project) {
      return NextResponse.json({
        success: false,
        message: 'This task belongs to a project. Use the project task API instead.'
      }, { status: 400 })
    }

    // Check permissions: admin, creator, or accepted assignee
    const isAdmin = ['admin'].includes(userRecord.role || user.role)
    const isCreator = task.createdBy.toString() === userRecord.employeeId.toString()
    const isAssigner = task.assignedBy?.toString() === userRecord.employeeId.toString()
    const userAssignment = await TaskAssignee.findOne({
      task: taskId,
      user: userRecord.employeeId,
      assignmentStatus: 'accepted'
    })
    const isAssignedAndAccepted = !!userAssignment

    const canUpdate = isAdmin || isCreator || isAssigner || isAssignedAndAccepted
    if (!canUpdate) {
      return NextResponse.json({
        success: false,
        message: 'You do not have permission to update this task'
      }, { status: 403 })
    }

    const body = await request.json()
    const {
      title, description, status, priority,
      dueDate, startDate, tags, estimatedHours,
      actualHours, order, subtasks, statusChangeReason
    } = body

    // For status changes, only assigned person or admin/creator can update
    if (status && status !== task.status) {
      if (!isAssignedAndAccepted && !isAdmin && !isCreator && !isAssigner) {
        return NextResponse.json({
          success: false,
          message: 'Only the assigned person or task creator can update task status'
        }, { status: 403 })
      }
    }

    const updates = {}
    const oldStatus = task.status

    if (title && title !== task.title) updates.title = title
    if (description !== undefined && description !== task.description) updates.description = description
    if (status && status !== task.status) {
      // For standalone tasks: creator/assigner can complete directly (no approval workflow)
      if (status === 'completed' && (isCreator || isAssigner || isAdmin)) {
        updates.status = 'completed'
        updates.completedAt = new Date()
      } else if (status === 'completed' && isAssignedAndAccepted) {
        // Assignee marks complete → goes to review for the creator
        updates.status = 'review'
      } else {
        updates.status = status
        if (status === 'completed') updates.completedAt = new Date()
      }
    }
    if (priority && priority !== task.priority) updates.priority = priority
    if (dueDate !== undefined) updates.dueDate = dueDate ? new Date(dueDate) : null
    if (startDate !== undefined) updates.startDate = startDate ? new Date(startDate) : null
    if (tags) updates.tags = tags
    if (estimatedHours !== undefined) updates.estimatedHours = estimatedHours
    if (actualHours !== undefined) updates.actualHours = actualHours
    if (order !== undefined) updates.order = order

    // Handle subtasks updates
    if (subtasks !== undefined) {
      const processedSubtasks = subtasks.map(st => {
        if (st.isNew || (st._id && st._id.toString().startsWith('new-'))) {
          return {
            title: st.title,
            completed: st.completed || false,
            estimatedDays: parseInt(st.estimatedDays) || 0,
            estimatedHours: parseInt(st.estimatedHours) || 0,
            order: st.order || 0,
            createdAt: new Date()
          }
        }
        return {
          _id: st._id,
          title: st.title,
          completed: st.completed || false,
          completedAt: st.completedAt,
          completedBy: st.completedBy,
          estimatedDays: parseInt(st.estimatedDays) || 0,
          estimatedHours: parseInt(st.estimatedHours) || 0,
          order: st.order || 0,
          createdAt: st.createdAt
        }
      })

      updates.subtasks = processedSubtasks

      const completedCount = processedSubtasks.filter(st => st.completed).length
      updates.progressPercentage = processedSubtasks.length > 0
        ? Math.round((completedCount / processedSubtasks.length) * 100)
        : 0
    }

    await Task.findByIdAndUpdate(taskId, updates)

    const updatedTask = await Task.findById(taskId)
      .populate('createdBy', 'firstName lastName profilePicture')
      .populate('assignedBy', 'firstName lastName')

    return NextResponse.json({
      success: true,
      message: 'Task updated successfully',
      data: updatedTask
    })
  } catch (error) {
    console.error('Update standalone task error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}

// DELETE - Delete standalone task
export async function DELETE(request, { params }) {
  try {
    const auth = await getAuthAndModels(request, ['Task', 'TaskAssignee', 'User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Task, TaskAssignee, User } = models

    const { taskId } = await params

    const userRecord = await User.findById(user._id || user.userId).select('employeeId role')
    if (!userRecord || !userRecord.employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    const task = await Task.findById(taskId)
    if (!task) {
      return NextResponse.json({ success: false, message: 'Task not found' }, { status: 404 })
    }

    if (task.project) {
      return NextResponse.json({
        success: false,
        message: 'This task belongs to a project. Use the project task API instead.'
      }, { status: 400 })
    }

    const isAdmin = ['admin'].includes(userRecord.role || user.role)
    const isCreator = task.createdBy.toString() === userRecord.employeeId.toString()
    const isAssigner = task.assignedBy?.toString() === userRecord.employeeId.toString()

    // Admin, creator, or assigner can delete standalone tasks immediately
    if (isAdmin || isCreator || isAssigner) {
      await TaskAssignee.deleteMany({ task: taskId })
      await Task.findByIdAndDelete(taskId)

      return NextResponse.json({
        success: true,
        message: 'Task deleted successfully'
      })
    }

    // Assignees can request deletion
    const isAssignee = await TaskAssignee.findOne({
      task: taskId,
      user: userRecord.employeeId,
      assignmentStatus: 'accepted'
    })

    if (!isAssignee) {
      return NextResponse.json({
        success: false,
        message: 'You do not have permission to delete this task'
      }, { status: 403 })
    }

    if (task.deletionRequest && task.deletionRequest.status === 'pending') {
      return NextResponse.json({
        success: false,
        message: 'A deletion request is already pending for this task'
      }, { status: 400 })
    }

    const { searchParams } = new URL(request.url)
    const reason = searchParams.get('reason') || 'No reason provided'

    task.deletionRequest = {
      status: 'pending',
      requestedBy: userRecord.employeeId,
      requestedAt: new Date(),
      reason
    }
    await task.save()

    return NextResponse.json({
      success: true,
      message: 'Deletion request submitted. Awaiting approval from task creator.'
    })
  } catch (error) {
    console.error('Delete standalone task error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
