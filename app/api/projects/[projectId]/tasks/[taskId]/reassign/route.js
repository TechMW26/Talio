import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import Project from '@/models/Project'
import Task from '@/models/Task'
import TaskAssignee from '@/models/TaskAssignee'
import User from '@/models/User'
import Employee from '@/models/Employee'
import { createTimelineEvent } from '@/lib/projectService'
import { notifyTaskAssigned } from '@/lib/projectNotifications'

// POST - Reassign a task to a new team member
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

    const { projectId, taskId } = await params

    const user = await User.findById(decoded.userId).select('employeeId role')
    if (!user || !user.employeeId) {
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

    // Check permissions - only task creator, project head, or admin can reassign
    const isAdmin = ['admin'].includes(user.role)
    const isProjectHead = project.projectHead.toString() === user.employeeId.toString()
    const isCreator = task.createdBy.toString() === user.employeeId.toString()

    if (!isAdmin && !isProjectHead && !isCreator) {
      return NextResponse.json({ 
        success: false, 
        message: 'Only task creator or project head can reassign tasks' 
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

    // Check if new assignee is a project member
    const newAssignee = await Employee.findById(newAssigneeId)
    if (!newAssignee) {
      return NextResponse.json({ 
        success: false, 
        message: 'Assignee not found' 
      }, { status: 404 })
    }

    // Check if already assigned to this person and not rejected
    const existingAssignment = await TaskAssignee.findOne({
      task: taskId,
      user: newAssigneeId
    })

    if (existingAssignment) {
      if (existingAssignment.assignmentStatus === 'accepted') {
        return NextResponse.json({ 
          success: false, 
          message: 'This person is already assigned to this task' 
        }, { status: 400 })
      } else if (existingAssignment.assignmentStatus === 'pending') {
        return NextResponse.json({ 
          success: false, 
          message: 'This person already has a pending assignment' 
        }, { status: 400 })
      }
      // If rejected, we can reassign - delete the old assignment first
      await TaskAssignee.findByIdAndDelete(existingAssignment._id)
    }

    // Create new assignment
    await TaskAssignee.create({
      task: taskId,
      user: newAssigneeId,
      assignedBy: user.employeeId,
      assignmentStatus: 'pending'
    })

    const assigner = await Employee.findById(user.employeeId).select('firstName lastName')

    // Create timeline event (non-blocking)
    createTimelineEvent({
      project: projectId,
      type: 'task_reassigned',
      createdBy: user.employeeId,
      relatedTask: taskId,
      description: `Task "${task.title}" was reassigned to ${newAssignee.firstName} ${newAssignee.lastName}`,
      metadata: { 
        taskTitle: task.title, 
        newAssignee: `${newAssignee.firstName} ${newAssignee.lastName}`,
        reassignedBy: `${assigner.firstName} ${assigner.lastName}`
      }
    }).catch(console.error)

    // Notify new assignee (non-blocking)
    User.findOne({ employeeId: newAssigneeId }).select('_id').then(newAssigneeUser => {
      if (newAssigneeUser) {
        notifyTaskAssigned(project, task, assigner, [newAssigneeUser._id]).catch(console.error)
      }
    }).catch(console.error)

    return NextResponse.json({
      success: true,
      message: 'Task reassigned successfully'
    })
  } catch (error) {
    console.error('Reassign task error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
