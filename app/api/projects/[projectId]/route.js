import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import {
  checkProjectAccess,
  getProjectTaskStats,
  createTimelineEvent,
  updateProjectStatus
} from '@/lib/projectService'
import { hasDepartmentAuthority } from '@/lib/hierarchyAuth'

// GET - Get project details
export async function GET(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Project', 'ProjectMember', 'Task', 'TaskAssignee', 'ProjectTimelineEvent', 'ProjectCompletionApproval', 'Employee', 'Chat'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Project, ProjectMember, Task, TaskAssignee, ProjectTimelineEvent, ProjectCompletionApproval, Employee, Chat } = models

    const { projectId } = await params

    const employeeId = user?.employeeId?._id || user?.employeeId
    if (!employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    // Get project with all relationships
    const project = await Project.findById(projectId)
      .populate('projectHead', 'firstName lastName profilePicture email employeeCode')
      .populate('projectHeads', 'firstName lastName profilePicture email employeeCode')
      .populate('createdBy', 'firstName lastName profilePicture')
      .populate('department', 'name code')
      .populate('projectManager', 'firstName lastName profilePicture email employeeCode')
      .populate({
        path: 'assignedTeams',
        select: 'teamName teamCode department teamLeaders members isActive',
        populate: [
          { path: 'teamLeaders', select: 'firstName lastName profilePicture' },
          { path: 'department', select: 'name' }
        ]
      })
      .populate('chatGroup')

    if (!project) {
      return NextResponse.json({ success: false, message: 'Project not found' }, { status: 404 })
    }

    // Check access (allow admins, hierarchy authorities, and project members)
    const isAdmin = ['admin', 'hr'].includes(user.role)
    if (!isAdmin) {
      const { hasAccess } = await checkProjectAccess(projectId, employeeId, 'view', models)
      // Also allow access via department hierarchy (dept head/manager of project's dept)
      const hasHierarchyAccess = project.department
        ? hasDepartmentAuthority(user, (project.department._id || project.department).toString())
        : false
      // Also allow team leaders of assigned teams
      const isTeamLeaderOfAssigned = user.teamLeaderOf?.some(tId =>
        project.assignedTeams?.some(at => (at._id || at).toString() === tId.toString())
      )
      if (!hasAccess && !hasHierarchyAccess && !isTeamLeaderOfAssigned) {
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

    // Get task statistics - pass models for multi-tenant
    const taskStats = await getProjectTaskStats(projectId, models)

    // Get pending completion approval if exists
    const pendingApproval = await ProjectCompletionApproval.findOne({
      project: projectId,
      status: 'pending'
    })
      .populate('requestedBy', 'firstName lastName')

    // Get current user's membership - use the extracted employeeId for consistency
    const userMembership = members.find(m =>
      m.user._id.toString() === employeeId.toString()
    )

    return NextResponse.json({
      success: true,
      data: {
        ...project.toObject(),
        members: members.map(m => ({
          ...m.toObject(),
          isCurrentUser: m.user._id.toString() === employeeId.toString()
        })),
        taskStats,
        pendingApproval,
        currentUserRole: userMembership?.role,
        currentUserInvitationStatus: userMembership?.invitationStatus,
        isProjectHead: project.projectHead?._id?.toString() === employeeId.toString() ||
          project.projectHeads?.some(h => h._id?.toString() === employeeId.toString()),
        isCreator: project.createdBy._id.toString() === employeeId.toString()
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
    const auth = await getAuthAndModels(request, ['Project', 'Employee', 'Chat', 'ProjectTimelineEvent', 'ProjectMember'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Project, Employee, Chat, ProjectMember } = models

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
    // Check against both single projectHead and projectHeads array
    const isAdmin = ['admin'].includes(user.role)
    const isHead = project.projectHead?.toString() === employeeId.toString() ||
      project.projectHeads?.some(h => h.toString() === employeeId.toString())

    if (!isAdmin && !isHead) {
      return NextResponse.json({
        success: false,
        message: 'Only project head can update the project'
      }, { status: 403 })
    }

    const body = await request.json()
    const { name, description, startDate, endDate, priority, tags, status, projectHeadIds } = body

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

    // Handle project heads update
    if (projectHeadIds && Array.isArray(projectHeadIds) && projectHeadIds.length > 0) {
      const currentHeadIds = (project.projectHeads || []).map(h => h.toString())
      const newHeadIds = projectHeadIds.map(h => h.toString())

      // Check if heads changed
      const headsChanged = newHeadIds.length !== currentHeadIds.length ||
        newHeadIds.some(h => !currentHeadIds.includes(h)) ||
        currentHeadIds.some(h => !newHeadIds.includes(h))

      if (headsChanged) {
        // Verify all new heads exist
        const newHeads = await Employee.find({ _id: { $in: projectHeadIds } })
        if (newHeads.length !== projectHeadIds.length) {
          return NextResponse.json({ success: false, message: 'One or more project heads not found' }, { status: 404 })
        }

        // Remove head role from removed heads
        const removedHeads = currentHeadIds.filter(h => !newHeadIds.includes(h))
        for (const headId of removedHeads) {
          // Change their role to member instead of removing
          await ProjectMember.updateOne(
            { project: projectId, user: headId, role: 'head' },
            { $set: { role: 'member' } }
          )
        }

        // Add head role to new heads
        const addedHeads = newHeadIds.filter(h => !currentHeadIds.includes(h))
        for (const headId of addedHeads) {
          // Check if already a member
          const existingMember = await ProjectMember.findOne({ project: projectId, user: headId })
          if (existingMember) {
            // Update to head role
            existingMember.role = 'head'
            await existingMember.save()
          } else {
            // Create new head member
            await ProjectMember.create({
              project: projectId,
              user: headId,
              role: 'head',
              invitationStatus: 'accepted',
              invitedBy: employeeId,
              respondedAt: new Date()
            })
          }
        }

        updates.projectHeads = projectHeadIds
        updates.projectHead = projectHeadIds[0] // Keep first as legacy

        const headNames = newHeads.map(h => `${h.firstName} ${h.lastName}`).join(', ')
        changes.push(`Project heads updated: ${headNames}`)
      }
    }

    // Handle status change separately using service
    if (status && status !== project.status) {
      const employee = await Employee.findById(employeeId)
      try {
        await updateProjectStatus(projectId, status, employee, { reason: 'Manual update' }, models)
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
      }, models)
    }

    const updatedProject = await Project.findById(projectId)
      .populate('projectHead', 'firstName lastName profilePicture')
      .populate('projectHeads', 'firstName lastName profilePicture')
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

// DELETE - Delete project and associated data
export async function DELETE(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Project', 'ProjectMember', 'ProjectTimelineEvent', 'Task', 'Chat', 'Message', 'ProjectNote'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Project, ProjectMember, ProjectTimelineEvent, Task, Chat, Message, ProjectNote } = models

    const { projectId } = await params

    const employeeId = user?.employeeId?._id || user?.employeeId
    if (!employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    const project = await Project.findById(projectId)
    if (!project) {
      return NextResponse.json({ success: false, message: 'Project not found' }, { status: 404 })
    }

    // Only admin or project head can delete
    const isAdmin = ['admin'].includes(user.role)
    const isHead = project.projectHead?.toString() === employeeId.toString() ||
      project.projectHeads?.some(h => h.toString() === employeeId.toString())

    if (!isAdmin && !isHead) {
      return NextResponse.json({
        success: false,
        message: 'Only admin or project head can delete the project'
      }, { status: 403 })
    }

    // Delete associated chat group and messages
    if (project.chatGroup) {
      try {
        // Delete all messages in the chat
        await Message.deleteMany({ chat: project.chatGroup })
        // Delete the chat group
        await Chat.findByIdAndDelete(project.chatGroup)
        console.log(`Deleted chat group ${project.chatGroup} for project ${projectId}`)
      } catch (chatErr) {
        console.error('Error deleting chat group:', chatErr.message)
      }
    }

    // Delete all project members
    await ProjectMember.deleteMany({ project: projectId })

    // Delete all project tasks
    await Task.deleteMany({ project: projectId })

    // Delete all project notes
    if (ProjectNote) {
      await ProjectNote.deleteMany({ project: projectId })
    }

    // Delete all timeline events
    await ProjectTimelineEvent.deleteMany({ project: projectId })

    // Delete the project
    await Project.findByIdAndDelete(projectId)

    return NextResponse.json({
      success: true,
      message: 'Project and all associated data deleted successfully'
    })
  } catch (error) {
    console.error('Delete project error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
