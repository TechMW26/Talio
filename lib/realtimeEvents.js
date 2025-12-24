/**
 * Real-time Events Helper
 * Centralized module for emitting Socket.IO events when data changes
 * This ensures all dashboards and components receive live updates
 */

// Event names for consistency across the codebase
export const REALTIME_EVENTS = {
  // Attendance events
  ATTENDANCE_UPDATE: 'attendance-update',
  ATTENDANCE_CHECK_IN: 'attendance-check-in',
  ATTENDANCE_CHECK_OUT: 'attendance-check-out',
  
  // Leave events
  LEAVE_REQUEST: 'leave-request',
  LEAVE_STATUS_UPDATE: 'leave-status-update',
  LEAVE_CANCELLED: 'leave-cancelled',
  
  // Expense events
  EXPENSE_SUBMITTED: 'expense-submitted',
  EXPENSE_STATUS_UPDATE: 'expense-status-update',
  
  // Travel events
  TRAVEL_REQUEST: 'travel-request',
  TRAVEL_STATUS_UPDATE: 'travel-status-update',
  
  // Project events
  PROJECT_CREATED: 'project-created',
  PROJECT_UPDATED: 'project-updated',
  PROJECT_DELETED: 'project-deleted',
  PROJECT_ASSIGNMENT: 'project-assignment',
  
  // Task events
  TASK_CREATED: 'task-created',
  TASK_UPDATED: 'task-updated',
  TASK_DELETED: 'task-deleted',
  TASK_STATUS_CHANGED: 'task-status-changed',
  TASK_ASSIGNED: 'task-assigned',
  
  // Employee events
  EMPLOYEE_CREATED: 'employee-created',
  EMPLOYEE_UPDATED: 'employee-updated',
  EMPLOYEE_DELETED: 'employee-deleted',
  
  // Department events
  DEPARTMENT_UPDATED: 'department-updated',
  
  // Announcement events
  ANNOUNCEMENT_CREATED: 'announcement-created',
  ANNOUNCEMENT_UPDATED: 'announcement-updated',
  
  // Notification events
  NEW_NOTIFICATION: 'new-notification',
  
  // Dashboard refresh events (for general data refresh)
  DASHBOARD_REFRESH: 'dashboard-refresh',
  
  // Geofence events
  GEOFENCE_APPROVAL: 'geofence-approval',
  
  // Performance events
  PERFORMANCE_REVIEW: 'performance-review',
  
  // Helpdesk events
  HELPDESK_TICKET: 'helpdesk-ticket',
  HELPDESK_TICKET_UPDATED: 'helpdesk-ticket-updated',
  
  // Document events
  DOCUMENT_UPDATE: 'document-update',
  
  // Asset events
  ASSET_UPDATE: 'asset-update',
  
  // Payroll events
  PAYROLL_UPDATE: 'payroll-update',
  
  // Meeting events
  MEETING_CREATED: 'meeting-created',
  MEETING_UPDATED: 'meeting-updated',
  MEETING_CANCELLED: 'meeting-cancelled',
  
  // Daily goals events
  DAILY_GOAL_UPDATED: 'daily-goal-updated',
  
  // Recruitment events
  RECRUITMENT_UPDATE: 'recruitment-update',
  
  // Holiday events
  HOLIDAY_UPDATE: 'holiday-update',
  
  // Policy events
  POLICY_UPDATE: 'policy-update',
}

/**
 * Emit a real-time event to specific users
 * @param {string} event - Event name from REALTIME_EVENTS
 * @param {Object} data - Event data
 * @param {Object} options - Options for targeting
 * @param {string[]} options.userIds - Array of user IDs to send to
 * @param {string} options.companyId - Company ID to broadcast to all company users
 * @param {string} options.departmentId - Department ID to broadcast to department users
 * @param {string} options.projectId - Project ID to broadcast to project members
 * @param {boolean} options.broadcast - Broadcast to all connected clients
 */
