import { NextResponse } from 'next/server'
import { getCronAuthErrorResponse } from '@/lib/cronAuth'
import { processExpiredMeetingsAcrossTenants } from '@/lib/meetingFinalizer'
import { getFirestoreSystemDatabase } from '@/lib/platform/firestoreApplication.server'
import { withFirestoreLease } from '@/lib/platform/firestoreLease.server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(request) {
  const authError = getCronAuthErrorResponse(request)
  if (authError) return authError

  try {
    const database = await getFirestoreSystemDatabase()
    const run = await withFirestoreLease(
      database,
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
