import { NextResponse } from 'next/server'
import { jwtVerify } from 'jose'

// Note: This endpoint provides status info only
// The actual scheduler runs in server.js using node-schedule

export async function GET(request) {
    try {
        // Verify authentication
        const authHeader = request.headers.get('authorization')
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return NextResponse.json(
                { success: false, message: 'Unauthorized' },
                { status: 401 }
            )
        }

        const token = authHeader.substring(7)
        const secret = new TextEncoder().encode(process.env.JWT_SECRET)
        const { payload: decoded } = await jwtVerify(token, secret)

        // Only admins can view scheduler status
        if (!['admin', 'hr'].includes(decoded.role)) {
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
