import { NextResponse } from 'next/server'
import mongoose from 'mongoose'
import { getAuthAndModels } from '@/lib/auth'
import { EMPLOYMENT_LETTER_ROLES } from '@/lib/hrms/employmentLetter'
import { issueEmploymentLetter, loadEmploymentLetterContext } from '@/lib/hrms/employmentLetter.server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function authorize(request, params) {
  const { id } = await params
  if (!mongoose.Types.ObjectId.isValid(id)) return { response: NextResponse.json({ success: false, message: 'Invalid employee ID' }, { status: 400 }) }
  const auth = await getAuthAndModels(request, ['Employee', 'User', 'Company', 'CompanySettings', 'SystemPreferences', 'Policy', 'Document'])
  if (!auth.success) return { response: NextResponse.json({ success: false, message: auth.message }, { status: 401 }) }
  if (!EMPLOYMENT_LETTER_ROLES.includes(auth.user.role)) return { response: NextResponse.json({ success: false, message: 'HR or admin access is required to issue letters' }, { status: 403 }) }
  return { auth, id }
}

export async function GET(request, { params }) {
  try {
    const { auth, id, response } = await authorize(request, params)
    if (response) return response
    const context = await loadEmploymentLetterContext(auth, id)
    const kind = new URL(request.url).searchParams.get('kind') === 'offer' ? 'offer' : 'appointment'
    const latest = await auth.models.Document.findOne({ employee: id, 'generatedLetter.kind': kind, isActive: { $ne: false } }).select('generatedLetter fileUrl fileName emailDelivery').sort({ createdAt: -1 }).lean()
    return NextResponse.json({ success: true, data: { defaults: context.defaults, logo: context.logo, email: context.employee.email, latest } })
  } catch (error) {
    console.error('[EmploymentLetter] Load failed:', error.message)
    return NextResponse.json({ success: false, message: 'Unable to load employee letter details' }, { status: error.status || 500 })
  }
}

export async function POST(request, { params }) {
  try {
    const { auth, id, response } = await authorize(request, params)
    if (response) return response
    const payload = await request.json().catch(() => null)
    if (!payload || typeof payload.sendEmail !== 'boolean') return NextResponse.json({ success: false, message: 'Invalid letter request' }, { status: 400 })
    const context = await loadEmploymentLetterContext(auth, id)
    const result = await issueEmploymentLetter(auth, context, payload)
    return NextResponse.json({ success: true, data: result.document, warning: result.emailError,
      message: result.emailError || (payload.sendEmail ? 'Letter saved in employee documents and sent by email' : 'PDF saved in employee documents'),
    })
  } catch (error) {
    console.error('[EmploymentLetter] Issue failed:', error.message)
    return NextResponse.json({ success: false, message: error.message || 'Unable to issue the letter' }, { status: error.status || 400 })
  }
}
