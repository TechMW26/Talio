import { NextResponse } from 'next/server'
import mongoose from 'mongoose'
import { getAuthAndModels } from '@/lib/auth'
import { EMPLOYMENT_LETTER_ROLES } from '@/lib/hrms/employmentLetter'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  try {
    const { id } = await params
    if (!mongoose.Types.ObjectId.isValid(id)) return new NextResponse('Invalid document ID', { status: 400 })
    const auth = await getAuthAndModels(request, ['Document', 'User'])
    if (!auth.success) return new NextResponse('Unauthorized', { status: 401 })
    const document = await auth.models.Document.findById(id).select('+generatedPdf').lean()
    if (!document?.generatedPdf || document.isActive === false) return new NextResponse('Document not found', { status: 404 })
    if (!EMPLOYMENT_LETTER_ROLES.includes(auth.user.role)) {
      const actor = await auth.models.User.findById(auth.user._id || auth.user.userId).select('employeeId').lean()
      if (!actor?.employeeId || String(actor.employeeId) !== String(document.employee)) return new NextResponse('Forbidden', { status: 403 })
    }
    const bytes = Buffer.isBuffer(document.generatedPdf) ? document.generatedPdf : Buffer.from(document.generatedPdf.buffer)
    return new NextResponse(bytes, { headers: { 'Content-Type': 'application/pdf', 'Content-Length': String(bytes.length),
      'Content-Disposition': `inline; filename="${document.fileName.replace(/["\r\n]/g, '')}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } })
  } catch (error) {
    console.error('[EmploymentLetter] File delivery failed:', error.message)
    return new NextResponse('Unable to load document', { status: 500 })
  }
}
