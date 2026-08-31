import { NextResponse } from 'next/server'
import { verifyTokenFromRequest } from '@/lib/auth'
import {
  buildTenantRootPrefix,
  getBlobAccessMode,
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

  try {
    const result = await getTenantBlob(pathname, {
      access: getBlobAccessMode(),
      ifNoneMatch: request.headers.get('if-none-match') || undefined,
    })

    if (!result) return new NextResponse('Not found', { status: 404 })
    if (result.statusCode === 304) {
      return new NextResponse(null, { status: 304, headers: { ETag: result.blob.etag } })
    }

    return new NextResponse(result.stream, {
      headers: {
        'Content-Type': result.blob.contentType || 'application/octet-stream',
        'Content-Length': String(result.blob.size),
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
