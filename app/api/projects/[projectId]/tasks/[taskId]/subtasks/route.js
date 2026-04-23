import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import mongoose from 'mongoose'
import { calculateCompletionPercentage, createTimelineEvent } from '@/lib/projectService'
import { queueTaskStatusChangedEmailNotifications } from '@/lib/projectEmailNotifications'

async function applySubtaskTaskState({
  task,
  progressPercentage,
  markingComplete = false,
  markingIncomplete = false,
  shouldAutoCompleteOnFullProgress = false,
  setOperations,
  ProjectApprovalRequest,
  requesterEmployeeId
}) {
  let statusChanged = false
  let newStatus = task.status
  let approvalCreated = false

  if (!task.subtasks || task.subtasks.length === 0) {
    return { statusChanged, newStatus, approvalCreated }
  }

  if (markingComplete && task.status === 'todo') {
    setOperations.status = 'in-progress'
    setOperations.completedAt = null
    statusChanged = true
    newStatus = 'in-progress'
  }

  if (progressPercentage === 100 && !['completed', 'review', 'archived'].includes(task.status)) {
    if (shouldAutoCompleteOnFullProgress) {
      setOperations.status = 'completed'
      setOperations.completedAt = new Date()
      statusChanged = true
      newStatus = 'completed'

      await ProjectApprovalRequest.deleteMany({
        relatedTask: task._id,
        type: 'task_review',
        status: 'pending'
      })
    } else {
      setOperations.status = 'review'
      setOperations.completedAt = null
      statusChanged = true
      newStatus = 'review'

      const projectId = task.project?._id || task.project
      if (projectId) {
        const existingRequest = await ProjectApprovalRequest.findOne({
          relatedTask: task._id,
          type: 'task_review',
          status: 'pending'
        })

        if (!existingRequest) {
          await ProjectApprovalRequest.create({
            project: projectId,
            type: 'task_review',
            status: 'pending',
            requestedBy: requesterEmployeeId,
            relatedTask: task._id,
            reason: `Task "${task.title}" is 100% complete and ready for review`,
            metadata: {
              taskTitle: task.title,
              taskPriority: task.priority,
              completedBy: requesterEmployeeId,
              progressPercentage: 100,
              trigger: 'subtask_completion'
            }
          })
          approvalCreated = true
        }
      }
    }
  }

  if (markingIncomplete && ['completed', 'review'].includes(task.status) && progressPercentage < 100 && progressPercentage > 0) {
    setOperations.status = 'in-progress'
    setOperations.completedAt = null
    statusChanged = true
    newStatus = 'in-progress'

    await ProjectApprovalRequest.deleteMany({
      relatedTask: task._id,
      type: 'task_review',
      status: 'pending'
    })
  }

  if (markingIncomplete && progressPercentage === 0 && !['todo', 'archived'].includes(task.status)) {
    setOperations.status = 'todo'
    setOperations.completedAt = null
    statusChanged = true
    newStatus = 'todo'

    await ProjectApprovalRequest.deleteMany({
      relatedTask: task._id,
      type: 'task_review',
      status: 'pending'
    })
  }

  return { statusChanged, newStatus, approvalCreated }
}

