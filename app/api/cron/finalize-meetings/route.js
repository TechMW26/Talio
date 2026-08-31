import { NextResponse } from 'next/server'
import { getCronAuthErrorResponse } from '@/lib/cronAuth'
import { processExpiredMeetingsAcrossTenants } from '@/lib/meetingFinalizer'
import { connectSuperadminDB } from '@/lib/superadminDb'
import { withMongoLease } from '@/lib/platform/distributedLease'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(request) {
  const authError = getCronAuthErrorResponse(request)
  if (authError) return authError

  try {
    const connection = await connectSuperadminDB()
    const run = await withMongoLease(
      connection.db.collection('system_locks'),
      'cron:finalize-meetings',
      { ttlMs: 10 * 60 * 1000 },
      () => processExpiredMeetingsAcrossTenants({ action: 'vercel-cron-finalize' }),
    )

    if (!run.acquired) {
      return NextResponse.json({ success: true, skipped: true, message: 'A finalizer run is already active' })
    }

    return NextResponse.json(run.value)
  } catch (error) {
    console.error('[MeetingFinalizerCron] Failed:', error)
    return NextResponse.json({ success: false, message: 'Meeting finalization failed' }, { status: 500 })
  }
}
