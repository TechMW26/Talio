/**
 * Web Push Notification Service
 * Handles sending push notifications to web browsers using the Web Push API
 * Integrated with Firebase Cloud Messaging for unified notification delivery
 */

import webpush from 'web-push';
import PushSubscription from '@/models/PushSubscription';
import User from '@/models/User';

// Initialize VAPID keys
let vapidKeysConfigured = false;

function initializeVapidKeys() {
    if (vapidKeysConfigured) return true;

    const publicKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT || `mailto:${process.env.EMAIL_FROM_EMAIL || 'noreply@talio.in'}`;

    if (!publicKey) {
        console.warn('[WebPush] ⚠️ VAPID public key not configured - web push disabled');
        return false;
    }

    // For web push, we need both public and private VAPID keys
    // If only Firebase VAPID (public key) is available, web push won't work
    // but FCM will still handle web notifications via Firebase's servers
    if (!privateKey) {
        console.warn('[WebPush] ⚠️ VAPID private key not configured - using FCM fallback');
        return false;
    }

    try {
        webpush.setVapidDetails(subject, publicKey, privateKey);
        vapidKeysConfigured = true;
        console.log('[WebPush] ✅ VAPID keys configured');
        return true;
    } catch (error) {
        console.error('[WebPush] ❌ Failed to configure VAPID keys:', error);
        return false;
    }
}

/**
 * Send web push notification to a single subscription
 * @param {Object} subscription - Push subscription object with endpoint and keys
 * @param {Object} payload - Notification payload
 * @returns {Promise<Object>} Result
 */
export async function sendWebPushToSubscription(subscription, payload) {
    if (!initializeVapidKeys()) {
        return { success: false, error: 'VAPID keys not configured' };
    }

    try {
        const pushPayload = JSON.stringify({
            notification: {
                title: payload.title || 'Talio HRMS',
                body: payload.body || payload.message || '',
                icon: payload.icon || '/icons/icon-192x192.png',
                badge: '/icons/icon-72x72.png',
                image: payload.image || null
            },
            data: {
                url: payload.url || '/dashboard',
                type: payload.type || 'notification',
                notificationId: payload.notificationId || null,
                timestamp: Date.now(),
                ...payload.data
            }
        });

        const result = await webpush.sendNotification(
            {
                endpoint: subscription.endpoint,
                keys: subscription.keys
            },
            pushPayload,
            {
                TTL: payload.ttl || 86400, // 24 hours default
                urgency: payload.urgency || 'normal' // 'very-low', 'low', 'normal', 'high'
            }
        );

        console.log('[WebPush] ✅ Notification sent:', result.statusCode);
        return { success: true, statusCode: result.statusCode };
    } catch (error) {
        console.error('[WebPush] ❌ Send error:', error.message);

        // Handle expired/invalid subscriptions
        if (error.statusCode === 404 || error.statusCode === 410) {
            return { success: false, error: 'subscription_expired', shouldRemove: true };
        }

        return { success: false, error: error.message };
    }
}

/**
 * Send web push notification to a user (all their web subscriptions)
 * @param {string} userId - User ID
 * @param {Object} payload - Notification payload
 * @returns {Promise<Object>} Result with success/failure counts
 */
export async function sendWebPushToUser(userId, payload) {
    try {
        // Get all web push subscriptions for this user
        const subscriptions = await PushSubscription.find({ user: userId });

        if (!subscriptions || subscriptions.length === 0) {
            console.log(`[WebPush] No web subscriptions for user ${userId}`);
            return { success: false, error: 'No web subscriptions', successCount: 0, failureCount: 0 };
        }

        const results = await Promise.allSettled(
            subscriptions.map(sub => sendWebPushToSubscription(sub, payload))
        );

        let successCount = 0;
        let failureCount = 0;
        const expiredSubscriptions = [];

        results.forEach((result, index) => {
            if (result.status === 'fulfilled' && result.value.success) {
                successCount++;
                // Update lastUsed timestamp
                subscriptions[index].lastUsed = new Date();
                subscriptions[index].save().catch(() => { });
            } else {
                failureCount++;
                // Check if subscription should be removed
                if (result.value?.shouldRemove) {
                    expiredSubscriptions.push(subscriptions[index]._id);
                }
            }
        });

        // Remove expired subscriptions
        if (expiredSubscriptions.length > 0) {
            await PushSubscription.deleteMany({ _id: { $in: expiredSubscriptions } });
            console.log(`[WebPush] Removed ${expiredSubscriptions.length} expired subscriptions`);
        }

        return {
            success: successCount > 0,
            successCount,
            failureCount,
            totalSubscriptions: subscriptions.length
        };
    } catch (error) {
        console.error('[WebPush] Error sending to user:', error);
        return { success: false, error: error.message, successCount: 0, failureCount: 1 };
    }
}

/**
 * Send web push notification to multiple users
 * @param {string[]} userIds - Array of user IDs
 * @param {Object} payload - Notification payload
 * @returns {Promise<Object>} Result with success/failure counts
 */
export async function sendWebPushToUsers(userIds, payload) {
    try {
        const results = await Promise.allSettled(
            userIds.map(userId => sendWebPushToUser(userId, payload))
        );

        let totalSuccess = 0;
        let totalFailure = 0;

        results.forEach(result => {
            if (result.status === 'fulfilled') {
                totalSuccess += result.value.successCount || 0;
                totalFailure += result.value.failureCount || 0;
            } else {
                totalFailure++;
            }
        });

        return {
            success: totalSuccess > 0,
            successCount: totalSuccess,
            failureCount: totalFailure,
            totalUsers: userIds.length
        };
    } catch (error) {
        console.error('[WebPush] Error sending to multiple users:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Check if web push is available for a user
 * @param {string} userId - User ID
 * @returns {Promise<boolean>}
 */
export async function hasWebPushSubscription(userId) {
    const count = await PushSubscription.countDocuments({ user: userId });
    return count > 0;
}

/**
 * Get web push status/configuration
 * @returns {Object} Status object
 */
export function getWebPushStatus() {
    return {
        enabled: vapidKeysConfigured || !!process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY,
        vapidConfigured: vapidKeysConfigured,
        publicKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY || null
    };
}

export default {
    sendWebPushToSubscription,
    sendWebPushToUser,
    sendWebPushToUsers,
    hasWebPushSubscription,
    getWebPushStatus
};
