import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { optimizeImage, isValidImage } from '@/lib/imageOptimization'
import {
  buildAuthenticatedBlobUrl,
  isBlobStorageConfigured,
  uploadTenantBlob,
} from '@/lib/platform/blobStorage.server'
import {
  normalizeUploadCategory,
  validateUploadMetadata,
} from '@/lib/platform/uploadPolicy'

export const runtime = 'nodejs'
export const maxDuration = 60

const OPTIMIZABLE_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
])

function uploadResponse(data) {
  return NextResponse.json({
    success: true,
    // Keep the old top-level fields while all callers converge on `data`.
    url: data.fileUrl,
    fileUrl: data.fileUrl,
    data,
  })
}

async function getEmployee(auth) {
  const userId = String(auth.user._id || auth.user.userId), currentUser = await auth.database.get('users', userId)
  if (currentUser?.employeeId) return auth.database.get('employees', String(currentUser.employeeId?._id || currentUser.employeeId))
  const result = await auth.database.list('employees', { filters: [{ field: 'userId', operator: '==', value: userId }], limit: 2 })
  if (result.records.length > 1) throw new Error('Ambiguous employee account')
  return result.records[0] || null
}

export async function POST(request) {
  try {
    const auth = await getAuthAndDatabase(request, { queryFields: { employees: ['userId'] } })
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }

    const formData = await request.formData()
    const file = formData.get('file')
    const category = normalizeUploadCategory(formData.get('folder'))
    if (!file || typeof file.arrayBuffer !== 'function') {
      return NextResponse.json({ success: false, message: 'No file provided' }, { status: 400 })
    }
    if (!category) {
      return NextResponse.json({ success: false, message: 'Invalid upload category' }, { status: 400 })
    }

    const validation = validateUploadMetadata({
      filename: file.name,
      contentType: file.type,
      size: file.size,
    })
    if (!validation.valid) {
      return NextResponse.json({ success: false, ...validation }, { status: 400 })
    }

    const employee = await getEmployee(auth)
    const userId = String(auth.user._id || auth.user.userId)
    let buffer = Buffer.from(await file.arrayBuffer())
    let contentType = validation.contentType
    let optimizationInfo = null

    if (OPTIMIZABLE_TYPES.has(contentType) && await isValidImage(buffer)) {
      const optimized = await optimizeImage(buffer, {
        type: 'large',
        format: 'webp',
        quality: 80,
      })
      buffer = optimized.buffer
      optimizationInfo = optimized.metadata
      contentType = 'image/webp'
    }

    const basename = file.name.replace(/\.[^/.]+$/, '') || 'file'
    const finalFilename = optimizationInfo ? `${basename}.webp` : file.name

    if (isBlobStorageConfigured()) {
      const access = 'private'
      const blob = await uploadTenantBlob({
        tenantId: auth.tenant.databaseName,
        category,
        ownerId: userId,
        filename: finalFilename,
        body: buffer,
        contentType,
        access,
        cacheControlMaxAge: access === 'private' ? 300 : 31_536_000,
      })
      const fileUrl = blob.access === 'private'
        ? buildAuthenticatedBlobUrl(blob.pathname)
        : blob.url

      return uploadResponse({
        fileUrl,
        fileId: blob.pathname,
        fileName: file.name,
        fileType: contentType,
        fileSize: buffer.length,
        originalSize: file.size,
        optimized: Boolean(optimizationInfo),
        width: optimizationInfo?.width,
        height: optimizationInfo?.height,
        storage: blob.provider,
        ...(optimizationInfo && { compressionRatio: optimizationInfo.compressionRatio }),
      })
    }

    return NextResponse.json({
      success: false,
      code: 'BLOB_NOT_CONFIGURED',
      message: 'Private Vercel Blob storage must be configured before uploading',
    }, { status: 503 })
  } catch (error) {
    console.error('[Upload] Failed:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
