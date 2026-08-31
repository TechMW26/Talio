import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { getRuntimeCapabilities } from '@/lib/platform/runtime'

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

        const runtime = getRuntimeCapabilities()
        // Return scheduler info
        return NextResponse.json({
            success: true,
            data: {
                type: runtime.isVercel ? 'vercel-cron-and-queues' : 'node-schedule',
                description: runtime.isVercel
                    ? 'Vercel Cron invokes bounded jobs; Vercel Queues handles durable work'
                    : 'In-house scheduler running in server.js',
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
                managedQueue: process.env.VERCEL === '1',
                note: runtime.isVercel
                    ? 'Schedules are declared in vercel.json and protected by CRON_SECRET'
                    : 'Scheduler is managed by server.js'
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
