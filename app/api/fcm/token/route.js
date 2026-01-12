import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
// POST - Register/Update FCM Token
export async function POST(request) {
    try {
        // Get authenticated user and tenant-specific models
        const auth = await getAuthAndModels(request, ['User']);
        if (!auth.success) {
            return NextResponse.json({ message: auth.message }, { status: 401 });
        }
        const { user, models } = auth;
        const { User } = models;

        const { fcmToken, deviceInfo } = await request.json();

        if (!fcmToken) {
            return NextResponse.json(
                { success: false, message: 'FCM token is required' },
                { status: 400 }
            );
        }

        // Find user
        const userId = user._id || user.userId;
        const userRecord = await User.findById(userId);
        if (!userRecord) {
            return NextResponse.json(
                { success: false, message: 'User not found' },
                { status: 404 }
            );
        }

        // Determine platform from deviceInfo
        // Supports: 'web', 'android', 'ios', 'android_expo', 'ios_expo', 'android_webview'
        const rawPlatform = deviceInfo?.platform || deviceInfo?.device || 'android'
        
        // Map platform to device type for FCM routing
        // All Android variants (expo, webview, native) use FCM
        // All iOS variants use APNs via FCM
        let device = 'android'
        if (rawPlatform === 'web') {
            device = 'web'
        } else if (rawPlatform === 'ios' || rawPlatform === 'ios_expo') {
            device = 'ios'
        } else if (rawPlatform.includes('android') || rawPlatform === 'android_expo' || rawPlatform === 'android_webview') {
            device = 'android'
        }
        
        // Store the detailed platform for debugging
        const platform = rawPlatform

        // Validate FCM token format (should not be Expo Push Token)
        if (fcmToken.startsWith('ExponentPushToken')) {
            console.warn(`⚠️ Received Expo Push Token instead of FCM token for user ${userRecord.email}`);
            return NextResponse.json(
                { 
                    success: false, 
                    message: 'Invalid token format. Expected native FCM/APNs token, received Expo Push Token. Please update your app to use native push tokens.' 
                },
                { status: 400 }
            );
        }

        // Check if token already exists
        const existingTokenIndex = userRecord.fcmTokens?.findIndex(t => t.token === fcmToken) ?? -1;

        if (existingTokenIndex !== -1) {
            // Update existing token
            userRecord.fcmTokens[existingTokenIndex].lastUsed = new Date();
            userRecord.fcmTokens[existingTokenIndex].device = device;
            userRecord.fcmTokens[existingTokenIndex].platform = platform;
            if (deviceInfo) {
                userRecord.fcmTokens[existingTokenIndex].deviceInfo = {
                    ...userRecord.fcmTokens[existingTokenIndex].deviceInfo,
                    ...deviceInfo
                };
            }
        } else {
            // Add new token
            if (!userRecord.fcmTokens) {
                userRecord.fcmTokens = [];
            }
            userRecord.fcmTokens.push({
                token: fcmToken,
                device: device,
                platform: platform,
                deviceInfo: deviceInfo || {},
                createdAt: new Date(),
                lastUsed: new Date()
            });
        }

        await userRecord.save();

        console.log(`✅ FCM token registered for user ${userRecord.email} (platform: ${platform}, device: ${device})`);

        return NextResponse.json({
            success: true,
            message: 'FCM token registered successfully',
            tokenCount: userRecord.fcmTokens?.length || 0,
            platform: platform
        });
    } catch (error) {
        console.error('Register FCM token error:', error);
        return NextResponse.json(
            { success: false, message: 'Failed to register FCM token', error: error.message },
            { status: 500 }
        );
    }
}

// DELETE - Remove FCM Token
export async function DELETE(request) {
    try {
        // Get authenticated user and tenant-specific models
        const auth = await getAuthAndModels(request, ['User']);
        if (!auth.success) {
            return NextResponse.json({ message: auth.message }, { status: 401 });
        }
        const { user, models } = auth;
        const { User } = models;

        const { fcmToken } = await request.json();

        if (!fcmToken) {
            return NextResponse.json(
                { success: false, message: 'FCM token is required' },
                { status: 400 }
            );
        }

        // Find user and remove token
        const userId = user._id || user.userId;
        const userRecord = await User.findById(userId);
        if (!userRecord) {
            return NextResponse.json(
                { success: false, message: 'User not found' },
                { status: 404 }
            );
        }

        userRecord.fcmTokens = (userRecord.fcmTokens || []).filter(t => t.token !== fcmToken);
        await userRecord.save();

        console.log(`✅ FCM token removed for user ${userRecord.email}`);

        return NextResponse.json({
            success: true,
            message: 'FCM token removed successfully'
        });
    } catch (error) {
        console.error('Remove FCM token error:', error);
        return NextResponse.json(
            { success: false, message: 'Failed to remove FCM token', error: error.message },
            { status: 500 }
        );
    }
}

// PUT - Update notification preferences
export async function PUT(request) {
    try {
        // Get authenticated user and tenant-specific models
        const auth = await getAuthAndModels(request, ['User']);
        if (!auth.success) {
            return NextResponse.json({ message: auth.message }, { status: 401 });
        }
        const { user, models } = auth;
        const { User } = models;

        const { preferences } = await request.json();

        if (!preferences) {
            return NextResponse.json(
                { success: false, message: 'Preferences are required' },
                { status: 400 }
            );
        }

        const userId = user._id || user.userId;
        const userRecord = await User.findByIdAndUpdate(
            userId,
            { notificationPreferences: preferences },
            { new: true }
        );

        if (!userRecord) {
            return NextResponse.json(
                { success: false, message: 'User not found' },
                { status: 404 }
            );
        }

        console.log(`✅ Notification preferences updated for user ${userRecord.email}`);

        return NextResponse.json({
            success: true,
            message: 'Notification preferences updated',
            preferences: userRecord.notificationPreferences
        });
    } catch (error) {
        console.error('Update notification preferences error:', error);
        return NextResponse.json(
            { success: false, message: 'Failed to update preferences', error: error.message },
            { status: 500 }
        );
    }
}
