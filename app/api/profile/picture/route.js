import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { getProfileStore, getProfileRecords, replaceProfilePicture, invalidateProfile } from '@/lib/platform/firestoreProfile.server'
import { buildCacheKey, clearCachePattern, deleteCache } from '@/lib/cache'
import { uploadImage, deleteImage } from '@/lib/mediaStorage'
import { optimizeImage, isValidImage } from '@/lib/imageOptimization'

export const dynamic = 'force-dynamic'

// Maximum file size: 5MB
const MAX_FILE_SIZE = 5 * 1024 * 1024

/**
 * POST /api/profile/picture
 * Upload profile picture
 */
export async function POST(request) {
    try {
        // Get authenticated user and tenant-specific models
        const auth = await getAuthAndDatabase(request)
        if (!auth.success) {
            return NextResponse.json({ message: auth.message }, { status: 401 })
        }
        const { user: authUser, tenant } = auth
        const store = await getProfileStore(tenant.databaseName)

        const authUserId = authUser._id || authUser.userId
        const { user, employee } = await getProfileRecords(store, authUserId)
        if (!user) {
            return NextResponse.json({ success: false, message: 'User not found' }, { status: 404 })
        }

        const getId = (value) => {
            if (!value) return null
            if (typeof value === 'object') return value._id || value.id || null
            return value
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

        if (!employee) {
            return NextResponse.json({
                success: false,
                message: 'Employee profile not found. Please contact HR/admin to link your account before uploading a profile picture.'
            }, { status: 404 })
        }

        const employeeId = getId(employee)

        // Generate filename with employee code for easy identification
        const timestamp = Date.now()
        const employeeCode = employee?.employeeCode || 'UNKNOWN'
        const filename = `profile_${employeeCode}_${timestamp}.webp`

        let fileUrl = ''
        let fileId = null

        // Upload to private Blob storage
        try {
            console.log('[Profile Picture] Uploading to private Blob storage...')
            const mediaResult = await uploadImage(optimizedBuffer, {
                databaseName: auth.tenant.databaseName,
                category: 'profile',
                contentType: 'image/webp',
                originalName: filename,
                userId: String(authUserId),
                employeeId: String(employeeId),
            })
            fileUrl = mediaResult.url
            fileId = String(mediaResult._id)
            console.log(`[Profile Picture] ✅ Uploaded to private Blob storage: ${fileUrl}`)
        } catch (mediaError) {
            console.error('[Profile Picture] ❌ private Blob storage upload failed:', mediaError.message)
        }

        if (!fileUrl) {
            return NextResponse.json({ success: false, message: 'Image storage is unavailable. Please retry.' }, { status: 503 })
        }

        let previousFileIds
        try {
            previousFileIds = await replaceProfilePicture(store, authUserId, employeeId, { url: fileUrl, _id: fileId })
        } catch (error) {
            await deleteImage(fileId, { databaseName: tenant.databaseName }).catch(() => {})
            throw error
        }

        const todayKey = new Date().toISOString().slice(0, 10)
        const profileCacheKey = buildCacheKey({
            tenantId: tenant?.databaseName,
            role: authUser.role,
            userId: authUserId,
            namespace: 'profile'
        })
        const employeeDashboardCacheKey = buildCacheKey({
            tenantId: tenant?.databaseName,
            role: authUser.role,
            userId: authUserId,
            namespace: 'dashboard:employee-stats',
            params: { date: todayKey }
        })
        await Promise.all([
            deleteCache(profileCacheKey),
            deleteCache(employeeDashboardCacheKey),
            clearCachePattern(`tenant:${tenant?.databaseName || 'unknown'}:role:${authUser.role || 'any'}:user:${authUserId}:dashboard:unified:*`),
        ]).catch((err) => {
            console.log('[Profile Picture] Cache invalidation failed:', err.message)
        })

        await Promise.all(previousFileIds.filter(id => id !== fileId).map(id => deleteImage(id, { databaseName: tenant.databaseName }).catch(() => {})))

        return NextResponse.json({
            success: true,
            message: 'Profile picture uploaded successfully',
            data: {
                url: fileUrl,
                fileId: fileId,
                storage: 'vercel-blob',
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
        const auth = await getAuthAndDatabase(request)
        if (!auth.success) {
            return NextResponse.json({ message: auth.message }, { status: 401 })
        }
        const { user: authUser, tenant } = auth
        const store = await getProfileStore(tenant.databaseName)
        const userId = authUser._id || authUser.userId
        const { user, employee } = await getProfileRecords(store, userId)
        if (!user) {
            return NextResponse.json({ success: false, message: 'User not found' }, { status: 404 })
        }

        const profilePicture = employee?.profilePicture

        if (!profilePicture) {
            return NextResponse.json({
                success: false,
                message: 'No profile picture to delete'
            }, { status: 400 })
        }

        const previousFileIds = await replaceProfilePicture(store, userId, employee._id, null)
        await invalidateProfile(tenant.databaseName, userId)
        await Promise.all(previousFileIds.map(id => deleteImage(id, { databaseName: tenant.databaseName }).catch(() => {})))

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
