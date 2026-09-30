import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { hydrateEmployeeLifecycle, getLifecycleProgress } from '@/lib/hrms/employeeLifecycle.server'
import { normalizeOnboardingVerification } from '@/lib/hrms/onboardingVerification'
import { validateOnboardingFiles } from '@/lib/hrms/onboardingSubmission.server'
import { getOnboardingKycEvidence } from '@/lib/hrms/onboardingKyc.server'
import { isFeatureEnabled } from '@/lib/planFeatures'
import { clearCachePattern, buildCachePattern } from '@/lib/cache'

export const dynamic = 'force-dynamic'

async function ownEmployee(request) {
  const auth = await getAuthAndModels(request, ['Employee', 'User', 'Document'])
  if (!auth.success) return { response: NextResponse.json({ success: false, message: auth.message }, { status: 401 }) }
  const user = await auth.models.User.findById(auth.user._id || auth.user.userId).select('employeeId').lean()
  const employee = user?.employeeId ? await auth.models.Employee.findById(user.employeeId).lean() : null
  return { auth, employee }
}

export async function GET(request) {
  try {
    const { auth, employee, response } = await ownEmployee(request)
    if (response) return response
    if (!employee || !isFeatureEnabled(auth.companyFeatures, 'onboarding')) return NextResponse.json({ success: true, data: { enabled: false, checklist: [] } })
    const lifecycle = hydrateEmployeeLifecycle(employee)
    const linkedEvidence = await getOnboardingKycEvidence(auth.models, employee._id)
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
    const lifecycle = hydrateEmployeeLifecycle(employee)
    const item = lifecycle.onboarding.checklist.find(entry => entry.key === body.itemKey)
    if (!item || item.completed) return NextResponse.json({ success: false, message: 'This onboarding item is already verified or is not available' }, { status: 409 })
    const linkedEvidence = item.key === 'documents' ? await getOnboardingKycEvidence(auth.models, employee._id) : {}
    const { verification } = normalizeOnboardingVerification(item.key, body.verification, { submission: true, employee, linkedEvidence })
    if (!verification.documents.length && !Object.values(verification.details).some(value => value !== false && String(value).trim())) throw new Error('Add a file or complete your details before submitting')
    verification.documents = await validateOnboardingFiles(auth, employee._id, verification.documents)
    item.submission = { status: 'pending', verification, submittedAt: new Date(), submittedBy: auth.user._id || auth.user.userId, reviewReason: '' }
    const updated = await auth.models.Employee.findOneAndUpdate({ _id: employee._id, ...(Number.isInteger(employee.__v) ? { __v: employee.__v } : {}) }, {
      $set: { 'lifecycle.onboarding.checklist': lifecycle.onboarding.checklist }, $inc: { __v: 1 },
    }, { new: true, runValidators: true }).select('_id').lean()
    if (!updated) return NextResponse.json({ success: false, message: 'Your onboarding record changed. Refresh and submit again.' }, { status: 409 })
    for (const file of verification.documents) {
      await auth.models.Document.findOneAndUpdate({ employee: employee._id, fileId: file.fileId }, { $set: {
        name: file.fileName, fileName: file.fileName, type: file.fileType, fileType: file.fileType, url: file.fileUrl, fileUrl: file.fileUrl,
        fileSize: file.fileSize, category: `onboarding_${file.requirementKey}`, status: 'pending', onboardingItemKey: item.key,
      }, $setOnInsert: { employee: employee._id, uploadedBy: employee._id, fileId: file.fileId, isActive: true } }, { upsert: true, new: true })
    }
    await clearCachePattern(buildCachePattern({ tenantId: auth.tenant.databaseName, namespace: 'employee:detail' })).catch(() => {})
    return NextResponse.json({ success: true, message: 'Submitted to HR. Your onboarding details are pending review.' })
  } catch (error) {
    console.error('[OnboardingSubmission] Submission failed:', error.message)
    return NextResponse.json({ success: false, message: error.message || 'Unable to submit onboarding documents' }, { status: 400 })
  }
}
