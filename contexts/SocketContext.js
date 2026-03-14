'use client'

import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { io } from 'socket.io-client'
import toast from '@/utils/toast'

// Real-time event names (mirrored from lib/realtimeEvents.js for client-side)
export const REALTIME_EVENTS = {
  ATTENDANCE_UPDATE: 'attendance-update',
  ATTENDANCE_CHECK_IN: 'attendance-check-in',
  ATTENDANCE_CHECK_OUT: 'attendance-check-out',
  LEAVE_REQUEST: 'leave-request',
  LEAVE_STATUS_UPDATE: 'leave-status-update',
  LEAVE_CANCELLED: 'leave-cancelled',
  EXPENSE_SUBMITTED: 'expense-submitted',
  EXPENSE_STATUS_UPDATE: 'expense-status-update',
  TRAVEL_REQUEST: 'travel-request',
  TRAVEL_STATUS_UPDATE: 'travel-status-update',
  PROJECT_CREATED: 'project-created',
  PROJECT_UPDATED: 'project-updated',
  PROJECT_DELETED: 'project-deleted',
  PROJECT_ASSIGNMENT: 'project-assignment',
  TASK_CREATED: 'task-created',
  TASK_UPDATED: 'task-updated',
  TASK_DELETED: 'task-deleted',
  TASK_STATUS_CHANGED: 'task-status-changed',
  TASK_ASSIGNED: 'task-assigned',
  EMPLOYEE_CREATED: 'employee-created',
  EMPLOYEE_UPDATED: 'employee-updated',
  EMPLOYEE_DELETED: 'employee-deleted',
  DEPARTMENT_UPDATED: 'department-updated',
  ANNOUNCEMENT_CREATED: 'announcement-created',
  ANNOUNCEMENT_UPDATED: 'announcement-updated',
  NEW_NOTIFICATION: 'new-notification',
  DASHBOARD_REFRESH: 'dashboard-refresh',
  GEOFENCE_APPROVAL: 'geofence-approval',
  PERFORMANCE_REVIEW: 'performance-review',
  HELPDESK_TICKET: 'helpdesk-ticket',
  HELPDESK_TICKET_UPDATED: 'helpdesk-ticket-updated',
  DOCUMENT_UPDATE: 'document-update',
  ASSET_UPDATE: 'asset-update',
  PAYROLL_UPDATE: 'payroll-update',
  MEETING_CREATED: 'meeting-created',
  MEETING_UPDATED: 'meeting-updated',
  MEETING_CANCELLED: 'meeting-cancelled',
  DAILY_GOAL_UPDATED: 'daily-goal-updated',
  RECRUITMENT_UPDATE: 'recruitment-update',
  HOLIDAY_UPDATE: 'holiday-update',
  POLICY_UPDATE: 'policy-update',
}

const SocketContext = createContext()

