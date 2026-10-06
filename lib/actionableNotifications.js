/**
 * Actionable Notification Helper
 * 
 * Centralized module for creating persistent actionable notifications
 * that require user action (accept/reject/view/etc.)
 */

import { storeActionableNotification } from './actionableNotificationStore.server'
import { collectFirestorePages } from './platform/firestoreQueries.server'
import { buildCachePattern, clearCachePattern } from './cache.js'

async function invalidateActionableNotificationCache(database, userIds) {
  const tenantId = database?.databaseName
  if (!tenantId || !Array.isArray(userIds) || userIds.length === 0) {
    return
  }

  const uniqueUserIds = [...new Set(
    userIds
      .map(userId => userId?.toString?.() || userId)
      .filter(Boolean)
  )]

  await Promise.allSettled(uniqueUserIds.map(userId =>
    clearCachePattern(buildCachePattern({
      tenantId,
      userId,
      namespace: 'actionable-notifications',
    }))
  ))
}

/**
 * Notification type configurations with default icons and actions
 */
export const NOTIFICATION_TYPES = {
  PROJECT_INVITATION: 'project_invitation',
  TASK_ASSIGNMENT: 'task_assignment',
  MEETING_INVITATION: 'meeting_invitation',
  LEAVE_APPROVAL: 'leave_approval',
  EXPENSE_APPROVAL: 'expense_approval',
  DOCUMENT_APPROVAL: 'document_approval',
  TRAVEL_APPROVAL: 'travel_approval',
  ATTENDANCE_CORRECTION: 'attendance_correction',
  HELPDESK_ASSIGNMENT: 'helpdesk_assignment',
  ANNOUNCEMENT: 'announcement',
  PROBATION_APPROVAL: 'probation_approval',
  GENERIC: 'generic'
}

/**
 * Get default icon for notification type
 */
export function getDefaultIcon(type) {
  const icons = {
    [NOTIFICATION_TYPES.PROJECT_INVITATION]: '📊',
    [NOTIFICATION_TYPES.TASK_ASSIGNMENT]: '✅',
    [NOTIFICATION_TYPES.MEETING_INVITATION]: '📅',
    [NOTIFICATION_TYPES.LEAVE_APPROVAL]: '🏖️',
    [NOTIFICATION_TYPES.EXPENSE_APPROVAL]: '💰',
    [NOTIFICATION_TYPES.DOCUMENT_APPROVAL]: '📄',
    [NOTIFICATION_TYPES.TRAVEL_APPROVAL]: '✈️',
    [NOTIFICATION_TYPES.ATTENDANCE_CORRECTION]: '⏰',
    [NOTIFICATION_TYPES.HELPDESK_ASSIGNMENT]: '🎫',
    [NOTIFICATION_TYPES.ANNOUNCEMENT]: '📢',
    [NOTIFICATION_TYPES.PROBATION_APPROVAL]: 'probation',
    [NOTIFICATION_TYPES.GENERIC]: '🔔'
  }
  return icons[type] || '🔔'
}

/**
 * Create a project invitation notification
 * @param {Object} database - Verified tenant Firestore database
 * @param {Object} params - Notification parameters
 * @returns {Promise<Object>} - Created notification
 */
export async function createProjectInvitationNotification(database, params) {
  const { 
    targetUserId, 
    projectId, 
    projectName, 
    invitedBy,
    invitedByName 
  } = params

  const notification = await storeActionableNotification(database, {
    user: targetUserId,
    title: '📊 Project Invitation',
    message: `${invitedByName || 'Someone'} invited you to join the project "${projectName}"`,
    icon: '📊',
    type: NOTIFICATION_TYPES.PROJECT_INVITATION,
    priority: 'high',
    reference: {
      model: 'Project',
      id: projectId
    },
    actions: [
      {
        id: 'accept',
        label: 'Accept',
        variant: 'success',
        endpoint: `/api/projects/${projectId}/members/respond`,
        method: 'POST',
        payload: { action: 'accept' }
      },
      {
        id: 'reject',
        label: 'Decline',
        variant: 'danger',
        endpoint: `/api/projects/${projectId}/members/respond`,
        method: 'POST',
        payload: { action: 'reject' },
        requiresReason: true,
        reasonPrompt: 'Reason for declining (optional)'
      }
    ],
    url: `/dashboard/projects/${projectId}`,
    metadata: { projectId, projectName, invitedBy },
    createdBy: invitedBy
  })

  // Emit socket event
  if (global.io) {
    global.io.to(`user:${targetUserId}`).emit('actionable-notification', {
      notification: notification
    })
  }

  return notification
}

