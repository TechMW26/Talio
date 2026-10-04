import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { getProfileStore, getProfileRecords, replaceAadhaarImage, invalidateProfile } from '@/lib/platform/firestoreProfile.server'
import { uploadImage, deleteImage } from '@/lib/mediaStorage'
import { processImage, ImagePipelineError } from '@/lib/imagePipeline'

export const dynamic = 'force-dynamic'

// Maximum file size: 5MB
const MAX_FILE_SIZE = 5 * 1024 * 1024

/**
 * POST /api/profile/aadhaar-upload
 * Upload Aadhaar card images (front/back)
 */
export async function POST(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndDatabase(request)
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user: authUser } = auth
    const store = await getProfileStore(auth.tenant.databaseName)
    const { user, employee } = await getProfileRecords(store, authUser._id || authUser.userId)
    if (!user) {
      return NextResponse.json({ success: false, message: 'User not found' }, { status: 404 })
    }

    // Check if account is suspended
    if (!user.isActive && user.suspensionReason === 'profile_incomplete') {
      return NextResponse.json({
        success: false,
        message: 'Your account has been suspended due to incomplete profile. Please contact HR.'
      }, { status: 403 })
    }

    // Parse the request body
    const body = await request.json()
    const { side, imageData } = body

    // Validate side
    if (!side || !['front', 'back'].includes(side)) {
      return NextResponse.json({
        success: false,
        message: 'Invalid side. Must be "front" or "back"'
      }, { status: 400 })
    }

    // Validate image data
    if (!imageData) {
      return NextResponse.json({
        success: false,
        message: 'No image data provided'
      }, { status: 400 })
    }

    // Validate base64 image
    const base64Regex = /^data:image\/(jpeg|jpg|png|webp);base64,/
    if (!base64Regex.test(imageData)) {
      return NextResponse.json({
        success: false,
        message: 'Invalid image format. Please upload a JPEG, PNG, or WebP image.'
      }, { status: 400 })
    }

    // Extract base64 data and check size
    const base64Data = imageData.replace(base64Regex, '')
    const rawBuffer = Buffer.from(base64Data, 'base64')

    if (rawBuffer.length > MAX_FILE_SIZE) {
      return NextResponse.json({
        success: false,
        message: 'Image too large. Maximum size is 5MB.'
      }, { status: 400 })
    }

    // Run through unified pipeline: strips EXIF (PII!), normalizes to WebP.
    let imageBuffer = rawBuffer
    let processedExtension = imageData.match(/data:image\/(\w+);/)?.[1] || 'jpg'
    let processedContentType = `image/${processedExtension}`
    try {
      const processed = await processImage(rawBuffer, { type: 'document' })
      imageBuffer = processed.buffer
      processedExtension = processed.format
      processedContentType = processed.mimeType
    } catch (pipelineErr) {
      if (pipelineErr instanceof ImagePipelineError && pipelineErr.code === 'too_large') {
        return NextResponse.json({ success: false, message: 'Image too large.' }, { status: 413 })
      }
      return NextResponse.json({ success: false, message: 'Invalid image. Please upload a clear supported image.' }, { status: 400 })
    }

    // Get employee info for folder structure

    // Generate secure filename with employee code
    const timestamp = Date.now()
    const extension = processedExtension
    const employeeCode = employee?.employeeCode || 'UNKNOWN'
    const filename = `aadhaar_${side}_${employeeCode}_${timestamp}.${extension}`

    let fileUrl = ''
    let fileId = null

    // Upload to private Blob storage
    try {
      console.log('[Aadhaar Upload] Uploading to private Blob storage...')
      const mediaResult = await uploadImage(imageBuffer, {
        databaseName: auth.tenant.databaseName,
        category: 'aadhaar',
        contentType: processedContentType,
        originalName: filename,
        userId: String(authUser._id || authUser.userId),
        employeeId: employee?._id ? String(employee._id) : undefined,
      })
      fileUrl = mediaResult.url
      fileId = String(mediaResult._id)
      console.log(`[Aadhaar Upload] ✅ Uploaded to private Blob storage: ${fileUrl}`)
    } catch (mediaError) {
      console.error('[Aadhaar Upload] ❌ private Blob storage upload failed:', mediaError.message)
    }

    if (!fileUrl) {
      return NextResponse.json({ success: false, message: 'Document storage is unavailable. Please retry.' }, { status: 503 })
    }

    let result
    try {
      result = await replaceAadhaarImage(store, user._id, side, { _id: fileId, url: fileUrl })
    } catch (error) {
      await deleteImage(fileId, { databaseName: auth.tenant.databaseName }).catch(() => {})
      throw error
    }
    await invalidateProfile(auth.tenant.databaseName, user._id)
    if (result.previous && result.previous !== fileId) await deleteImage(result.previous, { databaseName: auth.tenant.databaseName }).catch(() => {})

    return NextResponse.json({
      success: true,
      message: `Aadhaar ${side} uploaded successfully`,
      data: {
        side,
        url: fileUrl,
        uploadedAt: new Date(),
        bothUploaded: result.bothUploaded
      }
    })

  } catch (error) {
    console.error('[Aadhaar Upload] Error:', error)
    return NextResponse.json({
      success: false,
      message: 'Failed to upload Aadhaar document'
    }, { status: 500 })
  }
}

/**
 * GET /api/profile/aadhaar-upload
 * Get Aadhaar upload status
 */
export async function GET(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndDatabase(request)
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user: authUser } = auth
    const store = await getProfileStore(auth.tenant.databaseName)
    const user = await store.get('users', authUser._id || authUser.userId)
    if (!user) {
      return NextResponse.json({ success: false, message: 'User not found' }, { status: 404 })
    }

    return NextResponse.json({
      success: true,
      data: {
        aadhaarFront: user.profileCompletion?.aadhaarFront || null,
        aadhaarBack: user.profileCompletion?.aadhaarBack || null,
        bothUploaded: !!(user.profileCompletion?.aadhaarFront?.url && user.profileCompletion?.aadhaarBack?.url)
      }
    })

  } catch (error) {
    console.error('[Aadhaar Status] Error:', error)
    return NextResponse.json({
      success: false,
      message: 'Failed to get Aadhaar status'
    }, { status: 500 })
  }
}
