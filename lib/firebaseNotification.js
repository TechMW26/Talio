// Firebase Cloud Messaging service for sending push notifications
import admin from 'firebase-admin'

// Initialize Firebase Admin SDK
let firebaseApp = null
let initializationAttempted = false

function initializeFirebase() {
    // Return existing app if already initialized
    if (firebaseApp) {
        return firebaseApp
    }

    // Check if Firebase Admin SDK is already initialized globally
    if (admin.apps.length > 0) {
        firebaseApp = admin.apps[0]
        return firebaseApp
    }

    // Only attempt initialization once to avoid multiple error logs
    if (initializationAttempted) {
        return null
    }

    initializationAttempted = true

    try {
        // Check if service account key is provided
        const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_KEY

        if (!serviceAccount) {
            console.warn('⚠️  FIREBASE_SERVICE_ACCOUNT_KEY not found in environment variables')
            console.warn('⚠️  Push notifications will not work until you add the Firebase service account key')
            return null
        }

        // Parse the service account key
        const serviceAccountJson = JSON.parse(serviceAccount)

        firebaseApp = admin.initializeApp({
            credential: admin.credential.cert(serviceAccountJson),
            projectId: serviceAccountJson.project_id
        })

        console.log('✅ Firebase Admin SDK initialized successfully')
        return firebaseApp
    } catch (error) {
        console.error('❌ Failed to initialize Firebase Admin SDK:', error.message)
        return null
    }
}

/**
 * Send notification to a single device
 * Supports both Android (FCM) and iOS (APNs via FCM)
 */
export async function sendNotificationToDevice(token, notification, data = {}) {
    try {
        const app = initializeFirebase()
        if (!app) {
            // Silent skip - warning already logged during initialization
            return { success: false, error: 'Firebase not initialized' }
        }

        const message = {
            token,
            notification: {
                title: notification.title || 'Talio',
                body: notification.body || '',
                ...(notification.image && { image: notification.image })
            },
            data: {
                ...data,
                timestamp: Date.now().toString()
            },
            // Android-specific configuration
            android: {
                priority: 'high',
                notification: {
                    channelId: 'talio_notifications',
                    sound: 'default',
                    priority: 'high',
                    defaultSound: true,
                    defaultVibrateTimings: true
                }
            },
            // iOS/APNs configuration (via FCM)
            apns: {
                headers: {
                    'apns-priority': '10',           // High priority (10) or normal (5)
                    'apns-push-type': 'alert'        // 'alert', 'background', 'voip', etc.
                },
                payload: {
                    aps: {
                        alert: {
                            title: notification.title || 'Talio',
                            body: notification.body || ''
                        },
                        badge: data.badge || 1,          // Badge count on app icon
                        sound: 'default',
                        'mutable-content': 1,            // Allows notification service extension
                        'content-available': 1,          // Enable background fetch
                        'thread-id': data.threadId || 'talio-default'  // Group notifications
                    },
                    // Custom data for iOS
                    url: data.url || '/dashboard',
                    type: data.type || 'system'
                }
            }
        }

        const response = await admin.messaging().send(message)
        console.log('✅ Notification sent successfully:', response)

        return { success: true, messageId: response }
    } catch (error) {
        console.error('❌ Error sending notification:', error.message)

        // Handle invalid token
        if (error.code === 'messaging/registration-token-not-registered' ||
            error.code === 'messaging/invalid-registration-token') {
            return { success: false, error: 'invalid_token', shouldRemove: true }
        }

        return { success: false, error: error.message }
    }
}

/**
 * Send notification to multiple devices
 * Supports both Android (FCM) and iOS (APNs via FCM)
 */
