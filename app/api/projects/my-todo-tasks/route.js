import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'

/**
 * GET - Get all project tasks assigned to the current user that are in "todo" status
 * These tasks will be displayed on the personal todo page
 */
export async function GET(request) {
  try {
    const auth = await getAuthAndModels(request, ['Task', 'TaskAssignee', 'User', 'Employee', 'Project'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }

    const { user, models } = auth
    const { Task, TaskAssignee, User, Employee, Project } = models

    // Get user's employee record
    const userRecord = await User.findById(user._id || user.userId).select('employeeId')
    if (!userRecord || !userRecord.employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    // Find all task assignments for this user where assignment is accepted
    const assignments = await TaskAssignee.find({
      user: userRecord.employeeId,
      assignmentStatus: 'accepted'
    }).select('task')

    const taskIds = assignments.map(a => a.task)

    // Find all tasks that are in "todo" status
    const tasks = await Task.find({
      _id: { $in: taskIds },
      status: 'todo'
    })
      .populate('project', 'name')
      .populate('createdBy', 'firstName lastName profilePicture')
      .populate('assignedBy', 'firstName lastName')
      .sort({ dueDate: 1, priority: -1, createdAt: -1 })

    // Format tasks for the todo page
    const formattedTasks = tasks.map(task => ({
      _id: task._id,
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      dueDate: task.dueDate,
      project: task.project,
      createdBy: task.createdBy,
      assignedBy: task.assignedBy,
      subtasks: task.subtasks || [],
      progressPercentage: task.progressPercentage || 0,
      isProjectTask: true, // Flag to identify this as a project task
      createdAt: task.createdAt
    }))

    return NextResponse.json({
      success: true,
      data: formattedTasks,
      count: formattedTasks.length
    })
  } catch (error) {
    console.error('Get my todo tasks error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
