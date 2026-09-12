import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import vercelConfig from '@/vercel.json'

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
                type: 'vercel-cron-and-queues',
                description: 'Vercel Cron invokes scheduled jobs; Vercel Queues delivers background work',
                jobs: vercelConfig.crons.map(({ path, schedule }) => ({ path, schedule })),
                cronSecretConfigured: !!process.env.CRON_SECRET,
                managedQueue: process.env.VERCEL === '1',
                note: 'Schedules are declared in vercel.json and protected by CRON_SECRET'
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
