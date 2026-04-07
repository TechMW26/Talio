import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import {
  inspectExpiredMeetingsForDatabase,
  processExpiredMeetingsForDatabase,
} from '@/lib/meetingFinalizer'
export const dynamic = 'force-dynamic'

/**
 * POST /api/meetings/expire-past
 * 
 * Automatically handles expired meetings:
 * - Moves meetings past their end time to 'completed' status (if not already)
 * - Deactivates meeting links for online meetings
 * 
 * This can be called by a cron job or triggered periodically
 */
export async function POST(request) {
  try {
    const auth = await getAuthAndModels(request)
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }

    const result = await processExpiredMeetingsForDatabase(auth.tenant.databaseName, {
      tenantName: auth.tenant.name || auth.tenant.databaseName,
      action: 'manual-expire-route',
    })

    console.log(
      `[Meeting Expiry] ${auth.tenant.databaseName}: completed ${result.meetingsCompleted}, `
      + `deactivated ${result.linksDeactivated}, generated ${result.summariesGenerated} summaries`
    )

    return NextResponse.json({
      success: true,
      message: result.skipped
        ? result.message
        : `Processed ${result.meetingsCompleted} expired meetings and generated ${result.summariesGenerated} AI summaries`,
      data: {
        meetingsCompleted: result.meetingsCompleted,
        linksDeactivated: result.linksDeactivated,
        summariesGenerated: result.summariesGenerated,
        summaryFailures: result.summaryFailures,
        meetingsTouched: result.meetingsTouched,
        skipped: result.skipped,
      }
    })

  } catch (error) {
    console.error('[Meeting Expiry] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to process expired meetings' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/meetings/expire-past
 * 
 * Check status of expired meetings without modifying them
 */
export async function GET(request) {
  try {
    const auth = await getAuthAndModels(request)
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }

    const counts = await inspectExpiredMeetingsForDatabase(auth.tenant.databaseName)

    return NextResponse.json({
      success: true,
      data: counts
    })

  } catch (error) {
    console.error('[Meeting Expiry Check] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to check expired meetings' },
      { status: 500 }
    )
  }
}
