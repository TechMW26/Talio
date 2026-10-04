import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { EMPLOYMENT_LETTER_ROLES } from '@/lib/hrms/employmentLetter'
import { isDocumentId } from '@/lib/documents.server'
import { getTenantBlob, getBlobStreamLength, buildTenantRootPrefix } from '@/lib/platform/blobStorage.server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  try {
    const { id } = await params
    if (!isDocumentId(id)) return new NextResponse('Invalid document ID', { status: 400 })
    const auth = await getAuthAndDatabase(request)
    if (!auth.success) return new NextResponse('Unauthorized', { status: auth.status || 401 })
    const document = await auth.database.get('documents', id)
    if ((!document?.generatedPdf && !document?.storage) || document.isActive === false) return new NextResponse('Document not found', { status: 404 })
    if (!EMPLOYMENT_LETTER_ROLES.includes(auth.user.role)) {
      const actor = await auth.database.get('users', String(auth.user._id || auth.user.userId))
      if (!actor?.employeeId || String(actor.employeeId) !== String(document.employee)) return new NextResponse('Forbidden', { status: 403 })
    }
    const headers = { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${String(document.fileName || 'document.pdf').replace(/["\r\n]/g, '')}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }
    if (document.storage?.pathname) {
      if (!document.storage.pathname.startsWith(`${buildTenantRootPrefix(auth.tenant.databaseName)}/documents/`) || document.storage.pathname.includes('..')) throw new Error('Invalid document storage scope')
      const blob = await getTenantBlob(document.storage.pathname, { access: 'private' })
      if (!blob?.stream) return new NextResponse('Document not found', { status: 404 })
      const length = getBlobStreamLength(blob)
      if (length !== null) headers['Content-Length'] = String(length)
      return new NextResponse(blob.stream, { headers })
    }
    // Preserve delivery of imported inline letters until their verified Blob copy exists.
    const bytes = Buffer.isBuffer(document.generatedPdf) ? document.generatedPdf : Buffer.from(document.generatedPdf.buffer)
    headers['Content-Length'] = String(bytes.length)
    return new NextResponse(bytes, { headers })
  } catch (error) {
    console.error('[EmploymentLetter] File delivery failed:', error.code || error.name)
    return new NextResponse('Unable to load document', { status: 500 })
  }
}
