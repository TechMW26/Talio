import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { uploadImageToImageKit, deleteFromImageKit, getProfilePictureUrl, getImageKitFolder, generateEmployeeFolderName } from '@/lib/imagekit'
import { optimizeImage, isValidImage } from '@/lib/imageOptimization'
import path from 'path'
import fs from 'fs/promises'
import { existsSync } from 'fs'

export const dynamic = 'force-dynamic'

// Maximum file size: 5MB
const MAX_FILE_SIZE = 5 * 1024 * 1024

// Check if ImageKit is configured
const isImageKitConfigured = () => {
    const configured = !!(
        process.env.IMAGEKIT_PUBLIC_KEY &&
        process.env.IMAGEKIT_PRIVATE_KEY &&
        process.env.IMAGEKIT_URL_ENDPOINT
    )
    console.log('[Profile Picture] ImageKit configured:', configured)
    return configured
}

/**
 * POST /api/profile/picture
 * Upload profile picture
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

        const user = await User.findById(authUser._id || authUser.userId).populate('employeeId')
        if (!user) {
            return NextResponse.json({ success: false, message: 'User not found' }, { status: 404 })
        }

        // Parse the request - handle both FormData and JSON
        let imageBuffer
        let originalFilename = 'profile.jpg'
        const contentType = request.headers.get('content-type') || ''

        if (contentType.includes('multipart/form-data')) {
            // Handle FormData upload
            const formData = await request.formData()
            const file = formData.get('file') || formData.get('image')

            if (!file) {
                return NextResponse.json({
                    success: false,
                    message: 'No image file provided'
                }, { status: 400 })
            }

            originalFilename = file.name
            const bytes = await file.arrayBuffer()
            imageBuffer = Buffer.from(bytes)
        } else {
            // Handle JSON with base64 image
            const body = await request.json()
            const { imageData } = body

            if (!imageData) {
                return NextResponse.json({
                    success: false,
                    message: 'No image data provided'
                }, { status: 400 })
            }

            // Validate base64 image
            const base64Regex = /^data:image\/(jpeg|jpg|png|webp|gif);base64,/
            if (!base64Regex.test(imageData)) {
                return NextResponse.json({
                    success: false,
                    message: 'Invalid image format. Please upload a JPEG, PNG, WebP, or GIF image.'
                }, { status: 400 })
            }

            const base64Data = imageData.replace(base64Regex, '')
            imageBuffer = Buffer.from(base64Data, 'base64')

            // Extract extension from mime type
            const mimeMatch = imageData.match(/data:image\/(\w+);/)
            if (mimeMatch) {
                originalFilename = `profile.${mimeMatch[1]}`
            }
        }

        // Check file size
        if (imageBuffer.length > MAX_FILE_SIZE) {
            return NextResponse.json({
                success: false,
                message: 'Image too large. Maximum size is 5MB.'
            }, { status: 400 })
        }

        // Validate image
        if (!await isValidImage(imageBuffer)) {
            return NextResponse.json({
                success: false,
                message: 'Invalid image file'
            }, { status: 400 })
        }

        // Optimize image for profile picture
        const { buffer: optimizedBuffer } = await optimizeImage(imageBuffer, {
            type: 'avatar',
            format: 'webp',
            quality: 85
        })

        // Get employee info for folder structure
        let employee = user.employeeId
        if (!employee) {
            employee = await Employee.findOne({ userId: authUser._id || authUser.userId }).select('firstName lastName employeeCode')
        }

        // Generate filename with employee code for easy identification
        const timestamp = Date.now()
        const employeeCode = employee?.employeeCode || 'UNKNOWN'
        const filename = `profile_${employeeCode}_${timestamp}.webp`

        // Get the appropriate ImageKit folder
        const imagekitFolder = getImageKitFolder('profile', { employee })
        const employeeFolderName = generateEmployeeFolderName(employee)

        let fileUrl = ''
        let fileId = null
        let thumbnailUrl = null

        // Try ImageKit upload if configured
        if (isImageKitConfigured()) {
            try {
                console.log('[Profile Picture] Attempting ImageKit upload...')
                console.log('[Profile Picture] Folder:', imagekitFolder)
                console.log('[Profile Picture] Buffer size:', optimizedBuffer.length, 'bytes')

                // Build safe tags (no undefined values)
                const safeTags = ['profile', 'avatar', employeeCode].filter(Boolean)

                // Use uploadImageToImageKit directly (no temp file) - works better in serverless/Docker
                const imagekitResult = await uploadImageToImageKit(optimizedBuffer, {
                    fileName: filename,
                    folder: imagekitFolder,
                    tags: safeTags,
                    useUniqueFileName: true,
                })

                fileUrl = imagekitResult.url
                fileId = imagekitResult.fileId
                thumbnailUrl = imagekitResult.thumbnailUrl
                console.log(`[Profile Picture] ✅ Uploaded to ImageKit: ${fileUrl}`)
            } catch (imagekitError) {
                console.error('[Profile Picture] ❌ ImageKit upload failed:')
                console.error('[Profile Picture] Error name:', imagekitError.name)
                console.error('[Profile Picture] Error message:', imagekitError.message)
                // Fall through to local storage
            }
        } else {
            console.log('[Profile Picture] ImageKit not configured, using local storage')
        }

        // Fallback: Local file storage with employee folder structure
        if (!fileUrl) {
            const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'profiles', employeeFolderName)
            if (!existsSync(uploadDir)) {
                await fs.mkdir(uploadDir, { recursive: true })
            }

            const filePath = path.join(uploadDir, filename)
            await fs.writeFile(filePath, optimizedBuffer)
            fileUrl = `/uploads/profiles/${employeeFolderName}/${filename}`
        }

        // Get old profile picture info for cleanup
        const oldProfilePicture = user.employeeId?.profilePicture
        const oldProfilePictureFileId = user.employeeId?.profilePictureFileId

        // Update Employee model with new profile picture
        if (user.employeeId) {
            await Employee.findByIdAndUpdate(user.employeeId._id, {
                $set: {
                    profilePicture: fileUrl,
                    ...(fileId && { profilePictureFileId: fileId }),
                }
            })
        }

        // Also update User model if it has avatar field
        await User.findByIdAndUpdate(authUser._id || authUser.userId, {
            $set: {
                avatar: fileUrl,
                ...(fileId && { avatarFileId: fileId }),
            }
        })

        // Delete old profile picture
        if (oldProfilePicture) {
            if (oldProfilePictureFileId) {
                // Delete from ImageKit
                try {
                    await deleteFromImageKit(oldProfilePictureFileId)
                    console.log(`[Profile Picture] Deleted old ImageKit file: ${oldProfilePictureFileId}`)
                } catch (err) {
                    console.log('Old ImageKit file cleanup:', err.message)
                }
            } else if (oldProfilePicture.startsWith('/uploads/')) {
                // Delete from local filesystem
                const oldPath = path.join(process.cwd(), 'public', oldProfilePicture)
                try {
                    await fs.unlink(oldPath)
                } catch (err) {
                    console.log('Old local file cleanup:', err.message)
                }
            }
        }

        return NextResponse.json({
            success: true,
            message: 'Profile picture uploaded successfully',
            data: {
                url: fileUrl,
                fileId: fileId,
                thumbnailUrl: thumbnailUrl,
                storage: fileId ? 'imagekit' : 'local',
            }
        })

    } catch (error) {
        console.error('[Profile Picture Upload] Error:', error)
        return NextResponse.json({
            success: false,
            message: 'Failed to upload profile picture'
        }, { status: 500 })
    }
}

/**
 * DELETE /api/profile/picture
 * Remove profile picture
 */
