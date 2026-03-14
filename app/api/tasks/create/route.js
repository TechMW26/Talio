import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import mongoose from 'mongoose'
import {
  calculateCompletionPercentage,
  createTimelineEvent
} from '@/lib/projectService'
import { notifyTaskAssigned } from '@/lib/projectNotifications'
import { createTaskAssignmentNotification } from '@/lib/actionableNotifications'

/**
 * POST /api/tasks/create
 * 
 * Create a standalone task with optional project association.
 * Allows assigning tasks to any employee without requiring a project.
 */
export async function POST(request) {
  try {
    const auth = await getAuthAndModels(request, [
      'Project', 'ProjectMember', 'Task', 'TaskAssignee',
      'User', 'Employee', 'ProjectTimelineEvent', 'ActionableNotification'
    ])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Project, ProjectMember, Task, TaskAssignee, User, Employee } = models

    const userRecord = await User.findById(user._id || user.userId).select('employeeId role')
    if (!userRecord || !userRecord.employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    const body = await request.json()
    const {
      title,
      description,
      priority,
      dueDate,
      startDate,
      assigneeIds = [],
      tags,
      estimatedHours,
      subtasks = [],
      attachments: rawAttachments,
      projectId // Optional — if provided, task is linked to this project
    } = body

    if (!title || !title.trim()) {
      return NextResponse.json({ success: false, message: 'Task title is required' }, { status: 400 })
    }

    if (assigneeIds.length === 0) {
      return NextResponse.json({ success: false, message: 'At least one assignee is required' }, { status: 400 })
    }

    // Validate project if provided
    let project = null
    if (projectId) {
      project = await Project.findById(projectId)
      if (!project) {
        return NextResponse.json({ success: false, message: 'Project not found' }, { status: 404 })
      }
    }

    // Safely normalize attachments
    let finalAttachments = []
    try {
      if (rawAttachments && Array.isArray(rawAttachments)) {
        finalAttachments = rawAttachments
          .filter(item => item && typeof item === 'object' && item.name && item.url)
          .map(item => ({
            name: String(item.name || ''),
            url: String(item.url || ''),
            type: item.type ? String(item.type) : undefined,
            size: typeof item.size === 'number' ? item.size : undefined,
            uploadedBy: userRecord.employeeId,
            uploadedAt: new Date()
          }))
      }
    } catch (attachmentError) {
      console.warn('[Tasks/Create] Failed to process attachments:', attachmentError)
      finalAttachments = []
    }

    // Get order: for project tasks, continue from existing tasks; for standalone, start from 0
    let order = 0
    if (projectId) {
      const lastTask = await Task.findOne({ project: projectId }).sort({ order: -1 })
      order = lastTask ? lastTask.order + 1 : 0
    }

    // Prepare subtasks
    const formattedSubtasks = subtasks.map((st, index) => ({
      _id: new mongoose.Types.ObjectId(),
      title: st.title,
      completed: false,
      estimatedDays: parseInt(st.estimatedDays) || 0,
      estimatedHours: parseInt(st.estimatedHours) || 0,
      order: index,
      createdAt: new Date()
    }))

    // Calculate dates from ETA if self-assigned
    let calculatedStartDate = startDate ? new Date(startDate) : undefined
    let calculatedDueDate = dueDate ? new Date(dueDate) : undefined

    if (estimatedHours && assigneeIds.includes(userRecord.employeeId.toString())) {
      calculatedStartDate = new Date()
      const workDays = Math.ceil(estimatedHours / 8)
      calculatedDueDate = new Date()
      calculatedDueDate.setDate(calculatedDueDate.getDate() + workDays)
    }

    // Create the task
    const taskData = {
      title: title.trim(),
      description,
      status: 'todo',
      priority: priority || 'medium',
      createdBy: userRecord.employeeId,
      assignedBy: assigneeIds.length > 0 ? userRecord.employeeId : undefined,
      dueDate: calculatedDueDate,
      startDate: calculatedStartDate,
      tags: tags || [],
      estimatedHours,
      order,
      subtasks: formattedSubtasks,
      progressPercentage: 0,
      attachments: finalAttachments
    }

    // Only set project if provided
    if (projectId) {
      taskData.project = projectId
    }

    const task = await Task.create(taskData)

    const creatorEmployee = await Employee.findById(userRecord.employeeId)

    // Create timeline event if associated with a project
    if (projectId) {
      const taskDescription = estimatedHours && assigneeIds.includes(user.employeeId.toString())
        ? `Task "${title}" was created with ${estimatedHours}h ETA`
        : `Task "${title}" was created`

      await createTimelineEvent({
        project: projectId,
        type: 'task_created',
        createdBy: user.employeeId,
        relatedTask: task._id,
        description: taskDescription,
        metadata: { taskTitle: title, priority, estimatedHours }
      }, models)
    }

    // Assign to users
    for (const assigneeId of assigneeIds) {
      const assigneeIdStr = assigneeId.toString()

      // Verify assignee exists
      const assigneeEmployee = await Employee.findById(assigneeIdStr)
      if (!assigneeEmployee) continue

      // If project-linked, check project membership (skip for standalone tasks)
      if (projectId) {
        const isMember = await ProjectMember.findOne({
          project: projectId,
          user: assigneeIdStr,
          invitationStatus: 'accepted'
        })
        if (!isMember && assigneeIdStr !== userRecord.employeeId.toString()) {
          continue
        }
      }

      await TaskAssignee.create({
        task: task._id,
        user: assigneeIdStr,
        assignedBy: user.employeeId,
        assignmentStatus: assigneeIdStr === user.employeeId.toString() ? 'accepted' : 'pending'
      })

      // Create timeline event for project tasks
      if (projectId) {
        await createTimelineEvent({
          project: projectId,
          type: 'task_assigned',
          createdBy: user.employeeId,
          relatedTask: task._id,
          relatedMember: assigneeIdStr,
          description: `Task "${title}" was assigned to ${assigneeEmployee.firstName} ${assigneeEmployee.lastName}`,
          metadata: { taskTitle: title, assigneeName: `${assigneeEmployee.firstName} ${assigneeEmployee.lastName}` }
        }, models)
      }

      // Notify non-self assignments
      if (assigneeIdStr !== user.employeeId.toString()) {
        if (project) {
          await notifyTaskAssigned(project, task, assigneeEmployee, creatorEmployee, models)
        }

        try {
          const assigneeUser = await User.findOne({ employeeId: assigneeIdStr }).select('_id')
          if (assigneeUser) {
            await createTaskAssignmentNotification(models, {
              targetUserId: assigneeUser._id,
              taskId: task._id,
              taskTitle: title,
              projectId: projectId || null,
              projectName: project?.name || 'Standalone Task',
              assignedBy: userRecord.employeeId,
              assignedByName: creatorEmployee ? `${creatorEmployee.firstName} ${creatorEmployee.lastName}` : 'Someone',
              dueDate: calculatedDueDate,
              priority: priority || 'medium'
            })
          }
        } catch (actionErr) {
          console.error('[Tasks/Create] Error creating actionable notification:', actionErr)
        }
      }
    }

    // Recalculate project completion if project-linked
    if (projectId) {
      await calculateCompletionPercentage(projectId, models)
    }

    // Fetch populated task
    const populatedTask = await Task.findById(task._id)
      .populate('project', 'name status')
      .populate('createdBy', 'firstName lastName profilePicture')
      .populate('assignedBy', 'firstName lastName')

    const taskAssignees = await TaskAssignee.find({ task: task._id })
      .populate('user', 'firstName lastName profilePicture employeeCode')

    return NextResponse.json({
      success: true,
      message: 'Task created successfully',
      data: {
        ...populatedTask.toObject(),
        assignees: taskAssignees
      }
    }, { status: 201 })
  } catch (error) {
    console.error('Create standalone task error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