export async function sendNotificationToMultipleDevices(tokens, notification, data = {}) {
    try {
        const app = initializeFirebase()
        if (!app) {
            // Silent skip - warning already logged during initialization
            return { success: false, error: 'Firebase not initialized' }
        }

        if (!tokens || tokens.length === 0) {
            return { success: false, error: 'No tokens provided' }
        }

        // Filter out invalid tokens
        const validTokens = tokens.filter(t => t && typeof t === 'string' && t.length > 0)

        if (validTokens.length === 0) {
            return { success: false, error: 'No valid tokens' }
        }

        const message = {
            notification: {
                title: notification.title || 'Talio',
                body: notification.body || '',
                ...(notification.image && { image: notification.image })
            },
            data: {
                ...data,
                timestamp: Date.now().toString()
            },
            // Android-specific configuration
            android: {
                priority: 'high',
                notification: {
                    channelId: 'talio_notifications',
                    sound: 'default',
                    priority: 'high'
                }
            },
            // iOS/APNs configuration (via FCM)
            apns: {
                headers: {
                    'apns-priority': '10',
                    'apns-push-type': 'alert'
                },
                payload: {
                    aps: {
                        alert: {
                            title: notification.title || 'Talio',
                            body: notification.body || ''
                        },
                        badge: data.badge || 1,
                        sound: 'default',
                        'mutable-content': 1,
                        'content-available': 1,
                        'thread-id': data.threadId || 'talio-default'
                    },
                    url: data.url || '/dashboard',
                    type: data.type || 'system'
                }
            },
            tokens: validTokens
        }

        const response = await admin.messaging().sendEachForMulticast(message)

        console.log(`✅ Sent ${response.successCount} notifications successfully`)

        if (response.failureCount > 0) {
            console.warn(`⚠️  ${response.failureCount} notifications failed`)

            // Collect failed tokens for cleanup
            const failedTokens = []
            response.responses.forEach((resp, idx) => {
                if (!resp.success) {
                    failedTokens.push({
                        token: validTokens[idx],
                        error: resp.error?.code
                    })
                }
            })

            return {
                success: true,
                successCount: response.successCount,
                failureCount: response.failureCount,
                failedTokens
            }
        }

        return {
            success: true,
            successCount: response.successCount,
            failureCount: 0
        }
    } catch (error) {
        console.error('❌ Error sending notifications:', error.message)
        return { success: false, error: error.message }
    }
}

/**
 * Send notification to a user (supports multiple devices)
 */
export async function sendNotificationToUser(user, notification, data = {}) {
    try {
        if (!user || !user.fcmTokens || user.fcmTokens.length === 0) {
            console.warn('User has no FCM tokens')
            return { success: false, error: 'No FCM tokens' }
        }

        // Extract tokens from user's fcmTokens array
        const tokens = user.fcmTokens.map(t => t.token).filter(Boolean)

        if (tokens.length === 0) {
            return { success: false, error: 'No valid FCM tokens' }
        }

        // Check user's notification preferences
        const notificationType = data.type
        if (notificationType && user.notificationPreferences) {
            const isEnabled = user.notificationPreferences[notificationType]
            if (isEnabled === false) {
                console.log(`User has disabled ${notificationType} notifications`)
                return { success: false, error: 'Notifications disabled by user' }
            }
        }

        const result = await sendNotificationToMultipleDevices(tokens, notification, data)

        // Handle failed tokens - remove invalid ones
        if (result.failedTokens && result.failedTokens.length > 0) {
            const invalidTokens = result.failedTokens
                .filter(ft => ft.error === 'messaging/registration-token-not-registered' ||
                    ft.error === 'messaging/invalid-registration-token')
                .map(ft => ft.token)

            if (invalidTokens.length > 0) {
                console.log(`Removing ${invalidTokens.length} invalid tokens`)
                // The calling function should handle removing invalid tokens from user
                result.tokensToRemove = invalidTokens
            }
        }

        return result
    } catch (error) {
        console.error('❌ Error sending notification to user:', error.message)
        return { success: false, error: error.message }
    }
}

/**
 * Send notification to multiple users
 */
export async function sendNotificationToUsers(users, notification, data = {}) {
    try {
        const results = await Promise.allSettled(
            users.map(user => sendNotificationToUser(user, notification, data))
        )

        const successCount = results.filter(r => r.status === 'fulfilled' && r.value.success).length
        const failureCount = results.length - successCount

        console.log(`✅ Sent notifications to ${successCount}/${users.length} users`)

        return {
            success: true,
            total: users.length,
            successCount,
            failureCount,
            // Keep backward compatibility
            successful: successCount,
            failed: failureCount
        }
    } catch (error) {
        console.error('❌ Error sending notifications to users:', error.message)
        return { success: false, error: error.message, successCount: 0, failureCount: users?.length || 0 }
    }
}

export default {
    sendNotificationToDevice,
    sendNotificationToMultipleDevices,
    sendNotificationToUser,
    sendNotificationToUsers
}
