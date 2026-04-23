import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { processProjectEmailNotificationLog } from '@/lib/projectEmailNotifications'

/**
 * GET - Get a single project email notification log
 */
export async function GET(request, { params }) {
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

        const { id } = await params
        if (!id) {
            return NextResponse.json({ success: false, message: 'Email log ID is required' }, { status: 400 })
        }

        const log = await ProjectEmailNotificationLog.findById(id)
            .populate('project', 'projectName projectCode status')
            .populate('task', 'taskName status')
            .populate('recipientEmployee', 'firstName lastName employeeCode profilePicture email')
            .populate('recipientUser', 'email')
            .populate('triggeredByUser', 'email')
            .populate('triggeredByEmployee', 'firstName lastName employeeCode')
            .lean()

        if (!log) {
            return NextResponse.json({ success: false, message: 'Email log not found' }, { status: 404 })
        }

        return NextResponse.json({ success: true, data: log })
    } catch (error) {
        console.error('Get project email log error:', error)
        return NextResponse.json(
            { success: false, message: error.message || 'Failed to fetch email log' },
            { status: 500 }
        )
    }
}

/**
 * POST - Retry sending a failed/pending project email notification
 */
export async function POST(request, { params }) {
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

        const { id } = await params
        if (!id) {
            return NextResponse.json({ success: false, message: 'Email log ID is required' }, { status: 400 })
        }

        const emailLog = await ProjectEmailNotificationLog.findById(id)
        if (!emailLog) {
            return NextResponse.json({ success: false, message: 'Email log not found' }, { status: 404 })
        }

        if (emailLog.status === 'sent') {
            return NextResponse.json({
                success: true,
                alreadySent: true,
                message: 'Email already sent',
            })
        }

        // Reset auto-retry throttling so manual retry attempts immediately
        emailLog.autoRetryCount = 0
        emailLog.rateLimitedUntil = null
        emailLog.scheduledFor = null
        emailLog.queued = false
        await emailLog.save()

        const result = await processProjectEmailNotificationLog(emailLog, models)

        const updated = await ProjectEmailNotificationLog.findById(id)
            .populate('project', 'projectName projectCode status')
            .populate('task', 'taskName status')
            .populate('recipientEmployee', 'firstName lastName employeeCode profilePicture')
            .populate('triggeredByUser', 'email')
            .lean()

        return NextResponse.json({
            success: !!result?.success,
            message: result?.success
                ? 'Email sent successfully'
                : `Failed to send email: ${result?.error || 'unknown error'}`,
            data: updated,
        })
    } catch (error) {
        console.error('Retry project email log error:', error)
        return NextResponse.json(
            { success: false, message: error.message || 'Failed to retry email' },
            { status: 500 }
        )
    }
}
