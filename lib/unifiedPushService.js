/**
 * Unified Push Notification Service
 * Sends notifications to both Android (FCM) and Web (Web Push) platforms
 * Single entry point for all push notifications in the application
 */

import { sendNotificationToUser, sendNotificationToUsers, sendNotificationToDevice } from './firebaseNotification';
import { sendWebPushToUser, sendWebPushToUsers } from './webPushNotification';
import { randomBytes } from 'node:crypto';
import { collectFirestorePages } from './platform/firestoreQueries.server';
import { WEB_PUSH_STORE_OPTIONS } from './webPushNotification';
export const UNIFIED_PUSH_STORE_OPTIONS = WEB_PUSH_STORE_OPTIONS;
const requireDatabase = options => { if (!options?.database?.databaseName) throw new Error('Native tenant database is required for push delivery'); return options.database; };

/**
 * Platform types for targeted notifications
 */
export const PLATFORM = {
    ANDROID: 'android',
    WEB: 'web',
    IOS: 'ios',
    ALL: 'all'
};

/**
 * Send push notification to a user across all their devices
 * Automatically sends to both Android and Web platforms
 * 
 * @param {string} userId - User ID to send notification to
 * @param {Object} options - Notification options
 * @param {string} options.title - Notification title
 * @param {string} options.body - Notification body/message
 * @param {string} [options.url] - URL to navigate on click
 * @param {string} [options.icon] - Notification icon
 * @param {string} [options.image] - Notification image
 * @param {string} [options.type] - Notification type (leave, attendance, task, etc.)
 * @param {Object} [options.data] - Additional data payload
 * @param {string|string[]} [options.platform] - Target platform(s): 'all', 'android', 'web', or array
 * @param {boolean} [options.saveToDb] - Whether to save notification to database (default: true)
 * @returns {Promise<Object>} Result with success status and counts
 */
