import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { createTimelineEvent } from '@/lib/projectService'
import { queueProjectStatusChangedEmailNotifications } from '@/lib/projectEmailNotifications'

// GET - Check if project can be marked complete (all tasks completed)
export async function GET(request, { params }) {
  try {
    const auth = await getAuthAndModels(request, ['Project', 'Task', 'User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Project, Task, User } = models

    const { projectId } = await params

    const project = await Project.findById(projectId)
    if (!project) {
      return NextResponse.json({ success: false, message: 'Project not found' }, { status: 404 })
    }

    // Get all non-archived tasks
    const tasks = await Task.find({
      project: projectId,
      status: { $ne: 'archived' }
    }).select('status title')

    const totalTasks = tasks.length
    const completedTasks = tasks.filter(t => t.status === 'completed').length
    const allTasksCompleted = totalTasks === 0 || completedTasks === totalTasks
    const incompleteTasks = tasks.filter(t => t.status !== 'completed')

    return NextResponse.json({
      success: true,
      data: {
        canComplete: allTasksCompleted && !['completed', 'approved'].includes(project.status),
        totalTasks,
        completedTasks,
        allTasksCompleted,
        projectStatus: project.status,
        incompleteTasks: incompleteTasks.map(t => ({ id: t._id, title: t.title, status: t.status }))
      }
    })
  } catch (error) {
    console.error('Check completion status error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}

// POST - Mark project as complete (only if ALL tasks are completed)
export async function POST(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Project', 'Task', 'User', 'Employee', 'ProjectTimelineEvent', 'ProjectMember', 'ProjectEmailNotificationLog'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Project, Task, User, Employee } = models

    const { projectId } = await params

    const userRecord = await User.findById(user._id || user.userId).select('employeeId role')
    if (!userRecord || !userRecord.employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    const project = await Project.findById(projectId)
    if (!project) {
      return NextResponse.json({ success: false, message: 'Project not found' }, { status: 404 })
    }

    // Check if user is a project head (support both old and new structure)
    const projectHeadIds = project.projectHeads && project.projectHeads.length > 0
      ? project.projectHeads.map(h => h.toString())
      : project.projectHead
        ? [project.projectHead.toString()]
        : []

    const isProjectHead = projectHeadIds.includes(userRecord.employeeId.toString())
    const isAdmin = ['admin'].includes(userRecord.role || user.role)

    if (!isProjectHead && !isAdmin) {
      return NextResponse.json({
        success: false,
        message: 'Only project heads can mark the project as complete'
      }, { status: 403 })
    }

    // Check if ALL tasks are completed (not just percentage)
    const tasks = await Task.find({
      project: projectId,
      status: { $ne: 'archived' }
    }).select('status title')

    const totalTasks = tasks.length
    const completedTasks = tasks.filter(t => t.status === 'completed').length

    if (totalTasks > 0 && completedTasks !== totalTasks) {
      const incompleteTasks = tasks.filter(t => t.status !== 'completed')
      return NextResponse.json({
        success: false,
        message: `All tasks must be completed. ${totalTasks - completedTasks} task(s) remaining.`,
        data: {
          totalTasks,
          completedTasks,
          incompleteTasks: incompleteTasks.slice(0, 5).map(t => t.title) // Show first 5
        }
      }, { status: 400 })
    }

    // Check if already completed
    if (['completed', 'approved'].includes(project.status)) {
      return NextResponse.json({
        success: false,
        message: 'Project is already marked as complete'
      }, { status: 400 })
    }

    const employee = await Employee.findById(userRecord.employeeId)

    // Update project status to completed
    const oldStatus = project.status
    project.status = 'completed'
    project.completionPercentage = 100
    await project.save()

    // Create timeline event
    await createTimelineEvent({
      project: projectId,
      type: 'project_completed',
      createdBy: user.employeeId,
      description: `Project marked as completed by ${employee.firstName} ${employee.lastName}`,
      metadata: {
        completedBy: user.employeeId,
        completerName: `${employee.firstName} ${employee.lastName}`,
        completionPercentage: 100,
        totalTasks,
        completedTasks
      }
    }, models)

    try {
      await queueProjectStatusChangedEmailNotifications({
        projectId,
        oldStatus,
        newStatus: project.status,
        changedByEmployeeId: userRecord.employeeId,
        triggeredByUserId: user._id || user.userId || null,
        eventTimestamp: project.updatedAt || new Date(),
        models,
      })
    } catch (emailError) {
      console.error('Failed to queue project completion emails:', emailError)
    }

    return NextResponse.json({
      success: true,
      message: 'Project marked as complete successfully',
      data: project
    })
  } catch (error) {
    console.error('Mark project complete error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
