import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import Project from '@/models/Project'
import ProjectMember from '@/models/ProjectMember'
import User from '@/models/User'
import Employee from '@/models/Employee'
import { 
  createProject, 
  getUserProjects, 
  calculateCompletionPercentage,
  getProjectTaskStats,
  createTimelineEvent
} from '@/lib/projectService'
import { 
  notifyProjectInvitation,
  getProjectMemberUserIds
} from '@/lib/projectNotifications'

export const dynamic = 'force-dynamic'

// GET - List projects for current user
export async function GET(request) {
  console.log('GET /api/projects called');
  try {
    const token = request.headers.get('authorization')?.split(' ')[1]
    if (!token) {
      return NextResponse.json({ success: false, message: 'No token provided' }, { status: 401 })
    }

    const decoded = await verifyToken(token)
    if (!decoded) {
      return NextResponse.json({ success: false, message: 'Invalid token' }, { status: 401 })
    }

    await connectDB()

    const user = await User.findById(decoded.userId).select('employeeId role')
    if (!user || !user.employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const role = searchParams.get('role')
    const invitationStatus = searchParams.get('invitationStatus')
    const all = searchParams.get('all') // For admin to see all projects

    let projects

    // Admin can see all projects
    if (all === 'true' && ['admin', 'hr'].includes(user.role)) {
      const query = {}
      if (status) {
        query.status = status === 'active' 
          ? { $in: ['planned', 'ongoing', 'pending', 'completed_pending_approval'] }
          : status
      }
      if (!status) {
        query.status = { $ne: 'archived' }
      }

      projects = await Project.find(query)
        .populate('projectHead', 'firstName lastName profilePicture')
        .populate('createdBy', 'firstName lastName')
        .populate('department', 'name')
        .sort({ updatedAt: -1 })
    } else {
      // Regular user - get their projects
      const filters = {}
      if (status) {
        filters.status = status === 'active' 
          ? ['planned', 'ongoing', 'pending', 'completed_pending_approval', 'overdue']
          : status.split(',')
      }
      if (role) filters.role = role
      if (invitationStatus) filters.invitationStatus = invitationStatus

      projects = await getUserProjects(user.employeeId, filters)
    }

    // Add task stats to each project
    const projectsWithStats = await Promise.all(projects.map(async (project) => {
      const stats = await getProjectTaskStats(project._id)
      return {
        ...project.toObject ? project.toObject() : project,
        taskStats: stats
      }
    }))

    return NextResponse.json({
      success: true,
      data: projectsWithStats,
      currentEmployeeId: user.employeeId.toString()
    })
  } catch (error) {
    console.error('Get projects error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}

// POST - Create a new project
export async function POST(request) {
  try {
    const token = request.headers.get('authorization')?.split(' ')[1]
    if (!token) {
      return NextResponse.json({ success: false, message: 'No token provided' }, { status: 401 })
    }

    const decoded = await verifyToken(token)
    if (!decoded) {
      return NextResponse.json({ success: false, message: 'Invalid token' }, { status: 401 })
    }

    await connectDB()

    const user = await User.findById(decoded.userId).select('employeeId')
    if (!user || !user.employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    const creatorEmployee = await Employee.findById(user.employeeId)
    if (!creatorEmployee) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    const body = await request.json()
    const { 
      name, 
      description, 
      startDate, 
      endDate, 
      projectHeadId, 
      members = [],
      priority,
      department,
      tags,
      status
    } = body

    // Validate required fields
    if (!name || !startDate || !endDate || !projectHeadId) {
      return NextResponse.json({
        success: false,
        message: 'Name, start date, end date, and project head are required'
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

    // Verify project head exists
    const projectHead = await Employee.findById(projectHeadId)
    if (!projectHead) {
      return NextResponse.json({
        success: false,
        message: 'Project head not found'
      }, { status: 404 })
    }

    // Create the project with service
    const project = await createProject(
      {
        name,
        description,
        startDate: start,
        endDate: end,
        projectHead: projectHeadId,
        priority: priority || 'medium',
        department,
        tags: tags || [],
        status: status || 'planned'
      },
      creatorEmployee,
      members.map(m => ({
        userId: m.userId,
        role: m.role || 'member',
        isExternal: m.isExternal || false,
        sourceDepartment: m.sourceDepartment
      }))
    )

    // Send notifications to invited members
    for (const member of members) {
      const invitedEmployee = await Employee.findById(member.userId)
      if (invitedEmployee) {
        await notifyProjectInvitation(project, invitedEmployee, creatorEmployee)
      }
    }

    // Populate and return the project
    const populatedProject = await Project.findById(project._id)
      .populate('projectHead', 'firstName lastName profilePicture')
      .populate('createdBy', 'firstName lastName')
      .populate('department', 'name')
      .populate('chatGroup')

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