/**
 * Create a task assignment notification
 * @param {Object} database - Verified tenant Firestore database
 * @param {Object} params - Notification parameters
 * @returns {Promise<Object>} - Created notification
 */
export async function createTaskAssignmentNotification(database, params) {
  const { 
    targetUserId, 
    taskId, 
    taskTitle, 
    projectId,
    projectName,
    assignedBy,
    assignedByName,
    dueDate,
    priority
  } = params

  const notification = await storeActionableNotification(database, {
    user: targetUserId,
    title: '✅ New Task Assigned',
    message: `${assignedByName || 'Someone'} assigned you a task: "${taskTitle}"${projectName ? ` in project "${projectName}"` : ''}${dueDate ? `\nDue: ${new Date(dueDate).toLocaleDateString()}` : ''}`,
    icon: '✅',
    type: NOTIFICATION_TYPES.TASK_ASSIGNMENT,
    priority: priority === 'critical' ? 'urgent' : priority === 'high' ? 'high' : 'medium',
    reference: {
      model: 'Task',
      id: taskId
    },
    actions: [
      {
        id: 'view',
        label: 'View Task',
        variant: 'primary'
      }
    ],
    url: `/dashboard/projects/my-tasks`,
    metadata: { taskId, taskTitle, projectId, projectName, assignedBy, dueDate },
    createdBy: assignedBy
  })

  // Emit socket event
  if (global.io) {
    global.io.to(`user:${targetUserId}`).emit('actionable-notification', {
      notification: notification
    })
  }

  return notification
}

/**
 * Create a meeting invitation notification
 * @param {Object} database - Verified tenant Firestore database
 * @param {Object} params - Notification parameters
 * @returns {Promise<Object>} - Created notification
 */
export async function createMeetingInvitationNotification(database, params) {
  const { 
    targetUserId, 
    meetingId, 
    meetingTitle, 
    organizerId,
    organizerName,
    startTime,
    endTime,
    isRecurring
  } = params

  const startDate = new Date(startTime)
  const timeStr = startDate.toLocaleString('en-US', { 
    weekday: 'short', 
    month: 'short', 
    day: 'numeric',
    hour: 'numeric', 
    minute: '2-digit'
  })

  const notification = await storeActionableNotification(database, {
    user: targetUserId,
    title: '📅 Meeting Invitation',
    message: `${organizerName || 'Someone'} invited you to a meeting: "${meetingTitle}"\n📅 ${timeStr}${isRecurring ? '\n🔄 Recurring meeting' : ''}`,
    icon: '📅',
    type: NOTIFICATION_TYPES.MEETING_INVITATION,
    priority: 'high',
    reference: {
      model: 'Meeting',
      id: meetingId
    },
    actions: [
      {
        id: 'accept',
        label: 'Accept',
        variant: 'success',
        endpoint: `/api/meetings/${meetingId}/respond`,
        method: 'POST',
        payload: { response: 'accepted' }
      },
      {
        id: 'tentative',
        label: 'Maybe',
        variant: 'warning',
        endpoint: `/api/meetings/${meetingId}/respond`,
        method: 'POST',
        payload: { response: 'tentative' }
      },
      {
        id: 'decline',
        label: 'Decline',
        variant: 'danger',
        endpoint: `/api/meetings/${meetingId}/respond`,
        method: 'POST',
        payload: { response: 'declined' }
      }
    ],
    url: `/dashboard/meetings`,
    metadata: { meetingId, meetingTitle, organizerId, startTime, endTime, isRecurring },
    createdBy: organizerId
  })

  // Emit socket event
  if (global.io) {
    global.io.to(`user:${targetUserId}`).emit('actionable-notification', {
      notification: notification
    })
  }

  return notification
}

/**
 * Create a leave approval request notification
 * @param {Object} database - Verified tenant Firestore database
 * @param {Object} params - Notification parameters
 * @returns {Promise<Object>} - Created notification
 */
