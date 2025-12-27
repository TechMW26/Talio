import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import fs from 'fs/promises'
import path from 'path'

export const dynamic = 'force-dynamic'

/**
 * GET /api/uploads/aadhaar/[...path]
 * Securely serve Aadhaar document images
 * Only allows users to access their own documents or admin/HR to access any
 */
export async function GET(request, context) {
  try {
    // In Next.js 15, params is a Promise and needs to be awaited
    const { path: pathSegments } = await context.params
    
    // Get authenticated user and tenant-specific models
    const auth = await getAuthAndModels(request, ['User'])
    if (!auth.success) {
      return NextResponse.json({ message: auth.message }, { status: 401 })
    }
    const { user, models } = auth
    const { User } = models

    // Get the file path from params
    if (!pathSegments || pathSegments.length < 2) {
      return NextResponse.json({ success: false, message: 'Invalid path' }, { status: 400 })
    }

    // Expected format: [userId, filename]
    const [requestedUserId, filename] = pathSegments

    // Get the user ID from auth
    const userId = (user._id || user.userId)?.toString()

    // Verify access permissions
    const requestingUser = await User.findById(userId).select('role')
    if (!requestingUser) {
      return NextResponse.json({ success: false, message: 'User not found' }, { status: 404 })
    }

    // Allow access only if:
    // 1. User is requesting their own documents
    // 2. User is admin/HR
    const isOwnDocument = userId === requestedUserId
    const isAuthorized = ['admin', 'hr'].includes(requestingUser.role)

    if (!isOwnDocument && !isAuthorized) {
      return NextResponse.json({
        success: false,
        message: 'Not authorized to access this document'
      }, { status: 403 })
    }

    // Construct the file path
    const filePath = path.join(process.cwd(), 'uploads', 'aadhaar', requestedUserId, filename)

    // Security check: ensure path doesn't escape the uploads directory
    const normalizedPath = path.normalize(filePath)
    const uploadsDir = path.join(process.cwd(), 'uploads', 'aadhaar')
    
    if (!normalizedPath.startsWith(uploadsDir)) {
      return NextResponse.json({
        success: false,
        message: 'Invalid file path'
      }, { status: 400 })
    }

    // Check if file exists
    try {
      await fs.access(filePath)
    } catch {
      return NextResponse.json({
        success: false,
        message: 'File not found'
      }, { status: 404 })
    }

    // Read the file
    const fileBuffer = await fs.readFile(filePath)

    // Determine content type
    const extension = path.extname(filename).toLowerCase()
    const contentTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp'
    }
    const contentType = contentTypes[extension] || 'application/octet-stream'

    // Return the file with appropriate headers
    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': fileBuffer.length.toString(),
        'Cache-Control': 'private, max-age=3600', // Cache for 1 hour, but private
        'X-Content-Type-Options': 'nosniff',
      },
    })

  } catch (error) {
    console.error('[Aadhaar File Serve] Error:', error)
    return NextResponse.json({
      success: false,
      message: 'Failed to serve file'
    }, { status: 500 })
  }
}
