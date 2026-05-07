import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import {
  requestCompletionApproval,
  respondToCompletionApproval,
  getProjectTaskStats
} from '@/lib/projectService'
import {
  notifyProjectCompletionRequested,
  notifyProjectApproved,
  notifyProjectRejected,
  getProjectMemberUserIds
} from '@/lib/projectNotifications'

// GET - Get approval status for a project
export async function GET(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Project', 'ProjectMember', 'User', 'Employee', 'ProjectCompletionApproval'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Project, ProjectMember, User, Employee, ProjectCompletionApproval } = models

    const { projectId } = await params

    const userRecord = await User.findById(user._id || user.userId).select('employeeId')
    if (!userRecord || !userRecord.employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    const approvals = await ProjectCompletionApproval.find({ project: projectId })
      .populate('requestedBy', 'firstName lastName profilePicture')
      .populate('respondedBy', 'firstName lastName profilePicture')
      .populate('projectHead', 'firstName lastName')
      .sort({ createdAt: -1 })

    const pendingApproval = approvals.find(a => a.status === 'pending')

    return NextResponse.json({
      success: true,
      data: {
        approvals,
        pendingApproval,
        hasPendingApproval: !!pendingApproval
      }
    })
  } catch (error) {
    console.error('Get approval error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}

// POST - Request project completion approval
export async function POST(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Project', 'ProjectMember', 'User', 'Employee', 'ProjectCompletionApproval', 'Task', 'ProjectTimelineEvent'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Project, ProjectMember, User, Employee } = models

    const { projectId } = await params

    const userRecord = await User.findById(user._id || user.userId).select('employeeId role')
    if (!userRecord || !userRecord.employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    const project = await Project.findById(projectId)
    if (!project) {
      return NextResponse.json({ success: false, message: 'Project not found' }, { status: 404 })
    }

    // Check if user can request completion (must be accepted member)
    const isAdmin = ['admin'].includes(userRecord.role || user.role)
    const membership = await ProjectMember.findOne({
      project: projectId,
      user: userRecord.employeeId,
      invitationStatus: 'accepted'
    })

    if (!isAdmin && !membership) {
      return NextResponse.json({
        success: false,
        message: 'You must be an accepted member to request completion'
      }, { status: 403 })
    }

    const body = await request.json()
    const { remark } = body

    const employee = await Employee.findById(userRecord.employeeId)

    try {
      const approval = await requestCompletionApproval(projectId, employee, remark, models)

      // Notify project head
      await notifyProjectCompletionRequested(project, employee, models)

      return NextResponse.json({
        success: true,
        message: 'Completion approval requested',
        data: approval
      }, { status: 201 })
    } catch (err) {
      return NextResponse.json({ success: false, message: err.message }, { status: 400 })
    }
  } catch (error) {
    console.error('Request approval error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}

// PUT - Respond to completion approval (approve/reject)
export async function PUT(request, { params }) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['Project', 'ProjectMember', 'User', 'Employee', 'ProjectCompletionApproval', 'Task', 'ProjectTimelineEvent'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Project, ProjectMember, User, Employee } = models

    const { projectId } = await params

    const userRecord = await User.findById(user._id || user.userId).select('employeeId role')
    if (!userRecord || !userRecord.employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    const project = await Project.findById(projectId)
    if (!project) {
      return NextResponse.json({ success: false, message: 'Project not found' }, { status: 404 })
    }

    // Only project head(s) can respond. Support both legacy `projectHead`,
    // multi-head `projectHeads`, and accepted ProjectMember head records.
    const employeeId = userRecord.employeeId.toString()
    const projectHeadIds = project.projectHeads && project.projectHeads.length > 0
      ? project.projectHeads.map(h => (h._id || h).toString())
      : project.projectHead
        ? [(project.projectHead._id || project.projectHead).toString()]
        : []
    const hasHeadMembership = !!(await ProjectMember.findOne({
      project: projectId,
      user: userRecord.employeeId,
      role: 'head',
      invitationStatus: 'accepted'
    }).select('_id'))
    const isProjectHead = projectHeadIds.includes(employeeId) || hasHeadMembership
    const isAdmin = ['admin'].includes(userRecord.role || user.role)

    if (!isProjectHead && !isAdmin) {
      return NextResponse.json({
        success: false,
        message: 'Only the project head can respond to completion approvals'
      }, { status: 403 })
    }

    const body = await request.json()
    const { approvalId, action, remark, unmarkSubtasks } = body

    if (!approvalId) {
      return NextResponse.json({ success: false, message: 'Approval ID is required' }, { status: 400 })
    }

    if (!action || !['approve', 'reject'].includes(action)) {
      return NextResponse.json({
        success: false,
        message: 'Valid action (approve/reject) is required'
      }, { status: 400 })
    }

    const employee = await Employee.findById(userRecord.employeeId)
    const approve = action === 'approve'

    try {
      const result = await respondToCompletionApproval(approvalId, employee, approve, remark, unmarkSubtasks, models, { isAdmin })

      // Get all accepted members for notification
      const memberUserIds = await getProjectMemberUserIds(projectId, null, models)

      if (approve) {
        await notifyProjectApproved(project, employee, memberUserIds, remark, models)
      } else {
        await notifyProjectRejected(project, employee, memberUserIds, remark, models)
      }

      return NextResponse.json({
        success: true,
        message: approve ? 'Project marked as completed' : 'Completion rejected',
        data: result
      })
    } catch (err) {
      return NextResponse.json({ success: false, message: err.message }, { status: 400 })
    }
  } catch (error) {
    console.error('Respond to approval error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
