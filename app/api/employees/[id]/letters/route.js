import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { EMPLOYMENT_LETTER_ROLES } from '@/lib/hrms/employmentLetter'
import { getEmploymentLetterDatabase, issueEmploymentLetter, loadEmploymentLetterContext } from '@/lib/hrms/employmentLetter.server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function authorize(request, params) {
  const { id } = await params
  if (!/^[a-f\d]{24}$/i.test(id)) return { response: NextResponse.json({ success: false, message: 'Invalid employee ID' }, { status: 400 }) }
  const auth = await getAuthAndDatabase(request)
  if (!auth.success) return { response: NextResponse.json({ success: false, message: auth.message }, { status: 401 }) }
  if (!EMPLOYMENT_LETTER_ROLES.includes(auth.user.role)) return { response: NextResponse.json({ success: false, message: 'HR or admin access is required to issue letters' }, { status: 403 }) }
  return { auth: { ...auth, database: await getEmploymentLetterDatabase(auth) }, id }
}

export async function GET(request, { params }) {
  try {
    const { auth, id, response } = await authorize(request, params)
    if (response) return response
    const context = await loadEmploymentLetterContext(auth, id)
    const kind = new URL(request.url).searchParams.get('kind') === 'offer' ? 'offer' : 'appointment'
    let latest = null, cursor
    do {
      const page = await auth.database.list('documents', { filters: [{ field: 'employee', operator: '==', value: id }, { field: 'generatedLetter.kind', operator: '==', value: kind }], orderBy: [{ field: 'createdAt', direction: 'desc' }], limit: 100, cursor })
      const document = page.records.find(record => record.isActive !== false)
      if (document) latest = { _id: document._id, generatedLetter: document.generatedLetter, fileUrl: document.fileUrl, fileName: document.fileName, emailDelivery: document.emailDelivery }
      cursor = page.nextCursor
    } while (!latest && cursor)
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
