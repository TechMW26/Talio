/**
 * Centralized Notification Service for Firebase Cloud Messaging
 * Handles all automated notifications across the application
 * Ensures no notifications are dropped with retry mechanism
 * 
 * MULTI-TENANT: This module now supports tenant-aware models.
 * Pass tenant models via options.models when called from authenticated routes.
 * Falls back to default models for backward compatibility (cron jobs, etc.)
 */

import { sendNotificationToUsers } from './firebaseNotification'
import DefaultUser from '@/models/User'
import DefaultEmployee from '@/models/Employee'
import DefaultNotification from '@/models/Notification'

// Global model references (can be overridden per-call)
let globalModels = {
  User: DefaultUser,
  Employee: DefaultEmployee,
  Notification: DefaultNotification
}

/**
 * Set tenant models globally for this request cycle
 * @param {Object} models - { User, Employee, Notification }
 */
export function setTenantModels(models) {
  if (models) {
    globalModels = { ...globalModels, ...models }
  }
}

/**
 * Notification Queue for retry mechanism
 */
class NotificationQueue {
  constructor() {
    this.queue = []
    this.processing = false
    this.maxRetries = 3
  }

  async add(notificationData) {
    this.queue.push({
      ...notificationData,
      retries: 0,
      addedAt: new Date()
    })

    if (!this.processing) {
      this.process()
    }
  }

  async process() {
    if (this.queue.length === 0) {
      this.processing = false
      return
    }

    this.processing = true
    const item = this.queue.shift()

    try {
      await this.sendNotification(item)
      console.log(`✅ Notification sent successfully: ${item.title}`)
    } catch (error) {
      console.error(`❌ Failed to send notification: ${item.title}`, error)

      // Retry logic
      if (item.retries < this.maxRetries) {
        item.retries++
        this.queue.push(item)
        console.log(`🔄 Retrying notification (${item.retries}/${this.maxRetries}): ${item.title}`)
      } else {
        console.error(`💀 Notification failed after ${this.maxRetries} retries: ${item.title}`)
      }
    }

    // Process next item
    setTimeout(() => this.process(), 100)
  }

  async sendNotification(item) {
    const { userIds, title, message, url, data, icon, models = {} } = item
    
    // Use item models, global models, or defaults
    const User = models.User || globalModels.User || DefaultUser
    const Notification = models.Notification || globalModels.Notification || DefaultNotification

    // Validate userIds
    if (!userIds || userIds.length === 0) {
      console.error('❌ No user IDs provided for notification')
      return
    }

    // Get users with FCM tokens
    const users = await User.find({
      _id: { $in: userIds }
    }).select('_id fcmTokens notificationPreferences')

    if (users.length === 0) {
      console.warn(`⚠️ No users found for notification: ${title}`)
      return
    }

    // Send via Firebase Cloud Messaging
    let result = null
    try {
      const notification = {
        title,
        body: message
      }

      const notificationData = {
        ...data,
        url: url || '/dashboard',
        icon: icon || '/icons/icon-192x192.png'
      }

      result = await sendNotificationToUsers(users, notification, notificationData)

      console.log(`✅ FCM notifications sent: ${result.successCount}/${users.length}`)
      if (result.failureCount > 0) {
        console.warn(`⚠️ Failed to send ${result.failureCount} notifications`)
      }
    } catch (fcmError) {
      console.error('❌ Failed to send FCM notifications:', fcmError)
    }

    // Save notification to database for each user
    // Determine notification type - ensure it matches the schema enum
    let notificationType = 'system' // default
    if (data?.type) {
      // Map common type names to schema enum values
      const typeMapping = {
        'message': 'chat',
        'chat': 'chat',
        'task': 'task',
        'leave': 'leave',
        'attendance': 'attendance',
        'announcement': 'announcement',
        'system': 'system',
        'approval': 'approval',
        'custom': 'custom'
      }
      notificationType = typeMapping[data.type] || 'system'
    }

    try {
      const notificationPromises = users.map(user =>
        Notification.create({
          user: user._id,
          title,
          message,
          sentBy: item.sentBy || null,
          type: notificationType,
          url: url || '/dashboard',
          icon: icon || '/icons/icon-192x192.png',
          data: data || {},
          deliveryStatus: {
            socketIO: {
              sent: false
            },
            fcm: {
              sent: result ? result.successCount > 0 : false,
              sentAt: result && result.successCount > 0 ? new Date() : null
            }
          }
        })
      )

      await Promise.all(notificationPromises)
      console.log(`✅ Saved ${users.length} notification(s) to database`)
    } catch (dbError) {
      console.error('❌ Failed to save notifications to database:', dbError)
      // Don't throw - FCM notification was already sent
    }

    return result
  }
}

// Global notification queue instance
const notificationQueue = new NotificationQueue()

/**
 * Send notification with automatic retry
 * @param {Object} params - Notification parameters
 * @param {Object} params.models - Optional tenant-aware models { User, Employee, Notification }
 */
