/**
 * Internal Event Bus
 * Central coordinator that:
 *  1. Pushes real-time updates to connected clients via Socket.IO
 *  2. Fans out to registered external webhooks via BullMQ
 *  3. Invalidates relevant caches (L1 + Redis)
 *
 * Usage:
 *   import { emitEvent } from '@/lib/eventBus'
 *   emitEvent('chat.unread.updated', payload, { userIds, databaseName })
 */

import { emitRealtimeEvent } from './realtimeEvents.js'
import { dispatchWebhooks } from './webhookDispatcher.js'
import { clearCachePattern, buildCachePattern } from './cache.js'

// ─── Event definitions ───────────────────────────────────────────────────────

export const EVENTS = {
  // Chat events
  CHAT_UNREAD_UPDATED: 'chat.unread.updated',
  CHAT_MESSAGE_SENT: 'chat.message.sent',

  // Sidebar / badge count events
  SIDEBAR_COUNTS_UPDATED: 'sidebar.counts.updated',

  // Granular sidebar triggers (each causes a sidebar count refresh push)
  LEAVE_STATUS_CHANGED: 'leave.status.changed',
  ATTENDANCE_CORRECTION_CHANGED: 'attendance.correction.changed',
  EXPENSE_STATUS_CHANGED: 'expense.status.changed',
  HELPDESK_TICKET_CHANGED: 'helpdesk.ticket.changed',
  NOTIFICATION_CREATED: 'notification.created',
  TASK_ASSIGNMENT_CHANGED: 'task.assignment.changed',
  PROJECT_INVITATION_CHANGED: 'project.invitation.changed',
}

// Events that should trigger a sidebar count push
const SIDEBAR_TRIGGER_EVENTS = new Set([
  EVENTS.LEAVE_STATUS_CHANGED,
  EVENTS.ATTENDANCE_CORRECTION_CHANGED,
  EVENTS.EXPENSE_STATUS_CHANGED,
  EVENTS.HELPDESK_TICKET_CHANGED,
  EVENTS.NOTIFICATION_CREATED,
  EVENTS.TASK_ASSIGNMENT_CHANGED,
  EVENTS.PROJECT_INVITATION_CHANGED,
])

// ─── Main emit function ─────────────────────────────────────────────────────

/**
 * Emit an internal event. Triggers Socket.IO push + webhook dispatch + cache invalidation.
 *
 * @param {string} event - Event name from EVENTS
 * @param {Object} payload - Event data (sent to clients and webhooks)
 * @param {Object} options
 * @param {string[]} [options.userIds] - User IDs to push Socket.IO event to
 * @param {string} [options.databaseName] - Tenant database name (for webhooks + cache keys)
 * @param {string} [options.companyId] - Company ID for company-wide Socket.IO broadcast
 * @param {boolean} [options.skipSocket=false] - Skip Socket.IO emission
 * @param {boolean} [options.skipWebhook=false] - Skip webhook dispatch
 * @param {boolean} [options.skipCacheInvalidation=false] - Skip cache invalidation
 */