export function emitRealtimeEvent(event, data, options = {}) {
  const io = global.io
  if (!io) {
    console.warn('[Realtime] Socket.IO not initialized, skipping event:', event)
    return false
  }

  const { userIds, companyId, departmentId, projectId, broadcast } = options

  try {
    // Add timestamp to all events
    const eventData = {
      ...data,
      timestamp: new Date().toISOString(),
      eventType: event
    }

    // Broadcast to all clients
    if (broadcast) {
      io.emit(event, eventData)
      console.log(`📡 [Realtime] Broadcast ${event}`)
      return true
    }

    // Send to specific project room
    if (projectId) {
      io.to(`project:${projectId}`).emit(event, eventData)
      console.log(`📡 [Realtime] Sent ${event} to project:${projectId}`)
    }

    // Send to specific users
    if (userIds && userIds.length > 0) {
      userIds.forEach(userId => {
        if (userId) {
          io.to(`user:${userId.toString()}`).emit(event, eventData)
        }
      })
      console.log(`📡 [Realtime] Sent ${event} to ${userIds.length} users`)
      return true
    }

    // If companyId is provided, we need to fetch all users in the company
    // This should be handled by the caller who has access to the database
    if (companyId) {
      // Emit to a company room (clients need to join this room)
      io.to(`company:${companyId}`).emit(event, eventData)
      console.log(`📡 [Realtime] Sent ${event} to company:${companyId}`)
      return true
    }

    // If departmentId is provided
    if (departmentId) {
      io.to(`department:${departmentId}`).emit(event, eventData)
      console.log(`📡 [Realtime] Sent ${event} to department:${departmentId}`)
      return true
    }

    return true
  } catch (error) {
    console.error(`[Realtime] Error emitting ${event}:`, error)
    return false
  }
}

/**
 * Emit attendance update event
 */
export function emitAttendanceUpdate(attendanceData, targetUserIds = [], options = {}) {
  return emitRealtimeEvent(REALTIME_EVENTS.ATTENDANCE_UPDATE, {
    attendance: attendanceData,
    action: options.action || 'update'
  }, { userIds: targetUserIds, ...options })
}

/**
 * Emit leave request/update event
 */
export function emitLeaveUpdate(leaveData, targetUserIds = [], options = {}) {
  const event = options.isNew 
    ? REALTIME_EVENTS.LEAVE_REQUEST 
    : REALTIME_EVENTS.LEAVE_STATUS_UPDATE
  
  return emitRealtimeEvent(event, {
    leave: leaveData,
    action: options.action || 'update'
  }, { userIds: targetUserIds, ...options })
}

/**
 * Emit expense update event
 */
export function emitExpenseUpdate(expenseData, targetUserIds = [], options = {}) {
  const event = options.isNew 
    ? REALTIME_EVENTS.EXPENSE_SUBMITTED 
    : REALTIME_EVENTS.EXPENSE_STATUS_UPDATE
  
  return emitRealtimeEvent(event, {
    expense: expenseData,
    action: options.action || 'update'
  }, { userIds: targetUserIds, ...options })
}

/**
 * Emit project update event
 */
export function emitProjectUpdate(projectData, targetUserIds = [], options = {}) {
  let event = REALTIME_EVENTS.PROJECT_UPDATED
  if (options.isNew) event = REALTIME_EVENTS.PROJECT_CREATED
  if (options.isDeleted) event = REALTIME_EVENTS.PROJECT_DELETED
  
  return emitRealtimeEvent(event, {
    project: projectData,
    action: options.action || 'update'
  }, { userIds: targetUserIds, projectId: projectData?._id, ...options })
}

/**
 * Emit task update event
 */
export function emitTaskUpdate(taskData, targetUserIds = [], options = {}) {
  let event = REALTIME_EVENTS.TASK_UPDATED
  if (options.isNew) event = REALTIME_EVENTS.TASK_CREATED
  if (options.isDeleted) event = REALTIME_EVENTS.TASK_DELETED
  if (options.statusChanged) event = REALTIME_EVENTS.TASK_STATUS_CHANGED
  
  return emitRealtimeEvent(event, {
    task: taskData,
    action: options.action || 'update'
  }, { userIds: targetUserIds, projectId: taskData?.project, ...options })
}

