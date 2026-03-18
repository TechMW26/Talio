import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { createTaskAssignmentNotification } from '@/lib/actionableNotifications'

export const dynamic = 'force-dynamic'

// POST - Reassign a standalone task to a new user
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

    // Only admin, creator, or assigner can reassign
    const isAdmin = ['admin'].includes(userRecord.role || user.role)
    const isCreator = task.createdBy.toString() === userRecord.employeeId.toString()
    const isAssigner = task.assignedBy?.toString() === userRecord.employeeId.toString()

    if (!isAdmin && !isCreator && !isAssigner) {
      return NextResponse.json({
        success: false,
        message: 'You do not have permission to reassign this task'
      }, { status: 403 })
    }

    const body = await request.json()
    const { newAssigneeId } = body

    if (!newAssigneeId) {
      return NextResponse.json({
        success: false,
        message: 'New assignee ID is required'
      }, { status: 400 })
    }

    // Check if already assigned
    const existing = await TaskAssignee.findOne({
      task: taskId,
      user: newAssigneeId,
      assignmentStatus: { $in: ['pending', 'accepted'] }
    })

    if (existing) {
      return NextResponse.json({
        success: false,
        message: 'This user is already assigned to the task'
      }, { status: 400 })
    }

    // Delete any previously rejected assignment
    await TaskAssignee.deleteMany({
      task: taskId,
      user: newAssigneeId,
      assignmentStatus: 'rejected'
    })

    const employee = await Employee.findById(newAssigneeId)
    if (!employee) {
      return NextResponse.json({
        success: false,
        message: 'Employee not found'
      }, { status: 404 })
    }

    const isSelfAssignment = newAssigneeId === userRecord.employeeId.toString()

    await TaskAssignee.create({
      task: taskId,
      user: newAssigneeId,
      assignedBy: userRecord.employeeId,
      assignmentStatus: isSelfAssignment ? 'accepted' : 'pending'
    })

    // Notify new assignee
    if (!isSelfAssignment) {
      try {
        const assigner = await Employee.findById(userRecord.employeeId)
        const assigneeUser = await User.findOne({ employeeId: newAssigneeId }).select('_id')
        if (assigneeUser) {
          createTaskAssignmentNotification(models, {
            targetUserId: assigneeUser._id,
            taskId: task._id,
            taskTitle: task.title,
            projectId: null,
            projectName: null,
            assignedBy: userRecord.employeeId,
            assignedByName: assigner ? `${assigner.firstName} ${assigner.lastName}` : 'Someone',
            dueDate: task.dueDate,
            priority: task.priority || 'medium'
          }).catch(console.error)
        }
      } catch (notifyErr) {
        console.error('Notification error:', notifyErr)
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Task reassigned successfully'
    })
  } catch (error) {
    console.error('Reassign standalone task error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