export async function emitEvent(event, payload = {}, options = {}) {
  const {
    userIds = [],
    databaseName,
    companyId,
    skipSocket = false,
    skipWebhook = false,
    skipCacheInvalidation = false,
  } = options

  // ── 1. Socket.IO push ──────────────────────────────────────────────────
  if (!skipSocket) {
    try {
      emitRealtimeEvent(event, payload, {
        userIds,
        companyId,
      })

      // If this is a sidebar trigger event, also push 'sidebar.counts.updated' via Socket.IO
      if (SIDEBAR_TRIGGER_EVENTS.has(event)) {
        emitRealtimeEvent(EVENTS.SIDEBAR_COUNTS_UPDATED, { triggerEvent: event, ...payload }, {
          userIds,
          companyId,
        })
      }
    } catch (err) {
      console.error(`[EventBus] Socket.IO error for ${event}:`, err.message)
    }
  }

  // ── 2. Cache invalidation ──────────────────────────────────────────────
  if (!skipCacheInvalidation && databaseName) {
    try {
      await invalidateCachesForEvent(event, payload, { userIds, databaseName })
    } catch (err) {
      console.error(`[EventBus] Cache invalidation error for ${event}:`, err.message)
    }
  }

  // ── 3. Webhook dispatch (async, non-blocking) ─────────────────────────
  if (!skipWebhook && databaseName) {
    // Fire-and-forget - don't await
    dispatchWebhooks({ databaseName, event, payload }).catch(err => {
      console.error(`[EventBus] Webhook dispatch error for ${event}:`, err.message)
    })

    // If this is a sidebar trigger event, also dispatch webhook for 'sidebar.counts.updated'
    if (SIDEBAR_TRIGGER_EVENTS.has(event)) {
      dispatchWebhooks({
        databaseName,
        event: EVENTS.SIDEBAR_COUNTS_UPDATED,
        payload: { triggerEvent: event, ...payload },
      }).catch(err => {
        console.error(`[EventBus] Webhook dispatch error for sidebar.counts.updated:`, err.message)
      })
    }
  }

  console.log(`🔔 [EventBus] ${event} → ${userIds.length} user(s)${databaseName ? ` [${databaseName}]` : ''}`)
}

// ─── Cache invalidation per event ────────────────────────────────────────────

async function invalidateCachesForEvent(event, payload, { userIds, databaseName }) {
  const promises = []

  const invalidateUserNamespaces = (namespaces) => {
    for (const userId of userIds) {
      for (const namespace of namespaces) {
        promises.push(clearCachePattern(buildCachePattern({
          tenantId: databaseName,
          userId,
          namespace,
        })))
      }
    }
  }

  switch (event) {
    case EVENTS.CHAT_UNREAD_UPDATED:
    case EVENTS.CHAT_MESSAGE_SENT: {
      invalidateUserNamespaces(['chat:unread'])
      break
    }

    case EVENTS.SIDEBAR_COUNTS_UPDATED:
    case EVENTS.LEAVE_STATUS_CHANGED:
    case EVENTS.ATTENDANCE_CORRECTION_CHANGED:
    case EVENTS.EXPENSE_STATUS_CHANGED:
    case EVENTS.HELPDESK_TICKET_CHANGED:
    case EVENTS.NOTIFICATION_CREATED: {
      invalidateUserNamespaces(['sidebar:counts'])
      break
    }

    case EVENTS.TASK_ASSIGNMENT_CHANGED: {
      invalidateUserNamespaces(['sidebar:counts', 'tasks:personal', 'my-tasks', 'actionable-notifications'])
      break
    }

    case EVENTS.PROJECT_INVITATION_CHANGED: {
      invalidateUserNamespaces(['sidebar:counts', 'actionable-notifications'])
      break
    }

    default:
      // No specific cache invalidation for unknown events
      break
  }

  if (promises.length) {
    await Promise.allSettled(promises)
  }
}

// ─── Convenience helpers ─────────────────────────────────────────────────────

/**
 * Emit chat unread count update to specific users.
 * Typically called after: new message, mark-read, message deletion.
 *
 * @param {Object} data - { totalUnread, unreadByChat }
 * @param {string[]} userIds - User IDs to notify
 * @param {string} databaseName - Tenant database
 */
export function emitChatUnreadUpdated(data, userIds, databaseName) {
  return emitEvent(EVENTS.CHAT_UNREAD_UPDATED, data, { userIds, databaseName })
}

/**
 * Emit sidebar counts update to specific users.
 * Typically called after: leave approval, attendance correction, expense approval,
 * helpdesk ticket change, notification creation, task assignment, project invitation.
 *
 * @param {Object} data - Partial or full sidebar counts { leaves?, attendance?, projects?, ... }
 * @param {string[]} userIds - User IDs to notify
 * @param {string} databaseName - Tenant database
 */
export function emitSidebarCountsUpdated(data, userIds, databaseName) {
  return emitEvent(EVENTS.SIDEBAR_COUNTS_UPDATED, data, { userIds, databaseName })
}

const eventBus = {
  EVENTS,
  emitEvent,
  emitChatUnreadUpdated,
  emitSidebarCountsUpdated,
}

export default eventBus
