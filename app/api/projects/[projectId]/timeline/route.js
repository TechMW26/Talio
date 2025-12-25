import { NextResponse } from 'next/server'
import { verifyToken, getAuthAndModels } from '@/lib/auth'
import { checkProjectAccess, createTimelineEvent } from '@/lib/projectService'
import { notifyCommentAdded, getProjectMemberUserIds } from '@/lib/projectNotifications'
// GET - Get project timeline/activity feed
export async function GET(request, { params }) {
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
    const auth = await getAuthAndModels(request, ['Project', 'ProjectMember', 'ProjectTimelineEvent', 'User', 'Employee'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { Project, ProjectMember, ProjectTimelineEvent, User, Employee } = models

    const { projectId } = await params
    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get('limit')) || 50
    const offset = parseInt(searchParams.get('offset')) || 0
    const type = searchParams.get('type')

    const user = await User.findById(decoded.userId).select('employeeId role')
    if (!user || !user.employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    // Check access
    const isAdmin = ['admin', 'hr'].includes(user.role)
    if (!isAdmin) {
      const { hasAccess } = await checkProjectAccess(projectId, user.employeeId, 'view')
      if (!hasAccess) {
        return NextResponse.json({ success: false, message: 'Access denied' }, { status: 403 })
      }
    }

    const query = { project: projectId }
    if (type) {
      query.type = type
    }

    const [events, total] = await Promise.all([
      ProjectTimelineEvent.find(query)
        .populate('createdBy', 'firstName lastName profilePicture')
        .populate('relatedTask', 'title status')
        .populate('relatedMember', 'firstName lastName profilePicture')
        .sort({ createdAt: -1 })
        .skip(offset)
        .limit(limit),
      ProjectTimelineEvent.countDocuments(query)
    ])

    return NextResponse.json({
      success: true,
      data: events,
      pagination: {
        total,
        offset,
        limit,
        hasMore: offset + events.length < total
      }
    })
  } catch (error) {
    console.error('Get timeline error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}

// POST - Add a comment/update to the timeline
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

    const { projectId } = await params

    const user = await User.findById(decoded.userId).select('employeeId role')
    if (!user || !user.employeeId) {
      return NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
    }

    const project = await Project.findById(projectId)
    if (!project) {
      return NextResponse.json({ success: false, message: 'Project not found' }, { status: 404 })
    }

    // Check if user can add comments (must be accepted member)
    const isAdmin = ['admin'].includes(user.role)
    if (!isAdmin) {
      const { hasAccess } = await checkProjectAccess(projectId, user.employeeId, 'participate')
      if (!hasAccess) {
        return NextResponse.json({ 
          success: false, 
          message: 'You must accept the project invitation to add comments' 
        }, { status: 403 })
      }
    }

    const body = await request.json()
    const { content, taskId } = body

    if (!content || !content.trim()) {
      return NextResponse.json({ success: false, message: 'Comment content is required' }, { status: 400 })
    }

    const employee = await Employee.findById(user.employeeId)

    // Create the comment as a timeline event
    const event = await createTimelineEvent({
      project: projectId,
      type: 'comment_added',
      createdBy: user.employeeId,
      relatedTask: taskId || undefined,
      description: `${employee.firstName} ${employee.lastName} added a comment`,
      commentContent: content.trim(),
      metadata: {
        taskId,
        commentPreview: content.substring(0, 100)
      }
    })

    // Notify other members (with throttling - only if last comment was > 5 mins ago)
    const lastCommentByUser = await ProjectTimelineEvent.findOne({
      project: projectId,
      type: 'comment_added',
      createdBy: user.employeeId,
      _id: { $ne: event._id }
    }).sort({ createdAt: -1 })

    const shouldNotify = !lastCommentByUser || 
      (new Date() - lastCommentByUser.createdAt) > 5 * 60 * 1000 // 5 minutes

    if (shouldNotify) {
      const memberUserIds = await getProjectMemberUserIds(projectId, user.employeeId)
      await notifyCommentAdded(project, employee, memberUserIds, content)
    }

    const populatedEvent = await ProjectTimelineEvent.findById(event._id)
      .populate('createdBy', 'firstName lastName profilePicture')
      .populate('relatedTask', 'title')

    return NextResponse.json({
      success: true,
      message: 'Comment added successfully',
      data: populatedEvent
    }, { status: 201 })
  } catch (error) {
    console.error('Add comment error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