// GET - Get all subtasks for a task
export async function GET(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Task', 'TaskAssignee', 'User', 'Project', 'ProjectApprovalRequest'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Task, TaskAssignee, User, Project, ProjectApprovalRequest } = models

    const { taskId } = await params

    const task = await Task.findById(taskId).select('subtasks progressPercentage')
    if (!task) {
      return NextResponse.json({ success: false, message: 'Task not found' }, { status: 404 })
    }

    return NextResponse.json({
      success: true,
      data: {
        subtasks: task.subtasks || [],
        progressPercentage: task.progressPercentage || 0
      }
    })
  } catch (error) {
    console.error('Get subtasks error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}

// POST - Add a new subtask
export async function POST(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Task', 'TaskAssignee', 'User', 'Project', 'ProjectTimelineEvent'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Task, TaskAssignee, User, Project, ProjectTimelineEvent } = models

    const { taskId } = await params
    const body = await request.json()
    const { title, estimatedDays, estimatedHours } = body

    if (!title || !title.trim()) {
      return NextResponse.json({ success: false, message: 'Subtask title is required' }, { status: 400 })
    }

    const userRecord = await User.findById(user._id || user.userId).select('employeeId role')
    if (!userRecord || !userRecord.employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    const task = await Task.findById(taskId).populate('project', 'projectHeads projectHead')
    if (!task) {
      return NextResponse.json({ success: false, message: 'Task not found' }, { status: 404 })
    }

    // Check permissions - assignee, creator, assignedBy, project head, or admin can add subtasks
    const isAssignee = await TaskAssignee.findOne({
      task: taskId,
      user: userRecord.employeeId,
      assignmentStatus: 'accepted'
    })
    const isCreator = task.createdBy && task.createdBy.toString() === userRecord.employeeId.toString()
    const isAssigner = task.assignedBy && task.assignedBy.toString() === userRecord.employeeId.toString()

    // Safely get project head IDs
    let projectHeadIds = []
    if (task.project && typeof task.project === 'object') {
      if (task.project.projectHeads && task.project.projectHeads.length > 0) {
        projectHeadIds = task.project.projectHeads.map(h => h.toString())
      } else if (task.project.projectHead) {
        projectHeadIds = [task.project.projectHead.toString()]
      }
    }
    const isProjectHead = projectHeadIds.includes(userRecord.employeeId.toString())
    const isAdmin = ['admin'].includes(userRecord.role || user.role)

    if (!isAssignee && !isCreator && !isAssigner && !isProjectHead && !isAdmin) {
      return NextResponse.json({
        success: false,
        message: 'You do not have permission to add subtasks'
      }, { status: 403 })
    }

    // Add subtask with explicit _id and ETA
    const newSubtask = {
      _id: new mongoose.Types.ObjectId(),
      title: title.trim(),
      completed: false,
      estimatedDays: parseInt(estimatedDays) || 0,
      estimatedHours: parseInt(estimatedHours) || 0,
      order: task.subtasks ? task.subtasks.length : 0,
      createdAt: new Date()
    }

    // Use atomic $push operation for reliable array updates
    const currentSubtasks = [...(task.subtasks || []), newSubtask]

    // Calculate progress
    const completedCount = currentSubtasks.filter(st => st.completed).length
    const progressPercentage = currentSubtasks.length > 0
      ? Math.round((completedCount / currentSubtasks.length) * 100)
      : 0

    // Calculate total ETA from all subtasks
    let taskEstimatedHours = task.estimatedHours || 0
    const subtasksWithEta = currentSubtasks.filter(st => st.estimatedDays > 0 || st.estimatedHours > 0)
    if (subtasksWithEta.length > 0) {
      let totalHours = 0
      subtasksWithEta.forEach(st => {
        totalHours += (st.estimatedDays || 0) * 8 + (st.estimatedHours || 0)
      })
      taskEstimatedHours = totalHours
    }

    // Use findByIdAndUpdate with $push for atomic operation
    const updatedTask = await Task.findByIdAndUpdate(
      taskId,
      {
        $push: { subtasks: newSubtask },
        $set: {
          progressPercentage,
          estimatedHours: taskEstimatedHours
        }
      },
      { new: true }
    )

    if (!updatedTask) {
      return NextResponse.json({ success: false, message: 'Failed to add subtask' }, { status: 500 })
    }

    // Recalculate project completion percentage (includes subtask progress)
    const projectId = task.project?._id || task.project
    if (projectId) {
      calculateCompletionPercentage(projectId, models).catch(console.error)

      // Create timeline event for subtask addition
      createTimelineEvent({
        project: projectId,
        type: 'subtask_added',
        createdBy: user.employeeId,
        relatedTask: taskId,
        description: `Subtask "${newSubtask.title}" added to task "${task.title}"`,
        metadata: {
          taskTitle: task.title,
          subtaskTitle: newSubtask.title,
          estimatedDays: newSubtask.estimatedDays,
          estimatedHours: newSubtask.estimatedHours
        }
      }, models).catch(console.error)
    }

    return NextResponse.json({
      success: true,
      message: 'Subtask added successfully',
      data: {
        subtask: newSubtask,
        progressPercentage: updatedTask.progressPercentage,
        estimatedHours: updatedTask.estimatedHours
      }
    })
  } catch (error) {
    console.error('Add subtask error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}

// PUT - Update a subtask (toggle completion, update title, reorder, ETA)
export async function PUT(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Task', 'TaskAssignee', 'User', 'Employee', 'Project', 'ProjectMember', 'ProjectTimelineEvent', 'ProjectApprovalRequest', 'ProjectEmailNotificationLog'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Task, TaskAssignee, User, Project, ProjectTimelineEvent, ProjectApprovalRequest } = models

    const { taskId } = await params
    const body = await request.json()
    const { subtaskId, completed, title, order, estimatedDays, estimatedHours, action, reason } = body

    if (!subtaskId) {
      return NextResponse.json({ success: false, message: 'Subtask ID is required' }, { status: 400 })
    }

    const userRecord = await User.findById(user._id || user.userId).select('employeeId role')
    if (!userRecord || !userRecord.employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    const task = await Task.findById(taskId).populate('project', 'projectHeads projectHead')
    if (!task) {
      return NextResponse.json({ success: false, message: 'Task not found' }, { status: 404 })
    }

    // Check permissions - assignee, creator, assignedBy, project head, or admin can update subtasks
    const isAssignee = await TaskAssignee.findOne({
      task: taskId,
      user: userRecord.employeeId,
      assignmentStatus: 'accepted'
    })
    const isCreator = task.createdBy && task.createdBy.toString() === userRecord.employeeId.toString()
    const isAssigner = task.assignedBy && task.assignedBy.toString() === userRecord.employeeId.toString()

    // Safely get project head IDs
    let projectHeadIds = []
    if (task.project && typeof task.project === 'object') {
      if (task.project.projectHeads && task.project.projectHeads.length > 0) {
        projectHeadIds = task.project.projectHeads.map(h => h.toString())
      } else if (task.project.projectHead) {
        projectHeadIds = [task.project.projectHead.toString()]
      }
    }
    const isProjectHead = projectHeadIds.includes(userRecord.employeeId.toString())
    const isAdmin = ['admin'].includes(userRecord.role || user.role)

    if (!isAssignee && !isCreator && !isAssigner && !isProjectHead && !isAdmin) {
      return NextResponse.json({
        success: false,
        message: 'You do not have permission to update subtasks'
      }, { status: 403 })
    }

    // STRICT ENFORCEMENT: If task is in 'review' status and 100% complete,
    // only project head/admin can uncheck subtasks (through rejection flow)
    if (task.status === 'review' && !isProjectHead && !isAdmin) {
      const completedCount = task.subtasks.filter(st => st.completed).length
      const currentProgress = Math.round((completedCount / task.subtasks.length) * 100)

      if (currentProgress === 100 && completed === false) {
        return NextResponse.json({
          success: false,
          message: 'Task is under review. Subtasks cannot be modified until the project head reviews the task.'
        }, { status: 403 })
      }
    }

    // Find the subtask in the array
    if (!task.subtasks || task.subtasks.length === 0) {
      return NextResponse.json({ success: false, message: 'No subtasks found on this task' }, { status: 404 })
    }

    const subtaskIndex = task.subtasks.findIndex(st => st._id.toString() === subtaskId.toString())
    if (subtaskIndex === -1) {
      return NextResponse.json({ success: false, message: 'Subtask not found' }, { status: 404 })
    }

    const currentSubtask = task.subtasks[subtaskIndex]
    const shouldAutoCompleteOnFullProgress = !task.project || isProjectHead

    // Check how many assignees this task has (for multi-assignee flow)
    const allAssignees = await TaskAssignee.find({
      task: taskId,
      assignmentStatus: 'accepted'
    }).select('user')
    const assigneeIds = allAssignees.map(a => a.user.toString())
    const isMultiAssignee = assigneeIds.length > 1

    // Build update object for the subtask
    const updateFields = {}
    const setOperations = {}

    // Handle accept/reject actions for multi-assignee subtask completion
    if (action === 'acceptCompletion') {
      // Another assignee is accepting a subtask completion
      if (!currentSubtask.pendingAcceptance) {
        return NextResponse.json({
          success: false,
          message: 'This subtask is not pending acceptance'
        }, { status: 400 })
      }

      const acceptedBy = currentSubtask.acceptedBy || []
      const alreadyAccepted = acceptedBy.some(id => id.toString() === userRecord.employeeId.toString())

      if (alreadyAccepted) {
        return NextResponse.json({
          success: false,
          message: 'You have already accepted this completion'
        }, { status: 400 })
      }

      // Add to acceptedBy
      const newAcceptedBy = [...acceptedBy, userRecord.employeeId]
      setOperations[`subtasks.${subtaskIndex}.acceptedBy`] = newAcceptedBy

      // Check if all assignees have accepted
      const allAccepted = assigneeIds.every(id =>
        newAcceptedBy.some(accId => accId.toString() === id)
      )

      if (allAccepted) {
        // All assignees accepted - mark as fully complete
        setOperations[`subtasks.${subtaskIndex}.completed`] = true
        setOperations[`subtasks.${subtaskIndex}.pendingAcceptance`] = false
      }

      const updatedSubtasks = [...task.subtasks]
      updatedSubtasks[subtaskIndex] = {
        ...updatedSubtasks[subtaskIndex].toObject(),
        acceptedBy: newAcceptedBy,
        completed: allAccepted,
        pendingAcceptance: !allAccepted
      }

      const completedCount = updatedSubtasks.filter(st => st.completed && !st.pendingAcceptance).length
      const progressPercentage = updatedSubtasks.length > 0
        ? Math.round((completedCount / updatedSubtasks.length) * 100)
        : 0
      setOperations.progressPercentage = progressPercentage

      const { statusChanged, newStatus, approvalCreated } = await applySubtaskTaskState({
        task,
        progressPercentage,
        markingComplete: allAccepted,
        shouldAutoCompleteOnFullProgress,
        setOperations,
        ProjectApprovalRequest,
        requesterEmployeeId: userRecord.employeeId
      })

      const updatedTask = await Task.findByIdAndUpdate(taskId, { $set: setOperations }, { new: true })

      return NextResponse.json({
        success: true,
        message: allAccepted
          ? statusChanged
            ? `All assignees accepted. Task moved to ${newStatus === 'completed' ? 'Completed' : 'Review'}.`
            : 'All assignees accepted. Subtask marked complete!'
          : 'Acceptance recorded',
        data: {
          subtask: updatedTask.subtasks[subtaskIndex],
          allAccepted,
          progressPercentage,
          taskStatus: updatedTask.status,
          statusChanged,
          approvalCreated
        }
      })
    }

    if (action === 'rejectCompletion') {
      // Another assignee is rejecting a subtask completion
      if (!currentSubtask.pendingAcceptance) {
        return NextResponse.json({
          success: false,
          message: 'This subtask is not pending acceptance'
        }, { status: 400 })
      }

      // Reset the subtask - remove completion and pending state
      setOperations[`subtasks.${subtaskIndex}.completed`] = false
      setOperations[`subtasks.${subtaskIndex}.pendingAcceptance`] = false
      setOperations[`subtasks.${subtaskIndex}.completedAt`] = null
      setOperations[`subtasks.${subtaskIndex}.acceptedBy`] = []

      // Add rejection record
      const newRejection = {
        employee: userRecord.employeeId,
        reason: reason || 'No reason provided',
        rejectedAt: new Date()
      }
      const rejectedBy = currentSubtask.rejectedBy || []
      setOperations[`subtasks.${subtaskIndex}.rejectedBy`] = [...rejectedBy, newRejection]

      const updatedSubtasks = [...task.subtasks]
      updatedSubtasks[subtaskIndex] = {
        ...updatedSubtasks[subtaskIndex].toObject(),
        completed: false,
        pendingAcceptance: false,
        completedAt: null,
        acceptedBy: [],
        rejectedBy: [...rejectedBy, newRejection]
      }

      const completedCount = updatedSubtasks.filter(st => st.completed && !st.pendingAcceptance).length
      const progressPercentage = updatedSubtasks.length > 0
        ? Math.round((completedCount / updatedSubtasks.length) * 100)
        : 0
      setOperations.progressPercentage = progressPercentage

      const { statusChanged, newStatus, approvalCreated } = await applySubtaskTaskState({
        task,
        progressPercentage,
        markingIncomplete: true,
        shouldAutoCompleteOnFullProgress,
        setOperations,
        ProjectApprovalRequest,
        requesterEmployeeId: userRecord.employeeId
      })

      const updatedTask = await Task.findByIdAndUpdate(taskId, { $set: setOperations }, { new: true })

      return NextResponse.json({
        success: true,
        message: statusChanged
          ? `Subtask completion rejected. Task moved to ${newStatus === 'todo' ? 'To Do' : 'In Progress'}.`
          : 'Subtask completion rejected and reset',
        data: {
          subtask: updatedTask.subtasks[subtaskIndex],
          progressPercentage,
          taskStatus: updatedTask.status,
          statusChanged,
          approvalCreated
        }
      })
    }

    // Standard completion toggle logic
    if (completed !== undefined) {
      if (completed && isMultiAssignee) {
        // Multi-assignee task: Set pending acceptance instead of completing
        setOperations[`subtasks.${subtaskIndex}.pendingAcceptance`] = true
        setOperations[`subtasks.${subtaskIndex}.completedAt`] = new Date()
        setOperations[`subtasks.${subtaskIndex}.completedBy`] = userRecord.employeeId
        setOperations[`subtasks.${subtaskIndex}.acceptedBy`] = [userRecord.employeeId]
        setOperations[`subtasks.${subtaskIndex}.rejectedBy`] = []
        // Don't set completed=true yet - wait for all acceptances
      } else if (completed) {
        // Single assignee task: Complete immediately
        setOperations[`subtasks.${subtaskIndex}.completed`] = true
        setOperations[`subtasks.${subtaskIndex}.completedAt`] = new Date()
        setOperations[`subtasks.${subtaskIndex}.completedBy`] = userRecord.employeeId
        setOperations[`subtasks.${subtaskIndex}.pendingAcceptance`] = false
      } else {
        // Unchecking the subtask
        setOperations[`subtasks.${subtaskIndex}.completed`] = false
        setOperations[`subtasks.${subtaskIndex}.completedAt`] = null
        setOperations[`subtasks.${subtaskIndex}.completedBy`] = null
        setOperations[`subtasks.${subtaskIndex}.pendingAcceptance`] = false
        setOperations[`subtasks.${subtaskIndex}.acceptedBy`] = []
      }
    }

    if (title !== undefined && title.trim()) {
      setOperations[`subtasks.${subtaskIndex}.title`] = title.trim()
    }

    if (order !== undefined) {
      setOperations[`subtasks.${subtaskIndex}.order`] = order
    }

    if (estimatedDays !== undefined) {
      setOperations[`subtasks.${subtaskIndex}.estimatedDays`] = parseInt(estimatedDays) || 0
    }
    if (estimatedHours !== undefined) {
      setOperations[`subtasks.${subtaskIndex}.estimatedHours`] = parseInt(estimatedHours) || 0
    }

    // Calculate new progress based on updated subtasks
    // Note: For multi-assignee tasks, subtasks with pendingAcceptance don't count as complete
    const updatedSubtasks = [...task.subtasks]
    if (completed !== undefined) {
      // For multi-assignee: marking complete sets pendingAcceptance, not completed
      if (completed && isMultiAssignee) {
        updatedSubtasks[subtaskIndex].pendingAcceptance = true
        updatedSubtasks[subtaskIndex].completed = false
      } else {
        updatedSubtasks[subtaskIndex].completed = completed
        updatedSubtasks[subtaskIndex].pendingAcceptance = false
      }
    }
    if (estimatedDays !== undefined) {
      updatedSubtasks[subtaskIndex].estimatedDays = parseInt(estimatedDays) || 0
    }
    if (estimatedHours !== undefined) {
      updatedSubtasks[subtaskIndex].estimatedHours = parseInt(estimatedHours) || 0
    }

    // Only fully completed subtasks count towards progress
    const completedCount = updatedSubtasks.filter(st => st.completed && !st.pendingAcceptance).length
    const pendingCount = updatedSubtasks.filter(st => st.pendingAcceptance).length
    const progressPercentage = updatedSubtasks.length > 0
      ? Math.round((completedCount / updatedSubtasks.length) * 100)
      : 0
    setOperations.progressPercentage = progressPercentage

    const { statusChanged, newStatus, approvalCreated } = await applySubtaskTaskState({
      task,
      progressPercentage,
      markingComplete: completed === true,
      markingIncomplete: completed === false,
      shouldAutoCompleteOnFullProgress,
      setOperations,
      ProjectApprovalRequest,
      requesterEmployeeId: userRecord.employeeId
    })

    // Recalculate total task ETA from all subtasks
    const subtasksWithEta = updatedSubtasks.filter(st => st.estimatedDays > 0 || st.estimatedHours > 0)
    if (subtasksWithEta.length > 0) {
      let totalHours = 0
      subtasksWithEta.forEach(st => {
        totalHours += (st.estimatedDays || 0) * 8 + (st.estimatedHours || 0)
      })
      setOperations.estimatedHours = totalHours
    }

    // Use atomic update
    const updatedTask = await Task.findByIdAndUpdate(
      taskId,
      { $set: setOperations },
      { new: true }
    )

    if (!updatedTask) {
      return NextResponse.json({ success: false, message: 'Failed to update subtask' }, { status: 500 })
    }

    // Recalculate project completion percentage
    const projectId = task.project?._id || task.project
    if (projectId) {
      calculateCompletionPercentage(projectId, models).catch(console.error)

      // Create timeline event for subtask update
      const subtaskTitle = updatedSubtasks[subtaskIndex]?.title || 'Subtask'
      let timelineDescription = ''
      let timelineType = 'subtask_updated'

      if (completed !== undefined) {
        timelineType = completed ? 'subtask_completed' : 'subtask_reopened'
        timelineDescription = `Subtask "${subtaskTitle}" ${completed ? 'completed' : 'reopened'} on task "${task.title}"`
      } else if (estimatedDays !== undefined || estimatedHours !== undefined) {
        timelineDescription = `Subtask "${subtaskTitle}" ETA updated on task "${task.title}"`
      } else if (title !== undefined) {
        timelineDescription = `Subtask renamed to "${title}" on task "${task.title}"`
      }

      if (timelineDescription) {
        createTimelineEvent({
          project: projectId,
          type: timelineType,
          createdBy: userRecord.employeeId,
          relatedTask: taskId,
          description: timelineDescription,
          metadata: {
            taskTitle: task.title,
            subtaskTitle,
            completed,
            progressPercentage,
            statusChanged,
            newStatus
          }
        }, models).catch(console.error)
      }

      // Additional timeline event for task status change
      if (statusChanged) {
        let statusDescription = ''
        if (newStatus === 'in-progress') {
          statusDescription = 'In Progress'
        } else if (newStatus === 'review') {
          statusDescription = 'Review (Pending Approval)'
        } else if (newStatus === 'todo') {
          statusDescription = 'To Do'
        } else {
          statusDescription = newStatus.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
        }

        createTimelineEvent({
          project: projectId,
          type: 'task_status_changed',
          createdBy: userRecord.employeeId,
          relatedTask: taskId,
          description: `Task "${task.title}" automatically moved to ${statusDescription} after subtask update`,
          metadata: {
            taskTitle: task.title,
            oldStatus: task.status,
            newStatus,
            trigger: 'subtask_completion',
            approvalCreated
          }
        }, models).catch(console.error)

        queueTaskStatusChangedEmailNotifications({
          projectId,
          taskId,
          oldStatus: task.status,
          newStatus: updatedTask.status,
          changedByEmployeeId: userRecord.employeeId,
          triggeredByUserId: user._id || user.userId || null,
          eventTimestamp: updatedTask.updatedAt || new Date(),
          models,
        }).catch(console.error)
      }
    }

    // Build appropriate message
    let message = 'Subtask updated successfully'
    if (statusChanged) {
      message = `Subtask updated. Task moved to ${newStatus === 'in-progress' ? 'In Progress' : newStatus === 'review' ? 'Review (Pending Approval)' : newStatus === 'todo' ? 'To Do' : newStatus}`
    } else if (completed && isMultiAssignee) {
      message = 'Subtask marked for completion. Waiting for other assignees to accept.'
    }

    return NextResponse.json({
      success: true,
      message,
      data: {
        subtask: updatedTask.subtasks[subtaskIndex],
        progressPercentage: updatedTask.progressPercentage,
        taskStatus: updatedTask.status,
        statusChanged,
        approvalCreated,
        isMultiAssignee,
        pendingAcceptance: isMultiAssignee && completed
      }
    })
  } catch (error) {
    console.error('Update subtask error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}

// DELETE - Delete a subtask
export async function DELETE(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Task', 'TaskAssignee', 'User', 'Project', 'ProjectTimelineEvent'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user: authUser, models } = auth
    const { Task, TaskAssignee, User, Project, ProjectTimelineEvent } = models

    const { taskId } = await params
    const { searchParams } = new URL(request.url)
    const subtaskId = searchParams.get('subtaskId')

    if (!subtaskId) {
      return NextResponse.json({ success: false, message: 'Subtask ID is required' }, { status: 400 })
    }

    const userRecord = await User.findById(authUser._id || authUser.userId).select('employeeId role')
    if (!userRecord || !userRecord.employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    const task = await Task.findById(taskId).populate('project', 'projectHeads projectHead')
    if (!task) {
      return NextResponse.json({ success: false, message: 'Task not found' }, { status: 404 })
    }

    // Check permissions - creator, assignedBy, assignee, project head, or admin can delete subtasks
    const isCreator = task.createdBy && task.createdBy.toString() === userRecord.employeeId.toString()
    const isAssigner = task.assignedBy && task.assignedBy.toString() === userRecord.employeeId.toString()
    const isAssignee = await TaskAssignee.findOne({
      task: taskId,
      user: userRecord.employeeId,
      assignmentStatus: 'accepted'
    })

    // Safely get project head IDs
    let projectHeadIds = []
    if (task.project && typeof task.project === 'object') {
      if (task.project.projectHeads && task.project.projectHeads.length > 0) {
        projectHeadIds = task.project.projectHeads.map(h => h.toString())
      } else if (task.project.projectHead) {
        projectHeadIds = [task.project.projectHead.toString()]
      }
    }
    const isProjectHead = projectHeadIds.includes(userRecord.employeeId.toString())
    const isAdmin = ['admin'].includes(userRecord.role || user.role)

    if (!isCreator && !isAssigner && !isAssignee && !isProjectHead && !isAdmin) {
      return NextResponse.json({
        success: false,
        message: 'You do not have permission to delete subtasks'
      }, { status: 403 })
    }

    // Calculate new progress after removing the subtask
    const deletedSubtask = (task.subtasks || []).find(st => st._id.toString() === subtaskId.toString())
    const remainingSubtasks = (task.subtasks || []).filter(st => st._id.toString() !== subtaskId.toString())
    const completedCount = remainingSubtasks.filter(st => st.completed).length
    const progressPercentage = remainingSubtasks.length > 0
      ? Math.round((completedCount / remainingSubtasks.length) * 100)
      : 0

    // Use atomic $pull operation to remove subtask
    const updatedTask = await Task.findByIdAndUpdate(
      taskId,
      {
        $pull: { subtasks: { _id: new mongoose.Types.ObjectId(subtaskId) } },
        $set: { progressPercentage }
      },
      { new: true }
    )

    if (!updatedTask) {
      return NextResponse.json({ success: false, message: 'Failed to delete subtask' }, { status: 500 })
    }

    // Recalculate project completion percentage
    const projectId = task.project?._id || task.project
    if (projectId) {
      calculateCompletionPercentage(projectId, models).catch(console.error)

      // Create timeline event for subtask deletion
      createTimelineEvent({
        project: projectId,
        type: 'subtask_deleted',
        createdBy: userRecord.employeeId,
        relatedTask: taskId,
        description: `Subtask "${deletedSubtask?.title || 'Unknown'}" deleted from task "${task.title}"`,
        metadata: {
          taskTitle: task.title,
          subtaskTitle: deletedSubtask?.title,
          remainingSubtasks: remainingSubtasks.length
        }
      }, models).catch(console.error)
    }

    return NextResponse.json({
      success: true,
      message: 'Subtask deleted successfully',
      data: {
        progressPercentage: updatedTask.progressPercentage
      }
    })
  } catch (error) {
    console.error('Delete subtask error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
