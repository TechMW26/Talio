import { NextResponse } from 'next/server'
import { verifyTokenFromRequest } from '@/lib/auth'
import { createHash } from 'node:crypto'
import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import { rateLimit } from '@/lib/security/rateLimiter'
import { validateMiraImageAction } from '@/lib/miraImageGeneration'
import { generatePollinationsImage } from '@/lib/ai/providers/pollinationsImageProvider'
import { isBlobStorageConfigured, uploadTenantBlob, deleteTenantBlob } from '@/lib/platform/blobStorage.server'

export const runtime = 'nodejs'
export const maxDuration = 180

export async function POST(request) {
  const auth = await verifyTokenFromRequest(request)
  if (!auth.success) return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => null)
  const action = validateMiraImageAction(body?.action)
  if (!action || !/^[a-zA-Z0-9_-]{8,80}$/.test(body?.requestId || '')) return NextResponse.json({ success: false, message: 'A valid image prompt and request ID are required.' }, { status: 400 })
  if (!process.env.POLLINATIONS_API_KEY) return NextResponse.json({ success: false, message: 'Image generation is not configured.' }, { status: 503 })
  if (!isBlobStorageConfigured()) return NextResponse.json({ success: false, message: 'Private image storage is not configured.' }, { status: 503 })
  const store = await getFirestoreTenantDatabase(auth.tenant.databaseName, { queryFields: { mirageneratedimages: ['user', 'requestId'] }, constraints: { mirageneratedimages: [{ fields: ['user', 'requestId'] }] } })
  const owner = { user: String(auth.user._id), requestId: body.requestId }
  const existing = (await store.list('mirageneratedimages', { filters: [{ field: 'user', operator: '==', value: owner.user }, { field: 'requestId', operator: '==', value: owner.requestId }], limit: 1 })).records[0]
  if (existing) return existing.status === 'ready'
    ? NextResponse.json({ success: true, image: { id: String(existing._id), status: 'ready' } })
    : NextResponse.json({ success: false, message: 'This image request is already in progress or has failed. Send a new request to try again.' }, { status: 409 })
  const bucket = await rateLimit('MIRA_IMAGE', `${auth.tenant.databaseName}:${auth.user._id}`)
  if (!bucket.allowed) return NextResponse.json({ success: false, message: 'Image generation limit reached. Please try again later.' }, { status: 429, headers: { 'Retry-After': String(bucket.retryAfterSeconds) } })
  let record, stored
  try {
    const now = new Date()
    record = await store.create('mirageneratedimages', { _id: createHash('sha256').update(JSON.stringify(owner)).digest('hex').slice(0, 24), ...owner, status: 'pending', createdAt: now, updatedAt: now })
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(150000)])
    const generationStarted = performance.now()
    const image = await generatePollinationsImage(action.fields.prompt, signal)
    const generationMs = performance.now() - generationStarted
    const storageStarted = performance.now()
    signal.throwIfAborted()
    if (image.buffer.length > 8 * 1024 * 1024) throw new Error('Generated image is too large.')
    stored = await uploadTenantBlob({ tenantId: auth.tenant.databaseName, category: 'mira-images', ownerId: owner.user, filename: 'generated.png', body: image.buffer, contentType: image.contentType, access: 'private' })
    signal.throwIfAborted()
    // Generation may take minutes. Re-check current account/session version
    // while committing so revocation during provider work cannot publish media.
    await store.transaction(async tx => {
      const [account, current] = await Promise.all([tx.get('users', owner.user), tx.get('mirageneratedimages', record._id)])
      if (!account?.isActive || (Number(account.authVersion) || 0) !== (Number(auth.user.authVersion) || 0)) throw Object.assign(new Error('Account access changed'), { status: 403 })
      if (!current || current.user !== owner.user || current.status !== 'pending') throw Object.assign(new Error('Image request changed'), { status: 409 })
      await tx.replace('mirageneratedimages', { ...current, status: 'ready', pathname: stored.pathname, contentType: image.contentType, byteLength: image.buffer.length, sha256: createHash('sha256').update(image.buffer).digest('hex'), model: image.model, updatedAt: new Date() })
    })
    return NextResponse.json({ success: true, image: { id: String(record._id), status: 'ready' } }, { headers: { 'Server-Timing': `image_generation;dur=${generationMs.toFixed(1)}, image_storage;dur=${(performance.now() - storageStarted).toFixed(1)}` } })
  } catch (error) {
    if (stored) await deleteTenantBlob(stored.pathname).catch(() => {})
    if (record) await store.mutate('mirageneratedimages', record._id, current => ({ ...current, status: 'failed', updatedAt: new Date() })).catch(() => {})
    return NextResponse.json({ success: false, message: error.status === 403 ? 'Account access changed. Please sign in again.' : error.code === 'ALREADY_EXISTS' ? 'This image request is already being processed.' : 'Could not generate the image. Please try again later or check image credits.' }, { status: error.status || (error.code === 'ALREADY_EXISTS' ? 409 : 502) })
  }
}
