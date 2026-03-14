import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// POST - Approve or reject a deletion request for a standalone task
export async function POST(request, { params }) {
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

    if (!task.deletionRequest || task.deletionRequest.status !== 'pending') {
      return NextResponse.json({
        success: false,
        message: 'No pending deletion request found'
      }, { status: 400 })
    }

    // Only admin, creator, or assigner can respond to deletion requests
    const isAdmin = ['admin'].includes(userRecord.role || user.role)
    const isCreator = task.createdBy.toString() === userRecord.employeeId.toString()
    const isAssigner = task.assignedBy?.toString() === userRecord.employeeId.toString()

    // Don't allow the requester to approve their own deletion request
    const isRequester = task.deletionRequest.requestedBy.toString() === userRecord.employeeId.toString()

    if (!isAdmin && !isCreator && !isAssigner) {
      return NextResponse.json({
        success: false,
        message: 'You do not have permission to respond to this deletion request'
      }, { status: 403 })
    }

    if (isRequester && !isAdmin) {
      return NextResponse.json({
        success: false,
        message: 'You cannot approve your own deletion request'
      }, { status: 403 })
    }

    const body = await request.json()
    const { action, reason } = body

    if (!action || !['approve', 'reject'].includes(action)) {
      return NextResponse.json({
        success: false,
        message: 'Valid action (approve/reject) is required'
      }, { status: 400 })
    }

    if (action === 'approve') {
      await TaskAssignee.deleteMany({ task: taskId })
      await Task.findByIdAndDelete(taskId)

      return NextResponse.json({
        success: true,
        message: 'Task deletion approved and task has been deleted'
      })
    } else {
      task.deletionRequest.status = 'rejected'
      task.deletionRequest.respondedBy = userRecord.employeeId
      task.deletionRequest.respondedAt = new Date()
      task.deletionRequest.rejectionReason = reason || 'No reason provided'
      await task.save()

      return NextResponse.json({
        success: true,
        message: 'Task deletion request rejected'
      })
    }
  } catch (error) {
    console.error('Standalone task deletion response error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