export async function sendUnifiedPush(userId, options) {
    try {
        const {
            title,
            body,
            url = '/dashboard',
            icon = '/icons/icon-192x192.png',
            image = null,
            type = 'system',
            data = {},
            platform = PLATFORM.ALL,
            saveToDb = true
        } = options;

        if (!title || !body) {
            return { success: false, error: 'Title and body are required' };
        }

        // Get user with FCM tokens
        const database = requireDatabase(options);
        const user = await database.get('users', String(userId));
        if (!user || user.isActive === false) {
            console.warn(`[UnifiedPush] User not found: ${userId}`);
            return { success: false, error: 'User not found' };
        }

        // Check notification preferences
        if (user.notificationPreferences && type !== 'system') {
            const prefKey = type === 'chat' ? 'chat' :
                type === 'task' ? 'projects' :
                    type === 'leave' ? 'leave' :
                        type === 'attendance' ? 'attendance' :
                            type === 'announcement' ? 'announcements' : null;

            if (prefKey && user.notificationPreferences[prefKey] === false) {
                console.log(`[UnifiedPush] User ${userId} has disabled ${type} notifications`);
                return { success: false, error: 'Notifications disabled by user' };
            }
        }

        const results = {
            android: { success: false, count: 0 },
            web: { success: false, count: 0 }
        };

        const targetPlatforms = Array.isArray(platform) ? platform :
            platform === PLATFORM.ALL ? [PLATFORM.ANDROID, PLATFORM.WEB] : [platform];

        // Prepare notification payload
        const notification = { title, body, image };
        const notificationData = {
            ...data,
            url,
            type,
            icon,
            timestamp: Date.now().toString()
        };

        // Send to Android (FCM)
        if (targetPlatforms.includes(PLATFORM.ANDROID)) {
            try {
                // Filter Android FCM tokens
                const androidTokens = user.fcmTokens?.filter(t =>
                    t.device === 'android' || t.platform === 'android'
                ) || [];

                if (androidTokens.length > 0) {
                    const fcmResult = await sendNotificationToUser(
                        { ...user, fcmTokens: androidTokens },
                        notification,
                        notificationData
                    );
                    results.android = {
                        success: fcmResult?.success || fcmResult?.successCount > 0,
                        count: fcmResult?.successCount || (fcmResult?.success ? 1 : 0)
                    };
                }
            } catch (error) {
                console.error('[UnifiedPush] Android FCM error:', error.message);
            }
        }

        // Send to Web (FCM for web + Web Push API)
        if (targetPlatforms.includes(PLATFORM.WEB)) {
            try {
                // Try FCM for web tokens first
                const webFcmTokens = user.fcmTokens?.filter(t =>
                    t.device === 'web' || t.platform === 'web'
                ) || [];

                if (webFcmTokens.length > 0) {
                    const webFcmResult = await sendNotificationToUser(
                        { ...user, fcmTokens: webFcmTokens },
                        notification,
                        notificationData
                    );
                    results.web.count += webFcmResult?.successCount || (webFcmResult?.success ? 1 : 0);
                    results.web.success = results.web.success || webFcmResult?.success;
                }

                // Also send via Web Push API for broader browser support
                const webPushResult = await sendWebPushToUser(userId, {
                    title,
                    body,
                    url,
                    icon,
                    image,
                    type,
                    data: notificationData, database
                });

                if (webPushResult?.success) {
                    results.web.count += webPushResult.successCount || 0;
                    results.web.success = true;
                }
            } catch (error) {
                console.error('[UnifiedPush] Web push error:', error.message);
            }
        }

        // Save notification to database
        if (saveToDb) {
            try {
                await database.create('notifications', {
                    _id: randomBytes(12).toString('hex'), createdAt: new Date(), updatedAt: new Date(),
                    user: userId,
                    title,
                    message: body,
                    type,
                    url,
                    icon,
                    read: false,
                    deliveryStatus: {
                        fcm: {
                            sent: results.android.success || results.web.success,
                            sentAt: (results.android.success || results.web.success) ? new Date() : null
                        },
                        socketIO: {
                            sent: false
                        }
                    },
                    data: notificationData
                });
            } catch (dbError) {
                console.error('[UnifiedPush] Failed to save notification:', dbError.message);
            }
        }

        const totalSuccess = results.android.count + results.web.count;
        console.log(`[UnifiedPush] Sent to user ${userId}: Android=${results.android.count}, Web=${results.web.count}`);

        return {
            success: totalSuccess > 0,
            android: results.android,
            web: results.web,
            totalSent: totalSuccess
        };
    } catch (error) {
        console.error('[UnifiedPush] Error:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Send push notification to multiple users
 * @param {string[]} userIds - Array of user IDs
 * @param {Object} options - Same as sendUnifiedPush options
 * @returns {Promise<Object>} Aggregated results
 */
export async function sendUnifiedPushToUsers(userIds, options) {
    try {
        if (!userIds || userIds.length === 0) {
            return { success: false, error: 'No user IDs provided' };
        }

        const results = await Promise.allSettled(
            userIds.map(userId => sendUnifiedPush(userId, options))
        );

        let totalAndroid = 0;
        let totalWeb = 0;
        let successCount = 0;

        results.forEach(result => {
            if (result.status === 'fulfilled' && result.value.success) {
                successCount++;
                totalAndroid += result.value.android?.count || 0;
                totalWeb += result.value.web?.count || 0;
            }
        });

        console.log(`[UnifiedPush] Sent to ${successCount}/${userIds.length} users`);

        return {
            success: successCount > 0,
            totalUsers: userIds.length,
            successfulUsers: successCount,
            failedUsers: userIds.length - successCount,
            android: { count: totalAndroid },
            web: { count: totalWeb },
            totalSent: totalAndroid + totalWeb
        };
    } catch (error) {
        console.error('[UnifiedPush] Error sending to multiple users:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Send notification to users by role
 * @param {string} role - User role (admin, hr, manager, employee, department_head)
 * @param {Object} options - Notification options
 * @param {string} [companyId] - Optional company ID to filter users
 * @returns {Promise<Object>} Results
 */
export async function sendUnifiedPushByRole(role, options, companyId = null) {
    try {
        const database = requireDatabase(options);
        const filters = [{ field: 'role', operator: '==', value: role }, { field: 'isActive', operator: '==', value: true }];
        if (companyId) filters.push({ field: 'company', operator: '==', value: String(companyId) });
        const users = await collectFirestorePages(database, 'users', { filters });
        const userIds = users.map(u => u._id.toString());

        if (userIds.length === 0) {
            return { success: false, error: 'No users found with specified role' };
        }

        return sendUnifiedPushToUsers(userIds, options);
    } catch (error) {
        console.error('[UnifiedPush] Error sending by role:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Send notification to all users in a company
 * @param {string} companyId - Company ID
 * @param {Object} options - Notification options
 * @returns {Promise<Object>} Results
 */
export async function sendUnifiedPushToCompany(companyId, options) {
    try {
        const database = requireDatabase(options);
        const users = await collectFirestorePages(database, 'users', { filters: [{ field: 'company', operator: '==', value: String(companyId) }, { field: 'isActive', operator: '==', value: true }] });
        const userIds = users.map(u => u._id.toString());

        if (userIds.length === 0) {
            return { success: false, error: 'No active users in company' };
        }

        return sendUnifiedPushToUsers(userIds, options);
    } catch (error) {
        console.error('[UnifiedPush] Error sending to company:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Send test notification to verify push setup
 * @param {string} userId - User ID to test
 * @returns {Promise<Object>} Test results
 */
export async function sendTestNotification(userId, options) {
    return sendUnifiedPush(userId, {
        title: '🔔 Allow Notification',
        body: 'Push notifications are working! This is a test from Talio HRMS.',
        type: 'system',
        url: '/dashboard',
        saveToDb: false, database: requireDatabase(options)
    });
}

/**
 * Get notification delivery status for a user
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Status object with device counts
 */
export async function getNotificationStatus(userId, options) {
    try {
        const database = requireDatabase(options);
        const user = await database.get('users', String(userId));
        const webSubscriptions = (await collectFirestorePages(database, 'pushsubscriptions', { filters: [{ field: 'user', operator: '==', value: String(userId) }] })).filter(row => row.isActive !== false).length;

        const androidTokens = user?.fcmTokens?.filter(t =>
            t.device === 'android' || t.platform === 'android'
        ).length || 0;

        const webTokens = user?.fcmTokens?.filter(t =>
            t.device === 'web' || t.platform === 'web'
        ).length || 0;

        return {
            hasAndroid: androidTokens > 0,
            hasWeb: webSubscriptions > 0 || webTokens > 0,
            androidDevices: androidTokens,
            webDevices: webSubscriptions + webTokens,
            totalDevices: androidTokens + webSubscriptions + webTokens
        };
    } catch (error) {
        console.error('[UnifiedPush] Error getting status:', error);
        return { hasAndroid: false, hasWeb: false, totalDevices: 0 };
    }
}

export default {
    sendUnifiedPush,
    sendUnifiedPushToUsers,
    sendUnifiedPushByRole,
    sendUnifiedPushToCompany,
    sendTestNotification,
    getNotificationStatus,
    PLATFORM
};
