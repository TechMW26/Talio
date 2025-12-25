import { NextResponse } from 'next/server'
import { verifyToken, getAuthAndModels } from '@/lib/auth'
import { createTimelineEvent } from '@/lib/projectService'

// POST - Mark project as complete (only if at 100% progress)
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
    const auth = await getAuthAndModels(request, ['Project', 'User', 'Employee'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { models } = auth
    const { Project, User, Employee } = models

    const { projectId } = await params

    const user = await User.findById(decoded.userId).select('employeeId role')
    if (!user || !user.employeeId) {
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

    const isProjectHead = projectHeadIds.includes(user.employeeId.toString())
    const isAdmin = ['admin'].includes(user.role)

    if (!isProjectHead && !isAdmin) {
      return NextResponse.json({ 
        success: false, 
        message: 'Only project heads can mark the project as complete' 
      }, { status: 403 })
    }

    // Check if project is at 100% completion
    if (project.completionPercentage < 100) {
      return NextResponse.json({ 
        success: false, 
        message: `Project must be at 100% completion. Current: ${project.completionPercentage}%` 
      }, { status: 400 })
    }

    // Check if already completed
    if (['completed', 'approved'].includes(project.status)) {
      return NextResponse.json({ 
        success: false, 
        message: 'Project is already marked as complete' 
      }, { status: 400 })
    }

    const employee = await Employee.findById(user.employeeId)

    // Update project status to completed
    project.status = 'completed'
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
        completionPercentage: project.completionPercentage
      }
    })

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
