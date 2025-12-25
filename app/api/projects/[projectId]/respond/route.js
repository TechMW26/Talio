import { NextResponse } from 'next/server'
import { verifyToken, getAuthAndModels } from '@/lib/auth'
import { respondToInvitation, createTimelineEvent } from '@/lib/projectService'
import {
  notifyProjectInvitationAccepted,
  notifyProjectInvitationRejected
} from '@/lib/projectNotifications'

// POST - Respond to project invitation (accept/reject)
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
    const auth = await getAuthAndModels(request, ['Project', 'ProjectMember', 'User', 'Employee', 'Chat'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Project, ProjectMember, User, Employee, Chat } = models

    const { projectId } = await params

    const user = await User.findById(decoded.userId).select('employeeId')
    if (!user || !user.employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    const body = await request.json()
    const { action, reason } = body

    if (!action || !['accept', 'reject'].includes(action)) {
      return NextResponse.json({ 
        success: false, 
        message: 'Valid action (accept/reject) is required' 
      }, { status: 400 })
    }

    const project = await Project.findById(projectId)
    if (!project) {
      return NextResponse.json({ success: false, message: 'Project not found' }, { status: 404 })
    }

    const employee = await Employee.findById(user.employeeId)
    if (!employee) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    // Use the service to handle the response
    const accept = action === 'accept'
    
    try {
      await respondToInvitation(projectId, user.employeeId, accept, reason)
    } catch (err) {
      return NextResponse.json({ success: false, message: err.message }, { status: 400 })
    }

    // Get creator and head user IDs for notification
    const notifyEmployeeIds = [project.createdBy, project.projectHead]
      .filter(id => id.toString() !== user.employeeId.toString())
    
    const notifyUsers = await User.find({ 
      employeeId: { $in: notifyEmployeeIds } 
    }).select('_id')
    const notifyUserIds = notifyUsers.map(u => u._id)

    // Send notifications
    if (accept) {
      await notifyProjectInvitationAccepted(project, employee, notifyUserIds)
    } else {
      await notifyProjectInvitationRejected(project, employee, notifyUserIds, reason)
    }

    return NextResponse.json({
      success: true,
      message: accept ? 'You have joined the project' : 'Invitation rejected'
    })
  } catch (error) {
    console.error('Respond to invitation error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
