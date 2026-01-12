import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { sendNotificationToDevice } from '@/lib/firebaseNotification'

/**
 * POST /api/fcm/send-test
 * Send a test push notification to the current user's devices
 * Used for debugging push notification delivery
 */
export async function POST(request) {
    try {
        // Get authenticated user
        const auth = await getAuthAndModels(request, ['User']);
        if (!auth.success) {
            return NextResponse.json({ message: auth.message }, { status: 401 });
        }
        const { user, models } = auth;
        const { User } = models;

        const userId = user._id || user.userId;
        const userRecord = await User.findById(userId);
        
        if (!userRecord) {
            return NextResponse.json(
                { success: false, message: 'User not found' },
                { status: 404 }
            );
        }

        // Get FCM tokens for this user
        const fcmTokens = userRecord.fcmTokens || [];
        
        if (fcmTokens.length === 0) {
            return NextResponse.json({
                success: false,
                message: 'No FCM tokens registered for this user',
                debug: {
                    userId: userId.toString(),
                    email: userRecord.email,
                    tokenCount: 0
                }
            });
        }

        // Log all registered tokens for debugging
        console.log(`📱 User ${userRecord.email} has ${fcmTokens.length} registered tokens:`);
        fcmTokens.forEach((t, i) => {
            console.log(`  ${i + 1}. Platform: ${t.platform}, Device: ${t.device}`);
            console.log(`     Token preview: ${t.token.substring(0, 30)}...`);
            console.log(`     Last used: ${t.lastUsed}`);
        });

        // Prepare test notification
        const notification = {
            title: '🔔 Test Push Notification',
            body: `This is a test from Talio at ${new Date().toLocaleTimeString()}`
        };

        const data = {
            type: 'test',
            url: '/debug/notifications',
            timestamp: Date.now().toString()
        };

        // Send to all registered tokens
        const results = [];
        for (const tokenInfo of fcmTokens) {
            try {
                console.log(`📤 Sending to ${tokenInfo.platform}...`);
                const result = await sendNotificationToDevice(
                    tokenInfo.token,
                    notification,
                    data
                );
                results.push({
                    platform: tokenInfo.platform,
                    device: tokenInfo.device,
                    tokenPreview: tokenInfo.token.substring(0, 20) + '...',
                    success: result.success,
                    messageId: result.messageId,
                    error: result.error
                });
                console.log(`  Result: ${result.success ? '✅ Sent' : '❌ Failed'}`);
                if (result.error) {
                    console.log(`  Error: ${result.error}`);
                }
            } catch (err) {
                results.push({
                    platform: tokenInfo.platform,
                    device: tokenInfo.device,
                    tokenPreview: tokenInfo.token.substring(0, 20) + '...',
                    success: false,
                    error: err.message
                });
                console.log(`  ❌ Exception: ${err.message}`);
            }
        }

        const successCount = results.filter(r => r.success).length;
        const failCount = results.filter(r => !r.success).length;

        return NextResponse.json({
            success: successCount > 0,
            message: `Sent to ${successCount}/${fcmTokens.length} devices`,
            debug: {
                userId: userId.toString(),
                email: userRecord.email,
                totalTokens: fcmTokens.length,
                successCount,
                failCount,
                results
            }
        });
    } catch (error) {
        console.error('Send test notification error:', error);
        return NextResponse.json(
            { success: false, message: error.message },
            { status: 500 }
        );
    }
}

/**
 * GET /api/fcm/send-test
 * Get debug info about current user's FCM tokens
 */
export async function GET(request) {
    try {
        const auth = await getAuthAndModels(request, ['User']);
        if (!auth.success) {
            return NextResponse.json({ message: auth.message }, { status: 401 });
        }
        const { user, models } = auth;
        const { User } = models;

        const userId = user._id || user.userId;
        const userRecord = await User.findById(userId);
        
        if (!userRecord) {
            return NextResponse.json(
                { success: false, message: 'User not found' },
                { status: 404 }
            );
        }

        const fcmTokens = userRecord.fcmTokens || [];

        return NextResponse.json({
            success: true,
            data: {
                userId: userId.toString(),
                email: userRecord.email,
                tokenCount: fcmTokens.length,
                tokens: fcmTokens.map(t => ({
                    platform: t.platform,
                    device: t.device,
                    tokenPreview: t.token.substring(0, 30) + '...',
                    isExpoToken: t.token.startsWith('ExponentPushToken'),
                    createdAt: t.createdAt,
                    lastUsed: t.lastUsed,
                    deviceInfo: t.deviceInfo
                }))
            }
        });
    } catch (error) {
        console.error('Get FCM tokens error:', error);
        return NextResponse.json(
            { success: false, message: error.message },
            { status: 500 }
        );
    }
}
