import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'

/**
 * GET - Fetch project email notification history with filters/stats
 *
 * Query params:
 *   page, limit, status (pending|sent|failed), triggerType, projectId, taskId, search, sortBy, sortOrder
 */
export async function GET(request) {
  try {
    const auth = await getAuthAndModels(request, ['ProjectEmailNotificationLog'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { ProjectEmailNotificationLog } = models

    if (!['admin', 'hr'].includes(user.role)) {
      return NextResponse.json({ success: false, message: 'Access denied' }, { status: 403 })
    }

    if (!ProjectEmailNotificationLog) {
      return NextResponse.json({
        success: true,
        data: [],
        pagination: { page: 1, limit: 20, total: 0, pages: 0 },
        stats: { sent: 0, failed: 0, pending: 0, total: 0 },
      })
    }

    const { searchParams } = new URL(request.url)
    const page = Math.max(parseInt(searchParams.get('page')) || 1, 1)
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit')) || 20, 1), 100)
    const status = searchParams.get('status')
    const triggerType = searchParams.get('triggerType')
    const projectId = searchParams.get('projectId')
    const taskId = searchParams.get('taskId')
    const search = (searchParams.get('search') || '').trim()
    const sortBy = searchParams.get('sortBy') || 'createdAt'
    const sortOrder = searchParams.get('sortOrder') === 'asc' ? 1 : -1

    const query = {}

    if (status && ['sent', 'failed', 'pending'].includes(status)) {
      query.status = status
    }

    if (
      triggerType &&
      ['project_created', 'task_created', 'project_status_changed', 'task_status_changed'].includes(triggerType)
    ) {
      query.triggerType = triggerType
    }

    if (projectId) query.project = projectId
    if (taskId) query.task = taskId

    if (search) {
      const re = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
      query.$or = [
        { recipientEmail: re },
        { recipientName: re },
        { subject: re },
      ]
    }

    const skip = (page - 1) * limit
    const sortObj = { [sortBy]: sortOrder }

    const [emails, total, sentCount, failedCount, pendingCount] = await Promise.all([
      ProjectEmailNotificationLog.find(query)
        .populate('project', 'projectName projectCode status')
        .populate('task', 'taskName status')
        .populate('recipientEmployee', 'firstName lastName employeeCode profilePicture')
        .populate('triggeredByUser', 'email')
        .sort(sortObj)
        .skip(skip)
        .limit(limit)
        .lean()
        .catch((err) => {
          console.error('Failed to fetch project email logs:', err.message)
          return []
        }),
      ProjectEmailNotificationLog.countDocuments(query).catch(() => 0),
      ProjectEmailNotificationLog.countDocuments({ status: 'sent' }).catch(() => 0),
      ProjectEmailNotificationLog.countDocuments({ status: 'failed' }).catch(() => 0),
      ProjectEmailNotificationLog.countDocuments({ status: 'pending' }).catch(() => 0),
    ])

    return NextResponse.json({
      success: true,
      data: emails,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
      stats: {
        sent: sentCount,
        failed: failedCount,
        pending: pendingCount,
        total: sentCount + failedCount + pendingCount,
      },
    })
  } catch (error) {
    console.error('Get project email notifications error:', error)
    return NextResponse.json(
      { success: false, message: error.message || 'Failed to fetch project email notifications' },
      { status: 500 }
    )
  }
}