export async function createLeaveApprovalNotification(database, params) {
  const { 
    targetUserId, 
    leaveId, 
    leaveType,
    employeeName,
    employeeId,
    startDate,
    endDate,
    days,
    reason
  } = params

  const startStr = new Date(startDate).toLocaleDateString()
  const endStr = new Date(endDate).toLocaleDateString()

  const notification = await storeActionableNotification(database, {
    user: targetUserId,
    title: '🏖️ Leave Request',
    message: `${employeeName} has requested ${leaveType || 'leave'} for ${days} day${days > 1 ? 's' : ''}\n📅 ${startStr} - ${endStr}${reason ? `\n📝 ${reason}` : ''}`,
    icon: '🏖️',
    type: NOTIFICATION_TYPES.LEAVE_APPROVAL,
    priority: 'medium',
    reference: {
      model: 'Leave',
      id: leaveId
    },
    actions: [
      {
        id: 'approve',
        label: 'Approve',
        variant: 'success',
        endpoint: `/api/leave/${leaveId}`,
        method: 'PATCH',
        payload: { status: 'approved' }
      },
      {
        id: 'reject',
        label: 'Reject',
        variant: 'danger',
        endpoint: `/api/leave/${leaveId}`,
        method: 'PATCH',
        payload: { status: 'rejected' },
        requiresReason: true,
        reasonPrompt: 'Reason for rejection'
      }
    ],
    url: `/dashboard/leave?tab=requests`,
    metadata: { leaveId, leaveType, employeeName, employeeId, startDate, endDate, days },
    createdBy: employeeId
  })

  // Emit socket event
  if (global.io) {
    global.io.to(`user:${targetUserId}`).emit('actionable-notification', {
      notification: notification
    })
  }

  return notification
}

/**
 * Create a generic actionable notification
 * @param {Object} database - Verified tenant Firestore database
 * @param {Object} params - Notification parameters
 * @returns {Promise<Object>} - Created notification
 */
export async function createActionableNotification(database, params) {
  const { 
    targetUserId,
    title,
    message,
    icon,
    type = NOTIFICATION_TYPES.GENERIC,
    priority = 'medium',
    reference,
    actions,
    url,
    metadata,
    createdBy,
    expiresAt
  } = params

  const notification = await storeActionableNotification(database, {
    user: targetUserId,
    title,
    message,
    icon: icon || getDefaultIcon(type),
    type,
    priority,
    reference,
    actions: actions || [
      { id: 'view', label: 'View', variant: 'primary' },
      { id: 'dismiss', label: 'Dismiss', variant: 'secondary' }
    ],
    url,
    metadata,
    createdBy,
    expiresAt
  })

  // Emit socket event
  if (global.io) {
    global.io.to(`user:${targetUserId}`).emit('actionable-notification', {
      notification: notification
    })
  }

  return notification
}

/**
 * Dismiss all pending notifications for a reference
 * Useful when the referenced entity is deleted or action is taken elsewhere
 * @param {Object} database - Verified tenant Firestore database
 * @param {string} referenceModel - The model type (e.g., 'Project', 'Task')
 * @param {string} referenceId - The reference ID
 */
export async function dismissNotificationsForReference(database, referenceModel, referenceId, { recipientId } = {}) {
  const notifications = await collectFirestorePages(database, 'actionablenotifications', { filters: [
    { field: 'reference.model', operator: '==', value: referenceModel },
    { field: 'reference.id', operator: '==', value: String(referenceId) },
    { field: 'status', operator: '==', value: 'pending' },
    ...(recipientId ? [{ field: 'user', operator: '==', value: String(recipientId) }] : []),
  ] })
  let modifiedCount = 0
  for (const notification of notifications) {
    const changed = await database.transaction(async tx => {
      const current = await tx.get('actionablenotifications', notification._id)
      if (!current || current.status !== 'pending' || (recipientId && String(current.user) !== String(recipientId))) return false
      await tx.replace('actionablenotifications', { ...current, status: 'dismissed', actionTaken: { action: 'auto_dismissed', takenAt: new Date() }, updatedAt: new Date() })
      return true
    })
    if (changed) {
      modifiedCount++
      global.io?.to(`user:${notification.user}`).emit('actionable-notification-removed', { notificationId: notification._id })
    }
  }
  await invalidateActionableNotificationCache(database, notifications.map(record => record.user))
  return { modifiedCount }
}

/**
 * Create an expense approval notification
 */
