import { NextResponse } from 'next/server'
import { verifyToken, getAuthAndModels } from '@/lib/auth'
import { getTodaysTasks, getUserProjectsSummaryForMaya } from '@/lib/projectService'

// GET - Get user's tasks (today's, pending, all)
export async function GET(request) {
  try {
    const token = request.headers.get('authorization')?.split(' ')[1]
    if (!token) {
      return NextResponse.json({ success: false, message: 'No token provided' }, { status: 401 })
    }

    const decoded = await verifyToken(token)
    if (!decoded) {
      return NextResponse.json({ success: false, message: 'Invalid token' }, { status: 401 })
    }

    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Task', 'TaskAssignee', 'User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Task, TaskAssignee, User } = models

    const user = await User.findById(decoded.userId).select('employeeId')
    if (!user || !user.employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    const { searchParams } = new URL(request.url)
    const filter = searchParams.get('filter') || 'all' // Changed default from 'today' to 'all'
    const projectId = searchParams.get('projectId')

    // Get all assignments for user
    const assignmentQuery = {
      user: user.employeeId,
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
      .sort({ dueDate: 1, priority: -1, createdAt: -1 })

    // Attach assignment status
    const tasksWithAssignmentStatus = tasks.map(task => {
      const assignment = assignments.find(a => a.task.toString() === task._id.toString())
      return {
        ...task.toObject(),
        assignmentStatus: assignment?.assignmentStatus,
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
