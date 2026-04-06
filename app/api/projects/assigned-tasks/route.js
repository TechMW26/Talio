import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
// GET - Get tasks assigned/created by the current user
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Task', 'TaskAssignee', 'User', 'Employee'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Task, TaskAssignee, User, Employee } = models

    const userRecord = await User.findById(user._id || user.userId).select('employeeId')
    if (!userRecord || !userRecord.employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status') || 'all'
    const projectId = searchParams.get('projectId')
    const month = searchParams.get('month')
    const year = searchParams.get('year')

    // Find all tasks assigned by the current user (where they are assignedBy)
    // OR tasks they created and assigned to others
    const taskQuery = {
      $or: [
        { assignedBy: user.employeeId },
        { createdBy: user.employeeId }
      ],
      status: { $ne: 'archived' }
    }

    if (status !== 'all') {
      taskQuery.status = status
    }

    if (projectId) {
      taskQuery.project = projectId
    }

    // Month/year filter — show tasks relevant to a specific month
    const now = new Date()
    if (month !== null && month !== undefined && year) {
      const filterMonth = parseInt(month)
      const filterYear = parseInt(year)
      if (!isNaN(filterMonth) && !isNaN(filterYear)) {
        const monthStart = new Date(filterYear, filterMonth, 1)
        const monthEnd = new Date(filterYear, filterMonth + 1, 0, 23, 59, 59, 999)

        taskQuery.$and = [
          {
            $or: [
              { createdAt: { $gte: monthStart, $lte: monthEnd } },
              { dueDate: { $gte: monthStart, $lte: monthEnd } },
              { status: { $nin: ['completed'] }, createdAt: { $lte: monthEnd } },
              { status: 'completed', updatedAt: { $gte: monthStart, $lte: monthEnd } },
            ]
          }
        ]
      }
    }

    const tasks = await Task.find(taskQuery)
      .populate('project', 'name status endDate priority projectHead projectHeads')
      .populate('createdBy', 'firstName lastName profilePicture')
      .populate('assignedBy', 'firstName lastName')
      .sort({ createdAt: -1 })

    // Get assignees for each task
    const taskIds = tasks.map(t => t._id)
    const assignees = await TaskAssignee.find({ task: { $in: taskIds } })
      .populate('user', 'firstName lastName profilePicture employeeCode email')
      .populate('assignedBy', 'firstName lastName')

    // Filter tasks to only include those assigned to OTHER users (not self-assigned only)
    const tasksWithAssignees = tasks
      .map(task => {
        const taskAssignees = assignees.filter(a => 
          a.task.toString() === task._id.toString()
        )
        
        // Check if task is assigned to anyone other than the creator
        const hasOtherAssignees = taskAssignees.some(a => 
          a.user._id.toString() !== user.employeeId.toString()
        )
        
        // If task is only self-assigned, skip it (unless there are no assignees at all)
        if (!hasOtherAssignees && taskAssignees.length > 0) {
          // Check if creator is the only assignee
          const onlySelfAssigned = taskAssignees.every(a => 
            a.user._id.toString() === user.employeeId.toString()
          )
          if (onlySelfAssigned) return null
        }

        return {
          ...task.toObject(),
          assignees: taskAssignees
        }
      })
      .filter(Boolean) // Remove null entries

    // Get unique projects for filter dropdown
    const uniqueProjects = []
    const projectIds = new Set()
    tasksWithAssignees.forEach(task => {
      if (task.project && !projectIds.has(task.project._id.toString())) {
        projectIds.add(task.project._id.toString())
        uniqueProjects.push({
          _id: task.project._id,
          name: task.project.name
        })
      }
    })

    // Calculate stats
    const stats = {
      total: tasksWithAssignees.length,
      todo: tasksWithAssignees.filter(t => t.status === 'todo').length,
      inProgress: tasksWithAssignees.filter(t => t.status === 'in-progress').length,
      review: tasksWithAssignees.filter(t => t.status === 'review').length,
      completed: tasksWithAssignees.filter(t => t.status === 'completed').length,
      pendingAcceptance: tasksWithAssignees.filter(t => 
        t.assignees?.some(a => a.assignmentStatus === 'pending')
      ).length,
      pendingDeletion: tasksWithAssignees.filter(t => 
        t.deletionRequest?.status === 'pending'
      ).length
    }

    return NextResponse.json({
      success: true,
      data: tasksWithAssignees,
      projects: uniqueProjects.sort((a, b) => a.name.localeCompare(b.name)),
      stats
    })
  } catch (error) {
    console.error('Get assigned tasks error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
