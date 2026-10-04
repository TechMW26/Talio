import { createHash } from 'node:crypto'
import { enqueueBackgroundJob } from '@/lib/platform/firestoreBackgroundJobs.server'
import { getFirestoreTenantDatabase } from '@/lib/platform/firestoreApplication.server'
import { getPusherServer } from '@/lib/pusherServer'
import { roomToPusherChannel } from '@/lib/platform/realtimeChannels'
import { sendNotificationToUsers } from './firebaseNotification'

async function notificationActor(database, userId) {
  const user = await database.get('users', String(userId))
  if (user?.employeeId) return database.get('employees', String(user.employeeId))
  return (await database.list('employees', { filters: [{ field: 'userId', operator: '==', value: String(userId) }], limit: 1 })).records[0] || null
}

export async function deliverQueuedNotification(item) {
  const database = await getFirestoreTenantDatabase(item.databaseName)
  if (!item.jobId || !Array.isArray(item.userIds) || !item.userIds.length) throw new Error('Notification job and recipients are required')
  const ids = [...new Set(item.userIds.map(String))]
  const users = []
  for (let offset = 0; offset < ids.length; offset += 100) users.push(...(await database.getMany('users', ids.slice(offset, offset + 100))).filter(Boolean))
  const { title, message, url, data, icon } = item
  const notificationType = ({ message: 'chat', chat: 'chat', task: 'task', leave: 'leave', attendance: 'attendance', announcement: 'announcement', system: 'system', approval: 'approval', custom: 'custom' })[data?.type] || 'system'
  // Persist durable in-app records before attempting best-effort device delivery.
  // The deterministic identity prevents duplicate inbox entries on job replay.
  const records = []
  for (const user of users) {
    const id = createHash('sha256').update(`${item.jobId}:${user._id}`).digest('hex').slice(0, 24)
    const record = await database.transaction(async tx => {
      const current = await tx.get('notifications', id)
      if (current) return current
      const now = new Date()
      const next = { _id: id, user: user._id, title, message, sentBy: item.sentBy || null, type: notificationType, url: url || '/dashboard', icon: icon || '/icons/icon-192x192.png', data: data || {}, read: false, isRead: false, readAt: null, deliveryStatus: { socketIO: { sent: false }, fcm: { sent: false, status: 'not_sent' } }, createdAt: now, updatedAt: now }
      await tx.create('notifications', next)
      return next
    })
    records.push(record)
  }
  if (process.env.TALIO_LOCAL_ACCEPTANCE === '1') return { total: users.length, successCount: 0, failureCount: 0, skippedCount: users.length, skipped: true }
  const deliveries = await Promise.all(records.map(async (record, index) => {
    const claimed = await database.transaction(async tx => {
      const current = await tx.get('notifications', record._id)
      if (current.deliveryStatus?.fcm?.status && current.deliveryStatus.fcm.status !== 'not_sent') return false
      // Never replay an uncertain push: a crash may happen after provider acceptance.
      await tx.replace('notifications', { ...current, deliveryStatus: { ...current.deliveryStatus, fcm: { sent: false, status: 'sending', startedAt: new Date() } } })
      return true
    })
    if (!claimed) return { duplicate: true }
    let result
    try { result = await sendNotificationToUsers([users[index]], { title, body: message }, { ...data, url: url || '/dashboard', icon: icon || '/icons/icon-192x192.png' }) } catch { result = null }
    const success = Boolean(result?.successCount)
    await database.mutate('notifications', record._id, current => ({ ...current, deliveryStatus: { ...current.deliveryStatus, fcm: { sent: success, status: success ? 'sent' : 'unknown', sentAt: success ? new Date() : null } }, updatedAt: new Date() }))
    return { success }
  }))
  // Repeated realtime hints are harmless; the client deduplicates by record ID.
  if (process.env.TALIO_LOCAL_ACCEPTANCE !== '1') await Promise.all(records.map(record => getPusherServer().trigger(roomToPusherChannel(`user:${record.user}`, database.databaseName), 'new-notification', { _id: record._id, title, message, type: notificationType, url: url || '/dashboard' })))
  return { total: users.length, successCount: deliveries.filter(item => item.success).length, failureCount: deliveries.filter(item => item.success === false).length }
}

