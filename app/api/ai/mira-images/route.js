import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { rateLimit } from '@/lib/security/rateLimiter'
import { validateMiraImageAction } from '@/lib/miraImageGeneration'
import { generatePollinationsImage } from '@/lib/ai/providers/pollinationsImageProvider'
import { isBlobStorageConfigured, uploadTenantBlob, deleteTenantBlob } from '@/lib/platform/blobStorage.server'

export const runtime = 'nodejs'
export const maxDuration = 180

export async function POST(request) {
  const auth = await getAuthAndModels(request, ['MiraGeneratedImage'])
  if (!auth.success) return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => null)
  const action = validateMiraImageAction(body?.action)
  if (!action || !/^[a-zA-Z0-9_-]{8,80}$/.test(body?.requestId || '')) return NextResponse.json({ success: false, message: 'A valid image prompt and request ID are required.' }, { status: 400 })
  if (!process.env.POLLINATIONS_API_KEY) return NextResponse.json({ success: false, message: 'Image generation is not configured.' }, { status: 503 })
  const Image = auth.models.MiraGeneratedImage
  const owner = { user: auth.user._id, requestId: body.requestId }
  const existing = await Image.findOne(owner).lean()
  if (existing) return existing.status === 'ready'
    ? NextResponse.json({ success: true, image: { id: String(existing._id), status: 'ready' } })
    : NextResponse.json({ success: false, message: 'This image request is already in progress or has failed. Send a new request to try again.' }, { status: 409 })
  const bucket = await rateLimit('MIRA_IMAGE', `${auth.tenant.databaseName}:${auth.user._id}`)
  if (!bucket.allowed) return NextResponse.json({ success: false, message: 'Image generation limit reached. Please try again later.' }, { status: 429, headers: { 'Retry-After': String(bucket.retryAfterSeconds) } })
  let record, stored
  try {
    record = await Image.create(owner)
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(150000)])
    const generationStarted = performance.now()
    const image = await generatePollinationsImage(action.fields.prompt, signal)
    const generationMs = performance.now() - generationStarted
    const storageStarted = performance.now()
    signal.throwIfAborted()
    if (image.buffer.length > 8 * 1024 * 1024) throw new Error('Generated image is too large.')
    if (isBlobStorageConfigured()) stored = await uploadTenantBlob({ tenantId: auth.tenant.databaseName, category: 'mira-images', ownerId: String(auth.user._id), filename: 'generated.png', body: image.buffer, contentType: image.contentType, access: 'private' })
    signal.throwIfAborted()
    await Image.updateOne({ _id: record._id, user: auth.user._id }, { $set: { status: 'ready', ...(stored ? { pathname: stored.pathname } : { imageBuffer: image.buffer }), model: image.model } })
    return NextResponse.json({ success: true, image: { id: String(record._id), status: 'ready' } }, { headers: { 'Server-Timing': `image_generation;dur=${generationMs.toFixed(1)}, image_storage;dur=${(performance.now() - storageStarted).toFixed(1)}` } })
  } catch (error) {
    if (stored) await deleteTenantBlob(stored.url).catch(() => {})
    if (record) await Image.updateOne({ _id: record._id }, { $set: { status: 'failed' } }).catch(() => {})
    return NextResponse.json({ success: false, message: error.code === 11000 ? 'This image request is already being processed.' : 'Could not generate the image. Please try again later or check image credits.' }, { status: error.code === 11000 ? 409 : 502 })
  }
}
