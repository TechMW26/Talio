import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'

// GET - Debug endpoint to check notification status
export async function GET(request) {
    try {
        // Get authenticated user and tenant-specific models
        const auth = await getAuthAndModels(request, ['ScheduledNotification', 'RecurringNotification'])
        if (!auth.success) {
            return NextResponse.json({ message: auth.message }, { status: 401 })
        }
        const { user, models } = auth
        const { ScheduledNotification, RecurringNotification } = models

        // Only admins can access debug info
        if (!['admin', 'hr'].includes(user.role)) {
            return NextResponse.json(
                { success: false, message: 'Access denied' },
                { status: 403 }
            )
        }

        const now = new Date()

        // Get scheduled notifications summary
        const scheduledPending = await ScheduledNotification.find({ status: 'pending' })
            .select('title scheduledFor targetType status createdAt')
            .sort({ scheduledFor: 1 })
            .limit(10)

        const scheduledDue = await ScheduledNotification.find({
            status: 'pending',
            scheduledFor: { $lte: now }
        }).select('title scheduledFor targetType status')

        const scheduledSent = await ScheduledNotification.countDocuments({ status: 'sent' })
        const scheduledFailed = await ScheduledNotification.countDocuments({ status: 'failed' })

        // Get recurring notifications summary
        const recurringActive = await RecurringNotification.find({ isActive: true })
            .select('title frequency nextScheduledAt lastSentAt totalSent isActive dailyTime weeklyDays weeklyTime monthlyDay monthlyTime')
            .sort({ nextScheduledAt: 1 })
            .limit(10)

        const recurringDue = await RecurringNotification.find({
            isActive: true,
            nextScheduledAt: { $lte: now },
            $or: [
                { endDate: null },
                { endDate: { $gte: now } }
            ]
        }).select('title frequency nextScheduledAt lastSentAt')

        const recurringInactive = await RecurringNotification.countDocuments({ isActive: false })

        return NextResponse.json({
            success: true,
            data: {
                currentTime: now.toISOString(),
                cronSecretConfigured: !!process.env.CRON_SECRET,
                scheduled: {
                    pending: scheduledPending.length,
                    due: scheduledDue.length,
                    sent: scheduledSent,
                    failed: scheduledFailed,
                    pendingList: scheduledPending.map(n => ({
                        id: n._id,
                        title: n.title,
                        scheduledFor: n.scheduledFor,
                        targetType: n.targetType,
                        isDue: new Date(n.scheduledFor) <= now,
                        timeUntil: Math.round((new Date(n.scheduledFor) - now) / 1000 / 60) + ' minutes'
                    })),
                    dueNow: scheduledDue.map(n => ({
                        id: n._id,
                        title: n.title,
                        scheduledFor: n.scheduledFor,
                        targetType: n.targetType
                    }))
                },
                recurring: {
                    active: recurringActive.length,
                    due: recurringDue.length,
                    inactive: recurringInactive,
                    activeList: recurringActive.map(n => ({
                        id: n._id,
                        title: n.title,
                        frequency: n.frequency,
                        nextScheduledAt: n.nextScheduledAt,
                        lastSentAt: n.lastSentAt,
                        totalSent: n.totalSent || 0,
                        isDue: n.nextScheduledAt ? new Date(n.nextScheduledAt) <= now : false,
                        timeUntil: n.nextScheduledAt ? Math.round((new Date(n.nextScheduledAt) - now) / 1000 / 60) + ' minutes' : 'Not scheduled',
                        settings: {
                            dailyTime: n.dailyTime,
                            weeklyDays: n.weeklyDays,
                            weeklyTime: n.weeklyTime,
                            monthlyDay: n.monthlyDay,
                            monthlyTime: n.monthlyTime
                        }
                    })),
                    dueNow: recurringDue.map(n => ({
                        id: n._id,
                        title: n.title,
                        frequency: n.frequency,
                        nextScheduledAt: n.nextScheduledAt
                    }))
                }
            }
        })
    } catch (error) {
        console.error('Debug notifications error:', error)
        return NextResponse.json(
            { success: false, message: error.message || 'Failed to get debug info' },
            { status: 500 }
        )
    }
}

// POST - Manually trigger notification processing (for testing)
export async function POST(request) {
    try {
        // Get authenticated user and tenant-specific models
        const auth = await getAuthAndModels(request, [])
        if (!auth.success) {
            return NextResponse.json({ message: auth.message }, { status: 401 })
        }
        const { user } = auth

        // Only admins can manually trigger
        if (!['admin'].includes(user.role)) {
            return NextResponse.json(
                { success: false, message: 'Access denied - admin only' },
                { status: 403 }
            )
        }

        const cronSecret = process.env.CRON_SECRET
        if (!cronSecret) {
            return NextResponse.json(
                { success: false, message: 'CRON_SECRET not configured' },
                { status: 500 }
            )
        }

        // Call the cron endpoint internally
        const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000'
        const response = await fetch(`${baseUrl}/api/cron/process-scheduled-notifications`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${cronSecret}`
            }
        })

        const result = await response.json()

        return NextResponse.json({
            success: true,
            message: 'Notification processing triggered',
            result
        })
    } catch (error) {
        console.error('Manual trigger error:', error)
        return NextResponse.json(
            { success: false, message: error.message || 'Failed to trigger processing' },
            { status: 500 }
        )
    }
}