export async function sendNotification({ userIds, title, message, url, data, icon, sentBy, database }) {
  if (!database?.databaseName || !database?.get) throw new Error('Verified tenant Firestore database is required for notifications')
  return enqueueBackgroundJob('notification', { databaseName: database.databaseName, userIds, title, message, url, data, icon, sentBy })
}

/**
 * Messaging Notifications
 * @param {Object} params.database - Verified tenant Firestore database
 */
export async function sendMessageNotification({ senderId, recipientId, message, chatId, database }) {
  try {
    if (!database?.get) throw new Error('Verified tenant database required')

    // Get sender user to find employee
    const senderUser = await database.get('users', String(senderId))
    let senderName = 'Someone'

    if (senderUser && senderUser.employeeId) {
      const sender = await database.get('employees', String(senderUser.employeeId))
      if (sender) {
        senderName = `${sender.firstName} ${sender.lastName}`
      }
    }

    await sendNotification({
      database,
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
    })
  } catch (error) {
    console.error('Failed to send message notification:', error)
  }
}

/**
 * Announcement Notifications
 */
export async function sendAnnouncementNotification({ announcementId, title, content, targetUserIds, createdBy, database }) {
  try {
    await sendNotification({
      database,
      userIds: targetUserIds,
      title: '📢 New Announcement',
      message: title,
      url: `/dashboard/announcements?id=${announcementId}`,
      data: {
        type: 'announcement',
        announcementId
      },
      sentBy: createdBy,
    })
  } catch (error) {
    console.error('Failed to send announcement notification:', error)
  }
}

/**
 * Policy Notifications
 */
export async function sendPolicyNotification({ policyId, title, targetUserIds, createdBy, database }) {
  try {
    await sendNotification({
      database,
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
export async function sendLeaveRequestNotification({ leaveId, employeeId, employeeName, leaveType, startDate, endDate, approverIds, database }) {
  try {
    await sendNotification({
      database,
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

export async function sendLeaveApprovedNotification({ leaveId, employeeId, leaveType, startDate, endDate, approvedBy, database }) {
  try {
    const approver = await notificationActor(database, approvedBy)
    const approverName = approver ? `${approver.firstName} ${approver.lastName}` : 'Manager'

    await sendNotification({
      database,
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

export async function sendLeaveRejectedNotification({ leaveId, employeeId, leaveType, startDate, endDate, rejectedBy, reason, database }) {
  try {
    const rejector = await notificationActor(database, rejectedBy)
    const rejectorName = rejector ? `${rejector.firstName} ${rejector.lastName}` : 'Manager'

    await sendNotification({
      database,
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
export async function sendAttendanceReminderNotification({ employeeId, database }) {
  try {
    await sendNotification({
      database,
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

export async function sendCheckoutReminderNotification({ employeeId, database }) {
  try {
    await sendNotification({
      database,
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
export async function sendPayrollGeneratedNotification({ employeeId, month, year, amount, database }) {
  try {
    await sendNotification({
      database,
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
export async function sendPerformanceReviewNotification({ employeeId, reviewId, reviewerName, period, database }) {
  try {
    await sendNotification({
      database,
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
export async function sendExpenseApprovedNotification({ employeeId, expenseId, amount, approvedBy, database }) {
  try {
    const approver = await notificationActor(database, approvedBy)
    const approverName = approver ? `${approver.firstName} ${approver.lastName}` : 'Manager'

    await sendNotification({
      database,
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

export async function sendExpenseRejectedNotification({ employeeId, expenseId, amount, rejectedBy, reason, database }) {
  try {
    const rejector = await notificationActor(database, rejectedBy)
    const rejectorName = rejector ? `${rejector.firstName} ${rejector.lastName}` : 'Manager'

    await sendNotification({
      database,
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

export async function sendTravelApprovedNotification({ employeeId, travelId, destination, approvedBy, database }) {
  try {
    const approver = await notificationActor(database, approvedBy)
    const approverName = approver ? `${approver.firstName} ${approver.lastName}` : 'Manager'

    await sendNotification({
      database,
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
export async function sendTicketAssignedNotification({ ticketId, assigneeId, title, assignedBy, database }) {
  try {
    const assigner = await notificationActor(database, assignedBy)
    const assignerName = assigner ? `${assigner.firstName} ${assigner.lastName}` : 'Someone'

    await sendNotification({
      database,
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

export async function sendTicketStatusUpdateNotification({ ticketId, creatorId, title, status, updatedBy, database }) {
  try {
    await sendNotification({
      database,
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
