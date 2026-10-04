import { NextResponse } from 'next/server'
import { verifyTokenFromRequest } from '@/lib/auth'
import { createHash } from 'node:crypto'
import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import { getTenantBlob, buildTenantBlobPrefix } from '@/lib/platform/blobStorage.server'

export async function GET(request, { params }) {
  const auth = await verifyTokenFromRequest(request)
  if (!auth.success) return new NextResponse('Unauthorized', { status: 401 })
  const { id } = await params
  if (!/^[a-f0-9]{24}$/i.test(id)) return new NextResponse('Not found', { status: 404 })
  const image = await (await getFirestoreTenantDatabase(auth.tenant.databaseName)).get('mirageneratedimages', id)
  if (!image || String(image.user) !== String(auth.user._id) || image.status !== 'ready') return new NextResponse('Not found', { status: 404 })
  try {
    const prefix = `${buildTenantBlobPrefix({ tenantId: auth.tenant.databaseName, category: 'mira-images', ownerId: String(auth.user._id) })}/`
    if (!image.pathname?.startsWith(prefix) || image.pathname.includes('..')) return new NextResponse('Image unavailable', { status: 404 })
    if (!Number.isSafeInteger(image.byteLength) || image.byteLength < 1 || image.byteLength > 8 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(image.sha256 || '')) return new NextResponse('Image integrity metadata unavailable', { status: 502 })
    const blob = await getTenantBlob(image.pathname, { access: 'private' })
    if (!blob?.stream) return new NextResponse('Not found', { status: 404 })
    // Generated images are bounded to 8 MB. Verify migrated and new payloads
    // before returning anything to the owner.
    const reader = blob.stream.getReader(), chunks = []
    let received = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        received += value.byteLength
        if (received > image.byteLength) { await reader.cancel(); throw new Error('Image integrity mismatch') }
        chunks.push(Buffer.from(value))
      }
    } finally { reader.releaseLock() }
    const body = Buffer.concat(chunks)
    if (body.length !== image.byteLength || createHash('sha256').update(body).digest('hex') !== image.sha256) throw new Error('Image integrity mismatch')
    return new NextResponse(body, { headers: { 'Content-Type': image.contentType || 'image/png', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline; filename="mira-image.png"' } })
  } catch { return new NextResponse('Image unavailable', { status: 502 }) }
}
