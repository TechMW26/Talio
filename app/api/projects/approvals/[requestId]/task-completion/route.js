import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import Project from '@/models/Project'
import Task from '@/models/Task'
import ProjectApprovalRequest from '@/models/ProjectApprovalRequest'
import User from '@/models/User'
import Employee from '@/models/Employee'
import { createTimelineEvent } from '@/lib/projectService'

// POST - Approve or reject task completion
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

    await connectDB()

    const { requestId } = await params
    const body = await request.json()
    const { action, comment } = body // action: 'approve' or 'reject'

    const user = await User.findById(decoded.userId).select('employeeId role')
    if (!user || !user.employeeId) {
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

    const isProjectHead = projectHeadIds.includes(user.employeeId.toString())
    const isAdmin = ['admin'].includes(user.role)

    if (!isProjectHead && !isAdmin) {
      return NextResponse.json({ success: false, message: 'Only project heads can approve this request' }, { status: 403 })
    }

    const employee = await Employee.findById(user.employeeId)

    if (action === 'approve') {
      // Approve the task completion
      approvalRequest.status = 'approved'
      approvalRequest.reviewedBy = user.employeeId
      approvalRequest.reviewedAt = new Date()
      approvalRequest.reviewerComment = comment || ''
      await approvalRequest.save()

      // Update task status to completed
      const task = await Task.findById(approvalRequest.relatedTask._id)
      if (task) {
        task.status = 'completed'
        task.completedAt = new Date()
        await task.save()

        // Create timeline event
        await createTimelineEvent({
          project: project._id,
          type: 'task_completed',
          createdBy: user.employeeId,
          relatedTask: task._id,
          description: `Task "${task.title}" approved as completed by ${employee.firstName} ${employee.lastName}`,
          metadata: { 
            taskTitle: task.title,
            approvedBy: user.employeeId,
            approverName: `${employee.firstName} ${employee.lastName}`
          }
        })

        // Recalculate project completion percentage
        const { calculateCompletionPercentage } = await import('@/lib/projectService')
        await calculateCompletionPercentage(project._id)
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
        task.status = 'in-progress'
        await task.save()

        // Create timeline event
        await createTimelineEvent({
          project: project._id,
          type: 'task_completion_rejected',
          createdBy: user.employeeId,
          relatedTask: task._id,
          description: `Task "${task.title}" completion rejected by ${employee.firstName} ${employee.lastName}`,
          metadata: { 
            taskTitle: task.title,
            rejectedBy: user.employeeId,
            rejectorName: `${employee.firstName} ${employee.lastName}`,
            reason: comment || 'No reason provided'
          }
        })
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