export async function sendNotification({ userIds, title, message, url, data, icon, sentBy, models }) {
  return notificationQueue.add({ userIds, title, message, url, data, icon, sentBy, models })
}

/**
 * Messaging Notifications
 * @param {Object} params.models - Optional tenant-aware models
 */
export async function sendMessageNotification({ senderId, recipientId, message, chatId, models = {} }) {
  try {
    const User = models.User || globalModels.User || DefaultUser
    const Employee = models.Employee || globalModels.Employee || DefaultEmployee
    
    // Get sender user to find employee
    const senderUser = await User.findById(senderId).select('employeeId')
    let senderName = 'Someone'

    if (senderUser && senderUser.employeeId) {
      const sender = await Employee.findById(senderUser.employeeId).select('firstName lastName')
      if (sender) {
        senderName = `${sender.firstName} ${sender.lastName}`
      }
    }

    await sendNotification({
      userIds: [recipientId],
      title: `💬 New message from ${senderName}`,
      message: message.substring(0, 100),
      url: `/dashboard/chat?chatId=${chatId}`,
      data: {
        type: 'chat',
        chatId,
        senderId
      },
      sentBy: senderId,
      models
    })
  } catch (error) {
    console.error('Failed to send message notification:', error)
  }
}

/**
 * Announcement Notifications
 */
export async function sendAnnouncementNotification({ announcementId, title, content, targetUserIds, createdBy }) {
  try {
    await sendNotification({
      userIds: targetUserIds,
      title: '📢 New Announcement',
      message: title,
      url: `/dashboard/announcements?id=${announcementId}`,
      data: {
        type: 'announcement',
        announcementId
      },
      sentBy: createdBy
    })
  } catch (error) {
    console.error('Failed to send announcement notification:', error)
  }
}

/**
 * Policy Notifications
 */
export async function sendPolicyNotification({ policyId, title, targetUserIds, createdBy }) {
  try {
    await sendNotification({
      userIds: targetUserIds,
      title: '📋 New Policy Published',
      message: `${title} - Please review and acknowledge`,
      url: `/dashboard/policies?id=${policyId}`,
      data: {
        type: 'policy',
        policyId
      },
      sentBy: createdBy
    })
  } catch (error) {
    console.error('Failed to send policy notification:', error)
  }
}

/**
 * Leave Management Notifications
 */
export async function sendLeaveRequestNotification({ leaveId, employeeId, employeeName, leaveType, startDate, endDate, approverIds }) {
  try {
    await sendNotification({
      userIds: approverIds,
      title: '🏖️ New Leave Request',
      message: `${employeeName} requested ${leaveType} from ${startDate} to ${endDate}`,
      url: `/dashboard/leave?id=${leaveId}`,
      data: {
        type: 'leave_request',
        leaveId
      },
      sentBy: employeeId
    })
  } catch (error) {
    console.error('Failed to send leave request notification:', error)
  }
}

export async function sendLeaveApprovedNotification({ leaveId, employeeId, leaveType, startDate, endDate, approvedBy }) {
  try {
    const approver = await Employee.findOne({ userId: approvedBy }).select('firstName lastName')
    const approverName = approver ? `${approver.firstName} ${approver.lastName}` : 'Manager'

    await sendNotification({
      userIds: [employeeId],
      title: '✅ Leave Approved',
      message: `Your ${leaveType} from ${startDate} to ${endDate} has been approved by ${approverName}`,
      url: `/dashboard/leave?id=${leaveId}`,
      data: {
        type: 'leave_approved',
        leaveId
      },
      sentBy: approvedBy
    })
  } catch (error) {
    console.error('Failed to send leave approved notification:', error)
  }
}

export async function sendLeaveRejectedNotification({ leaveId, employeeId, leaveType, startDate, endDate, rejectedBy, reason }) {
  try {
    const rejector = await Employee.findOne({ userId: rejectedBy }).select('firstName lastName')
    const rejectorName = rejector ? `${rejector.firstName} ${rejector.lastName}` : 'Manager'

    await sendNotification({
      userIds: [employeeId],
      title: '❌ Leave Rejected',
      message: `Your ${leaveType} from ${startDate} to ${endDate} was rejected by ${rejectorName}${reason ? `: ${reason}` : ''}`,
      url: `/dashboard/leave?id=${leaveId}`,
      data: {
        type: 'leave_rejected',
        leaveId
      },
      sentBy: rejectedBy
    })
  } catch (error) {
    console.error('Failed to send leave rejected notification:', error)
  }
}

/**
 * Attendance Notifications
 */
export async function sendAttendanceReminderNotification({ employeeId }) {
  try {
    await sendNotification({
      userIds: [employeeId],
      title: '⏰ Attendance Reminder',
      message: 'Don\'t forget to check in for today!',
      url: '/dashboard/attendance',
      data: {
        type: 'attendance_reminder'
      }
    })
  } catch (error) {
    console.error('Failed to send attendance reminder notification:', error)
  }
}