export async function createExpenseApprovalNotification(database, params) {
  const { 
    targetUserId, 
    expenseId, 
    amount,
    category,
    employeeName,
    employeeId,
    submittedDate,
    description
  } = params

  const notification = await storeActionableNotification(database, {
    user: targetUserId,
    title: '💰 Expense Approval Request',
    message: `${employeeName} submitted an expense claim\n💵 ${amount}\n📁 ${category || 'General'}${description ? `\n📝 ${description}` : ''}`,
    icon: '💰',
    type: NOTIFICATION_TYPES.EXPENSE_APPROVAL,
    priority: 'medium',
    reference: {
      model: 'Expense',
      id: expenseId
    },
    actions: [
      {
        id: 'approve',
        label: 'Approve',
        variant: 'success',
        endpoint: `/api/expenses/${expenseId}/approve`,
        method: 'POST',
        payload: { action: 'approve' }
      },
      {
        id: 'reject',
        label: 'Reject',
        variant: 'danger',
        endpoint: `/api/expenses/${expenseId}/approve`,
        method: 'POST',
        payload: { action: 'reject' },
        requiresReason: true,
        reasonPrompt: 'Reason for rejection'
      }
    ],
    url: `/dashboard/expenses?tab=pending`,
    metadata: { expenseId, amount, category, employeeName, employeeId, submittedDate },
    createdBy: employeeId
  })

  if (global.io) {
    global.io.to(`user:${targetUserId}`).emit('actionable-notification', {
      notification: notification
    })
  }

  return notification
}

/**
 * Create a travel approval notification
 */
export async function createTravelApprovalNotification(database, params) {
  const { 
    targetUserId, 
    travelId, 
    destination,
    employeeName,
    employeeId,
    startDate,
    endDate,
    purpose
  } = params

  const startStr = new Date(startDate).toLocaleDateString()
  const endStr = new Date(endDate).toLocaleDateString()

  const notification = await storeActionableNotification(database, {
    user: targetUserId,
    title: '✈️ Travel Request',
    message: `${employeeName} has requested travel approval\n📍 ${destination}\n📅 ${startStr} - ${endStr}${purpose ? `\n📝 ${purpose}` : ''}`,
    icon: '✈️',
    type: NOTIFICATION_TYPES.TRAVEL_APPROVAL,
    priority: 'medium',
    reference: {
      model: 'Travel',
      id: travelId
    },
    actions: [
      {
        id: 'approve',
        label: 'Approve',
        variant: 'success',
        endpoint: `/api/travel/${travelId}/approve`,
        method: 'POST',
        payload: { action: 'approve' }
      },
      {
        id: 'reject',
        label: 'Reject',
        variant: 'danger',
        endpoint: `/api/travel/${travelId}/approve`,
        method: 'POST',
        payload: { action: 'reject' },
        requiresReason: true,
        reasonPrompt: 'Reason for rejection'
      }
    ],
    url: `/dashboard/travel?tab=pending`,
    metadata: { travelId, destination, employeeName, employeeId, startDate, endDate, purpose },
    createdBy: employeeId
  })

  if (global.io) {
    global.io.to(`user:${targetUserId}`).emit('actionable-notification', {
      notification: notification
    })
  }

  return notification
}

/**
 * Create an attendance correction approval notification
 */
export async function createAttendanceCorrectionNotification(database, params) {
  const { 
    targetUserId, 
    correctionId, 
    employeeName,
    employeeId,
    date,
    requestedCheckIn,
    requestedCheckOut,
    reason
  } = params

  const dateStr = new Date(date).toLocaleDateString()

  const notification = await storeActionableNotification(database, {
    user: targetUserId,
    title: '⏰ Attendance Correction Request',
    message: `${employeeName} requested an attendance correction\n📅 ${dateStr}${requestedCheckIn ? `\n🕐 Check-in: ${requestedCheckIn}` : ''}${requestedCheckOut ? `\n🕐 Check-out: ${requestedCheckOut}` : ''}${reason ? `\n📝 ${reason}` : ''}`,
    icon: '⏰',
    type: NOTIFICATION_TYPES.ATTENDANCE_CORRECTION,
    priority: 'medium',
    reference: {
      model: 'Attendance',
      id: correctionId
    },
    actions: [
      {
        id: 'approve',
        label: 'Approve',
        variant: 'success',
        endpoint: `/api/attendance/corrections`,
        method: 'PATCH',
        payload: { correctionId, action: 'approve' }
      },
      {
        id: 'reject',
        label: 'Reject',
        variant: 'danger',
        endpoint: `/api/attendance/corrections`,
        method: 'PATCH',
        payload: { correctionId, action: 'reject' },
        requiresReason: true,
        reasonPrompt: 'Reason for rejection'
      }
    ],
    url: `/dashboard/attendance?tab=corrections`,
    metadata: { correctionId, employeeName, employeeId, date, requestedCheckIn, requestedCheckOut },
    createdBy: employeeId
  })

  if (global.io) {
    global.io.to(`user:${targetUserId}`).emit('actionable-notification', {
      notification: notification
    })
  }

  return notification
}