export async function DELETE(request) {
    try {
        // Get authenticated user and tenant-specific models
        const auth = await getAuthAndModels(request, ['User', 'Employee'])
        if (!auth.success) {
            return NextResponse.json({ message: auth.message }, { status: 401 })
        }
        const { user: authUser, models } = auth
        const { User, Employee } = models

        const user = await User.findById(authUser._id || authUser.userId).populate('employeeId')
        if (!user) {
            return NextResponse.json({ success: false, message: 'User not found' }, { status: 404 })
        }

        const profilePicture = user.employeeId?.profilePicture
        const profilePictureFileId = user.employeeId?.profilePictureFileId

        if (!profilePicture) {
            return NextResponse.json({
                success: false,
                message: 'No profile picture to delete'
            }, { status: 400 })
        }

        // Delete from storage
        if (profilePictureFileId) {
            try {
                await deleteFromImageKit(profilePictureFileId)
                console.log(`[Profile Picture] Deleted from ImageKit: ${profilePictureFileId}`)
            } catch (err) {
                console.log('ImageKit delete error:', err.message)
            }
        } else if (profilePicture.startsWith('/uploads/')) {
            const filePath = path.join(process.cwd(), 'public', profilePicture)
            try {
                await fs.unlink(filePath)
            } catch (err) {
                console.log('Local file delete error:', err.message)
            }
        }

        // Clear profile picture from database
        if (user.employeeId) {
            await Employee.findByIdAndUpdate(user.employeeId._id, {
                $unset: {
                    profilePicture: 1,
                    profilePictureFileId: 1,
                }
            })
        }

        await User.findByIdAndUpdate(authUser._id || authUser.userId, {
            $unset: {
                avatar: 1,
                avatarFileId: 1,
            }
        })

        return NextResponse.json({
            success: true,
            message: 'Profile picture deleted successfully'
        })

    } catch (error) {
        console.error('[Profile Picture Delete] Error:', error)
        return NextResponse.json({
            success: false,
            message: 'Failed to delete profile picture'
        }, { status: 500 })
    }
}
