import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { 
  checkProjectAccess, 
  calculateCompletionPercentage,
  createTimelineEvent 
} from '@/lib/projectService'
import { 
  notifyTaskStatusChanged,
  notifyTaskAssigned,
  getProjectMemberUserIds
} from '@/lib/projectNotifications'
import { emitTaskUpdate } from '@/lib/realtimeEvents'

// GET - Get single task details
export async function GET(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Project', 'ProjectMember', 'Task', 'TaskAssignee', 'User', 'Employee'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Project, ProjectMember, Task, TaskAssignee, User, Employee } = models

    const { projectId, taskId } = await params

    const userRecord = await User.findById(user._id || user.userId).select('employeeId role')
    if (!userRecord || !userRecord.employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    const task = await Task.findById(taskId)
      .populate('project', 'name status projectHead')
      .populate('createdBy', 'firstName lastName profilePicture')
      .populate('assignedBy', 'firstName lastName')
      .populate('parentTask', 'title status')

    if (!task || task.project._id.toString() !== projectId) {
      return NextResponse.json({ success: false, message: 'Task not found' }, { status: 404 })
    }

    // Get assignees
    const assignees = await TaskAssignee.find({ task: taskId })
      .populate('user', 'firstName lastName profilePicture employeeCode email')
      .populate('assignedBy', 'firstName lastName')

    // Get subtasks
    const subTasks = await Task.find({ parentTask: taskId })
      .populate('createdBy', 'firstName lastName')
      .select('title status priority dueDate')

    // Check if current user is an assignee
    const userAssignment = assignees.find(a => 
      a.user._id.toString() === user.employeeId.toString()
    )

    return NextResponse.json({
      success: true,
      data: {
        ...task.toObject(),
        assignees,
        subTasks,
        isAssignee: !!userAssignment,
        userAssignmentStatus: userAssignment?.assignmentStatus,
        isCreator: task.createdBy._id.toString() === user.employeeId.toString(),
        isProjectHead: task.project.projectHead.toString() === user.employeeId.toString()
      }
    })
  } catch (error) {
    console.error('Get task error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}

// PUT - Update task
export async function PUT(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Project', 'ProjectMember', 'Task', 'TaskAssignee', 'User', 'Employee', 'ProjectTimelineEvent', 'ProjectApprovalRequest'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Project, ProjectMember, Task, TaskAssignee, User, Employee, ProjectApprovalRequest } = models

    const { projectId, taskId } = await params

    const userRecord = await User.findById(user._id || user.userId).select('employeeId role')
    if (!userRecord || !userRecord.employeeId) {
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

    // Check permissions
    const isAdmin = ['admin'].includes(userRecord.role || user.role)
    const isCreator = task.createdBy.toString() === userRecord.employeeId.toString()
    const isProjectHead = project.projectHead.toString() === userRecord.employeeId.toString()
    
    // Check if user is an accepted assignee
    const userAssignment = await TaskAssignee.findOne({
      task: taskId,
      user: userRecord.employeeId,
      assignmentStatus: 'accepted'
    })
    const isAssignedAndAccepted = !!userAssignment

    const body = await request.json()
    const { 
      title, 
      description, 
      status, 
      priority, 
      dueDate, 
      startDate,
      tags,
      estimatedHours,
      actualHours,
      order,
      subtasks,
      statusChangeReason // Reason for status change (required when manager/head changes status)
    } = body

    // For status changes, only the assigned person (who accepted), project head, or admin can update
    if (status && status !== task.status) {
      if (!isAssignedAndAccepted && !isAdmin && !isProjectHead) {
        return NextResponse.json({ 
          success: false, 
          message: 'Only the assigned person or project head can update task status' 
        }, { status: 403 })
      }
    }

    // For other updates, allow creator, project head, admin, or assignee
    const canUpdate = isAdmin || isCreator || isProjectHead || isAssignedAndAccepted

    if (!canUpdate) {
      return NextResponse.json({ 
        success: false, 
        message: 'You do not have permission to update this task' 
      }, { status: 403 })
    }

    const updates = {}
    const changes = []
    const oldStatus = task.status

    if (title && title !== task.title) {
      updates.title = title
      changes.push(`Title changed to "${title}"`)
    }
    if (description !== undefined && description !== task.description) {
      updates.description = description
      changes.push('Description updated')
    }
    if (status && status !== task.status) {
      // Calculate task progress from subtasks
      let taskProgress = 0
      if (task.subtasks && task.subtasks.length > 0) {
        const completedCount = task.subtasks.filter(st => st.completed).length
        taskProgress = Math.round((completedCount / task.subtasks.length) * 100)
      }
      
      // STRICT ENFORCEMENT: Cannot change from 'review' status when 100% complete (except project head/admin)
      if (task.status === 'review' && taskProgress === 100 && !isProjectHead && !isAdmin) {
        return NextResponse.json({ 
          success: false, 
          message: 'Task is under review and cannot be modified. Please wait for project head approval.' 
        }, { status: 403 })
      }
      
      // If assignee marks as completed, require approval from project head(s)
      if (status === 'completed' && !isProjectHead && !isAdmin) {
        // STRICTLY ENFORCE REVIEW STATUS
        updates.status = 'review'
        changes.push(`Status changed from ${oldStatus} to review`)
        
        // Create approval request for task review (instead of completion)
        await ProjectApprovalRequest.create({
          project: projectId,
          type: 'task_review',
          status: 'pending',
          requestedBy: user.employeeId,
          relatedTask: taskId,
          reason: `Task "${task.title}" submitted for review (100% complete)`,
          metadata: {
            taskTitle: task.title,
            taskPriority: task.priority,
            submittedBy: user.employeeId
          }
        })
      } else if (status === 'review' && !isProjectHead && !isAdmin) {
        // If assignee moves to review, create approval request
        updates.status = 'review'
        changes.push(`Status changed from ${oldStatus} to review`)
        
        // Create approval request for task review
        await ProjectApprovalRequest.create({
          project: projectId,
          type: 'task_review',
          status: 'pending',
          requestedBy: user.employeeId,
          relatedTask: taskId,
          reason: `Task "${task.title}" submitted for review`,
          metadata: {
            taskTitle: task.title,
            taskPriority: task.priority,
            submittedBy: user.employeeId
          }
        })
      } else {
        updates.status = status
        changes.push(`Status changed from ${oldStatus} to ${status}`)
        
        if (status === 'completed') {
          updates.completedAt = new Date()
        }
      }
    }
    if (priority && priority !== task.priority) {
      updates.priority = priority
      changes.push(`Priority changed to ${priority}`)
    }
    if (dueDate !== undefined) {
      updates.dueDate = dueDate ? new Date(dueDate) : null
    }
    if (startDate !== undefined) {
      updates.startDate = startDate ? new Date(startDate) : null
    }
    if (tags) {
      updates.tags = tags
    }
    if (estimatedHours !== undefined) {
      updates.estimatedHours = estimatedHours
    }
    if (actualHours !== undefined) {
      updates.actualHours = actualHours
    }
    if (order !== undefined) {
      updates.order = order
    }
    
    // Handle subtasks updates
    if (subtasks !== undefined) {
      const oldSubtasks = task.subtasks || []
      const oldSubtaskIds = oldSubtasks.map(st => st._id?.toString())
      
      // Process subtasks - separate new ones from existing
      const processedSubtasks = subtasks.map(st => {
        // If it's a new subtask (has isNew flag or starts with 'new-')
        if (st.isNew || (st._id && st._id.toString().startsWith('new-'))) {
          return {
            title: st.title,
            completed: st.completed || false,
            estimatedDays: parseInt(st.estimatedDays) || 0,
            estimatedHours: parseInt(st.estimatedHours) || 0,
            order: st.order || 0,
            createdAt: new Date()
          }
        }
        return {
          _id: st._id,
          title: st.title,
          completed: st.completed || false,
          completedAt: st.completedAt,
          completedBy: st.completedBy,
          estimatedDays: parseInt(st.estimatedDays) || 0,
          estimatedHours: parseInt(st.estimatedHours) || 0,
          order: st.order || 0,
          createdAt: st.createdAt
        }
      })
      
      updates.subtasks = processedSubtasks
      
      // Track changes for timeline
      const newSubtaskCount = subtasks.filter(st => st.isNew || (st._id && st._id.toString().startsWith('new-'))).length
      const deletedCount = oldSubtaskIds.filter(id => !subtasks.find(st => st._id?.toString() === id)).length
      
      // Check for ETA changes
      let etaChanges = []
      subtasks.forEach(st => {
        if (st._id && !st._id.toString().startsWith('new-')) {
          const oldSt = oldSubtasks.find(o => o._id?.toString() === st._id?.toString())
          if (oldSt) {
            if ((oldSt.estimatedDays || 0) !== (parseInt(st.estimatedDays) || 0) || 
                (oldSt.estimatedHours || 0) !== (parseInt(st.estimatedHours) || 0)) {
              etaChanges.push(`"${st.title}" ETA updated`)
            }
            if (oldSt.title !== st.title) {
              changes.push(`Subtask renamed: "${oldSt.title}" → "${st.title}"`)
            }
            if (oldSt.completed !== st.completed) {
              changes.push(`Subtask "${st.title}" ${st.completed ? 'completed' : 'reopened'}`)
            }
          }
        }
      })
      
      if (newSubtaskCount > 0) {
        changes.push(`${newSubtaskCount} subtask${newSubtaskCount > 1 ? 's' : ''} added`)
      }
      if (deletedCount > 0) {
        changes.push(`${deletedCount} subtask${deletedCount > 1 ? 's' : ''} removed`)
      }
      if (etaChanges.length > 0) {
        changes.push(`Subtask ETAs updated: ${etaChanges.join(', ')}`)
      }
      
      // Recalculate progress
      const completedCount = processedSubtasks.filter(st => st.completed).length
      updates.progressPercentage = processedSubtasks.length > 0 
        ? Math.round((completedCount / processedSubtasks.length) * 100)
        : 0
    }

    await Task.findByIdAndUpdate(taskId, updates)

    const updaterEmployee = await Employee.findById(user.employeeId)

    // Create timeline events - pass models for multi-tenant
    if (status && status !== oldStatus) {
      // Build description with reason if provided
      const reasonText = statusChangeReason ? ` - Reason: "${statusChangeReason}"` : ''
      const eventDescription = `Task "${task.title}" status changed from ${oldStatus} to ${status}${reasonText}`
      
      // Create timeline event (don't await to speed up response)
      createTimelineEvent({
        project: projectId,
        type: 'task_status_changed',
        createdBy: user.employeeId,
        relatedTask: taskId,
        description: eventDescription,
        metadata: { 
          taskTitle: task.title, 
          oldStatus, 
          newStatus: status,
          reason: statusChangeReason || null,
          changedBy: {
            employeeId: user.employeeId,
            name: updaterEmployee ? `${updaterEmployee.firstName} ${updaterEmployee.lastName}` : 'Unknown'
          }
        }
      }, models).catch(console.error)

      // Notify relevant users (non-blocking)
      TaskAssignee.find({ 
        task: taskId, 
        assignmentStatus: 'accepted' 
      }).select('user').then(assignees => {
        const notifyEmployeeIds = [
          task.createdBy,
          ...assignees.map(a => a.user)
        ].filter(id => id.toString() !== user.employeeId.toString())

        User.find({ 
          employeeId: { $in: notifyEmployeeIds } 
        }).select('_id').then(notifyUsers => {
          notifyTaskStatusChanged(
            project, 
            task, 
            updaterEmployee, 
            notifyUsers.map(u => u._id),
            oldStatus,
            status
          ).catch(console.error)
        }).catch(console.error)
      }).catch(console.error)

      // Recalculate completion percentage if status changed (non-blocking) - pass models
      calculateCompletionPercentage(projectId, models).catch(console.error)
    } else if (changes.length > 0) {
      createTimelineEvent({
        project: projectId,
        type: 'task_updated',
        createdBy: user.employeeId,
        relatedTask: taskId,
        description: changes.join(', '),
        metadata: { changes, updates }
      }, models).catch(console.error)
    }

    const updatedTask = await Task.findById(taskId)
      .populate('createdBy', 'firstName lastName profilePicture')
      .populate('assignedBy', 'firstName lastName')

    // Emit real-time task update to all project members
    try {
      const memberUserIds = await getProjectMemberUserIds(projectId, null, models)
      
      emitTaskUpdate(
        {
          _id: updatedTask._id,
          title: updatedTask.title,
          status: updatedTask.status,
          priority: updatedTask.priority,
          project: projectId,
          progressPercentage: updatedTask.progressPercentage,
          dueDate: updatedTask.dueDate
        },
        memberUserIds.map(id => id.toString()),
        { 
          action: 'update', 
          statusChanged: status && status !== oldStatus,
          oldStatus,
          newStatus: status
        }
      )
    } catch (emitError) {
      console.error('Failed to emit task update:', emitError)
    }

    return NextResponse.json({
      success: true,
      message: 'Task updated successfully',
      data: updatedTask
    })
  } catch (error) {
    console.error('Update task error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}

// DELETE - Delete/Archive task (project head and admins delete immediately, others create deletion request)
export async function DELETE(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Project', 'Task', 'TaskAssignee', 'User', 'Employee', 'ProjectTimelineEvent'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Project, Task, TaskAssignee, User, Employee } = models

    const { projectId, taskId } = await params
    const { searchParams } = new URL(request.url)
    const reason = searchParams.get('reason') || ''
    const forceDelete = searchParams.get('force') === 'true'

    const userRecord = await User.findById(user._id || user.userId).select('employeeId role')
    if (!userRecord || !userRecord.employeeId) {
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

    // Check permissions
    const isAdmin = ['admin'].includes(userRecord.role || user.role)
    const projectHeadIds = project.projectHeads && project.projectHeads.length > 0 
      ? project.projectHeads.map(h => h.toString())
      : project.projectHead 
        ? [project.projectHead.toString()] 
        : []
    const isProjectHead = projectHeadIds.includes(userRecord.employeeId.toString())
    const isCreator = task.createdBy.toString() === userRecord.employeeId.toString()

    // Check if user is an assignee
    const isAssignee = await TaskAssignee.findOne({
      task: taskId,
      user: userRecord.employeeId,
      assignmentStatus: 'accepted'
    })

    // Project head and admins can delete immediately
    if (isAdmin || isProjectHead) {
      const taskTitle = task.title

      // Delete the task and its assignees
      await TaskAssignee.deleteMany({ task: taskId })
      await Task.findByIdAndDelete(taskId)

      // Recalculate completion percentage (non-blocking) - pass models
      calculateCompletionPercentage(projectId, models).catch(console.error)

      // Create timeline event (non-blocking) - pass models
      createTimelineEvent({
        project: projectId,
        type: 'task_deleted',
        createdBy: userRecord.employeeId,
        description: `Task "${taskTitle}" was deleted`,
        metadata: { taskTitle }
      }, models).catch(console.error)

      return NextResponse.json({
        success: true,
        message: 'Task deleted successfully'
      })
    }

    // For task creator or assignee - create a deletion request
    if (!isCreator && !isAssignee) {
      return NextResponse.json({ 
        success: false, 
        message: 'You do not have permission to request deletion of this task' 
      }, { status: 403 })
    }

    // Check if there's already a pending deletion request
    if (task.deletionRequest && task.deletionRequest.status === 'pending') {
      return NextResponse.json({ 
        success: false, 
        message: 'A deletion request is already pending for this task' 
      }, { status: 400 })
    }

    // Create deletion request
    task.deletionRequest = {
      status: 'pending',
      requestedBy: userRecord.employeeId,
      requestedAt: new Date(),
      reason: reason || 'No reason provided'
    }
    await task.save()

    // Create timeline event - pass models
    await createTimelineEvent({
      project: projectId,
      type: 'task_deletion_requested',
      createdBy: userRecord.employeeId,
      relatedTask: taskId,
      description: `Deletion requested for task "${task.title}"`,
      metadata: { taskTitle: task.title, reason }
    }, models)

    return NextResponse.json({
      success: true,
      message: 'Deletion request submitted. Awaiting approval from project head.'
    })
  } catch (error) {
    console.error('Delete task error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
