import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { createTimelineEvent } from '@/lib/projectService'
import { queueTaskStatusChangedEmailNotifications } from '@/lib/projectEmailNotifications'

// POST - Approve or reject task completion
export async function POST(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Project', 'Task', 'TaskAssignee', 'ProjectApprovalRequest', 'User', 'Employee', 'ProjectTimelineEvent', 'ProjectMember', 'ProjectEmailNotificationLog'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Project, Task, ProjectApprovalRequest, User, Employee } = models

    const { requestId } = await params
    const body = await request.json()
    const { action, comment } = body // action: 'approve' or 'reject'

    const userRecord = await User.findById(user._id || user.userId).select('employeeId role')
    if (!userRecord || !userRecord.employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    const approvalRequest = await ProjectApprovalRequest.findById(requestId)
      .populate('project', 'name projectHeads projectHead')
      .populate('relatedTask', 'title status')
      .populate('requestedBy', 'firstName lastName')

    if (!approvalRequest) {
      return NextResponse.json({ success: false, message: 'Approval request not found' }, { status: 404 })
    }

    if (approvalRequest.status !== 'pending') {
      return NextResponse.json({ success: false, message: 'This request has already been processed' }, { status: 400 })
    }

    // Check if user is a project head (support both old and new structure)
    const project = approvalRequest.project
    const projectHeadIds = project.projectHeads && project.projectHeads.length > 0
      ? project.projectHeads.map(h => h.toString())
      : project.projectHead
        ? [project.projectHead.toString()]
        : []

    const isProjectHead = projectHeadIds.includes(userRecord.employeeId.toString())
    const isAdmin = ['admin'].includes(userRecord.role || user.role)

    if (!isProjectHead && !isAdmin) {
      return NextResponse.json({ success: false, message: 'Only project heads can approve this request' }, { status: 403 })
    }

    const employee = await Employee.findById(userRecord.employeeId)

    if (action === 'approve') {
      // Approve the task completion
      approvalRequest.status = 'approved'
      approvalRequest.reviewedBy = userRecord.employeeId
      approvalRequest.reviewedAt = new Date()
      approvalRequest.reviewerComment = comment || ''
      await approvalRequest.save()

      // Update task status to completed
      const task = await Task.findById(approvalRequest.relatedTask._id)
      if (task) {
        const oldStatus = task.status
        task.status = 'completed'
        task.completedAt = new Date()
        await task.save()

        // Create timeline event
        await createTimelineEvent({
          project: project._id,
          type: 'task_completed',
          createdBy: userRecord.employeeId,
          relatedTask: task._id,
          description: `Task "${task.title}" approved as completed by ${employee.firstName} ${employee.lastName}`,
          metadata: {
            taskTitle: task.title,
            approvedBy: userRecord.employeeId,
            approverName: `${employee.firstName} ${employee.lastName}`
          }
        }, models)

        // Recalculate project completion percentage
        const { calculateCompletionPercentage } = await import('@/lib/projectService')
        await calculateCompletionPercentage(project._id, models)

        try {
          await queueTaskStatusChangedEmailNotifications({
            projectId: project._id,
            taskId: task._id,
            oldStatus,
            newStatus: task.status,
            changedByEmployeeId: userRecord.employeeId,
            triggeredByUserId: user._id || user.userId || null,
            eventTimestamp: task.updatedAt || new Date(),
            models,
          })
        } catch (emailError) {
          console.error('Failed to queue approved task completion emails:', emailError)
        }
      }

      return NextResponse.json({
        success: true,
        message: 'Task completion approved successfully',
        data: approvalRequest
      })
    } else if (action === 'reject') {
      // Reject the completion
      approvalRequest.status = 'rejected'
      approvalRequest.reviewedBy = user.employeeId
      approvalRequest.reviewedAt = new Date()
      approvalRequest.reviewerComment = comment || ''
      await approvalRequest.save()

      // Update task status back to in-progress or review
      const task = await Task.findById(approvalRequest.relatedTask._id)
      if (task) {
        const oldStatus = task.status
        task.status = 'in-progress'
        await task.save()

        // Create timeline event
        await createTimelineEvent({
          project: project._id,
          type: 'task_completion_rejected',
          createdBy: userRecord.employeeId,
          relatedTask: task._id,
          description: `Task "${task.title}" completion rejected by ${employee.firstName} ${employee.lastName}`,
          metadata: {
            taskTitle: task.title,
            rejectedBy: userRecord.employeeId,
            rejectorName: `${employee.firstName} ${employee.lastName}`,
            reason: comment || 'No reason provided'
          }
        }, models)

        try {
          await queueTaskStatusChangedEmailNotifications({
            projectId: project._id,
            taskId: task._id,
            oldStatus,
            newStatus: task.status,
            changedByEmployeeId: userRecord.employeeId,
            triggeredByUserId: user._id || user.userId || null,
            eventTimestamp: task.updatedAt || new Date(),
            models,
          })
        } catch (emailError) {
          console.error('Failed to queue rejected task completion emails:', emailError)
        }
      }

      return NextResponse.json({
        success: true,
        message: 'Task completion rejected',
        data: approvalRequest
      })
    } else {
      return NextResponse.json({ success: false, message: 'Invalid action' }, { status: 400 })
    }
  } catch (error) {
    console.error('Task completion approval error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
