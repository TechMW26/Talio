import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { retryOnboardingEmail } from '@/lib/mailer'
import { ONBOARDING_STORE_OPTIONS, onboardingEmailView } from '@/lib/onboardingEmails.server'
async function handle(request, params, retry) {
  try {
    const auth = await getAuthAndDatabase(request, ONBOARDING_STORE_OPTIONS)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: auth.status || 401 })
    if (!['admin', 'hr'].includes(auth.user.role)) return NextResponse.json({ success: false, message: 'Access denied' }, { status: 403 })
    const { id } = await params
    if (!await auth.database.get('onboardingemails', id)) return NextResponse.json({ success: false, message: 'Email log not found' }, { status: 404 })
    const result = retry ? await retryOnboardingEmail(id, auth.user._id, auth.database) : { success: true }
    const data = await onboardingEmailView(auth.database, await auth.database.get('onboardingemails', id))
    return NextResponse.json({ success: result.success, ...(retry ? { message: result.success ? 'Email sent successfully' : result.error } : {}), data }, { status: result.busy ? 409 : 200 })
  } catch (error) { return NextResponse.json({ success: false, message: 'Onboarding email operation failed' }, { status: 500 }) }
}
export const GET = (request, { params }) => handle(request, params, false)
export const POST = (request, { params }) => handle(request, params, true)
