'use client'

import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { io } from 'socket.io-client'
import toast from '@/utils/toast'

const SocketContext = createContext()

export function SocketProvider({ children }) {
  const [socket, setSocket] = useState(null)
  const [isConnected, setIsConnected] = useState(false)
  const [currentUserId, setCurrentUserId] = useState(null)

  useEffect(() => {
    // Get user ID from localStorage
    const userData = localStorage.getItem('user')
    let userId = null
    if (userData) {
      const user = JSON.parse(userData)
      // Use the User's _id (not employeeId) for socket authentication
      // This matches how notifications are stored in the database
      userId = user.userId || user._id || user.id
      // Ensure it's a string
      if (typeof userId === 'object' && userId._id) {
        userId = userId._id
      }
      userId = userId?.toString()
      setCurrentUserId(userId)
      console.log('🔑 [Socket.IO Client] User ID for notifications:', userId)
    }

    // Initialize Socket.IO connection
    // Use window.location.origin to connect to the same server
    const socketInstance = io(window.location.origin, {
      path: '/api/socketio',
      transports: ['websocket', 'polling'], // Try websocket first, then fall back to polling
      reconnection: true,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 10000,
      reconnectionAttempts: 5, // Reduce attempts to avoid console spam
      timeout: 20000,
      autoConnect: true,
      forceNew: false
    })

    // Connection event handlers
    socketInstance.on('connect', () => {
      console.log('✅ [Socket.IO Client] Connected:', socketInstance.id)
      setIsConnected(true)

      // Authenticate user if we have userId
      if (userId) {
        socketInstance.emit('authenticate', userId)
      }
    })

    socketInstance.on('disconnect', () => {
      console.log('❌ [Socket.IO Client] Disconnected')
      setIsConnected(false)
    })

    socketInstance.on('connect_error', (error) => {
      // Only log once, not on every retry to avoid console spam
      if (!socketInstance._hasLoggedError) {
        console.warn('⚠️ [Socket.IO Client] Connection error - server may not be running. Use "npm run dev" for Socket.IO support.')
        socketInstance._hasLoggedError = true
      }
      setIsConnected(false)
    })

    socketInstance.on('reconnect', (attemptNumber) => {
      console.log(`🔄 [Socket.IO Client] Reconnected after ${attemptNumber} attempts`)
      setIsConnected(true)
      socketInstance._hasLoggedError = false // Reset error flag on successful reconnect

      // Re-authenticate after reconnection
      if (userId) {
        socketInstance.emit('authenticate', userId)
      }
    })

    // Handle new-notification events from scheduled/recurring notifications
    socketInstance.on('new-notification', (data) => {
      console.log('🔔 [Socket.IO Client] New notification received:', data)

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
                  {data.title || 'New Notification'}
                </p>
                <p className="mt-1 text-sm text-gray-500">
                  {data.message || ''}
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
    })

    setSocket(socketInstance)

    // Expose socket globally for MAYA to use
    window.__MAYA_SOCKET__ = socketInstance

    // Cleanup on unmount
    return () => {
      if (socketInstance) {
        socketInstance.disconnect()
      }
      // Clean up global reference
      if (window.__MAYA_SOCKET__ === socketInstance) {
        delete window.__MAYA_SOCKET__
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
      socket.on('task_updated', callback)
      return () => socket.off('task_updated', callback)
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

  // Subscribe to new messages
  const onNewMessage = useCallback((callback) => {
    if (socket && isConnected) {
      console.log('[SocketContext] Registering new-message listener, socket connected:', isConnected)
      const wrappedCallback = (data) => {
        console.log('[SocketContext] new-message event received:', data)
        callback(data)
      }
      socket.on('new-message', wrappedCallback)
      return () => {
        console.log('[SocketContext] Unregistering new-message listener')
        socket.off('new-message', wrappedCallback)
      }
    } else {
      console.warn('[SocketContext] Socket not available for onNewMessage, connected:', isConnected)
      // Return a noop function to avoid cleanup errors
      return () => {}
    }
  }, [socket, isConnected])

  // Subscribe to typing events
  const onUserTyping = useCallback((callback) => {
    if (socket) {
      socket.on('user-typing', callback)
      return () => socket.off('user-typing', callback)
    }
    return () => {}
  }, [socket])

  // Subscribe to stop typing events
  const onUserStopTyping = useCallback((callback) => {
    if (socket) {
      socket.on('user-stop-typing', callback)
      return () => socket.off('user-stop-typing', callback)
    }
    return () => {}
  }, [socket])

  // Subscribe to user joined events
  const onUserJoined = useCallback((callback) => {
    if (socket) {
      socket.on('user-joined', callback)
      return () => socket.off('user-joined', callback)
    }
    return () => {}
  }, [socket])

  // Subscribe to user left events
  const onUserLeft = useCallback((callback) => {
    if (socket) {
      socket.on('user-left', callback)
      return () => socket.off('user-left', callback)
    }
    return () => {}
  }, [socket])

  // Subscribe to message read events
  const onMessageRead = useCallback((callback) => {
    if (socket) {
      socket.on('message-read', callback)
      return () => socket.off('message-read', callback)
    }
    return () => {}
  }, [socket])

  // Subscribe to task update events
  const onTaskUpdate = useCallback((callback) => {
    if (socket) {
      socket.on('task-update', callback)
      return () => socket.off('task-update', callback)
    }
  }, [socket])

  // Subscribe to announcement events
  const onAnnouncement = useCallback((callback) => {
    if (socket) {
      socket.on('new-announcement', callback)
      return () => socket.off('new-announcement', callback)
    }
  }, [socket])

  // Subscribe to message reaction events
  const onMessageReaction = useCallback((callback) => {
    if (socket) {
      socket.on('message-reaction', callback)
      return () => socket.off('message-reaction', callback)
    }
  }, [socket])

  // Subscribe to message deleted events
  const onMessageDeleted = useCallback((callback) => {
    if (socket) {
      socket.on('message-deleted', callback)
      return () => socket.off('message-deleted', callback)
    }
  }, [socket])

  // Subscribe to geofence approval events
  const onGeofenceApproval = useCallback((callback) => {
    if (socket) {
      socket.on('geofence-approval', callback)
      return () => socket.off('geofence-approval', callback)
    }
  }, [socket])

  // Subscribe to leave status update events
  const onLeaveStatusUpdate = useCallback((callback) => {
    if (socket) {
      socket.on('leave-status-update', callback)
      return () => socket.off('leave-status-update', callback)
    }
  }, [socket])

  // Subscribe to expense status update events
  const onExpenseStatusUpdate = useCallback((callback) => {
    if (socket) {
      socket.on('expense-status-update', callback)
      return () => socket.off('expense-status-update', callback)
    }
  }, [socket])

  // Subscribe to travel status update events
  const onTravelStatusUpdate = useCallback((callback) => {
    if (socket) {
      socket.on('travel-status-update', callback)
      return () => socket.off('travel-status-update', callback)
    }
  }, [socket])

  // Subscribe to project assignment events
  const onProjectAssignment = useCallback((callback) => {
    if (socket) {
      socket.on('project-assignment', callback)
      return () => socket.off('project-assignment', callback)
    }
  }, [socket])

  // Subscribe to performance review events
  const onPerformanceReview = useCallback((callback) => {
    if (socket) {
      socket.on('performance-review', callback)
      return () => socket.off('performance-review', callback)
    }
  }, [socket])

  // Subscribe to helpdesk ticket events
  const onHelpdeskTicket = useCallback((callback) => {
    if (socket) {
      socket.on('helpdesk-ticket', callback)
      return () => socket.off('helpdesk-ticket', callback)
    }
  }, [socket])

  // Subscribe to document events
  const onDocumentUpdate = useCallback((callback) => {
    if (socket) {
      socket.on('document-update', callback)
      return () => socket.off('document-update', callback)
    }
  }, [socket])

  // Subscribe to asset events
  const onAssetUpdate = useCallback((callback) => {
    if (socket) {
      socket.on('asset-update', callback)
      return () => socket.off('asset-update', callback)
    }
  }, [socket])

  // Subscribe to payroll events
  const onPayrollUpdate = useCallback((callback) => {
    if (socket) {
      socket.on('payroll-update', callback)
      return () => socket.off('payroll-update', callback)
    }
  }, [socket])

  // Subscribe to new notification events (for scheduled/recurring notifications)
  const onNewNotification = useCallback((callback) => {
    if (socket) {
      socket.on('new-notification', callback)
      return () => socket.off('new-notification', callback)
    }
  }, [socket])

  // Subscribe to call alert events
  const onCallAlert = useCallback((callback) => {
    if (socket) {
      socket.on('call-alert', callback)
      return () => socket.off('call-alert', callback)
    }
  }, [socket])

  // Subscribe to call alert acknowledged events
  const onCallAlertAcknowledged = useCallback((callback) => {
    if (socket) {
      socket.on('call-alert-acknowledged', callback)
      return () => socket.off('call-alert-acknowledged', callback)
    }
  }, [socket])

  const value = {
    socket,
    isConnected,
    currentUserId,
    joinChat,
    leaveChat,
    joinProject,
    leaveProject,
    sendMessage,
    sendTyping,
    sendStopTyping,
    markAsRead,
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
    onCallAlertAcknowledged
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

