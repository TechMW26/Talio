import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { ONBOARDING_STORE_OPTIONS, queueFailedOnboardingEmails, onboardingQueueStatus } from '@/lib/onboardingEmails.server'
async function handle(request, write) {
  try {
    const auth = await getAuthAndDatabase(request, ONBOARDING_STORE_OPTIONS)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: auth.status || 401 })
    if (!['admin', 'hr'].includes(auth.user.role)) return NextResponse.json({ success: false, message: 'Access denied' }, { status: 403 })
    if (!write) return NextResponse.json({ success: true, queue: await onboardingQueueStatus(auth.database) })
    const body = await request.json().catch(() => ({}))
    const result = await queueFailedOnboardingEmails(auth.database, body.delayMinutes ?? 5)
    return NextResponse.json({ success: true, message: 'Eligible failed emails queued for retry', ...result })
  } catch (error) { return NextResponse.json({ success: false, message: error.status ? error.message : 'Email queue operation failed' }, { status: error.status || 500 }) }
}
export const GET = request => handle(request, false)
export const POST = request => handle(request, true)
