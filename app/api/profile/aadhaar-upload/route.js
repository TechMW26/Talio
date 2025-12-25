import { NextResponse } from 'next/server'
import { verifyToken, getAuthAndModels } from '@/lib/auth'
import path from 'path'
import fs from 'fs/promises'
import { deleteFromImageKit, getImageKitFolder, generateEmployeeFolderName } from '@/lib/imagekit'

export const dynamic = 'force-dynamic'

// Maximum file size: 5MB
const MAX_FILE_SIZE = 5 * 1024 * 1024

// Check if ImageKit is configured
const isImageKitConfigured = () => {
  return !!(
    process.env.IMAGEKIT_PUBLIC_KEY &&
    process.env.IMAGEKIT_PRIVATE_KEY &&
    process.env.IMAGEKIT_URL_ENDPOINT
  )
}

/**
 * POST /api/profile/aadhaar-upload
 * Upload Aadhaar card images (front/back)
 */
export async function POST(request) {
  try {
    // Verify authentication
    const token = request.headers.get('authorization')?.split(' ')[1]
    if (!token) {
      return NextResponse.json({ success: false, message: 'No token provided' }, { status: 401 })
    }

    const decoded = await verifyToken(token)
    if (!decoded) {
      return NextResponse.json({ success: false, message: 'Invalid token' }, { status: 401 })
    }

    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['User', 'Employee'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { models } = auth
    const { User, Employee } = models

    const user = await User.findById(decoded.userId)
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
    const imageBuffer = Buffer.from(base64Data, 'base64')

    if (imageBuffer.length > MAX_FILE_SIZE) {
      return NextResponse.json({
        success: false,
        message: 'Image too large. Maximum size is 5MB.'
      }, { status: 400 })
    }

    // Get employee info for folder structure
    let employee = null
    if (user.employeeId) {
      employee = await Employee.findById(user.employeeId).select('firstName lastName employeeCode')
    }
    if (!employee) {
      employee = await Employee.findOne({ userId: decoded.userId }).select('firstName lastName employeeCode')
    }

    // Generate secure filename with employee code
    const timestamp = Date.now()
    const extension = imageData.match(/data:image\/(\w+);/)?.[1] || 'jpg'
    const employeeCode = employee?.employeeCode || 'UNKNOWN'
    const filename = `aadhaar_${side}_${employeeCode}_${timestamp}.${extension}`

    // Get the appropriate ImageKit folder
    const imagekitFolder = getImageKitFolder('aadhaar', { employee })
    const employeeFolderName = generateEmployeeFolderName(employee)

    let fileUrl = ''
    let fileId = null

    // Try ImageKit upload if configured
    if (isImageKitConfigured()) {
      try {
        console.log('[Aadhaar Upload] ImageKit is configured, attempting upload...')
        console.log('[Aadhaar Upload] Folder:', imagekitFolder)
        console.log('[Aadhaar Upload] Filename:', filename)
        console.log('[Aadhaar Upload] Buffer size:', imageBuffer.length, 'bytes')

        // Build safe tags (no undefined values)
        const safeTags = ['aadhaar', side, 'document', employeeCode].filter(Boolean)

        // Use uploadImageToImageKit directly (no temp file) - works better in serverless/Docker
        const { uploadImageToImageKit } = await import('@/lib/imagekit')
        const imagekitResult = await uploadImageToImageKit(imageBuffer, {
          fileName: filename,
          folder: imagekitFolder,
          tags: safeTags,
          useUniqueFileName: true,
        })

        fileUrl = imagekitResult.url
        fileId = imagekitResult.fileId
        console.log(`[Aadhaar Upload] ✅ Uploaded to ImageKit: ${fileUrl}`)
      } catch (imagekitError) {
        console.error('[Aadhaar Upload] ❌ ImageKit upload failed:')
        console.error('[Aadhaar Upload] Error name:', imagekitError.name)
        console.error('[Aadhaar Upload] Error message:', imagekitError.message)
        console.error('[Aadhaar Upload] Error stack:', imagekitError.stack)
        // Fall through to local storage
      }
    } else {
      console.log('[Aadhaar Upload] ImageKit not configured, using local storage')
      console.log('[Aadhaar Upload] IMAGEKIT_PUBLIC_KEY:', process.env.IMAGEKIT_PUBLIC_KEY ? 'SET' : 'NOT SET')
      console.log('[Aadhaar Upload] IMAGEKIT_PRIVATE_KEY:', process.env.IMAGEKIT_PRIVATE_KEY ? 'SET' : 'NOT SET')
      console.log('[Aadhaar Upload] IMAGEKIT_URL_ENDPOINT:', process.env.IMAGEKIT_URL_ENDPOINT ? 'SET' : 'NOT SET')
    }

    // Fallback: Local file storage with employee folder structure
    if (!fileUrl) {
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

    await User.findByIdAndUpdate(decoded.userId, {
      $set: updateData
    })

    // Delete old file if exists
    const oldSideData = user.profileCompletion?.[side === 'front' ? 'aadhaarFront' : 'aadhaarBack']
    if (oldSideData?.url) {
      // If old file was on ImageKit, delete from ImageKit
      if (oldSideData.fileId) {
        try {
          await deleteFromImageKit(oldSideData.fileId)
          console.log(`[Aadhaar Upload] Deleted old ImageKit file: ${oldSideData.fileId}`)
        } catch (err) {
          console.log('Old ImageKit file cleanup:', err.message)
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
    const token = request.headers.get('authorization')?.split(' ')[1]
    if (!token) {
      return NextResponse.json({ success: false, message: 'No token provided' }, { status: 401 })
    }

    const decoded = await verifyToken(token)
    if (!decoded) {
      return NextResponse.json({ success: false, message: 'Invalid token' }, { status: 401 })
    }

    const user = await User.findById(decoded.userId).select('profileCompletion')
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
