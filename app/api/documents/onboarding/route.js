import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { hydrateEmployeeLifecycle, getLifecycleProgress } from '@/lib/hrms/employeeLifecycle.server'
import { validateOnboardingFiles } from '@/lib/hrms/onboardingSubmission.server'
import { getNativeOnboardingKycEvidence } from '@/lib/hrms/onboardingKyc.server'
import { submitOnboarding } from '@/lib/hrms/onboardingFirestore.server'
import { DOCUMENT_STORE_OPTIONS } from '@/lib/documents.server'
import { isFeatureEnabled } from '@/lib/planFeatures'
import { clearCachePattern, buildCachePattern } from '@/lib/cache'

export const dynamic = 'force-dynamic'

async function ownEmployee(request) {
  const auth = await getAuthAndDatabase(request, DOCUMENT_STORE_OPTIONS)
  if (!auth.success) return { response: NextResponse.json({ success: false, message: auth.message }, { status: auth.status || 401 }) }
  const user = await auth.database.get('users', String(auth.user._id || auth.user.userId))
  const employee = user?.employeeId ? await auth.database.get('employees', String(user.employeeId)) : null
  return { auth, employee }
}

export async function GET(request) {
  try {
    const { auth, employee, response } = await ownEmployee(request)
    if (response) return response
    if (!employee || !isFeatureEnabled(auth.companyFeatures, 'onboarding')) return NextResponse.json({ success: true, data: { enabled: false, checklist: [] } })
    const lifecycle = hydrateEmployeeLifecycle(employee)
    const linkedEvidence = await getNativeOnboardingKycEvidence(auth.database, employee._id)
    return NextResponse.json({ success: true, data: { enabled: true, linkedEvidence, profilePhone: employee.phone || '', checklist: lifecycle.onboarding.checklist, progress: getLifecycleProgress(lifecycle) } })
  } catch (error) {
    return NextResponse.json({ success: false, message: 'Unable to load your onboarding documents' }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    const { auth, employee, response } = await ownEmployee(request)
    if (response) return response
    if (!employee) return NextResponse.json({ success: false, message: 'Employee profile not found' }, { status: 404 })
    if (!isFeatureEnabled(auth.companyFeatures, 'onboarding')) return NextResponse.json({ success: false, message: 'Onboarding is not enabled' }, { status: 403 })
    const body = await request.json()
    const linkedEvidence = body.itemKey === 'documents' ? await getNativeOnboardingKycEvidence(auth.database, employee._id) : {}
    await submitOnboarding(auth.database, {
      employee, userId: String(auth.user._id || auth.user.userId), itemKey: body.itemKey,
      verification: body.verification, linkedEvidence,
      validateFiles: files => validateOnboardingFiles(auth, employee._id, files),
    })
    await clearCachePattern(buildCachePattern({ tenantId: auth.tenant.databaseName, namespace: 'employee:detail' })).catch(() => {})
    return NextResponse.json({ success: true, message: 'Submitted to HR. Your onboarding details are pending review.' })
  } catch (error) {
    console.error('[OnboardingSubmission] Submission failed:', error.code || error.name)
    return NextResponse.json({ success: false, message: error.message || 'Unable to submit onboarding documents' }, { status: error.status || 400 })
  }
}
