import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import path from 'path'
import fs from 'fs/promises'
import { uploadImage, deleteImage } from '@/lib/gridfs'
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
    const auth = await getAuthAndModels(request, ['User', 'Employee'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user: authUser, models } = auth
    const { User, Employee } = models

    const user = await User.findById(authUser._id || authUser.userId)
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
      console.warn('[Aadhaar Upload] Pipeline failed, storing raw:', pipelineErr?.message || pipelineErr)
    }

    // Get employee info for folder structure
    let employee = null
    if (user.employeeId) {
      employee = await Employee.findById(user.employeeId).select('firstName lastName employeeCode')
    }
    if (!employee) {
      employee = await Employee.findOne({ userId: authUser._id || authUser.userId }).select('firstName lastName employeeCode')
    }

    // Generate secure filename with employee code
    const timestamp = Date.now()
    const extension = processedExtension
    const employeeCode = employee?.employeeCode || 'UNKNOWN'
    const filename = `aadhaar_${side}_${employeeCode}_${timestamp}.${extension}`

    let fileUrl = ''
    let fileId = null

    // Upload to GridFS
    try {
      console.log('[Aadhaar Upload] Uploading to GridFS...')
      const gridfsResult = await uploadImage(imageBuffer, {
        category: 'aadhaar',
        contentType: processedContentType,
        originalName: filename,
        userId: String(authUser._id || authUser.userId),
        employeeId: employee?._id ? String(employee._id) : undefined,
      })
      fileUrl = gridfsResult.url
      fileId = String(gridfsResult._id)
      console.log(`[Aadhaar Upload] ✅ Uploaded to GridFS: ${fileUrl}`)
    } catch (gridfsError) {
      console.error('[Aadhaar Upload] ❌ GridFS upload failed:', gridfsError.message)
    }

    // Fallback: Local file storage
    if (!fileUrl) {
      const firstName = (employee?.firstName || '').replace(/[^a-zA-Z0-9]/g, '')
      const lastName = (employee?.lastName || '').replace(/[^a-zA-Z0-9]/g, '')
      const employeeFolderName = `${firstName}${lastName}-${employeeCode}`
      const uploadDir = path.join(process.cwd(), 'uploads', 'aadhaar', employeeFolderName)
      await fs.mkdir(uploadDir, { recursive: true })

      const filePath = path.join(uploadDir, filename)
      await fs.writeFile(filePath, imageBuffer)
      fileUrl = `/uploads/aadhaar/${employeeFolderName}/${filename}`
    }

    // Update user's Aadhaar document status
    const updateField = side === 'front' ? 'profileCompletion.aadhaarFront' : 'profileCompletion.aadhaarBack'

    const updateData = {
      [`${updateField}.url`]: fileUrl,
      [`${updateField}.uploadedAt`]: new Date(),
      ...(fileId && { [`${updateField}.fileId`]: fileId }),
    }

    // Check if both sides will be uploaded after this update
    const otherSide = side === 'front' ? 'aadhaarBack' : 'aadhaarFront'
    const otherSideUploaded = user.profileCompletion?.[otherSide]?.url

    if (otherSideUploaded) {
      updateData['profileCompletion.completedFields.aadhaarUploaded'] = true
      // Update status to partially complete if personal info is done
      if (user.profileCompletion?.completedFields?.personalInfo) {
        updateData['profileCompletion.status'] = 'partially_complete'
      }
    }

    await User.findByIdAndUpdate(authUser._id || authUser.userId, {
      $set: updateData
    })

    // Delete old file if exists
    const oldSideData = user.profileCompletion?.[side === 'front' ? 'aadhaarFront' : 'aadhaarBack']
    if (oldSideData?.url) {
      // If old file was on GridFS, delete from GridFS
      if (oldSideData.fileId) {
        try {
          await deleteImage(oldSideData.fileId)
          console.log(`[Aadhaar Upload] Deleted old GridFS file: ${oldSideData.fileId}`)
        } catch (err) {
          console.log('Old GridFS file cleanup:', err.message)
        }
      } else if (oldSideData.url.startsWith('/uploads/')) {
        // Local file - delete from filesystem
        const oldPath = path.join(process.cwd(), oldSideData.url)
        try {
          await fs.unlink(oldPath)
        } catch (err) {
          console.log('Old file cleanup:', err.message)
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: `Aadhaar ${side} uploaded successfully`,
      data: {
        side,
        url: fileUrl,
        uploadedAt: new Date(),
        bothUploaded: !!otherSideUploaded
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
    const auth = await getAuthAndModels(request, ['User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user: authUser, models } = auth
    const { User } = models

    const user = await User.findById(authUser._id).select('profileCompletion')
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
