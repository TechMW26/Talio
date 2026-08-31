import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { optimizeImage, isValidImage } from '@/lib/imageOptimization'
import { uploadImage } from '@/lib/gridfs'
import {
  buildAuthenticatedBlobUrl,
  getBlobAccessMode,
  isBlobStorageConfigured,
  uploadTenantBlob,
} from '@/lib/platform/blobStorage.server'
import {
  normalizeUploadCategory,
  validateUploadMetadata,
} from '@/lib/platform/uploadPolicy'
import { getRuntimeCapabilities } from '@/lib/platform/runtime'

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
  const { User, Employee } = auth.models
  const userId = auth.user._id || auth.user.userId
  const currentUser = await User.findById(userId).select('employeeId').lean()

  return currentUser?.employeeId
    ? Employee.findById(currentUser.employeeId).select('_id').lean()
    : Employee.findOne({ userId }).select('_id').lean()
}

export async function POST(request) {
  try {
    const auth = await getAuthAndModels(request, ['User', 'Employee'])
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
      const access = getBlobAccessMode()
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

    if (getRuntimeCapabilities().isVercel) {
      return NextResponse.json({
        success: false,
        code: 'BLOB_NOT_CONFIGURED',
        message: 'BLOB_READ_WRITE_TOKEN is required for uploads on Vercel',
      }, { status: 503 })
    }

    // GridFS remains the non-Vercel compatibility backend; no runtime path writes
    // to public/uploads, because those files disappear on serverless instances.
    const gridfs = await uploadImage(buffer, {
      category,
      contentType,
      originalName: finalFilename,
      userId,
      employeeId: employee?._id ? String(employee._id) : undefined,
    })

    return uploadResponse({
      fileUrl: gridfs.url,
      fileId: String(gridfs._id),
      fileName: file.name,
      fileType: contentType,
      fileSize: gridfs.length || buffer.length,
      originalSize: file.size,
      optimized: Boolean(optimizationInfo),
      width: optimizationInfo?.width,
      height: optimizationInfo?.height,
      storage: 'gridfs',
      ...(optimizationInfo && { compressionRatio: optimizationInfo.compressionRatio }),
    })
  } catch (error) {
    console.error('[Upload] Failed:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
