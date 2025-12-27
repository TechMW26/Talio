import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'

// Note: This endpoint provides status info only
// The actual scheduler runs in server.js using node-schedule

export async function GET(request) {
    try {
        // Get authenticated user
        const auth = await getAuthAndModels(request, [])
        if (!auth.success) {
            return NextResponse.json(
                { success: false, message: auth.message },
                { status: 401 }
            )
        }
        const { user } = auth

        // Only admins can view scheduler status
        if (!['admin', 'hr'].includes(user.role)) {
            return NextResponse.json(
                { success: false, message: 'Access denied' },
                { status: 403 }
            )
        }

        // Return scheduler info
        return NextResponse.json({
            success: true,
            data: {
                type: 'node-schedule',
                description: 'In-house scheduler running in server.js',
                jobs: [
                    {
                        id: 'notification-processor',
                        schedule: 'Every minute',
                        description: 'Processes scheduled and recurring notifications'
                    },
                    {
                        id: 'attendance-processor',
                        schedule: 'Every minute',
                        description: 'Processes attendance-based notifications'
                    },
                    {
                        id: 'cleanup-job',
                        schedule: 'Every hour',
                        description: 'Cleans up old notification data'
                    }
                ],
                cronSecretConfigured: !!process.env.CRON_SECRET,
                note: 'Scheduler is managed by server.js, not by external cron jobs'
            }
        })
    } catch (error) {
        console.error('Scheduler status error:', error)
        return NextResponse.json(
            { success: false, message: 'Failed to get scheduler status' },
            { status: 500 }
        )
    }
}