/**
 * Create an announcement notification
 */
export async function createAnnouncementNotification(database, params) {
  const { 
    targetUserId, 
    announcementId, 
    title,
    message,
    authorName,
    authorId,
    priority = 'medium'
  } = params

  const notification = await storeActionableNotification(database, {
    user: targetUserId,
    title: '📢 New Announcement',
    message: `${title}\n\n${message?.substring(0, 150)}${message?.length > 150 ? '...' : ''}`,
    icon: '📢',
    type: NOTIFICATION_TYPES.ANNOUNCEMENT,
    priority: priority === 'urgent' ? 'urgent' : priority === 'high' ? 'high' : 'medium',
    reference: {
      model: 'Announcement',
      id: announcementId
    },
    actions: [
      {
        id: 'view',
        label: 'Read More',
        variant: 'primary'
      },
      {
        id: 'dismiss',
        label: 'Dismiss',
        variant: 'secondary'
      }
    ],
    url: `/dashboard/announcements`,
    metadata: { announcementId, title, authorName, authorId },
    createdBy: authorId
  })

  if (global.io) {
    global.io.to(`user:${targetUserId}`).emit('actionable-notification', {
      notification: notification
    })
  }

  return notification
}

/**
 * Create the non-dismissible manager prompt for a probation decision.
 * The decision endpoint independently verifies both the tenant and the resolved
 * approver, so notification payloads cannot grant approval authority.
 */
export async function createProbationApprovalNotification(database, params) {
  const {
    targetUserId,
    approvalId,
    employeeId,
    employeeName,
    requestType,
    extensionMonths,
    requestRemarks,
    requestedByEmployee,
    pip,
  } = params
  const isExtension = requestType === 'extension'

  const notification = await storeActionableNotification(database, {
    user: targetUserId,
    title: isExtension ? 'Probation extension approval' : 'Probation confirmation approval',
    message: [
      `${employeeName} is awaiting your probation decision.`,
      isExtension ? `Requested extension: ${extensionMonths} month${extensionMonths === 1 ? '' : 's'}.` : null,
      requestRemarks ? `Request note: ${requestRemarks}` : null,
      pip?.enabled ? `PIP goals: ${pip.goals}\nPIP review: ${pip.reviewDate}` : null,
      'Manager remarks are required for either decision.',
    ].filter(Boolean).join('\n'),
    icon: 'probation',
    type: NOTIFICATION_TYPES.PROBATION_APPROVAL,
    priority: 'high',
    reference: { model: 'ProbationApproval', id: approvalId },
    actions: [
      {
        id: 'approve',
        label: isExtension ? 'Approve extension' : 'Confirm employee',
        variant: 'success',
        endpoint: `/api/employees/${employeeId}/probation-approval`,
        method: 'PATCH',
        payload: { approvalId, decision: 'approve' },
        requiresReason: true,
        reasonPrompt: 'Add your approval remarks',
      },
      {
        id: 'reject',
        label: 'Reject',
        variant: 'danger',
        endpoint: `/api/employees/${employeeId}/probation-approval`,
        method: 'PATCH',
        payload: { approvalId, decision: 'reject' },
        requiresReason: true,
        reasonPrompt: 'Add your rejection remarks',
      },
    ],
    url: `/dashboard/employees/${employeeId}`,
    metadata: { approvalId, employeeId, employeeName, requestType, extensionMonths },
    createdBy: requestedByEmployee || null,
    displaySettings: { persistent: true, showInBell: true, playSound: true, dismissible: false },
  })

  await invalidateActionableNotificationCache(database, [targetUserId])
  if (global.io) {
    global.io.to(`user:${targetUserId}`).emit('actionable-notification', {
      notification: notification,
    })
  }

  return notification
}
