import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { createTaskAssignmentNotification } from '@/lib/actionableNotifications'

export const dynamic = 'force-dynamic'

// POST - Assign additional users to a standalone task
export async function POST(request, { params }) {
  try {
    const auth = await getAuthAndModels(request, ['Task', 'TaskAssignee', 'User', 'Employee', 'ActionableNotification'])
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

    if (task.project) {
      return NextResponse.json({
        success: false,
        message: 'This task belongs to a project. Use the project task API instead.'
      }, { status: 400 })
    }

    // Only admin, creator, or assigner can add users
    const isAdmin = ['admin'].includes(userRecord.role || user.role)
    const isCreator = task.createdBy.toString() === userRecord.employeeId.toString()
    const isAssigner = task.assignedBy?.toString() === userRecord.employeeId.toString()

    if (!isAdmin && !isCreator && !isAssigner) {
      return NextResponse.json({
        success: false,
        message: 'You do not have permission to assign users to this task'
      }, { status: 403 })
    }

    const body = await request.json()
    const { assigneeId, assigneeIds } = body
    
    // Support both single and multiple assignee formats
    const idsToAssign = assigneeIds || (assigneeId ? [assigneeId] : [])
    
    if (idsToAssign.length === 0) {
      return NextResponse.json({
        success: false,
        message: 'At least one assignee ID is required'
      }, { status: 400 })
    }

    const assigner = await Employee.findById(userRecord.employeeId)
    const results = []

    for (const id of idsToAssign) {
      // Check if already assigned
      const existing = await TaskAssignee.findOne({ task: taskId, user: id })
      if (existing && existing.assignmentStatus !== 'rejected') {
        results.push({ id, status: 'skipped', reason: 'Already assigned' })
        continue
      }

      // If previously rejected, remove old assignment
      if (existing && existing.assignmentStatus === 'rejected') {
        await TaskAssignee.findByIdAndDelete(existing._id)
      }

      // Verify employee exists
      const employee = await Employee.findById(id)
      if (!employee) {
        results.push({ id, status: 'skipped', reason: 'Employee not found' })
        continue
      }

      // Self-assignment is auto-accepted
      const isSelfAssignment = id === userRecord.employeeId.toString()

      await TaskAssignee.create({
        task: taskId,
        user: id,
        assignedBy: userRecord.employeeId,
        assignmentStatus: isSelfAssignment ? 'accepted' : 'pending'
      })

      // Notify if not self-assigning
      if (!isSelfAssignment) {
        try {
          const assigneeUser = await User.findOne({ employeeId: id }).select('_id')
          if (assigneeUser) {
            createTaskAssignmentNotification(models, {
              task,
              assignee: employee,
              assignedBy: assigner,
              assigneeUserId: assigneeUser._id
            }).catch(console.error)
          }
        } catch (notifyErr) {
          console.error('Notification error:', notifyErr)
        }
      }

      results.push({ id, status: 'assigned' })
    }

    return NextResponse.json({
      success: true,
      message: 'Users assigned to task',
      data: results
    })
  } catch (error) {
    console.error('Assign to standalone task error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
