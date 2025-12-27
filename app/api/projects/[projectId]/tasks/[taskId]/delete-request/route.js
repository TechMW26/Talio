import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { createTimelineEvent } from '@/lib/projectService'

// POST - Request task deletion (for non-project heads)
export async function POST(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Project', 'Task', 'User', 'Employee', 'ProjectApprovalRequest', 'ProjectTimelineEvent'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Project, Task, User, Employee, ProjectApprovalRequest } = models

    const { projectId, taskId } = await params

    const userRecord = await User.findById(user._id || user.userId).select('employeeId role')
    if (!userRecord || !userRecord.employeeId) {
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

    const body = await request.json()
    const { reason } = body

    if (!reason || !reason.trim()) {
      return NextResponse.json({ 
        success: false, 
        message: 'Please provide a reason for deletion request' 
      }, { status: 400 })
    }

    // Check if there's already a pending request for this task
    const existingRequest = await ProjectApprovalRequest.findOne({
      project: projectId,
      relatedTask: taskId,
      type: 'task_deletion',
      status: 'pending'
    })

    if (existingRequest) {
      return NextResponse.json({ 
        success: false, 
        message: 'A deletion request for this task is already pending' 
      }, { status: 400 })
    }

    // Get requester info
    const requester = await Employee.findById(userRecord.employeeId).select('firstName lastName')

    // Create an approval request
    await ProjectApprovalRequest.create({
      project: projectId,
      type: 'task_deletion',
      requestedBy: userRecord.employeeId,
      relatedTask: taskId,
      reason: reason.trim(),
      metadata: {
        taskTitle: task.title,
        taskPriority: task.priority,
        taskStatus: task.status,
        requesterName: `${requester.firstName} ${requester.lastName}`
      }
    })

    // Create a timeline event for deletion request (non-blocking) - pass models for multi-tenant
    createTimelineEvent({
      project: projectId,
      type: 'task_deletion_requested',
      createdBy: userRecord.employeeId,
      relatedTask: taskId,
      description: `${requester.firstName} ${requester.lastName} requested deletion of task "${task.title}"`,
      metadata: { 
        taskTitle: task.title, 
        reason,
        requestedBy: userRecord.employeeId,
        requesterName: `${requester.firstName} ${requester.lastName}`
      }
    }, models).catch(console.error)

    return NextResponse.json({
      success: true,
      message: 'Deletion request submitted to project head'
    })
  } catch (error) {
    console.error('Task deletion request error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
