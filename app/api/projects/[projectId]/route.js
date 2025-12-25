import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import ProjectCompletionApproval from '@/models/ProjectCompletionApproval'
import { 
  checkProjectAccess, 
  getProjectTaskStats,
  createTimelineEvent,
  updateProjectStatus
} from '@/lib/projectService'

// GET - Get project details
export async function GET(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Project', 'ProjectMember', 'Task', 'TaskAssignee', 'ProjectTimelineEvent', 'Employee', 'Chat'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Project, ProjectMember, Task, TaskAssignee, ProjectTimelineEvent, Employee, Chat } = models

    const { projectId } = await params

    const employeeId = user?.employeeId?._id || user?.employeeId
    if (!employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    // Get project with all relationships
    const project = await Project.findById(projectId)
      .populate('projectHead', 'firstName lastName profilePicture email employeeCode')
      .populate('createdBy', 'firstName lastName profilePicture')
      .populate('department', 'name code')
      .populate('chatGroup')

    if (!project) {
      return NextResponse.json({ success: false, message: 'Project not found' }, { status: 404 })
    }

    // Check access (allow admins to view any project)
    const isAdmin = ['admin', 'hr'].includes(user.role)
    if (!isAdmin) {
      const { hasAccess } = await checkProjectAccess(projectId, employeeId, 'view')
      if (!hasAccess) {
        return NextResponse.json({ success: false, message: 'Access denied' }, { status: 403 })
      }
    }

    // Get members and deduplicate (in case any duplicates exist in DB)
    const allMembers = await ProjectMember.find({ project: projectId })
      .populate('user', 'firstName lastName profilePicture email employeeCode department')
      .populate('invitedBy', 'firstName lastName')
      .populate('sourceDepartment', 'name')
      .sort({ role: 1, createdAt: 1 })
    
    // Deduplicate members by user._id, keeping the first occurrence (usually 'head' role due to sort)
    const seenUserIds = new Set()
    const members = allMembers.filter(m => {
      if (!m.user || !m.user._id) return false
      const userId = m.user._id.toString()
      if (seenUserIds.has(userId)) return false
      seenUserIds.add(userId)
      return true
    })

    // Get task statistics
    const taskStats = await getProjectTaskStats(projectId)

    // Get pending completion approval if exists
    const pendingApproval = await ProjectCompletionApproval.findOne({
      project: projectId,
      status: 'pending'
    })
      .populate('requestedBy', 'firstName lastName')

    // Get current user's membership
    const userMembership = members.find(m => 
      m.user._id.toString() === user.employeeId.toString()
    )

    return NextResponse.json({
      success: true,
      data: {
        ...project.toObject(),
        members: members.map(m => ({
          ...m.toObject(),
          isCurrentUser: m.user._id.toString() === user.employeeId.toString()
        })),
        taskStats,
        pendingApproval,
        currentUserRole: userMembership?.role,
        currentUserInvitationStatus: userMembership?.invitationStatus,
        isProjectHead: project.projectHead._id.toString() === user.employeeId.toString(),
        isCreator: project.createdBy._id.toString() === user.employeeId.toString()
      }
    })
  } catch (error) {
    console.error('Get project error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}

// PUT - Update project
export async function PUT(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Project', 'Employee', 'Chat'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Project, Employee, Chat } = models

    const { projectId } = await params

    const employeeId = user?.employeeId?._id || user?.employeeId
    if (!employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    const project = await Project.findById(projectId)
    if (!project) {
      return NextResponse.json({ success: false, message: 'Project not found' }, { status: 404 })
    }

    // Only project head can update project (except admins)
    const isAdmin = ['admin'].includes(user.role)
    const isHead = project.projectHead.toString() === employeeId.toString()

    if (!isAdmin && !isHead) {
      return NextResponse.json({ 
        success: false, 
        message: 'Only project head can update the project' 
      }, { status: 403 })
    }

    const body = await request.json()
    const { name, description, startDate, endDate, priority, tags, status } = body

    const updates = {}
    const changes = []

    if (name && name !== project.name) {
      updates.name = name
      changes.push(`Name changed to "${name}"`)
      
      // Also update chat group name
      if (project.chatGroup) {
        await Chat.findByIdAndUpdate(project.chatGroup, { name })
      }
    }
    if (description !== undefined && description !== project.description) {
      updates.description = description
      changes.push('Description updated')
    }
    if (startDate && new Date(startDate).toISOString() !== project.startDate.toISOString()) {
      updates.startDate = new Date(startDate)
      changes.push(`Start date changed to ${new Date(startDate).toLocaleDateString()}`)
    }
    if (endDate && new Date(endDate).toISOString() !== project.endDate.toISOString()) {
      updates.endDate = new Date(endDate)
      changes.push(`End date changed to ${new Date(endDate).toLocaleDateString()}`)
    }
    if (priority && priority !== project.priority) {
      updates.priority = priority
      changes.push(`Priority changed to ${priority}`)
    }
    if (tags) {
      updates.tags = tags
    }

    // Handle status change separately using service
    if (status && status !== project.status) {
      const employee = await Employee.findById(employeeId)
      try {
        await updateProjectStatus(projectId, status, employee, { reason: 'Manual update' })
      } catch (err) {
        return NextResponse.json({ success: false, message: err.message }, { status: 400 })
      }
    }

    if (Object.keys(updates).length > 0) {
      await Project.findByIdAndUpdate(projectId, updates)

      const employee = await Employee.findById(employeeId)
      await createTimelineEvent({
        project: projectId,
        type: 'project_updated',
        createdBy: employeeId,
        description: changes.join(', '),
        metadata: { changes, updates }
      })
    }

    const updatedProject = await Project.findById(projectId)
      .populate('projectHead', 'firstName lastName profilePicture')
      .populate('createdBy', 'firstName lastName')
      .populate('department', 'name')

    return NextResponse.json({
      success: true,
      message: 'Project updated successfully',
      data: updatedProject
    })
  } catch (error) {
    console.error('Update project error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}

// DELETE - Archive project
export async function DELETE(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Project'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Project } = models

    const { projectId } = await params

    const employeeId = user?.employeeId?._id || user?.employeeId
    if (!employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    const project = await Project.findById(projectId)
    if (!project) {
      return NextResponse.json({ success: false, message: 'Project not found' }, { status: 404 })
    }

    // Only admin or project head can archive
    const isAdmin = ['admin'].includes(user.role)
    const isHead = project.projectHead.toString() === employeeId.toString()

    if (!isAdmin && !isHead) {
      return NextResponse.json({ 
        success: false, 
        message: 'Only admin or project head can archive the project' 
      }, { status: 403 })
    }

    // Archive instead of delete
    project.status = 'archived'
    await project.save()

    await createTimelineEvent({
      project: projectId,
      type: 'project_status_changed',
      createdBy: employeeId,
      description: 'Project archived',
      metadata: { oldStatus: project.status, newStatus: 'archived' }
    })

    return NextResponse.json({
      success: true,
      message: 'Project archived successfully'
    })
  } catch (error) {
    console.error('Delete project error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
