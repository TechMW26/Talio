import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import { writeFile, mkdir, unlink } from 'fs/promises'
import path from 'path'
import { existsSync } from 'fs'
import { optimizeImage, isValidImage } from '@/lib/imageOptimization'
import { uploadWithTempStorage, uploadImageToImageKit, getImageKitFolder, generateEmployeeFolderName } from '@/lib/imagekit'
import connectDB from '@/lib/mongodb'
import User from '@/models/User'
import Employee from '@/models/Employee'

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

// Check if ImageKit is configured
const isImageKitConfigured = () => {
  const configured = !!(
    process.env.IMAGEKIT_PUBLIC_KEY &&
    process.env.IMAGEKIT_PRIVATE_KEY &&
    process.env.IMAGEKIT_URL_ENDPOINT
  )
  console.log('[Upload] ImageKit configured:', configured, {
    publicKey: process.env.IMAGEKIT_PUBLIC_KEY ? 'SET' : 'NOT SET',
    privateKey: process.env.IMAGEKIT_PRIVATE_KEY ? 'SET' : 'NOT SET',
    urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT ? 'SET' : 'NOT SET'
  })
  return configured
}

export async function POST(request) {
  try {
    const token = request.headers.get('authorization')?.split(' ')[1]
    if (!token) {
      return NextResponse.json({ success: false, message: 'No token provided' }, { status: 401 })
    }

    const decoded = await verifyToken(token)
    if (!decoded) {
      return NextResponse.json({ success: false, message: 'Invalid token' }, { status: 401 })
    }

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
    await connectDB()
    const user = await User.findById(decoded.userId).select('employeeId')
    let employee = null
    if (user?.employeeId) {
      employee = await Employee.findById(user.employeeId).select('firstName lastName employeeCode')
    }
    if (!employee) {
      employee = await Employee.findOne({ userId: decoded.userId }).select('firstName lastName employeeCode')
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

    // Get the appropriate ImageKit folder based on upload type
    const imagekitFolder = getImageKitFolder(folder, { employee })

    console.log('[Upload] Processing:', {
      isImage,
      imagekitConfigured: isImageKitConfigured(),
      folder: imagekitFolder,
      fileName: finalFilename
    })

    // Try ImageKit upload if configured, fallback to local storage
    if (isImageKitConfigured() && isImage) {
      try {
        console.log('[Upload] Attempting ImageKit upload...')

        // Build safe tags (no undefined values)
        const safeTags = ['upload', folder, employee?.employeeCode].filter(Boolean)

        const imagekitResult = await uploadWithTempStorage(buffer, {
          fileName: finalFilename,
          folder: imagekitFolder,
          tags: safeTags,
        })

        console.log('[Upload] ImageKit SUCCESS:', imagekitResult.url)

        return NextResponse.json({
          success: true,
          data: {
            fileUrl: imagekitResult.url,
            fileId: imagekitResult.fileId,
            fileName: file.name,
            fileType: 'image/webp',
            fileSize: imagekitResult.size || buffer.length,
            originalSize: file.size,
            optimized: !!optimizationInfo,
            thumbnailUrl: imagekitResult.thumbnailUrl,
            width: imagekitResult.width,
            height: imagekitResult.height,
            storage: 'imagekit',
            ...(optimizationInfo && { compressionRatio: optimizationInfo.compressionRatio })
          }
        })
      } catch (imagekitError) {
        console.error('[Upload] ImageKit upload failed, falling back to local:', imagekitError.message)
        // Fall through to local storage
      }
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