/**
 * Emit employee update event
 */
export function emitEmployeeUpdate(employeeData, targetUserIds = [], options = {}) {
  let event = REALTIME_EVENTS.EMPLOYEE_UPDATED
  if (options.isNew) event = REALTIME_EVENTS.EMPLOYEE_CREATED
  if (options.isDeleted) event = REALTIME_EVENTS.EMPLOYEE_DELETED
  
  return emitRealtimeEvent(event, {
    employee: employeeData,
    action: options.action || 'update'
  }, { userIds: targetUserIds, ...options })
}

/**
 * Emit dashboard refresh event - tells clients to refresh their data
 */
export function emitDashboardRefresh(targetUserIds = [], dataTypes = []) {
  return emitRealtimeEvent(REALTIME_EVENTS.DASHBOARD_REFRESH, {
    dataTypes, // e.g., ['attendance', 'leaves', 'tasks']
    refreshAll: dataTypes.length === 0
  }, { userIds: targetUserIds })
}

/**
 * Emit announcement event
 */
export function emitAnnouncementUpdate(announcementData, options = {}) {
  const event = options.isNew 
    ? REALTIME_EVENTS.ANNOUNCEMENT_CREATED 
    : REALTIME_EVENTS.ANNOUNCEMENT_UPDATED
  
  return emitRealtimeEvent(event, {
    announcement: announcementData,
    action: options.action || 'create'
  }, { broadcast: true, ...options })
}

/**
 * Emit meeting update event
 */
export function emitMeetingUpdate(meetingData, targetUserIds = [], options = {}) {
  let event = REALTIME_EVENTS.MEETING_UPDATED
  if (options.isNew) event = REALTIME_EVENTS.MEETING_CREATED
  if (options.isCancelled) event = REALTIME_EVENTS.MEETING_CANCELLED
  
  return emitRealtimeEvent(event, {
    meeting: meetingData,
    action: options.action || 'update'
  }, { userIds: targetUserIds, ...options })
}

/**
 * Emit helpdesk ticket update event
 */
export function emitHelpdeskUpdate(ticketData, targetUserIds = [], options = {}) {
  const event = options.isNew 
    ? REALTIME_EVENTS.HELPDESK_TICKET 
    : REALTIME_EVENTS.HELPDESK_TICKET_UPDATED
  
  return emitRealtimeEvent(event, {
    ticket: ticketData,
    action: options.action || 'update'
  }, { userIds: targetUserIds, ...options })
}

/**
 * Emit holiday update event
 */
export function emitHolidayUpdate(holidayData, options = {}) {
  return emitRealtimeEvent(REALTIME_EVENTS.HOLIDAY_UPDATE, {
    holiday: holidayData,
    action: options.action || 'update'
  }, { broadcast: true, ...options })
}

/**
 * Emit travel request update event
 */
export function emitTravelUpdate(travelData, targetUserIds = [], options = {}) {
  const event = options.isNew 
    ? REALTIME_EVENTS.TRAVEL_REQUEST 
    : REALTIME_EVENTS.TRAVEL_STATUS_UPDATE
  
  return emitRealtimeEvent(event, {
    travel: travelData,
    action: options.action || 'update'
  }, { userIds: targetUserIds, ...options })
}

export default {
  REALTIME_EVENTS,
  emitRealtimeEvent,
  emitAttendanceUpdate,
  emitLeaveUpdate,
  emitExpenseUpdate,
  emitProjectUpdate,
  emitTaskUpdate,
  emitEmployeeUpdate,
  emitDashboardRefresh,
  emitAnnouncementUpdate,
  emitMeetingUpdate,
  emitHelpdeskUpdate,
  emitHolidayUpdate,
  emitTravelUpdate,
}