export function SocketProvider({ children }) {
  const [socket, setSocket] = useState(null)
  const [isConnected, setIsConnected] = useState(false)
  const [currentUserId, setCurrentUserId] = useState(null)
  const [currentEmployeeId, setCurrentEmployeeId] = useState(null)

  useEffect(() => {
    // Get user ID from localStorage
    const userData = localStorage.getItem('user')
    let userId = null
    let employeeId = null
    let tenantDatabaseName = null
    if (userData) {
      try {
        const user = JSON.parse(userData)
        // Use the User's _id (not employeeId) for socket authentication
        // This matches how notifications are stored in the database
        userId = user.userId || user._id || user.id
        employeeId = user.employeeId?._id || user.employeeId || user.employee?._id || user.employee || null
        tenantDatabaseName = user.tenant?.databaseName || user.databaseName || null
        // Ensure it's a string
        if (typeof userId === 'object' && userId._id) {
          userId = userId._id
        }
        if (typeof employeeId === 'object' && employeeId._id) {
          employeeId = employeeId._id
        }
        userId = userId?.toString()
        employeeId = employeeId?.toString()
        setCurrentUserId(userId)
        setCurrentEmployeeId(employeeId)
        console.log('🔑 [Socket.IO Client] User ID for notifications:', userId)
      } catch (parseError) {
        console.error('[Socket.IO Client] Error parsing user data:', parseError)
      }
    }

    // Initialize Socket.IO connection
    // Use window.location.origin to connect to the same server
    const socketInstance = io(window.location.origin, {
      path: '/api/socketio',
      transports: ['websocket', 'polling'], // Try websocket first, then fall back to polling
      reconnection: true,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 10000,
      reconnectionAttempts: 3,
      timeout: 10000,
      autoConnect: true,
      forceNew: false
    })

    // =============================================
    // Polling fallback for force-refresh
    // When Socket.IO is not available, poll the DB
    // =============================================
    let refreshPollTimer = null
    let socketConnectedOnce = false

    const startRefreshPolling = () => {
      // Only poll if we have a token and never connected to Socket.IO
      if (refreshPollTimer || socketConnectedOnce) return
      const token = localStorage.getItem('token')
      if (!token) return

      console.log('🔄 [Socket.IO Client] Socket.IO unavailable — starting refresh polling fallback')
      refreshPollTimer = setInterval(async () => {
        try {
          const res = await fetch('/api/user/check-refresh', {
            headers: { 'Authorization': `Bearer ${token}` },
          })
          if (!res.ok) return
          const data = await res.json()
          if (data.pending) {
            console.log('🔄 [Socket.IO Client] Pending refresh found via polling:', data)
            // Trigger the same refresh flow as Socket.IO force-refresh
            handleForceRefresh(data)
          }
        } catch {
          // Silently ignore polling errors
        }
      }, 15000) // Poll every 15 seconds
    }

    const stopRefreshPolling = () => {
      if (refreshPollTimer) {
        clearInterval(refreshPollTimer)
        refreshPollTimer = null
      }
    }

    // =============================================
    // Heartbeat for DB-backed presence fallback
    // When Socket.IO is unavailable, periodically POST
    // to /api/user/heartbeat so the live-users API
    // can determine who is active.
    // =============================================
    let heartbeatTimer = null

    const sendHeartbeat = async () => {
      const token = localStorage.getItem('token')
      if (!token) return
      try {
        await fetch('/api/user/heartbeat', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            employeeId: employeeId || undefined,
            currentPage: window.location.pathname,
          }),
        })
      } catch {
        // Silently ignore heartbeat errors
      }
    }

    const startHeartbeat = () => {
      if (heartbeatTimer || socketConnectedOnce) return
      sendHeartbeat() // Send immediately
      heartbeatTimer = setInterval(sendHeartbeat, 60000) // Then every 60s
    }

    const stopHeartbeat = () => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer)
        heartbeatTimer = null
      }
    }

    // Shared force-refresh handler (used by both Socket.IO and polling)
    const handleForceRefresh = (data) => {
      try {
        console.log('🔄 [Socket.IO Client] Force refresh request received:', data)

        const message = data?.message || 'The administrator has requested a page refresh.'

        // Show toast notification before refresh
        toast.custom((t) => (
          <div
            className={`${t.visible ? 'animate-enter' : 'animate-leave'
              } max-w-md w-full bg-amber-50 border border-amber-200 shadow-lg rounded-lg pointer-events-auto flex ring-1 ring-amber-300`}
          >
            <div className="flex-1 w-0 p-4">
              <div className="flex items-start">
                <div className="flex-shrink-0 pt-0.5">
                  <div className="h-10 w-10 rounded-full bg-amber-500 flex items-center justify-center">
                    <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  </div>
                </div>
                <div className="ml-3 flex-1">
                  <p className="text-sm font-medium text-amber-900">
                    Page Refresh Required
                  </p>
                  <p className="mt-1 text-sm text-amber-700">
                    {message}
                  </p>
                  <p className="mt-2 text-xs text-amber-600">
                    Refreshing in 3 seconds...
                  </p>
                </div>
              </div>
            </div>
          </div>
        ), {
          duration: 4000,
          position: 'top-center',
        })

        // Delay the refresh to let user see the message
        setTimeout(() => {
          // Hard refresh: clear cache and reload
          if (data?.hard) {
            const keysToRemove = []
            for (let i = 0; i < localStorage.length; i++) {
              const key = localStorage.key(i)
              if (key && (key.startsWith('cache_') || key.startsWith('query_'))) {
                keysToRemove.push(key)
              }
            }
            keysToRemove.forEach(key => localStorage.removeItem(key))
            sessionStorage.clear()
            window.location.reload(true)
          } else {
            window.location.reload()
          }
        }, 3000)
      } catch (error) {
        console.error('❌ [Socket.IO Client] Error handling force-refresh:', error)
        setTimeout(() => window.location.reload(), 2000)
      }
    }

    // Connection event handlers
    socketInstance.on('connect', () => {
      console.log('✅ [Socket.IO Client] Connected:', socketInstance.id)
      setIsConnected(true)
      socketConnectedOnce = true
      stopRefreshPolling() // No need to poll if Socket.IO works
      stopHeartbeat() // Socket.IO handles presence natively

      // Authenticate user if we have userId
      if (userId) {
        socketInstance.emit('authenticate', {
          userId,
          employeeId,
          tenantDatabaseName
        })
      }
    })

    socketInstance.on('disconnect', () => {
      console.log('❌ [Socket.IO Client] Disconnected')
      setIsConnected(false)
    })

    socketInstance.on('connect_error', (error) => {
      // Only log once, not on every retry to avoid console spam
      if (!socketInstance._hasLoggedError) {
        console.warn('⚠️ [Socket.IO Client] Connection error — real-time features will use polling fallback.')
        socketInstance._hasLoggedError = true
        // Proactively start heartbeat and polling fallback
        startRefreshPolling()
        startHeartbeat()
      }
      setIsConnected(false)
    })

    // When all reconnection attempts are exhausted, start DB polling fallback
    socketInstance.on('reconnect_failed', () => {
      console.warn('⚠️ [Socket.IO Client] All reconnection attempts failed — switching to polling fallback.')
      startRefreshPolling()
      startHeartbeat() // Start DB-backed presence heartbeat
    })

    socketInstance.on('reconnect', (attemptNumber) => {
      console.log(`🔄 [Socket.IO Client] Reconnected after ${attemptNumber} attempts`)
      setIsConnected(true)
      socketInstance._hasLoggedError = false // Reset error flag on successful reconnect

      // Re-authenticate after reconnection
      if (userId) {
        socketInstance.emit('authenticate', {
          userId,
          employeeId,
          tenantDatabaseName
        })
      }
    })

    // Handle new-notification events from scheduled/recurring notifications
    // CRITICAL: Wrapped in try-catch to prevent app crashes
    socketInstance.on('new-notification', (data) => {
      try {
        console.log('🔔 [Socket.IO Client] New notification received:', data)

        // Safely extract data with defaults
        const title = data?.title || 'New Notification'
        const message = data?.message || ''

        // Show toast notification
        toast.custom((t) => (
          <div
            className={`${t.visible ? 'animate-enter' : 'animate-leave'
              } max-w-md w-full bg-white shadow-lg rounded-lg pointer-events-auto flex ring-1 ring-black ring-opacity-5`}
          >
            <div className="flex-1 w-0 p-4">
              <div className="flex items-start">
                <div className="flex-shrink-0 pt-0.5">
                  <div className="h-10 w-10 rounded-full bg-blue-500 flex items-center justify-center">
                    <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                    </svg>
                  </div>
                </div>
                <div className="ml-3 flex-1">
                  <p className="text-sm font-medium text-gray-900">
                    {title}
                  </p>
                  <p className="mt-1 text-sm text-gray-500">
                    {message}
                  </p>
                </div>
              </div>
            </div>
            <div className="flex border-l border-gray-200">
              <button
                onClick={() => toast.dismiss(t.id)}
                className="w-full border border-transparent rounded-none rounded-r-lg p-4 flex items-center justify-center text-sm font-medium text-blue-600 hover:text-blue-500 focus:outline-none"
              >
                Close
              </button>
            </div>
          </div>
        ), {
          duration: 5000,
          position: 'top-right',
        })
      } catch (error) {
        console.error('❌ [Socket.IO Client] Error handling notification:', error)
      }
    })

    // Handle force-refresh events from admin
    // Uses shared handler that works for both Socket.IO and polling
    socketInstance.on('force-refresh', handleForceRefresh)

    setSocket(socketInstance)

    // Expose socket globally for MIRA to use
    window.__MIRA_SOCKET__ = socketInstance

    // Cleanup on unmount
    return () => {
      stopRefreshPolling()
      stopHeartbeat()
      if (socketInstance) {
        socketInstance.disconnect()
      }
      // Clean up global reference
      if (window.__MIRA_SOCKET__ === socketInstance) {
        delete window.__MIRA_SOCKET__
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Join a chat room
  const joinChat = useCallback((chatId) => {
    if (socket && isConnected) {
      socket.emit('join-chat', chatId)
      console.log(`👤 [Socket.IO Client] Joining chat:${chatId}`)
    }
  }, [socket, isConnected])

  // Leave a chat room
  const leaveChat = useCallback((chatId) => {
    if (socket && isConnected) {
      socket.emit('leave-chat', chatId)
      console.log(`👋 [Socket.IO Client] Leaving chat:${chatId}`)
    }
  }, [socket, isConnected])

  // Join a project room
  const joinProject = useCallback((projectId) => {
    if (socket && isConnected) {
      socket.emit('join-project', projectId)
      console.log(`📂 [Socket.IO Client] Joining project:${projectId}`)
    }
  }, [socket, isConnected])

  // Leave a project room
  const leaveProject = useCallback((projectId) => {
    if (socket && isConnected) {
      socket.emit('leave-project', projectId)
      console.log(`📂 [Socket.IO Client] Leaving project:${projectId}`)
    }
  }, [socket, isConnected])

  // Subscribe to task update events (for real-time sync when project head rejects/updates tasks)
  const onTaskUpdated = useCallback((callback) => {
    if (socket) {
      const wrappedCallback = (data) => {
        try {
          callback(data)
        } catch (error) {
          console.error('[SocketContext] Error in task_updated callback:', error)
        }
      }
      socket.on('task_updated', wrappedCallback)
      return () => socket.off('task_updated', wrappedCallback)
    }
  }, [socket])

  // Send a message
  const sendMessage = useCallback((chatId, message) => {
    if (socket && isConnected) {
      socket.emit('send-message', { chatId, message })
      console.log(`💬 [Socket.IO Client] Sending message to chat:${chatId}`)
    }
  }, [socket, isConnected])

  // Send typing indicator
  const sendTyping = useCallback((chatId, userId, userName) => {
    if (socket && isConnected) {
      socket.emit('typing', { chatId, userId, userName })
    }
  }, [socket, isConnected])

  // Send stop typing indicator
  const sendStopTyping = useCallback((chatId, userId) => {
    if (socket && isConnected) {
      socket.emit('stop-typing', { chatId, userId })
    }
  }, [socket, isConnected])

  // Mark message as read
  const markAsRead = useCallback((chatId, messageId, userId) => {
    if (socket && isConnected) {
      socket.emit('mark-read', { chatId, messageId, userId })
    }
  }, [socket, isConnected])

  // Request presence status for employees
  const requestPresence = useCallback((employeeIds) => {
    if (socket && isConnected) {
      const normalizedIds = Array.isArray(employeeIds)
        ? employeeIds.map(id => id?.toString?.()).filter(Boolean)
        : []
      if (normalizedIds.length === 0) return
      socket.emit('presence-request', { employeeIds: normalizedIds })
    }
  }, [socket, isConnected])

  // Subscribe to presence status responses
  const onPresenceStatus = useCallback((callback) => {
    if (socket) {
      const wrappedCallback = (data) => {
        try {
          callback(data)
        } catch (error) {
          console.error('[SocketContext] Error in presence-status callback:', error)
        }
      }
      socket.on('presence-status', wrappedCallback)
      return () => socket.off('presence-status', wrappedCallback)
    }
    return () => { }
  }, [socket])

  // Subscribe to presence updates
  const onPresenceUpdate = useCallback((callback) => {
    if (socket) {
      const wrappedCallback = (data) => {
        try {
          callback(data)
        } catch (error) {
          console.error('[SocketContext] Error in presence-update callback:', error)
        }
      }
      socket.on('presence-update', wrappedCallback)
      return () => socket.off('presence-update', wrappedCallback)
    }
    return () => { }
  }, [socket])

  // Subscribe to new messages
  // CRITICAL: Callback is wrapped to prevent crashes from propagating
  const onNewMessage = useCallback((callback) => {
    if (socket && isConnected) {
      console.log('[SocketContext] Registering new-message listener, socket connected:', isConnected)
      const wrappedCallback = (data) => {
        try {
          console.log('[SocketContext] new-message event received:', data)
          callback(data)
        } catch (error) {
          console.error('[SocketContext] Error in new-message callback:', error)
        }
      }
      socket.on('new-message', wrappedCallback)
      return () => {
        console.log('[SocketContext] Unregistering new-message listener')
        socket.off('new-message', wrappedCallback)
      }
    } else {
      console.warn('[SocketContext] Socket not available for onNewMessage, connected:', isConnected)
      // Return a noop function to avoid cleanup errors
      return () => { }
    }
  }, [socket, isConnected])

  // Subscribe to typing events
  const onUserTyping = useCallback((callback) => {
    if (socket) {
      const wrappedCallback = (data) => {
        try {
          callback(data)
        } catch (error) {
          console.error('[SocketContext] Error in user-typing callback:', error)
        }
      }
      socket.on('user-typing', wrappedCallback)
      return () => socket.off('user-typing', wrappedCallback)
    }
    return () => { }
  }, [socket])

  // Subscribe to stop typing events
  const onUserStopTyping = useCallback((callback) => {
    if (socket) {
      const wrappedCallback = (data) => {
        try {
          callback(data)
        } catch (error) {
          console.error('[SocketContext] Error in user-stop-typing callback:', error)
        }
      }
      socket.on('user-stop-typing', wrappedCallback)
      return () => socket.off('user-stop-typing', wrappedCallback)
    }
    return () => { }
  }, [socket])

  // Subscribe to user joined events
  const onUserJoined = useCallback((callback) => {
    if (socket) {
      const wrappedCallback = (data) => {
        try {
          callback(data)
        } catch (error) {
          console.error('[SocketContext] Error in user-joined callback:', error)
        }
      }
      socket.on('user-joined', wrappedCallback)
      return () => socket.off('user-joined', wrappedCallback)
    }
    return () => { }
  }, [socket])

  // Subscribe to user left events
  const onUserLeft = useCallback((callback) => {
    if (socket) {
      const wrappedCallback = (data) => {
        try {
          callback(data)
        } catch (error) {
          console.error('[SocketContext] Error in user-left callback:', error)
        }
      }
      socket.on('user-left', wrappedCallback)
      return () => socket.off('user-left', wrappedCallback)
    }
    return () => { }
  }, [socket])

  // Subscribe to message read events
  const onMessageRead = useCallback((callback) => {
    if (socket) {
      const wrappedCallback = (data) => {
        try {
          callback(data)
        } catch (error) {
          console.error('[SocketContext] Error in message-read callback:', error)
        }
      }
      socket.on('message-read', wrappedCallback)
      return () => socket.off('message-read', wrappedCallback)
    }
    return () => { }
  }, [socket])

  // Subscribe to task update events
  const onTaskUpdate = useCallback((callback) => {
    if (socket) {
      const wrappedCallback = (data) => {
        try {
          callback(data)
        } catch (error) {
          console.error('[SocketContext] Error in task-update callback:', error)
        }
      }
      socket.on('task-update', wrappedCallback)
      return () => socket.off('task-update', wrappedCallback)
    }
  }, [socket])

  // Subscribe to announcement events
  const onAnnouncement = useCallback((callback) => {
    if (socket) {
      const wrappedCallback = (data) => {
        try {
          callback(data)
        } catch (error) {
          console.error('[SocketContext] Error in announcement callback:', error)
        }
      }
      socket.on('new-announcement', wrappedCallback)
      return () => socket.off('new-announcement', wrappedCallback)
    }
  }, [socket])

  // Subscribe to message reaction events
  const onMessageReaction = useCallback((callback) => {
    if (socket) {
      const wrappedCallback = (data) => {
        try {
          callback(data)
        } catch (error) {
          console.error('[SocketContext] Error in message-reaction callback:', error)
        }
      }
      socket.on('message-reaction', wrappedCallback)
      return () => socket.off('message-reaction', wrappedCallback)
    }
  }, [socket])

  // Subscribe to message deleted events
  const onMessageDeleted = useCallback((callback) => {
    if (socket) {
      const wrappedCallback = (data) => {
        try {
          callback(data)
        } catch (error) {
          console.error('[SocketContext] Error in message-deleted callback:', error)
        }
      }
      socket.on('message-deleted', wrappedCallback)
      return () => socket.off('message-deleted', wrappedCallback)
    }
  }, [socket])

  // Subscribe to geofence approval events
  const onGeofenceApproval = useCallback((callback) => {
    if (socket) {
      const wrappedCallback = (data) => {
        try {
          callback(data)
        } catch (error) {
          console.error('[SocketContext] Error in geofence-approval callback:', error)
        }
      }
      socket.on('geofence-approval', wrappedCallback)
      return () => socket.off('geofence-approval', wrappedCallback)
    }
  }, [socket])

  // Subscribe to leave status update events
  const onLeaveStatusUpdate = useCallback((callback) => {
    if (socket) {
      const wrappedCallback = (data) => {
        try {
          callback(data)
        } catch (error) {
          console.error('[SocketContext] Error in leave-status-update callback:', error)
        }
      }
      socket.on('leave-status-update', wrappedCallback)
      return () => socket.off('leave-status-update', wrappedCallback)
    }
  }, [socket])

  // Subscribe to expense status update events
  const onExpenseStatusUpdate = useCallback((callback) => {
    if (socket) {
      const wrappedCallback = (data) => {
        try {
          callback(data)
        } catch (error) {
          console.error('[SocketContext] Error in expense-status-update callback:', error)
        }
      }
      socket.on('expense-status-update', wrappedCallback)
      return () => socket.off('expense-status-update', wrappedCallback)
    }
  }, [socket])

  // Subscribe to travel status update events
  const onTravelStatusUpdate = useCallback((callback) => {
    if (socket) {
      const wrappedCallback = (data) => {
        try {
          callback(data)
        } catch (error) {
          console.error('[SocketContext] Error in travel-status-update callback:', error)
        }
      }
      socket.on('travel-status-update', wrappedCallback)
      return () => socket.off('travel-status-update', wrappedCallback)
    }
  }, [socket])

  // Subscribe to project assignment events
  const onProjectAssignment = useCallback((callback) => {
    if (socket) {
      const wrappedCallback = (data) => {
        try {
          callback(data)
        } catch (error) {
          console.error('[SocketContext] Error in project-assignment callback:', error)
        }
      }
      socket.on('project-assignment', wrappedCallback)
      return () => socket.off('project-assignment', wrappedCallback)
    }
  }, [socket])

  // Subscribe to performance review events
  const onPerformanceReview = useCallback((callback) => {
    if (socket) {
      const wrappedCallback = (data) => {
        try {
          callback(data)
        } catch (error) {
          console.error('[SocketContext] Error in performance-review callback:', error)
        }
      }
      socket.on('performance-review', wrappedCallback)
      return () => socket.off('performance-review', wrappedCallback)
    }
  }, [socket])

  // Subscribe to helpdesk ticket events
  const onHelpdeskTicket = useCallback((callback) => {
    if (socket) {
      const wrappedCallback = (data) => {
        try {
          callback(data)
        } catch (error) {
          console.error('[SocketContext] Error in helpdesk-ticket callback:', error)
        }
      }
      socket.on('helpdesk-ticket', wrappedCallback)
      return () => socket.off('helpdesk-ticket', wrappedCallback)
    }
  }, [socket])

  // Subscribe to document events
  const onDocumentUpdate = useCallback((callback) => {
    if (socket) {
      const wrappedCallback = (data) => {
        try {
          callback(data)
        } catch (error) {
          console.error('[SocketContext] Error in document-update callback:', error)
        }
      }
      socket.on('document-update', wrappedCallback)
      return () => socket.off('document-update', wrappedCallback)
    }
  }, [socket])

  // Subscribe to asset events
  const onAssetUpdate = useCallback((callback) => {
    if (socket) {
      const wrappedCallback = (data) => {
        try {
          callback(data)
        } catch (error) {
          console.error('[SocketContext] Error in asset-update callback:', error)
        }
      }
      socket.on('asset-update', wrappedCallback)
      return () => socket.off('asset-update', wrappedCallback)
    }
  }, [socket])

  // Subscribe to payroll events
  const onPayrollUpdate = useCallback((callback) => {
    if (socket) {
      const wrappedCallback = (data) => {
        try {
          callback(data)
        } catch (error) {
          console.error('[SocketContext] Error in payroll-update callback:', error)
        }
      }
      socket.on('payroll-update', wrappedCallback)
      return () => socket.off('payroll-update', wrappedCallback)
    }
  }, [socket])

  // Subscribe to new notification events (for scheduled/recurring notifications)
  const onNewNotification = useCallback((callback) => {
    if (socket) {
      const wrappedCallback = (data) => {
        try {
          callback(data)
        } catch (error) {
          console.error('[SocketContext] Error in new-notification callback:', error)
        }
      }
      socket.on('new-notification', wrappedCallback)
      return () => socket.off('new-notification', wrappedCallback)
    }
  }, [socket])

  // Subscribe to call alert events
  const onCallAlert = useCallback((callback) => {
    if (socket) {
      const wrappedCallback = (data) => {
        try {
          callback(data)
        } catch (error) {
          console.error('[SocketContext] Error in call-alert callback:', error)
        }
      }
      socket.on('call-alert', wrappedCallback)
      return () => socket.off('call-alert', wrappedCallback)
    }
  }, [socket])

  // Subscribe to call alert acknowledged events
  const onCallAlertAcknowledged = useCallback((callback) => {
    if (socket) {
      const wrappedCallback = (data) => {
        try {
          callback(data)
        } catch (error) {
          console.error('[SocketContext] Error in call-alert-acknowledged callback:', error)
        }
      }
      socket.on('call-alert-acknowledged', wrappedCallback)
      return () => socket.off('call-alert-acknowledged', wrappedCallback)
    }
  }, [socket])

  // Subscribe to attendance update events
  const onAttendanceUpdate = useCallback((callback) => {
    if (socket) {
      const wrappedCallback = (data) => {
        try {
          callback(data)
        } catch (error) {
          console.error('[SocketContext] Error in attendance-update callback:', error)
        }
      }
      socket.on(REALTIME_EVENTS.ATTENDANCE_UPDATE, wrappedCallback)
      return () => socket.off(REALTIME_EVENTS.ATTENDANCE_UPDATE, wrappedCallback)
    }
    return () => { }
  }, [socket])

  // Subscribe to leave request events
  const onLeaveRequest = useCallback((callback) => {
    if (socket) {
      const wrappedCallback = (data) => {
        try {
          callback(data)
        } catch (error) {
          console.error('[SocketContext] Error in leave-request callback:', error)
        }
      }
      socket.on(REALTIME_EVENTS.LEAVE_REQUEST, wrappedCallback)
      return () => socket.off(REALTIME_EVENTS.LEAVE_REQUEST, wrappedCallback)
    }
    return () => { }
  }, [socket])

  // Subscribe to project created events
  const onProjectCreated = useCallback((callback) => {
    if (socket) {
      const wrappedCallback = (data) => {
        try {
          callback(data)
        } catch (error) {
          console.error('[SocketContext] Error in project-created callback:', error)
        }
      }
      socket.on(REALTIME_EVENTS.PROJECT_CREATED, wrappedCallback)
      return () => socket.off(REALTIME_EVENTS.PROJECT_CREATED, wrappedCallback)
    }
    return () => { }
  }, [socket])

  // Subscribe to project updated events
  const onProjectUpdated = useCallback((callback) => {
    if (socket) {
      const wrappedCallback = (data) => {
        try {
          callback(data)
        } catch (error) {
          console.error('[SocketContext] Error in project-updated callback:', error)
        }
      }
      socket.on(REALTIME_EVENTS.PROJECT_UPDATED, wrappedCallback)
      return () => socket.off(REALTIME_EVENTS.PROJECT_UPDATED, wrappedCallback)
    }
    return () => { }
  }, [socket])

  // Subscribe to task created events
  const onTaskCreated = useCallback((callback) => {
    if (socket) {
      const wrappedCallback = (data) => {
        try {
          callback(data)
        } catch (error) {
          console.error('[SocketContext] Error in task-created callback:', error)
        }
      }
      socket.on(REALTIME_EVENTS.TASK_CREATED, wrappedCallback)
      return () => socket.off(REALTIME_EVENTS.TASK_CREATED, wrappedCallback)
    }
    return () => { }
  }, [socket])

  // Subscribe to task status changed events
  const onTaskStatusChanged = useCallback((callback) => {
    if (socket) {
      const wrappedCallback = (data) => {
        try {
          callback(data)
        } catch (error) {
          console.error('[SocketContext] Error in task-status-changed callback:', error)
        }
      }
      socket.on(REALTIME_EVENTS.TASK_STATUS_CHANGED, wrappedCallback)
      return () => socket.off(REALTIME_EVENTS.TASK_STATUS_CHANGED, wrappedCallback)
    }
    return () => { }
  }, [socket])

  // Subscribe to employee created events
  const onEmployeeCreated = useCallback((callback) => {
    if (socket) {
      const wrappedCallback = (data) => {
        try {
          callback(data)
        } catch (error) {
          console.error('[SocketContext] Error in employee-created callback:', error)
        }
      }
      socket.on(REALTIME_EVENTS.EMPLOYEE_CREATED, wrappedCallback)
      return () => socket.off(REALTIME_EVENTS.EMPLOYEE_CREATED, wrappedCallback)
    }
    return () => { }
  }, [socket])

  // Subscribe to employee updated events
  const onEmployeeUpdated = useCallback((callback) => {
    if (socket) {
      const wrappedCallback = (data) => {
        try {
          callback(data)
        } catch (error) {
          console.error('[SocketContext] Error in employee-updated callback:', error)
        }
      }
      socket.on(REALTIME_EVENTS.EMPLOYEE_UPDATED, wrappedCallback)
      return () => socket.off(REALTIME_EVENTS.EMPLOYEE_UPDATED, wrappedCallback)
    }
    return () => { }
  }, [socket])

  // Subscribe to dashboard refresh events
  const onDashboardRefresh = useCallback((callback) => {
    if (socket) {
      const wrappedCallback = (data) => {
        try {
          callback(data)
        } catch (error) {
          console.error('[SocketContext] Error in dashboard-refresh callback:', error)
        }
      }
      socket.on(REALTIME_EVENTS.DASHBOARD_REFRESH, wrappedCallback)
      return () => socket.off(REALTIME_EVENTS.DASHBOARD_REFRESH, wrappedCallback)
    }
    return () => { }
  }, [socket])

  // Subscribe to meeting events
  const onMeetingUpdate = useCallback((callback) => {
    if (socket) {
      const wrappedCallback = (data) => {
        try {
          callback(data)
        } catch (error) {
          console.error('[SocketContext] Error in meeting-update callback:', error)
        }
      }
      socket.on(REALTIME_EVENTS.MEETING_CREATED, wrappedCallback)
      socket.on(REALTIME_EVENTS.MEETING_UPDATED, wrappedCallback)
      socket.on(REALTIME_EVENTS.MEETING_CANCELLED, wrappedCallback)
      return () => {
        socket.off(REALTIME_EVENTS.MEETING_CREATED, wrappedCallback)
        socket.off(REALTIME_EVENTS.MEETING_UPDATED, wrappedCallback)
        socket.off(REALTIME_EVENTS.MEETING_CANCELLED, wrappedCallback)
      }
    }
    return () => { }
  }, [socket])

  // Subscribe to announcement events
  const onAnnouncementUpdate = useCallback((callback) => {
    if (socket) {
      const wrappedCallback = (data) => {
        try {
          callback(data)
        } catch (error) {
          console.error('[SocketContext] Error in announcement-update callback:', error)
        }
      }
      socket.on(REALTIME_EVENTS.ANNOUNCEMENT_CREATED, wrappedCallback)
      socket.on(REALTIME_EVENTS.ANNOUNCEMENT_UPDATED, wrappedCallback)
      return () => {
        socket.off(REALTIME_EVENTS.ANNOUNCEMENT_CREATED, wrappedCallback)
        socket.off(REALTIME_EVENTS.ANNOUNCEMENT_UPDATED, wrappedCallback)
      }
    }
    return () => { }
  }, [socket])

  // Subscribe to holiday update events
  const onHolidayUpdate = useCallback((callback) => {
    if (socket) {
      const wrappedCallback = (data) => {
        try {
          callback(data)
        } catch (error) {
          console.error('[SocketContext] Error in holiday-update callback:', error)
        }
      }
      socket.on(REALTIME_EVENTS.HOLIDAY_UPDATE, wrappedCallback)
      return () => socket.off(REALTIME_EVENTS.HOLIDAY_UPDATE, wrappedCallback)
    }
    return () => { }
  }, [socket])

  // Generic subscribe function for any event
  const subscribe = useCallback((eventName, callback) => {
    if (socket) {
      const wrappedCallback = (data) => {
        try {
          callback(data)
        } catch (error) {
          console.error(`[SocketContext] Error in ${eventName} callback:`, error)
        }
      }
      socket.on(eventName, wrappedCallback)
      return () => socket.off(eventName, wrappedCallback)
    }
    return () => { }
  }, [socket])

  const value = {
    socket,
    isConnected,
    currentUserId,
    currentEmployeeId,
    joinChat,
    leaveChat,
    joinProject,
    leaveProject,
    sendMessage,
    sendTyping,
    sendStopTyping,
    markAsRead,
    requestPresence,
    onPresenceStatus,
    onPresenceUpdate,
    onNewMessage,
    onUserTyping,
    onUserStopTyping,
    onUserJoined,
    onUserLeft,
    onMessageRead,
    onTaskUpdate,
    onTaskUpdated,
    onAnnouncement,
    onMessageReaction,
    onMessageDeleted,
    onGeofenceApproval,
    onLeaveStatusUpdate,
    onExpenseStatusUpdate,
    onTravelStatusUpdate,
    onProjectAssignment,
    onPerformanceReview,
    onHelpdeskTicket,
    onDocumentUpdate,
    onAssetUpdate,
    onPayrollUpdate,
    onNewNotification,
    onCallAlert,
    onCallAlertAcknowledged,
    // New real-time event subscriptions
    onAttendanceUpdate,
    onLeaveRequest,
    onProjectCreated,
    onProjectUpdated,
    onTaskCreated,
    onTaskStatusChanged,
    onEmployeeCreated,
    onEmployeeUpdated,
    onDashboardRefresh,
    onMeetingUpdate,
    onAnnouncementUpdate,
    onHolidayUpdate,
    subscribe,
    // Export event constants for components to use
    REALTIME_EVENTS,
  }

  return (
    <SocketContext.Provider value={value}>
      {children}
    </SocketContext.Provider>
  )
}

export function useSocket() {
  const context = useContext(SocketContext)
  if (!context) {
    throw new Error('useSocket must be used within a SocketProvider')
  }
  return context
}

