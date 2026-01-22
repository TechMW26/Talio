import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { createTimelineEvent } from '@/lib/projectService'
import { notifyTaskStatusChanged, getProjectMemberUserIds } from '@/lib/projectNotifications'
import { emitTaskUpdate } from '@/lib/realtimeEvents'

/**
 * POST - Advance a project task status from "todo" to "in-progress"
 * This is called when a user marks a project task as started from the personal todo page
 */
export async function POST(request, { params }) {
  try {
    const auth = await getAuthAndModels(request, ['Task', 'TaskAssignee', 'User', 'Employee', 'Project'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }

    const { user, models } = auth
    const { Task, TaskAssignee, User, Employee, Project } = models
    const { taskId } = await params

    // Get user's employee record
    const userRecord = await User.findById(user._id || user.userId).select('employeeId role')
    if (!userRecord || !userRecord.employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    // Find the task
    const task = await Task.findById(taskId).populate('project', 'name projectHead')
    if (!task) {
      return NextResponse.json({ success: false, message: 'Task not found' }, { status: 404 })
    }

    // Check if user is an accepted assignee
    const userAssignment = await TaskAssignee.findOne({
      task: taskId,
      user: userRecord.employeeId,
      assignmentStatus: 'accepted'
    })

    if (!userAssignment) {
      return NextResponse.json({ 
        success: false, 
        message: 'You are not assigned to this task' 
      }, { status: 403 })
    }

    // Check if task is in "todo" status
    if (task.status !== 'todo') {
      return NextResponse.json({ 
        success: false, 
        message: 'Task is not in todo status' 
      }, { status: 400 })
    }

    const oldStatus = task.status
    const newStatus = 'in-progress'

    // Update task status to in-progress
    await Task.findByIdAndUpdate(taskId, { 
      status: newStatus,
      startDate: task.startDate || new Date() // Set start date if not already set
    })

    // Get employee details for timeline
    const updaterEmployee = await Employee.findById(userRecord.employeeId)
    const updaterName = updaterEmployee 
      ? `${updaterEmployee.firstName} ${updaterEmployee.lastName}` 
      : 'Unknown'

    // Create timeline event
    try {
      await createTimelineEvent({
        project: task.project._id,
        type: 'task_status_changed',
        createdBy: userRecord.employeeId,
        relatedTask: taskId,
        description: `Task "${task.title}" started by ${updaterName}`,
        metadata: { 
          taskTitle: task.title, 
          oldStatus, 
          newStatus,
          changedBy: {
            employeeId: userRecord.employeeId,
            name: updaterName
          }
        }
      }, models)
    } catch (e) {
      console.error('Failed to create timeline event:', e)
    }

    // Send notifications
    try {
      const memberUserIds = await getProjectMemberUserIds(task.project._id, userRecord.employeeId, models)
      await notifyTaskStatusChanged(
        task.project._id,
        task,
        oldStatus,
        newStatus,
        userRecord.employeeId,
        memberUserIds,
        models
      )
    } catch (e) {
      console.error('Failed to send notifications:', e)
    }

    // Emit real-time update
    try {
      await emitTaskUpdate(task.project._id.toString(), taskId, 'status_changed', {
        oldStatus,
        newStatus,
        changedBy: userRecord.employeeId
      })
    } catch (e) {
      console.error('Failed to emit task update:', e)
    }

    return NextResponse.json({
      success: true,
      message: 'Task started successfully',
      data: {
        _id: task._id,
        title: task.title,
        status: newStatus,
        project: task.project
      }
    })
  } catch (error) {
    console.error('Advance task status error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
