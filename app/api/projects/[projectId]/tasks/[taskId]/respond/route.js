import { NextResponse } from 'next/server'
import { verifyToken, getAuthAndModels } from '@/lib/auth'
import { createTimelineEvent } from '@/lib/projectService'
import { 
  notifyTaskAssignmentAccepted,
  notifyTaskAssignmentRejected
} from '@/lib/projectNotifications'

// POST - Respond to task assignment (accept/reject)
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

    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Project', 'Task', 'TaskAssignee', 'User', 'Employee'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Project, Task, TaskAssignee, User, Employee } = models

    const { projectId, taskId } = await params

    const user = await User.findById(decoded.userId).select('employeeId')
    if (!user || !user.employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    const body = await request.json()
    const { action, reason, estimatedHours } = body

    if (!action || !['accept', 'reject'].includes(action)) {
      return NextResponse.json({ 
        success: false, 
        message: 'Valid action (accept/reject) is required' 
      }, { status: 400 })
    }

    const task = await Task.findById(taskId)
    if (!task || task.project.toString() !== projectId) {
      return NextResponse.json({ success: false, message: 'Task not found' }, { status: 404 })
    }

    const project = await Project.findById(projectId)
    if (!project) {
      return NextResponse.json({ success: false, message: 'Project not found' }, { status: 404 })
    }

    // Find the assignment for current user
    const assignment = await TaskAssignee.findOne({
      task: taskId,
      user: user.employeeId
    })

    if (!assignment) {
      return NextResponse.json({ 
        success: false, 
        message: 'You are not assigned to this task' 
      }, { status: 404 })
    }

    if (assignment.assignmentStatus !== 'pending') {
      return NextResponse.json({ 
        success: false, 
        message: 'Assignment has already been responded to' 
      }, { status: 400 })
    }

    const accept = action === 'accept'

    assignment.assignmentStatus = accept ? 'accepted' : 'rejected'
    assignment.respondedAt = new Date()
    if (!accept && reason) {
      assignment.rejectionReason = reason
    }
    await assignment.save()

    // If accepting, update task with estimated hours and start date
    if (accept) {
      const updates = {}
      
      if (estimatedHours && estimatedHours > 0) {
        updates.estimatedHours = estimatedHours
        
        // Calculate expected completion date based on ETA
        // Assuming 8 work hours per day, 5 days per week
        const startDate = new Date()
        const workDays = Math.ceil(estimatedHours / 8)
        const completionDate = new Date(startDate)
        completionDate.setDate(completionDate.getDate() + workDays)
        
        if (!task.startDate) {
          updates.startDate = startDate
        }
        if (!task.dueDate) {
          updates.dueDate = completionDate
        }
      }
      
      if (Object.keys(updates).length > 0) {
        await Task.findByIdAndUpdate(taskId, updates)
      }
    }

    const employee = await Employee.findById(user.employeeId)

    // Create timeline event
    await createTimelineEvent({
      project: projectId,
      type: accept ? 'task_assignment_accepted' : 'task_assignment_rejected',
      createdBy: user.employeeId,
      relatedTask: taskId,
      description: accept 
        ? `${employee.firstName} ${employee.lastName} accepted task "${task.title}"${estimatedHours ? ` (ETA: ${estimatedHours}h)` : ''}`
        : `${employee.firstName} ${employee.lastName} rejected task "${task.title}"${reason ? `: ${reason}` : ''}`,
      metadata: { 
        taskTitle: task.title, 
        rejectionReason: reason,
        estimatedHours: estimatedHours
      }
    })

    // Notify task creator and project head (non-blocking - don't await)
    const notifyEmployeeIds = [task.createdBy, project.projectHead]
      .filter(id => id.toString() !== user.employeeId.toString())
    
    User.find({ 
      employeeId: { $in: notifyEmployeeIds } 
    }).select('_id').then(notifyUsers => {
      const notifyUserIds = notifyUsers.map(u => u._id)
      if (accept) {
        notifyTaskAssignmentAccepted(project, task, employee, notifyUserIds).catch(console.error)
      } else {
        notifyTaskAssignmentRejected(project, task, employee, notifyUserIds, reason).catch(console.error)
      }
    }).catch(console.error)

    return NextResponse.json({
      success: true,
      message: accept ? 'Task accepted' : 'Task rejected'
    })
  } catch (error) {
    console.error('Respond to task assignment error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
