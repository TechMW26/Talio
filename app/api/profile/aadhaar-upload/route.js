import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import User from '@/models/User'
import path from 'path'
import fs from 'fs/promises'

export const dynamic = 'force-dynamic'

// Maximum file size: 5MB
const MAX_FILE_SIZE = 5 * 1024 * 1024

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

    await connectDB()

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

    // Create secure upload directory
    const uploadDir = path.join(process.cwd(), 'uploads', 'aadhaar', decoded.userId)
    await fs.mkdir(uploadDir, { recursive: true })

    // Generate secure filename
    const timestamp = Date.now()
    const extension = imageData.match(/data:image\/(\w+);/)?.[1] || 'jpg'
    const filename = `aadhaar_${side}_${timestamp}.${extension}`
    const filePath = path.join(uploadDir, filename)

    // Save the file
    await fs.writeFile(filePath, imageBuffer)

    // Generate URL for the file
    const fileUrl = `/uploads/aadhaar/${decoded.userId}/${filename}`

    // Update user's Aadhaar document status
    const updateField = side === 'front' ? 'profileCompletion.aadhaarFront' : 'profileCompletion.aadhaarBack'
    
    const updateData = {
      [`${updateField}.url`]: fileUrl,
      [`${updateField}.uploadedAt`]: new Date(),
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
    const oldUrl = user.profileCompletion?.[side === 'front' ? 'aadhaarFront' : 'aadhaarBack']?.url
    if (oldUrl) {
      const oldPath = path.join(process.cwd(), oldUrl)
      try {
        await fs.unlink(oldPath)
      } catch (err) {
        // Ignore if file doesn't exist
        console.log('Old file cleanup:', err.message)
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

    await connectDB()

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
