import { NextResponse } from 'next/server'
import { verifyToken, getAuthAndModels } from '@/lib/auth'
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

        // Get authenticated user and tenant-specific models
        const auth = await getAuthAndModels(request, ['User']);
        if (!auth.success) {
            return NextResponse.json({ message: auth.message }, { status: 401 });
        }
        const { models } = auth;
        const { User } = models;

        const { fcmToken, deviceInfo } = await request.json();

        if (!fcmToken) {
            return NextResponse.json(
                { success: false, message: 'FCM token is required' },
                { status: 400 }
            );
        }

        // Find user
        const userRecord = await User.findById(decoded.userId);
        if (!userRecord) {
            return NextResponse.json(
                { success: false, message: 'User not found' },
                { status: 404 }
            );
        }

        // Determine platform from deviceInfo
        const platform = deviceInfo?.platform || deviceInfo?.device || 'android'
        const device = platform === 'web' ? 'web' : platform === 'ios' ? 'ios' : 'android'

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

        console.log(`✅ FCM token registered for user ${userRecord.email} (platform: ${platform})`);

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
        const token = request.headers.get('authorization')?.split(' ')[1];
        if (!token) {
            return NextResponse.json(
                { success: false, message: 'No token provided' },
                { status: 401 }
            );
        }

        const decoded = await verifyToken(token);
        if (!decoded) {
            return NextResponse.json(
                { success: false, message: 'Invalid token' },
                { status: 401 }
            );
        }

        // Get authenticated user and tenant-specific models
        const auth = await getAuthAndModels(request, ['User']);
        if (!auth.success) {
            return NextResponse.json({ message: auth.message }, { status: 401 });
        }
        const { models } = auth;
        const { User } = models;

        const { fcmToken } = await request.json();

        if (!fcmToken) {
            return NextResponse.json(
                { success: false, message: 'FCM token is required' },
                { status: 400 }
            );
        }

        // Find user and remove token
        const userRecord = await User.findById(decoded.userId);
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
        const token = request.headers.get('authorization')?.split(' ')[1];
        if (!token) {
            return NextResponse.json(
                { success: false, message: 'No token provided' },
                { status: 401 }
            );
        }

        const decoded = await verifyToken(token);
        if (!decoded) {
            return NextResponse.json(
                { success: false, message: 'Invalid token' },
                { status: 401 }
            );
        }

        // Get authenticated user and tenant-specific models
        const auth = await getAuthAndModels(request, ['User']);
        if (!auth.success) {
            return NextResponse.json({ message: auth.message }, { status: 401 });
        }
        const { models } = auth;
        const { User } = models;

        const { preferences } = await request.json();

        if (!preferences) {
            return NextResponse.json(
                { success: false, message: 'Preferences are required' },
                { status: 400 }
            );
        }

        const userRecord = await User.findByIdAndUpdate(
            decoded.userId,
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
