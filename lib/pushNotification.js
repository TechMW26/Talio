/**
 * Push Notification Helper
 * Wrapper for sending push notifications to users via Firebase Cloud Messaging
 * 
 * MULTI-TENANT: This module now supports tenant-aware models.
 * Pass tenant models via options.models when called from authenticated routes.
 * Falls back to default models for backward compatibility (cron jobs, etc.)
 */

import { sendNotificationToUser, sendNotificationToUsers } from './firebaseNotification'
import DefaultUser from '@/models/User'
import DefaultNotification from '@/models/Notification'

/**
 * Send push notification to a specific user
 * @param {string} userId - User ID to send notification to
 * @param {Object|string} titleOrMessage - Notification title as string, or message object with {title, body}
 * @param {string} body - Notification body/message (optional if titleOrMessage is an object)
 * @param {Object} options - Additional options
 * @param {Object} options.data - Custom data payload
 * @param {string} options.url - URL to navigate to when clicked
 * @param {string} options.icon - Notification icon URL
 * @param {string} options.type - Notification type (e.g., 'login', 'leave', 'task', etc.)
 * @param {string} options.eventType - Event type for tracking
 * @param {string} options.clickAction - Click action URL
 * @param {Object} options.models - Tenant-aware models { User, Notification }
 * @returns {Promise<Object>} Result object
 */
export async function sendPushToUser(userId, titleOrMessage, body, options = {}) {
    try {
        // Handle both call signatures:
        // 1. sendPushToUser(userId, {title, body}, {options})
        // 2. sendPushToUser(userId, title, body, {options})
        let title, message, opts

        if (typeof titleOrMessage === 'object' && titleOrMessage !== null) {
            // New signature: titleOrMessage is an object with {title, body}
            title = titleOrMessage.title
            message = titleOrMessage.body
            opts = body || {} // body parameter becomes options in this case
        } else {
            // Old signature: title and body are separate strings
            title = titleOrMessage
            message = body
            opts = options
        }

        const {
            data = {},
            url = '/dashboard',
            icon = null,
            type = 'system',
            eventType = null,
            clickAction = null,
            models = {} // Tenant-aware models
        } = opts
        
        // Use tenant models if provided, fallback to default
        const User = models.User || DefaultUser
        const Notification = models.Notification || DefaultNotification

        // Get user with FCM tokens
        const user = await User.findById(userId).select('email name fcmTokens notificationPreferences')

        if (!user) {
            console.warn(`[PushNotification] User not found: ${userId}`)
            return { success: false, message: 'User not found' }
        }

        console.log(`[PushNotification] Sending to ${user.email}: ${title}`)

        // Send via Firebase Cloud Messaging
        const notification = {
            title,
            body: message
        }

        const notificationData = {
            ...data,
            url: clickAction || url,
            type,
            icon: icon || '/icons/icon-192x192.png'
        }

        if (eventType) {
            notificationData.eventType = eventType
        }

        const result = await sendNotificationToUser(user, notification, notificationData)

        // Save to database for in-app notifications
        await Notification.create({
            user: userId,
            title,
            message,
            type,
            url: clickAction || url,
            icon: icon || '/icons/icon-192x192.png',
            read: false,
            deliveryStatus: {
                fcm: {
                    sent: result?.success || false,
                    sentAt: result?.success ? new Date() : null
                },
                socketIO: {
                    sent: false
                }
            }
        })

        return result

    } catch (error) {
        console.error('[PushNotification] Error:', error)
        return {
            success: false,
            message: error.message,
            successCount: 0,
            failureCount: 1
        }
    }
}

/**
 * Send push notification to multiple users
 * @param {string[]} userIds - Array of user IDs
 * @param {Object|string} titleOrMessage - Notification title as string, or message object with {title, body}
 * @param {string} body - Notification body/message (optional if titleOrMessage is an object)
 * @param {Object} options - Additional options (same as sendPushToUser)
 * @param {Object} options.models - Tenant-aware models { User, Notification }
 * @returns {Promise<Object>} Result object with counts
 */
export async function sendPushToUsers(userIds, titleOrMessage, body, options = {}) {
    try {
        // Handle both call signatures
        let title, message, opts

        if (typeof titleOrMessage === 'object' && titleOrMessage !== null) {
            title = titleOrMessage.title
            message = titleOrMessage.body
            opts = body || {}
        } else {
            title = titleOrMessage
            message = body
            opts = options
        }

        const { data = {}, url = '/dashboard', icon = null, type = 'system', models = {} } = opts
        
        // Use tenant models if provided, fallback to default
        const User = models.User || DefaultUser
        const Notification = models.Notification || DefaultNotification

        // Get all users with FCM tokens
        const users = await User.find({
            _id: { $in: userIds }
        }).select('email name fcmTokens notificationPreferences')

        if (users.length === 0) {
            console.warn('[PushNotification] No users found')
            return {
                success: false,
                message: 'No users found',
                successCount: 0,
                failureCount: userIds.length
            }
        }

        // Send via Firebase Cloud Messaging
        const notification = {
            title,
            body: message
        }

        const notificationData = {
            ...data,
            url,
            type,
            icon: icon || '/icons/icon-192x192.png'
        }

        const result = await sendNotificationToUsers(users, notification, notificationData)

        // Save to database for in-app notifications
        const notificationPromises = users.map(user =>
            Notification.create({
                user: user._id,
                title,
                message,
                type,
                url,
                icon: icon || '/icons/icon-192x192.png',
                read: false,
                deliveryStatus: {
                    fcm: {
                        sent: result?.successCount > 0 || false,
                        sentAt: result?.successCount > 0 ? new Date() : null
                    },
                    socketIO: {
                        sent: false
                    }
                }
            })
        )

        await Promise.all(notificationPromises)

        return {
            success: result.successCount > 0,
            successCount: result.successCount,
            failureCount: result.failureCount,
            totalUsers: users.length
        }

    } catch (error) {
        console.error('[PushNotification] Error sending to multiple users:', error)
        return {
            success: false,
            message: error.message,
            successCount: 0,
            failureCount: userIds.length
        }
    }
}
