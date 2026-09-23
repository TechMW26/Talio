import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { getTenantBlob } from '@/lib/platform/blobStorage.server'

export async function GET(request, { params }) {
  const auth = await getAuthAndModels(request, ['MiraGeneratedImage'])
  if (!auth.success) return new NextResponse('Unauthorized', { status: 401 })
  const { id } = await params
  if (!/^[a-f0-9]{24}$/i.test(id)) return new NextResponse('Not found', { status: 404 })
  const image = await auth.models.MiraGeneratedImage.findOne({ _id: id, user: auth.user._id, status: 'ready' }).select('+imageBuffer')
  if (!image) return new NextResponse('Not found', { status: 404 })
  try {
    const body = image.imageBuffer?.length ? new Uint8Array(image.imageBuffer) : (await getTenantBlob(image.pathname, { access: 'private' }))?.stream
    if (!body) return new NextResponse('Not found', { status: 404 })
    return new NextResponse(body, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline; filename="mira-image.png"' } })
  } catch { return new NextResponse('Image unavailable', { status: 502 }) }
}
