import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { writeFile, mkdir, unlink } from 'fs/promises'
import path from 'path'
import { existsSync } from 'fs'
import { optimizeImage, isValidImage } from '@/lib/imageOptimization'
import { uploadImage } from '@/lib/gridfs'
// Configure route for larger file uploads (10MB)
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
}

// Next.js App Router specific config
export const maxDuration = 60 // 60 seconds timeout for large uploads

// Image MIME types that should be optimized
const OPTIMIZABLE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']

export async function POST(request) {
  try {
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['User', 'Employee'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { User, Employee } = models

    const formData = await request.formData()
    const file = formData.get('file')
    const folder = formData.get('folder') || 'chat' // Allow custom folder

    if (!file) {
      return NextResponse.json({ success: false, message: 'No file provided' }, { status: 400 })
    }

    // Check file size (10MB limit)
    const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB in bytes
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({
        success: false,
        message: `File size exceeds 10MB limit. Your file is ${(file.size / (1024 * 1024)).toFixed(2)}MB`
      }, { status: 400 })
    }

    // Get employee info for folder structure
    const userId = user._id || user.userId
    const currentUser = await User.findById(userId).select('employeeId')
    let employee = null
    if (currentUser?.employeeId) {
      employee = await Employee.findById(currentUser.employeeId).select('firstName lastName employeeCode')
    }
    if (!employee) {
      employee = await Employee.findOne({ userId: userId }).select('firstName lastName employeeCode')
    }

    // Convert file to buffer
    const bytes = await file.arrayBuffer()
    let buffer = Buffer.from(bytes)
    let optimizationInfo = null

    // Optimize images before uploading
    const isImage = OPTIMIZABLE_TYPES.includes(file.type)
    if (isImage && await isValidImage(buffer)) {
      const { buffer: optimizedBuffer, metadata } = await optimizeImage(buffer, {
        type: 'large',
        format: 'webp',
        quality: 80
      })
      buffer = optimizedBuffer
      optimizationInfo = metadata
    }

    // Generate filename
    const originalName = file.name.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9.-]/g, '_')
    const finalFilename = isImage
      ? `${Date.now()}-${originalName}.webp`
      : `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`

    // Get the upload category from folder parameter
    const uploadCategory = folder || 'chat'

    console.log('[Upload] Processing:', {
      isImage,
      folder: uploadCategory,
      fileName: finalFilename
    })

    // Upload to GridFS
    try {
      console.log('[Upload] Uploading to GridFS...')
      const userId = user._id || user.userId
      const contentType = isImage ? 'image/webp' : (file.type || 'application/octet-stream')

      const gridfsResult = await uploadImage(buffer, {
        category: uploadCategory,
        contentType,
        originalName: finalFilename,
        userId: String(userId),
        employeeId: employee?._id ? String(employee._id) : undefined,
      })

      console.log('[Upload] GridFS SUCCESS:', gridfsResult.url)

      return NextResponse.json({
        success: true,
        data: {
          fileUrl: gridfsResult.url,
          fileId: String(gridfsResult._id),
          fileName: file.name,
          fileType: contentType,
          fileSize: gridfsResult.length || buffer.length,
          originalSize: file.size,
          optimized: !!optimizationInfo,
          width: optimizationInfo?.width,
          height: optimizationInfo?.height,
          storage: 'gridfs',
          ...(optimizationInfo && { compressionRatio: optimizationInfo.compressionRatio })
        }
      })
    } catch (gridfsError) {
      console.error('[Upload] GridFS upload failed, falling back to local:', gridfsError.message)
    }

    // Fallback: Local file storage
    const uploadsDir = path.join(process.cwd(), 'public', 'uploads', folder)

    try {
      if (!existsSync(uploadsDir)) {
        await mkdir(uploadsDir, { recursive: true, mode: 0o755 })
      }
    } catch (mkdirError) {
      console.error('[Upload] Failed to create directory:', mkdirError.message)
      // Try creating with different approach
      const { execSync } = require('child_process')
      try {
        execSync(`mkdir -p "${uploadsDir}"`, { stdio: 'ignore' })
      } catch (e) {
        return NextResponse.json({
          success: false,
          message: `Upload directory creation failed. Please ensure the server has write permissions to: ${uploadsDir}`
        }, { status: 500 })
      }
    }

    const filepath = path.join(uploadsDir, finalFilename)

    try {
      await writeFile(filepath, buffer)
    } catch (writeError) {
      console.error('[Upload] Failed to write file:', writeError.message)
      return NextResponse.json({
        success: false,
        message: `Failed to save file. Permission denied on: ${uploadsDir}. Please check server write permissions.`
      }, { status: 500 })
    }

    // Return the URL
    const fileUrl = `/uploads/${folder}/${finalFilename}`

    return NextResponse.json({
      success: true,
      data: {
        fileUrl,
        fileName: file.name,
        fileType: isImage ? 'image/webp' : file.type,
        fileSize: buffer.length,
        originalSize: file.size,
        optimized: !!optimizationInfo,
        storage: 'local',
        ...(optimizationInfo && { compressionRatio: optimizationInfo.compressionRatio })
      }
    })
  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}

