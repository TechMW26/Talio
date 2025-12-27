import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import mongoose from 'mongoose'
import { calculateCompletionPercentage, createTimelineEvent } from '@/lib/projectService'

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
    const auth = await getAuthAndModels(request, ['Task', 'TaskAssignee', 'User', 'Project', 'ProjectTimelineEvent', 'ProjectApprovalRequest'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Task, TaskAssignee, User, Project, ProjectTimelineEvent, ProjectApprovalRequest } = models

    const { taskId } = await params
    const body = await request.json()
    const { subtaskId, completed, title, order, estimatedDays, estimatedHours } = body

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

    // Build update object for the subtask
    const updateFields = {}
    const setOperations = {}

    if (completed !== undefined) {
      setOperations[`subtasks.${subtaskIndex}.completed`] = completed
      if (completed) {
        setOperations[`subtasks.${subtaskIndex}.completedAt`] = new Date()
        setOperations[`subtasks.${subtaskIndex}.completedBy`] = userRecord.employeeId
      } else {
        setOperations[`subtasks.${subtaskIndex}.completedAt`] = null
        setOperations[`subtasks.${subtaskIndex}.completedBy`] = null
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
    const updatedSubtasks = [...task.subtasks]
    if (completed !== undefined) {
      updatedSubtasks[subtaskIndex].completed = completed
    }
    if (estimatedDays !== undefined) {
      updatedSubtasks[subtaskIndex].estimatedDays = parseInt(estimatedDays) || 0
    }
    if (estimatedHours !== undefined) {
      updatedSubtasks[subtaskIndex].estimatedHours = parseInt(estimatedHours) || 0
    }

    const completedCount = updatedSubtasks.filter(st => st.completed).length
    const progressPercentage = updatedSubtasks.length > 0 
      ? Math.round((completedCount / updatedSubtasks.length) * 100)
      : 0
    setOperations.progressPercentage = progressPercentage

    // Auto-update task status based on subtask progress (only for tasks with subtasks)
    let statusChanged = false
    let newStatus = task.status
    let approvalCreated = false
    
    if (updatedSubtasks.length > 0) {
      // 1. If task is 'todo' and any subtask is marked done → move to 'in-progress'
      if (completed === true && task.status === 'todo') {
        setOperations.status = 'in-progress'
        statusChanged = true
        newStatus = 'in-progress'
      }
      
      // 2. If progress reaches 100% → move to 'review' and create approval request
      if (progressPercentage === 100 && !['completed', 'review', 'archived'].includes(task.status)) {
        setOperations.status = 'review'
        statusChanged = true
        newStatus = 'review'
        
        // Create approval request for task review
        const projectId = task.project?._id || task.project
        
        // Check if there's already a pending approval request for this task
        const existingRequest = await ProjectApprovalRequest.findOne({
          relatedTask: taskId,
          type: 'task_review',
          status: 'pending'
        })
        
        if (!existingRequest) {
          await ProjectApprovalRequest.create({
            project: projectId,
            type: 'task_review',
            status: 'pending',
            requestedBy: user.employeeId,
            relatedTask: taskId,
            reason: `Task "${task.title}" is 100% complete and ready for review`,
            metadata: {
              taskTitle: task.title,
              taskPriority: task.priority,
              completedBy: user.employeeId,
              progressPercentage: 100,
              trigger: 'subtask_completion'
            }
          })
          approvalCreated = true
        }
      }
      
      // 3. If subtask is unchecked and progress drops below 100% from completed/review → move back to 'in-progress'
      if (completed === false && ['completed', 'review'].includes(task.status) && progressPercentage < 100 && progressPercentage > 0) {
        setOperations.status = 'in-progress'
        statusChanged = true
        newStatus = 'in-progress'
        
        // Cancel any pending approval requests for this task
        await ProjectApprovalRequest.deleteMany({
          relatedTask: taskId,
          type: 'task_review',
          status: 'pending'
        })
      }
      
      // 4. If progress drops to 0% (all subtasks unchecked) → move back to 'todo'
      if (completed === false && progressPercentage === 0 && task.status !== 'todo' && !['completed', 'archived'].includes(task.status)) {
        setOperations.status = 'todo'
        statusChanged = true
        newStatus = 'todo'
        
        // Cancel any pending approval requests for this task
        await ProjectApprovalRequest.deleteMany({
          relatedTask: taskId,
          type: 'task_review',
          status: 'pending'
        })
      }
    }

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
      }
    }

    return NextResponse.json({
      success: true,
      message: statusChanged 
        ? `Subtask updated. Task moved to ${newStatus === 'in-progress' ? 'In Progress' : newStatus === 'review' ? 'Review (Pending Approval)' : newStatus === 'todo' ? 'To Do' : newStatus}`
        : 'Subtask updated successfully',
      data: {
        subtask: updatedTask.subtasks[subtaskIndex],
        progressPercentage: updatedTask.progressPercentage,
        taskStatus: updatedTask.status,
        statusChanged,
        approvalCreated
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
