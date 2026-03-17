import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import {
  createProject,
  calculateCompletionPercentage,
  createTimelineEvent
} from '@/lib/projectService'
import {
  notifyProjectInvitation,
  getProjectMemberUserIds
} from '@/lib/projectNotifications'
import { emitProjectUpdate } from '@/lib/realtimeEvents'
import { getProjectVisibilityFilter } from '@/lib/hierarchyAuth'

export const dynamic = 'force-dynamic'

// GET - List projects for current user
export async function GET(request) {
  console.log('GET /api/projects called');
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Project', 'ProjectMember', 'User', 'Employee', 'Task', 'Team'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user: authUser, models } = auth
    const { Project, ProjectMember, User, Employee, Task } = models

    // Get employeeId - could be object or string
    const employeeId = authUser.employeeId?._id || authUser.employeeId
    if (!employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const role = searchParams.get('role')
    const invitationStatus = searchParams.get('invitationStatus')
    const all = searchParams.get('all') // For admin to see all projects
    const departmentParam = searchParams.get('department')
    const departmentsParam = searchParams.get('departments') // Comma-separated list of department IDs

    let projects

    // Admin can see all projects
    if (all === 'true' && ['admin', 'hr'].includes(authUser.role)) {
      const query = {}
      if (status) {
        query.status = status === 'active'
          ? { $in: ['planned', 'ongoing', 'pending', 'completed_pending_approval'] }
          : status
      }
      if (!status) {
        query.status = { $ne: 'archived' }
      }

      // Apply department filter
      if (departmentsParam) {
        const deptIds = departmentsParam.split(',').filter(id => id.trim())
        if (deptIds.length > 0) {
          query.department = { $in: deptIds }
        }
      } else if (departmentParam && departmentParam !== 'all') {
        query.department = departmentParam
      }

      projects = await Project.find(query)
        .populate('projectHead', 'firstName lastName profilePicture')
        .populate('projectHeads', 'firstName lastName profilePicture')
        .populate('createdBy', 'firstName lastName')
        .populate('department', 'name')
        .populate('projectManager', 'firstName lastName profilePicture')
        .populate('assignedTeams', 'teamName teamCode department')
        .sort({ updatedAt: -1 })
    } else {
      // Regular user - get their projects using hierarchy-aware visibility
      // This includes projects they're members of + projects they can see via dept/team hierarchy
      const hierarchyFilter = await getProjectVisibilityFilter(authUser, models)

      // Also get direct memberships for role/invitation filtering
      const memberQuery = { user: employeeId }

      if (invitationStatus) {
        memberQuery.invitationStatus = invitationStatus
      }
      if (role) {
        memberQuery.role = role
      }

      const memberships = await ProjectMember.find(memberQuery)
        .select('project role invitationStatus')

      const memberProjectIds = memberships.map(m => m.project)

      // Combine: membership-based + hierarchy-based visibility
      const projectQuery = {
        $or: [
          { _id: { $in: memberProjectIds } },
          ...(hierarchyFilter.$or || (Object.keys(hierarchyFilter).length > 0 ? [hierarchyFilter] : []))
        ]
      }

      // Remove empty $or
      if (projectQuery.$or.length === 0) {
        projectQuery._id = { $in: memberProjectIds }
        delete projectQuery.$or
      }

      if (status) {
        const statusArray = status === 'active'
          ? ['planned', 'ongoing', 'pending', 'completed_pending_approval', 'overdue']
          : status.split(',')
        projectQuery.status = { $in: statusArray }
      }

      // Exclude archived unless specifically requested
      if (!status) {
        projectQuery.status = { $ne: 'archived' }
      }

      const projectResults = await Project.find(projectQuery)
        .populate('projectHead', 'firstName lastName profilePicture')
        .populate('projectHeads', 'firstName lastName profilePicture')
        .populate('createdBy', 'firstName lastName')
        .populate('department', 'name')
        .populate('projectManager', 'firstName lastName profilePicture')
        .populate('assignedTeams', 'teamName teamCode department')
        .sort({ updatedAt: -1 })

      // Attach membership info to each project (if user is a member)
      projects = projectResults.map(project => {
        const membership = memberships.find(m => m.project.toString() === project._id.toString())
        return {
          ...project.toObject(),
          userRole: membership?.role,
          userInvitationStatus: membership?.invitationStatus,
          isHierarchyVisible: !membership // true if visible via org hierarchy rather than direct membership
        }
      })
    }

    // Helper function to get task stats (inline with tenant Task model)
    async function getTaskStats(projectId) {
      const tasks = await Task.find({
        project: projectId,
        status: { $ne: 'archived' }
      }).select('status dueDate')

      const now = new Date()

      return {
        total: tasks.length,
        completed: tasks.filter(t => t.status === 'completed').length,
        inProgress: tasks.filter(t => t.status === 'in-progress').length,
        todo: tasks.filter(t => t.status === 'todo').length,
        review: tasks.filter(t => t.status === 'review').length,
        blocked: tasks.filter(t => t.status === 'blocked').length,
        rejected: tasks.filter(t => t.status === 'rejected').length,
        overdue: tasks.filter(t =>
          t.dueDate && new Date(t.dueDate) < now &&
          !['completed', 'archived'].includes(t.status)
        ).length
      }
    }

    // Add task stats to each project
    const projectsWithStats = await Promise.all(projects.map(async (project) => {
      const stats = await getTaskStats(project._id)
      return {
        ...project.toObject ? project.toObject() : project,
        taskStats: stats
      }
    }))

    return NextResponse.json({
      success: true,
      data: projectsWithStats,
      currentEmployeeId: employeeId.toString()
    })
  } catch (error) {
    console.error('Get projects error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}

// POST - Create a new project
export async function POST(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Project', 'ProjectMember', 'User', 'Employee', 'Chat', 'ProjectTimelineEvent', 'Notification', 'Team'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user: authUser, models } = auth
    const { Project, User, Employee, Team, ProjectMember } = models

    // Get employeeId - could be object or string
    const employeeId = authUser.employeeId?._id || authUser.employeeId
    if (!employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    const creatorEmployee = await Employee.findById(employeeId)
    if (!creatorEmployee) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    const body = await request.json()
    const {
      name,
      description,
      startDate,
      endDate,
      projectHeadId,  // Legacy support - single head
      projectHeadIds, // New - multiple heads
      members = [],
      priority,
      department,
      tags,
      status,
      assignedTeamIds, // NEW — array of Team IDs to assign
      projectManagerId // NEW — employee ID for project manager
    } = body

    // Support both single and multiple heads
    let headIds = projectHeadIds?.length ? projectHeadIds : (projectHeadId ? [projectHeadId] : [])

    // Default to creator as project head if none specified
    if (headIds.length === 0) {
      headIds = [employeeId.toString()]
    }

    // Validate required fields
    if (!name || !startDate || !endDate || headIds.length === 0) {
      return NextResponse.json({
        success: false,
        message: 'Name, start date, end date, and at least one project head are required'
      }, { status: 400 })
    }

    // Validate dates
    const start = new Date(startDate)
    const end = new Date(endDate)
    if (end < start) {
      return NextResponse.json({
        success: false,
        message: 'End date must be after start date'
      }, { status: 400 })
    }

    // Verify all project heads exist
    const projectHeads = await Employee.find({ _id: { $in: headIds } })
    if (projectHeads.length !== headIds.length) {
      return NextResponse.json({
        success: false,
        message: 'One or more project heads not found'
      }, { status: 404 })
    }

    // Validate and resolve assigned teams
    let assignedTeams = []
    let autoAddMembers = [...members]
    if (assignedTeamIds?.length) {
      const teams = await Team.find({ _id: { $in: assignedTeamIds }, isActive: true })
        .populate('teamLeaders', '_id firstName lastName')
        .populate('members', '_id')
      if (teams.length !== assignedTeamIds.length) {
        return NextResponse.json({
          success: false,
          message: 'One or more assigned teams not found or inactive'
        }, { status: 404 })
      }
      assignedTeams = teams.map(t => t._id)

      // Auto-add team leaders as project members with role 'team_leader'
      const existingMemberIds = new Set([
        ...members.map(m => m.userId?.toString()),
        ...headIds.map(id => id.toString()),
        employeeId.toString()
      ])
      for (const team of teams) {
        for (const leader of (team.teamLeaders || [])) {
          const lid = leader._id.toString()
          if (!existingMemberIds.has(lid)) {
            autoAddMembers.push({ userId: lid, role: 'team_leader', isExternal: false })
            existingMemberIds.add(lid)
          }
        }
      }
    }

    // Validate project manager
    let projectManagerRef = undefined
    if (projectManagerId) {
      const pmEmployee = await Employee.findById(projectManagerId)
      if (!pmEmployee) {
        return NextResponse.json({
          success: false,
          message: 'Project manager employee not found'
        }, { status: 404 })
      }
      projectManagerRef = projectManagerId
    }

    // Create the project with service - pass models for multi-tenant support
    const project = await createProject(
      {
        name,
        description,
        startDate: start,
        endDate: end,
        projectHeads: headIds, // Pass array of heads
        projectHead: headIds[0], // Keep first as legacy projectHead for compatibility
        priority: priority || 'medium',
        department,
        tags: tags || [],
        status: status || 'planned',
        assignedTeams: assignedTeams.length > 0 ? assignedTeams : undefined,
        projectManager: projectManagerRef
      },
      creatorEmployee,
      autoAddMembers.map(m => ({
        userId: m.userId,
        role: m.role || 'member',
        isExternal: m.isExternal || false,
        sourceDepartment: m.sourceDepartment
      })),
      models // Pass tenant-specific models
    )

    // Send notifications to invited project heads (non-blocking)
    // Only send to heads who are not the creator
    for (const headId of headIds) {
      if (headId.toString() !== creatorEmployee._id.toString()) {
        try {
          const invitedHead = await Employee.findById(headId)
          if (invitedHead) {
            await notifyProjectInvitation(project, invitedHead, creatorEmployee, models, 'head')
          }
        } catch (notifyError) {
          console.error('Failed to send project head invitation notification:', notifyError)
        }
      }
    }

    // Send notifications to invited members (non-blocking)
    for (const member of members) {
      try {
        const invitedEmployee = await Employee.findById(member.userId)
        if (invitedEmployee) {
          await notifyProjectInvitation(project, invitedEmployee, creatorEmployee, models)
        }
      } catch (notifyError) {
        console.error('Failed to send project invitation notification:', notifyError)
        // Continue - don't fail project creation due to notification issues
      }
    }

    // Populate and return the project
    const populatedProject = await Project.findById(project._id)
      .populate('projectHead', 'firstName lastName profilePicture')
      .populate('projectHeads', 'firstName lastName profilePicture')
      .populate('createdBy', 'firstName lastName')
      .populate('department', 'name')
      .populate('projectManager', 'firstName lastName profilePicture')
      .populate('assignedTeams', 'teamName teamCode department')
      .populate('chatGroup')

    // Emit real-time project creation to all members and admins
    try {
      const memberUserIds = await getProjectMemberUserIds(project._id, null, models)
      const adminUsers = await User.find({ role: { $in: ['admin', 'hr'] }, isActive: true }).select('_id').lean()
      const allUserIds = [...new Set([...memberUserIds.map(id => id.toString()), ...adminUsers.map(u => u._id.toString())])]

      emitProjectUpdate(
        {
          _id: project._id,
          name: project.name,
          status: project.status,
          projectHead: populatedProject.projectHead,
          startDate: project.startDate,
          endDate: project.endDate
        },
        allUserIds,
        { isNew: true, action: 'create' }
      )
    } catch (emitError) {
      console.error('Failed to emit project update:', emitError)
    }

    return NextResponse.json({
      success: true,
      message: 'Project created successfully',
      data: populatedProject
    }, { status: 201 })
  } catch (error) {
    console.error('Create project error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
