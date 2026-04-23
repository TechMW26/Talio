import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { createTimelineEvent, calculateCompletionPercentage } from '@/lib/projectService'
import { notifyTaskReviewRejected } from '@/lib/projectNotifications'
import {
  queueProjectStatusChangedEmailNotifications,
  queueTaskStatusChangedEmailNotifications,
} from '@/lib/projectEmailNotifications'
import { sendEmail, emailTemplates } from '@/lib/mailer'

// PUT - Approve or reject a request
export async function PUT(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Project', 'Task', 'TaskAssignee', 'ProjectApprovalRequest', 'User', 'Employee', 'ProjectTimelineEvent', 'ProjectMember', 'ProjectEmailNotificationLog'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Project, Task, TaskAssignee, ProjectApprovalRequest, User, Employee } = models

    const { requestId } = await params

    const userDoc = await User.findById(user._id || user.userId).select('employeeId role')
    if (!userDoc || !userDoc.employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    const approvalRequest = await ProjectApprovalRequest.findById(requestId)
      .populate('relatedTask')

    if (!approvalRequest) {
      return NextResponse.json({ success: false, message: 'Request not found' }, { status: 404 })
    }

    if (approvalRequest.status !== 'pending') {
      return NextResponse.json({
        success: false,
        message: 'This request has already been processed'
      }, { status: 400 })
    }

    const project = await Project.findById(approvalRequest.project)
    if (!project) {
      return NextResponse.json({ success: false, message: 'Project not found' }, { status: 404 })
    }

    // Only project head(s) or admin can approve
    const isAdmin = ['admin'].includes(userDoc.role)
    const projectHeadIds = project.projectHeads && project.projectHeads.length > 0
      ? project.projectHeads.map(h => h.toString())
      : project.projectHead
        ? [project.projectHead.toString()]
        : []
    const isProjectHead = projectHeadIds.includes(userDoc.employeeId.toString())

    if (!isAdmin && !isProjectHead) {
      return NextResponse.json({
        success: false,
        message: 'Only project heads can approve or reject requests'
      }, { status: 403 })
    }

    const body = await request.json()
    const {
      action,
      comment,
      unmarkSubtasks,
      subtasksToUnmark, // Array of subtask IDs to unmark
      subtaskComments,  // Object mapping subtask IDs to comments
      newStatus         // For tasks without subtasks - the new status to set
    } = body

    if (!action || !['approve', 'reject'].includes(action)) {
      return NextResponse.json({
        success: false,
        message: 'Valid action (approve/reject) is required'
      }, { status: 400 })
    }

    const isApproved = action === 'approve'

    // Update the request
    approvalRequest.status = isApproved ? 'approved' : 'rejected'
    approvalRequest.reviewedBy = userDoc.employeeId
    approvalRequest.reviewedAt = new Date()
    approvalRequest.reviewerComment = comment || ''
    await approvalRequest.save()

    // Handle the approval action
    if (isApproved) {
      switch (approvalRequest.type) {
        case 'task_completion':
          if (approvalRequest.relatedTask) {
            const taskTitle = approvalRequest.relatedTask.title
            const taskId = approvalRequest.relatedTask._id
            const oldStatus = approvalRequest.relatedTask.status

            // Update task status to completed
            const updatedTask = await Task.findByIdAndUpdate(taskId, {
              status: 'completed',
              completedAt: new Date()
            }, { new: true })

            // Recalculate completion percentage
            calculateCompletionPercentage(approvalRequest.project, models).catch(console.error)

            // Create timeline event
            createTimelineEvent({
              project: approvalRequest.project,
              type: 'task_completed',
              createdBy: userDoc.employeeId,
              relatedTask: taskId,
              description: `Task "${taskTitle}" completion approved`,
              metadata: { taskTitle, approvedBy: userDoc.employeeId }
            }, models).catch(console.error)

            queueTaskStatusChangedEmailNotifications({
              projectId: approvalRequest.project,
              taskId,
              oldStatus,
              newStatus: updatedTask?.status || 'completed',
              changedByEmployeeId: userDoc.employeeId,
              triggeredByUserId: user._id || user.userId || null,
              eventTimestamp: updatedTask?.updatedAt || new Date(),
              models,
            }).catch(console.error)
          }
          break

        case 'task_deletion':
          if (approvalRequest.relatedTask) {
            const taskTitle = approvalRequest.relatedTask.title
            const taskId = approvalRequest.relatedTask._id

            // Delete the task and its assignees
            await TaskAssignee.deleteMany({ task: taskId })
            await Task.findByIdAndDelete(taskId)

            // Recalculate completion percentage
            calculateCompletionPercentage(approvalRequest.project, models).catch(console.error)

            // Create timeline event
            createTimelineEvent({
              project: approvalRequest.project,
              type: 'task_deleted',
              createdBy: userDoc.employeeId,
              description: `Task "${taskTitle}" was deleted (approved by project head)`,
              metadata: { taskTitle, approvedBy: userDoc.employeeId }
            }, models).catch(console.error)
          }
          break

        case 'project_completion':
          // Handle project completion approval
          {
            const oldStatus = project.status
            const updatedProject = await Project.findByIdAndUpdate(approvalRequest.project, {
              status: 'approved',
              completedAt: new Date()
            }, { new: true })

            createTimelineEvent({
              project: approvalRequest.project,
              type: 'project_approved',
              createdBy: userDoc.employeeId,
              description: 'Project completion approved',
              metadata: { approvedBy: userDoc.employeeId }
            }, models).catch(console.error)

            queueProjectStatusChangedEmailNotifications({
              projectId: approvalRequest.project,
              oldStatus,
              newStatus: updatedProject?.status || 'approved',
              changedByEmployeeId: userDoc.employeeId,
              triggeredByUserId: user._id || user.userId || null,
              eventTimestamp: updatedProject?.updatedAt || new Date(),
              models,
            }).catch(console.error)
          }
          break

        case 'task_review':
          // Task review approval - mark task as completed (same as task_completion)
          if (approvalRequest.relatedTask) {
            const taskTitle = approvalRequest.relatedTask.title
            const taskId = approvalRequest.relatedTask._id
            const oldStatus = approvalRequest.relatedTask.status

            // Update task status to completed
            const updatedTask = await Task.findByIdAndUpdate(taskId, {
              status: 'completed',
              completedAt: new Date()
            }, { new: true })

            // Recalculate completion percentage
            calculateCompletionPercentage(approvalRequest.project, models).catch(console.error)

            // Create timeline event
            createTimelineEvent({
              project: approvalRequest.project,
              type: 'task_completed',
              createdBy: userDoc.employeeId,
              relatedTask: taskId,
              description: `Task "${taskTitle}" review approved and marked complete`,
              metadata: { taskTitle, approvedBy: userDoc.employeeId }
            }, models).catch(console.error)

            queueTaskStatusChangedEmailNotifications({
              projectId: approvalRequest.project,
              taskId,
              oldStatus,
              newStatus: updatedTask?.status || 'completed',
              changedByEmployeeId: userDoc.employeeId,
              triggeredByUserId: user._id || user.userId || null,
              eventTimestamp: updatedTask?.updatedAt || new Date(),
              models,
            }).catch(console.error)
          }
          break

        case 'member_removal':
          // Handle member removal - to be implemented
          break
      }
    } else {
      // Handle rejection
      if ((approvalRequest.type === 'task_completion' || approvalRequest.type === 'task_review') && approvalRequest.relatedTask) {
        const task = await Task.findById(approvalRequest.relatedTask._id)

        if (task) {
          const oldStatus = task.status
          // Determine the new status
          let targetStatus = 'in-progress'

          // For tasks without subtasks, allow project head to specify the status
          if ((!task.subtasks || task.subtasks.length === 0) && newStatus) {
            const validStatuses = ['todo', 'in-progress', 'on-hold']
            if (validStatuses.includes(newStatus)) {
              targetStatus = newStatus
            }
          }

          task.status = targetStatus

          // Track rejection details
          task.lastRejectedAt = new Date()
          task.lastRejectedBy = userDoc.employeeId
          task.rejectionCount = (task.rejectionCount || 0) + 1
          task.lastRejectionReason = comment || ''

          // Handle subtask unmarking and track unmarked names
          const unmarkedSubtaskNames = []

          if (task.subtasks && task.subtasks.length > 0) {
            if (subtasksToUnmark && subtasksToUnmark.length > 0) {
              // Selective unmarking - only unmark specified subtasks
              task.subtasks.forEach(st => {
                if (subtasksToUnmark.includes(st._id.toString())) {
                  st.completed = false
                  st.completedAt = null
                  st.completedBy = null
                  unmarkedSubtaskNames.push(st.title)
                  // Add rejection comment to subtask if provided
                  if (subtaskComments && subtaskComments[st._id.toString()]) {
                    st.rejectionComment = subtaskComments[st._id.toString()]
                    st.rejectedAt = new Date()
                    st.rejectedBy = userDoc.employeeId
                  }
                }
              })
            } else if (unmarkSubtasks) {
              // Legacy: unmark all subtasks
              task.subtasks.forEach(st => {
                if (st.completed) {
                  unmarkedSubtaskNames.push(st.title)
                }
                st.completed = false
                st.completedAt = null
                st.completedBy = null
              })
            }

            // Recalculate task progress percentage based on subtasks
            const completedCount = task.subtasks.filter(st => st.completed).length
            task.progressPercentage = task.subtasks.length > 0
              ? Math.round((completedCount / task.subtasks.length) * 100)
              : 0
          } else {
            // No subtasks - set progress to 0
            task.progressPercentage = 0
          }

          await task.save()

          // Emit socket event for real-time update with updated progress
          if (global.io) {
            global.io.to(`project:${approvalRequest.project}`).emit('task_updated', {
              _id: task._id,
              status: task.status,
              subtasks: task.subtasks,
              progressPercentage: task.progressPercentage,
              lastRejectedAt: task.lastRejectedAt,
              lastRejectionReason: task.lastRejectionReason,
              rejectionCount: task.rejectionCount
            })
          }

          // Recalculate project completion percentage
          calculateCompletionPercentage(approvalRequest.project, models).catch(console.error)

          // Get task assignees for notifications
          const taskAssignees = await TaskAssignee.find({
            task: task._id,
            assignmentStatus: 'accepted'
          }).populate('user', 'firstName lastName email')

          const assigneeEmployeeIds = taskAssignees.map(ta => ta.user._id)
          const assigneeUserIds = await User.find({
            employeeId: { $in: assigneeEmployeeIds }
          }).select('_id email')

          // Get rejector employee details
          const rejectorEmployee = await Employee.findById(userDoc.employeeId).select('firstName lastName')

          // Send push notifications to assignees
          if (assigneeUserIds.length > 0) {
            notifyTaskReviewRejected(
              project,
              task,
              rejectorEmployee,
              assigneeUserIds.map(u => u._id),
              comment,
              unmarkedSubtaskNames
            ).catch(console.error)
          }

          // Send email notifications to assignees
          for (const assignee of taskAssignees) {
            if (assignee.user?.email) {
              const assigneeUser = await User.findOne({ employeeId: assignee.user._id }).select('email')
              if (assigneeUser?.email) {
                const emailSubject = `Task Rejected: ${task.title}`
                const emailBody = `
                  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <div style="background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); padding: 20px; border-radius: 10px 10px 0 0;">
                      <h1 style="color: white; margin: 0; font-size: 24px;">❌ Task Rejected</h1>
                    </div>
                    <div style="background: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
                      <p style="color: #374151; font-size: 16px;">Hi ${assignee.user.firstName},</p>
                      <p style="color: #374151; font-size: 16px;">Your task has been rejected by <strong>${rejectorEmployee?.firstName} ${rejectorEmployee?.lastName}</strong>.</p>
                      
                      <div style="background: white; border: 1px solid #fecaca; border-left: 4px solid #ef4444; padding: 15px; margin: 15px 0; border-radius: 5px;">
                        <h3 style="color: #991b1b; margin: 0 0 10px 0;">${task.title}</h3>
                        <p style="color: #6b7280; margin: 0;">Project: <strong>${project.name}</strong></p>
                        ${comment ? `<p style="color: #dc2626; margin: 10px 0 0 0;"><strong>Reason:</strong> ${comment}</p>` : ''}
                      </div>
                      
                      ${unmarkedSubtaskNames.length > 0 ? `
                        <div style="background: #fef2f2; padding: 15px; border-radius: 5px; margin: 15px 0;">
                          <p style="color: #991b1b; font-weight: bold; margin: 0 0 10px 0;">Subtasks marked incomplete:</p>
                          <ul style="color: #b91c1c; margin: 0; padding-left: 20px;">
                            ${unmarkedSubtaskNames.map(name => `<li>${name}</li>`).join('')}
                          </ul>
                        </div>
                      ` : ''}
                      
                      <p style="color: #374151; font-size: 14px;">Please review the feedback and update the task accordingly.</p>
                      
                      <a href="${process.env.NEXT_PUBLIC_BASE_URL || 'https://app.talio.in'}/dashboard/projects/${project._id}?task=${task._id}" 
                         style="display: inline-block; background: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin-top: 15px;">
                        View Task
                      </a>
                    </div>
                  </div>
                `

                sendEmail({
                  to: assigneeUser.email,
                  subject: emailSubject,
                  html: emailBody
                }).catch(err => console.error('Failed to send rejection email:', err))
              }
            }
          }

          // Create timeline event for rejection (with red color indicator)
          createTimelineEvent({
            project: approvalRequest.project,
            type: 'task_rejected',
            createdBy: userDoc.employeeId,
            relatedTask: task._id,
            description: `Task "${task.title}" review rejected${comment ? `: ${comment}` : ''}`,
            metadata: {
              requestType: approvalRequest.type,
              rejectionComment: comment,
              unmarkSubtasks,
              subtasksUnmarked: unmarkedSubtaskNames,
              subtaskComments,
              newStatus: targetStatus,
              isRejection: true,
              colorCode: 'red'
            }
          }, models).catch(console.error)

          queueTaskStatusChangedEmailNotifications({
            projectId: approvalRequest.project,
            taskId: task._id,
            oldStatus,
            newStatus: task.status,
            changedByEmployeeId: userDoc.employeeId,
            triggeredByUserId: user._id || user.userId || null,
            eventTimestamp: task.updatedAt || new Date(),
            includeAssignees: false,
            models,
          }).catch(console.error)
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: isApproved ? 'Request approved' : 'Request rejected'
    })
  } catch (error) {
    console.error('Process approval request error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}

// DELETE - Cancel a request (by requester)
export async function DELETE(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Project', 'ProjectApprovalRequest', 'User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Project, ProjectApprovalRequest, User } = models

    const { requestId } = await params

    const userDoc = await User.findById(user._id || user.userId).select('employeeId role')
    if (!userDoc || !userDoc.employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    const approvalRequest = await ProjectApprovalRequest.findById(requestId)
    if (!approvalRequest) {
      return NextResponse.json({ success: false, message: 'Request not found' }, { status: 404 })
    }

    // Only requester, project head, or admin can cancel
    const isRequester = approvalRequest.requestedBy.toString() === userDoc.employeeId.toString()
    const isAdmin = ['admin'].includes(userDoc.role)

    const project = await Project.findById(approvalRequest.project)
    const isProjectHead = project && project.projectHead.toString() === userDoc.employeeId.toString()

    if (!isRequester && !isAdmin && !isProjectHead) {
      return NextResponse.json({
        success: false,
        message: 'You can only cancel your own requests'
      }, { status: 403 })
    }

    if (approvalRequest.status !== 'pending') {
      return NextResponse.json({
        success: false,
        message: 'Only pending requests can be cancelled'
      }, { status: 400 })
    }

    await ProjectApprovalRequest.findByIdAndDelete(requestId)

    return NextResponse.json({
      success: true,
      message: 'Request cancelled'
    })
  } catch (error) {
    console.error('Cancel approval request error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
