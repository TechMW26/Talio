import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { getTodaysTasks, getUserProjectsSummaryForMira } from '@/lib/projectService'

// GET - Get user's tasks (today's, pending, all)
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Task', 'TaskAssignee'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Task, TaskAssignee } = models

    const employeeId = user?.employeeId?._id || user?.employeeId
    if (!employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    const { searchParams } = new URL(request.url)
    const filter = searchParams.get('filter') || 'all' // Changed default from 'today' to 'all'
    const projectId = searchParams.get('projectId')

    // Get all assignments for user
    const assignmentQuery = {
      user: employeeId,
      assignmentStatus: { $in: ['pending', 'accepted'] }
    }
    
    const assignments = await TaskAssignee.find(assignmentQuery).select('task assignmentStatus')
    const taskIds = assignments.map(a => a.task)

    // Build task query
    const taskQuery = { _id: { $in: taskIds } }
    
    if (projectId) {
      taskQuery.project = projectId
    }

    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    switch (filter) {
      case 'today':
        taskQuery.status = { $nin: ['completed', 'archived'] }
        taskQuery.$or = [
          { dueDate: { $gte: today, $lt: tomorrow } },
          { dueDate: { $lt: today } } // Include overdue
        ]
        break
      case 'overdue':
        taskQuery.status = { $nin: ['completed', 'archived'] }
        taskQuery.dueDate = { $lt: today }
        break
      case 'pending':
        taskQuery.status = { $nin: ['completed', 'archived'] }
        break
      case 'completed':
        taskQuery.status = 'completed'
        break
      // 'all' has no additional filters
    }

    const tasks = await Task.find(taskQuery)
      .populate('project', 'name status endDate priority')
      .populate('createdBy', 'firstName lastName')
      .populate('assignedBy', 'firstName lastName')
      .populate({
        path: 'subtasks.completedBy',
        select: 'firstName lastName'
      })
      .populate({
        path: 'subtasks.acceptedBy',
        select: 'firstName lastName'
      })
      .sort({ dueDate: 1, priority: -1, createdAt: -1 })

    // Get all assignees for the tasks to enable multi-assignee features
    const allTaskAssignees = await TaskAssignee.find({
      task: { $in: taskIds },
      assignmentStatus: { $in: ['pending', 'accepted'] }
    })
      .populate('user', 'firstName lastName profilePicture')
      .select('task user assignmentStatus')

    // Group assignees by task
    const assigneesByTask = {}
    allTaskAssignees.forEach(a => {
      const taskIdStr = a.task.toString()
      if (!assigneesByTask[taskIdStr]) {
        assigneesByTask[taskIdStr] = []
      }
      assigneesByTask[taskIdStr].push({
        _id: a._id,
        user: a.user,
        assignmentStatus: a.assignmentStatus
      })
    })

    // Attach assignment status and all assignees
    const tasksWithAssignmentStatus = tasks.map(task => {
      const assignment = assignments.find(a => a.task.toString() === task._id.toString())
      const taskIdStr = task._id.toString()
      return {
        ...task.toObject(),
        assignmentStatus: assignment?.assignmentStatus,
        assignees: assigneesByTask[taskIdStr] || [],
        isMultiAssignee: (assigneesByTask[taskIdStr] || []).length > 1,
        isOverdue: task.dueDate && task.dueDate < now && task.status !== 'completed'
      }
    })

    // Get summary stats
    const allAssignments = await TaskAssignee.find({
      user: user.employeeId,
      assignmentStatus: { $in: ['pending', 'accepted'] }
    }).select('task')
    
    const allTaskIds = allAssignments.map(a => a.task)
    const allTasks = await Task.find({ 
      _id: { $in: allTaskIds },
      status: { $ne: 'archived' }
    }).select('status dueDate')

    const stats = {
      total: allTasks.length,
      completed: allTasks.filter(t => t.status === 'completed').length,
      pending: allTasks.filter(t => !['completed', 'archived'].includes(t.status)).length,
      overdue: allTasks.filter(t => 
        t.dueDate && t.dueDate < now && t.status !== 'completed'
      ).length,
      dueToday: allTasks.filter(t => 
        t.dueDate && t.dueDate >= today && t.dueDate < tomorrow
      ).length
    }

    return NextResponse.json({
      success: true,
      data: tasksWithAssignmentStatus,
      stats,
      filter
    })
  } catch (error) {
    console.error('Get my tasks error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
