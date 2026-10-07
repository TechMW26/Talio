import { NextResponse } from 'next/server'
import { verifyTokenFromRequest } from '@/lib/auth'
import { canReadDocumentUpload } from '@/lib/documentAccess.server'
import {
  buildTenantRootPrefix,
  getBlobAccessMode,
  getBlobStreamLength,
  getTenantBlob,
} from '@/lib/platform/blobStorage.server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  const auth = await verifyTokenFromRequest(request)
  if (!auth.success) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const { path = [] } = await params
  const pathname = path.join('/')
  const tenantPrefix = `${buildTenantRootPrefix(auth.tenant.databaseName)}/`

  if (!pathname.startsWith(tenantPrefix) || pathname.includes('..')) {
    return new NextResponse('Forbidden', { status: 403 })
  }
  const [category, ownerId] = pathname.slice(tenantPrefix.length).split('/')
  // Repository-owned media must use its dedicated record/recipient ACL. A
  // known Blob pathname alone never authorizes access to personal media.
  // Retired alert media must remain blocked here; removing the feature is not permission to expose old private files.
  if (['images', 'screenshots', 'meetingAudio', 'recruitmentResumes', 'resume-parts', 'mira-images', 'call-alerts'].includes(category)) {
    return new NextResponse('Forbidden', { status: 403 })
  }
  if (category === 'documents') {
    if (!await canReadDocumentUpload(auth, { fileId: pathname, ownerId })) return new NextResponse('Forbidden', { status: 403 })
  }

  try {
    const result = await getTenantBlob(pathname, {
      access: getBlobAccessMode(),
      ifNoneMatch: request.headers.get('if-none-match') || undefined,
    })

    if (!result) return new NextResponse('Not found', { status: 404 })
    if (result.statusCode === 304) {
      return new NextResponse(null, { status: 304, headers: { ETag: result.blob.etag } })
    }

    const streamLength = getBlobStreamLength(result)
    return new NextResponse(result.stream, {
      headers: {
        'Content-Type': result.blob.contentType || 'application/octet-stream',
        ...(streamLength === null ? {} : { 'Content-Length': String(streamLength) }),
        'Content-Disposition': result.blob.contentDisposition || 'inline',
        'Cache-Control': 'private, max-age=300, must-revalidate',
        ETag: result.blob.etag,
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    console.error('[PrivateBlobDelivery] Failed:', error.message)
    return new NextResponse('Not found', { status: 404 })
  }
}