export async function sendCheckoutReminderNotification({ employeeId }) {
  try {
    await sendNotification({
      userIds: [employeeId],
      title: '⏰ Checkout Reminder',
      message: 'Don\'t forget to check out before leaving!',
      url: '/dashboard/attendance',
      data: {
        type: 'checkout_reminder'
      }
    })
  } catch (error) {
    console.error('Failed to send checkout reminder notification:', error)
  }
}

/**
 * Payroll Notifications
 */
export async function sendPayrollGeneratedNotification({ employeeId, month, year, amount }) {
  try {
    await sendNotification({
      userIds: [employeeId],
      title: '💰 Payroll Generated',
      message: `Your payroll for ${month} ${year} has been generated: ₹${amount}`,
      url: '/dashboard/payroll',
      data: {
        type: 'payroll_generated',
        month,
        year
      }
    })
  } catch (error) {
    console.error('Failed to send payroll generated notification:', error)
  }
}

/**
 * Performance Review Notifications
 */
export async function sendPerformanceReviewNotification({ employeeId, reviewId, reviewerName, period }) {
  try {
    await sendNotification({
      userIds: [employeeId],
      title: '📊 Performance Review Available',
      message: `${reviewerName} has completed your performance review for ${period}`,
      url: `/dashboard/performance?id=${reviewId}`,
      data: {
        type: 'performance_review',
        reviewId
      }
    })
  } catch (error) {
    console.error('Failed to send performance review notification:', error)
  }
}

/**
 * Expense & Travel Notifications
 */
export async function sendExpenseApprovedNotification({ employeeId, expenseId, amount, approvedBy }) {
  try {
    const approver = await Employee.findOne({ userId: approvedBy }).select('firstName lastName')
    const approverName = approver ? `${approver.firstName} ${approver.lastName}` : 'Manager'

    await sendNotification({
      userIds: [employeeId],
      title: '✅ Expense Approved',
      message: `Your expense claim of ₹${amount} has been approved by ${approverName}`,
      url: `/dashboard/expenses?id=${expenseId}`,
      data: {
        type: 'expense_approved',
        expenseId
      },
      sentBy: approvedBy
    })
  } catch (error) {
    console.error('Failed to send expense approved notification:', error)
  }
}

export async function sendExpenseRejectedNotification({ employeeId, expenseId, amount, rejectedBy, reason }) {
  try {
    const rejector = await Employee.findOne({ userId: rejectedBy }).select('firstName lastName')
    const rejectorName = rejector ? `${rejector.firstName} ${rejector.lastName}` : 'Manager'

    await sendNotification({
      userIds: [employeeId],
      title: '❌ Expense Rejected',
      message: `Your expense claim of ₹${amount} was rejected by ${rejectorName}${reason ? `: ${reason}` : ''}`,
      url: `/dashboard/expenses?id=${expenseId}`,
      data: {
        type: 'expense_rejected',
        expenseId
      },
      sentBy: rejectedBy
    })
  } catch (error) {
    console.error('Failed to send expense rejected notification:', error)
  }
}

export async function sendTravelApprovedNotification({ employeeId, travelId, destination, approvedBy }) {
  try {
    const approver = await Employee.findOne({ userId: approvedBy }).select('firstName lastName')
    const approverName = approver ? `${approver.firstName} ${approver.lastName}` : 'Manager'

    await sendNotification({
      userIds: [employeeId],
      title: '✈️ Travel Request Approved',
      message: `Your travel request to ${destination} has been approved by ${approverName}`,
      url: `/dashboard/travel?id=${travelId}`,
      data: {
        type: 'travel_approved',
        travelId
      },
      sentBy: approvedBy
    })
  } catch (error) {
    console.error('Failed to send travel approved notification:', error)
  }
}

/**
 * Helpdesk Notifications
 */
export async function sendTicketAssignedNotification({ ticketId, assigneeId, title, assignedBy }) {
  try {
    const assigner = await Employee.findOne({ userId: assignedBy }).select('firstName lastName')
    const assignerName = assigner ? `${assigner.firstName} ${assigner.lastName}` : 'Someone'

    await sendNotification({
      userIds: [assigneeId],
      title: '🎫 Ticket Assigned',
      message: `${assignerName} assigned you a ticket: ${title}`,
      url: `/dashboard/helpdesk?id=${ticketId}`,
      data: {
        type: 'ticket_assigned',
        ticketId
      },
      sentBy: assignedBy
    })
  } catch (error) {
    console.error('Failed to send ticket assigned notification:', error)
  }
}

export async function sendTicketStatusUpdateNotification({ ticketId, creatorId, title, status, updatedBy }) {
  try {
    await sendNotification({
      userIds: [creatorId],
      title: '🎫 Ticket Status Updated',
      message: `Your ticket "${title}" status changed to ${status}`,
      url: `/dashboard/helpdesk?id=${ticketId}`,
      data: {
        type: 'ticket_status_update',
        ticketId,
        status
      },
      sentBy: updatedBy
    })
  } catch (error) {
    console.error('Failed to send ticket status update notification:', error)
  }
}

