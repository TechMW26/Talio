import { NextResponse } from 'next/server'
import { verifyToken, getAuthAndModels } from '@/lib/auth'
import { 
  calculateCompletionPercentage,
  createTimelineEvent 
} from '@/lib/projectService'

// POST - Respond to deletion request (approve/reject)
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
    const auth = await getAuthAndModels(request, ['Project', 'Task', 'TaskAssignee', 'User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Project, Task, TaskAssignee, User } = models

    const { projectId, taskId } = await params
    const { action, reason } = await request.json()

    if (!action || !['approve', 'reject'].includes(action)) {
      return NextResponse.json({ success: false, message: 'Invalid action' }, { status: 400 })
    }

    const user = await User.findById(decoded.userId).select('employeeId role')
    if (!user || !user.employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    const task = await Task.findById(taskId)
    if (!task || task.project.toString() !== projectId) {
      return NextResponse.json({ success: false, message: 'Task not found' }, { status: 404 })
    }

    // Check if there's a pending deletion request
    if (!task.deletionRequest || task.deletionRequest.status !== 'pending') {
      return NextResponse.json({ 
        success: false, 
        message: 'No pending deletion request found' 
      }, { status: 400 })
    }

    const project = await Project.findById(projectId)
    if (!project) {
      return NextResponse.json({ success: false, message: 'Project not found' }, { status: 404 })
    }

    // Check permissions - only project head, admins, or assignees can respond
    const isAdmin = ['admin'].includes(user.role)
    
    // Build list of project head IDs (handle both array and single field)
    const projectHeadIds = []
    if (project.projectHeads && project.projectHeads.length > 0) {
      projectHeadIds.push(...project.projectHeads.map(h => h.toString()))
    }
    if (project.projectHead) {
      const headId = project.projectHead.toString()
      if (!projectHeadIds.includes(headId)) {
        projectHeadIds.push(headId)
      }
    }
    // Also check createdBy as they should have head-level permissions
    if (project.createdBy) {
      const creatorId = project.createdBy.toString()
      if (!projectHeadIds.includes(creatorId)) {
        projectHeadIds.push(creatorId)
      }
    }
    
    const isProjectHead = projectHeadIds.includes(user.employeeId.toString())
    
    console.log('[Deletion Response] Permission check:', {
      userId: user.employeeId.toString(),
      projectHeadIds,
      isAdmin,
      isProjectHead,
      role: user.role
    })
    
    // Check if user is an assignee
    const isAssignee = await TaskAssignee.findOne({
      task: taskId,
      user: user.employeeId,
      assignmentStatus: 'accepted'
    })

    // Only project head, admin, or assignee (if not the requester) can respond
    const isRequester = task.deletionRequest.requestedBy.toString() === user.employeeId.toString()
    
    // Project heads and admins can always respond
    // Assignees can respond only if they are not the requester
    const canRespond = isAdmin || isProjectHead || (isAssignee && !isRequester)
    
    if (!canRespond) {
      return NextResponse.json({ 
        success: false, 
        message: 'You do not have permission to respond to this deletion request' 
      }, { status: 403 })
    }

    if (action === 'approve') {
      const taskTitle = task.title

      // Delete the task and its assignees
      await TaskAssignee.deleteMany({ task: taskId })
      await Task.findByIdAndDelete(taskId)

      // Recalculate completion percentage
      calculateCompletionPercentage(projectId).catch(console.error)

      // Create timeline event
      await createTimelineEvent({
        project: projectId,
        type: 'task_deleted',
        createdBy: user.employeeId,
        description: `Task "${taskTitle}" was deleted (deletion approved)`,
        metadata: { taskTitle, approvedBy: user.employeeId }
      })

      return NextResponse.json({
        success: true,
        message: 'Deletion approved. Task has been deleted.'
      })
    } else {
      // Reject the deletion request
      task.deletionRequest = {
        ...task.deletionRequest,
        status: 'rejected',
        respondedBy: user.employeeId,
        respondedAt: new Date(),
        rejectionReason: reason || 'No reason provided'
      }
      await task.save()

      // Create timeline event
      await createTimelineEvent({
        project: projectId,
        type: 'task_deletion_rejected',
        createdBy: user.employeeId,
        relatedTask: taskId,
        description: `Deletion request for task "${task.title}" was rejected`,
        metadata: { taskTitle: task.title, reason }
      })

      return NextResponse.json({
        success: true,
        message: 'Deletion request rejected.'
      })
    }
  } catch (error) {
    console.error('Deletion response error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
