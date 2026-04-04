import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { dismissNotificationsForReference } from '@/lib/actionableNotifications'
import { emitEvent, EVENTS } from '@/lib/eventBus'

export const dynamic = 'force-dynamic'

// POST - Respond to standalone task assignment (accept/reject)
export async function POST(request, { params }) {
  try {
    const auth = await getAuthAndModels(request, ['Task', 'TaskAssignee', 'User', 'Employee', 'ActionableNotification'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Task, TaskAssignee, User, Employee } = models

    const { taskId } = await params

    const userRecord = await User.findById(user._id || user.userId).select('employeeId')
    if (!userRecord || !userRecord.employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    const body = await request.json()
    const { action, reason, estimatedHours } = body

    if (!action || !['accept', 'reject'].includes(action)) {
      return NextResponse.json({
        success: false,
        message: 'Valid action (accept/reject) is required'
      }, { status: 400 })
    }

    const task = await Task.findById(taskId)
    if (!task) {
      return NextResponse.json({ success: false, message: 'Task not found' }, { status: 404 })
    }

    // Find the assignment for current user
    const assignment = await TaskAssignee.findOne({
      task: taskId,
      user: userRecord.employeeId
    })

    if (!assignment) {
      return NextResponse.json({
        success: false,
        message: 'You are not assigned to this task'
      }, { status: 404 })
    }

    if (assignment.assignmentStatus !== 'pending') {
      return NextResponse.json({
        success: false,
        message: 'Assignment has already been responded to'
      }, { status: 400 })
    }

    const accept = action === 'accept'

    assignment.assignmentStatus = accept ? 'accepted' : 'rejected'
    assignment.respondedAt = new Date()
    if (!accept && reason) {
      assignment.rejectionReason = reason
    }
    await assignment.save()

    // If accepting, update task with estimated hours and start date
    if (accept && estimatedHours && estimatedHours > 0) {
      const updates = { estimatedHours }
      const startDate = new Date()
      const workDays = Math.ceil(estimatedHours / 8)
      const completionDate = new Date(startDate)
      completionDate.setDate(completionDate.getDate() + workDays)

      if (!task.startDate) updates.startDate = startDate
      if (!task.dueDate) updates.dueDate = completionDate

      await Task.findByIdAndUpdate(taskId, updates)
    }

    // Dismiss actionable notifications for this task
    try {
      await dismissNotificationsForReference(models, 'Task', taskId)
    } catch (dismissErr) {
      console.error('[StandaloneTaskRespond] Error dismissing notifications:', dismissErr)
    }

    try {
      await emitEvent(EVENTS.TASK_ASSIGNMENT_CHANGED, {
        taskId,
        taskTitle: task.title,
        action: accept ? 'accepted' : 'rejected',
      }, {
        userIds: [(user._id || user.userId).toString()],
        databaseName: auth.tenant?.databaseName,
      })
    } catch (eventBusErr) {
      console.error('[StandaloneTaskRespond] Error emitting cache invalidation event:', eventBusErr)
    }

    return NextResponse.json({
      success: true,
      message: accept ? 'Task accepted' : 'Task rejected'
    })
  } catch (error) {
    console.error('Respond to standalone task assignment error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
