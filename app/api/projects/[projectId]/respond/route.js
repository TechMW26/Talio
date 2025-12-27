import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { respondToInvitation } from '@/lib/projectService'
import {
  notifyProjectInvitationAccepted,
  notifyProjectInvitationRejected
} from '@/lib/projectNotifications'

// POST - Respond to project invitation (accept/reject)
export async function POST(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Project', 'ProjectMember', 'User', 'Employee', 'Chat', 'ProjectTimelineEvent'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Project, ProjectMember, User, Employee, Chat } = models

    const { projectId } = await params

    const userRecord = await User.findById(user._id || user.userId).select('employeeId')
    if (!userRecord || !userRecord.employeeId) {
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

    const employee = await Employee.findById(userRecord.employeeId)
    if (!employee) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    // Use the service to handle the response - pass models for multi-tenant support
    const accept = action === 'accept'
    
    try {
      await respondToInvitation(projectId, userRecord.employeeId, accept, reason, models)
    } catch (err) {
      return NextResponse.json({ success: false, message: err.message }, { status: 400 })
    }

    // Get creator and head user IDs for notification
    const notifyEmployeeIds = [project.createdBy, project.projectHead]
      .filter(id => id.toString() !== userRecord.employeeId.toString())
    
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
