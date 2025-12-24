import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import User from '@/models/User'

// POST - Register/Update FCM Token
export async function POST(request) {
    try {
        const token = request.headers.get('authorization')?.split(' ')[1]
        if (!token) {
            return NextResponse.json(
                { success: false, message: 'No token provided' },
                { status: 401 }
            )
        }

        const decoded = await verifyToken(token)
        if (!decoded) {
            return NextResponse.json(
                { success: false, message: 'Invalid token' },
                { status: 401 }
            )
        }

        await connectDB()

        const { fcmToken, deviceInfo } = await request.json()

        if (!fcmToken) {
            return NextResponse.json(
                { success: false, message: 'FCM token is required' },
                { status: 400 }
            )
        }

        // Find user
        const user = await User.findById(decoded.userId)
        if (!user) {
            return NextResponse.json(
                { success: false, message: 'User not found' },
                { status: 404 }
            )
        }

        // Determine platform from deviceInfo
        const platform = deviceInfo?.platform || deviceInfo?.device || 'android'
        const device = platform === 'web' ? 'web' : platform === 'ios' ? 'ios' : 'android'

        // Check if token already exists
        const existingTokenIndex = user.fcmTokens.findIndex(t => t.token === fcmToken)

        if (existingTokenIndex !== -1) {
            // Update existing token
            user.fcmTokens[existingTokenIndex].lastUsed = new Date()
            user.fcmTokens[existingTokenIndex].device = device
            user.fcmTokens[existingTokenIndex].platform = platform
            if (deviceInfo) {
                user.fcmTokens[existingTokenIndex].deviceInfo = {
                    ...user.fcmTokens[existingTokenIndex].deviceInfo,
                    ...deviceInfo
                }
            }
        } else {
            // Add new token
            user.fcmTokens.push({
                token: fcmToken,
                device: device,
                platform: platform,
                deviceInfo: deviceInfo || {},
                createdAt: new Date(),
                lastUsed: new Date()
            })
        }

        await user.save()

        console.log(`✅ FCM token registered for user ${user.email} (platform: ${platform})`)

        return NextResponse.json({
            success: true,
            message: 'FCM token registered successfully',
            tokenCount: user.fcmTokens.length,
            platform: platform
        })
    } catch (error) {
        console.error('Register FCM token error:', error)
        return NextResponse.json(
            { success: false, message: 'Failed to register FCM token', error: error.message },
            { status: 500 }
        )
    }
}

// DELETE - Remove FCM Token
export async function DELETE(request) {
    try {
        const token = request.headers.get('authorization')?.split(' ')[1]
        if (!token) {
            return NextResponse.json(
                { success: false, message: 'No token provided' },
                { status: 401 }
            )
        }

        const decoded = await verifyToken(token)
        if (!decoded) {
            return NextResponse.json(
                { success: false, message: 'Invalid token' },
                { status: 401 }
            )
        }

        await connectDB()

        const { fcmToken } = await request.json()

        if (!fcmToken) {
            return NextResponse.json(
                { success: false, message: 'FCM token is required' },
                { status: 400 }
            )
        }

        // Find user and remove token
        const user = await User.findById(decoded.userId)
        if (!user) {
            return NextResponse.json(
                { success: false, message: 'User not found' },
                { status: 404 }
            )
        }

        user.fcmTokens = user.fcmTokens.filter(t => t.token !== fcmToken)
        await user.save()

        console.log(`✅ FCM token removed for user ${user.email}`)

        return NextResponse.json({
            success: true,
            message: 'FCM token removed successfully'
        })
    } catch (error) {
        console.error('Remove FCM token error:', error)
        return NextResponse.json(
            { success: false, message: 'Failed to remove FCM token', error: error.message },
            { status: 500 }
        )
    }
}

// PUT - Update notification preferences
export async function PUT(request) {
    try {
        const token = request.headers.get('authorization')?.split(' ')[1]
        if (!token) {
            return NextResponse.json(
                { success: false, message: 'No token provided' },
                { status: 401 }
            )
        }

        const decoded = await verifyToken(token)
        if (!decoded) {
            return NextResponse.json(
                { success: false, message: 'Invalid token' },
                { status: 401 }
            )
        }

        await connectDB()

        const { preferences } = await request.json()

        if (!preferences) {
            return NextResponse.json(
                { success: false, message: 'Preferences are required' },
                { status: 400 }
            )
        }

        const user = await User.findByIdAndUpdate(
            decoded.userId,
            { notificationPreferences: preferences },
            { new: true }
        )

        if (!user) {
            return NextResponse.json(
                { success: false, message: 'User not found' },
                { status: 404 }
            )
        }

        console.log(`✅ Notification preferences updated for user ${user.email}`)

        return NextResponse.json({
            success: true,
            message: 'Notification preferences updated',
            preferences: user.notificationPreferences
        })
    } catch (error) {
        console.error('Update notification preferences error:', error)
        return NextResponse.json(
            { success: false, message: 'Failed to update preferences', error: error.message },
            { status: 500 }
        )
    }
}
