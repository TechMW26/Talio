import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'
import { existsSync } from 'fs'
import { optimizeImage, isValidImage } from '@/lib/imageOptimization'

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

    // Create uploads directory if it doesn't exist
    const uploadsDir = path.join(process.cwd(), 'public', 'uploads', 'chat')
    if (!existsSync(uploadsDir)) {
      await mkdir(uploadsDir, { recursive: true })
    }

    // Convert file to buffer
    const bytes = await file.arrayBuffer()
    let buffer = Buffer.from(bytes)
    let finalFilename
    let optimizationInfo = null

    // Optimize images before saving
    const isImage = OPTIMIZABLE_TYPES.includes(file.type)
    if (isImage && await isValidImage(buffer)) {
      const { buffer: optimizedBuffer, metadata } = await optimizeImage(buffer, {
        type: 'large',
        format: 'webp',
        quality: 80
      })
      buffer = optimizedBuffer
      optimizationInfo = metadata
      
      // Change extension to webp for optimized images
      const originalName = file.name.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9.-]/g, '_')
      finalFilename = `${Date.now()}-${originalName}.webp`
    } else {
      // Non-image files - keep original
      const originalName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_')
      finalFilename = `${Date.now()}-${originalName}`
    }

    const filepath = path.join(uploadsDir, finalFilename)
    await writeFile(filepath, buffer)

    // Return the URL
    const fileUrl = `/uploads/chat/${finalFilename}`

    return NextResponse.json({
      success: true,
      data: {
        fileUrl,
        fileName: file.name,
        fileType: isImage ? 'image/webp' : file.type,
        fileSize: buffer.length,
        originalSize: file.size,
        optimized: !!optimizationInfo,
        ...(optimizationInfo && { compressionRatio: optimizationInfo.compressionRatio })
      }
    })
  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}

