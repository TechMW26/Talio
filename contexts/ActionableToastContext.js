'use client'

import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import { useSocket } from './SocketContext'
import ActionableToast from '@/components/ActionableToast'
import { playNotificationSound, NotificationSoundTypes } from '@/lib/notificationSounds'

const ActionableToastContext = createContext({
  notifications: [],
  showActionableToast: () => {},
  dismissNotification: () => {},
  executeAction: () => {},
  refreshNotifications: () => {},
  pendingCount: 0
})

export function ActionableToastProvider({ children }) {
  const [notifications, setNotifications] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const { socket, isConnected, subscribe } = useSocket()
  const hasFetchedRef = useRef(false)

  // Fetch pending notifications on mount
  const fetchPendingNotifications = useCallback(async () => {
    try {
      const token = localStorage.getItem('token')
      if (!token) {
        setIsLoading(false)
        return
      }

      const response = await fetch('/api/actionable-notifications', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      if (response.ok) {
        const data = await response.json()
        if (data.success && data.notifications) {
          setNotifications(data.notifications)
        }
      }
    } catch (error) {
      console.error('[ActionableToast] Error fetching notifications:', error)
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Initial fetch
  useEffect(() => {
    // Only fetch once on mount
    if (!hasFetchedRef.current) {
      hasFetchedRef.current = true
      fetchPendingNotifications()
    }
  }, [fetchPendingNotifications])

  // Listen for new actionable notifications via Socket.IO
  useEffect(() => {
    if (!socket || !isConnected) return

    const handleNewNotification = (data) => {
      try {
        console.log('[ActionableToast] New notification received:', data)
        
        if (data?.notification) {
          setNotifications(prev => {
            // Check if notification already exists
            const exists = prev.some(n => n._id === data.notification._id)
            if (exists) return prev
            return [data.notification, ...prev]
          })

          // Play notification sound based on notification type
          if (data.notification.displaySettings?.playSound !== false) {
            try {
              // Map notification type to sound
              const soundMap = {
                project_invitation: NotificationSoundTypes.ALERT,
                task_assignment: NotificationSoundTypes.ALERT,
                meeting_invitation: NotificationSoundTypes.CHIME,
                leave_approval: NotificationSoundTypes.URGENT,
                expense_approval: NotificationSoundTypes.CHIME,
                travel_approval: NotificationSoundTypes.CHIME,
                announcement: NotificationSoundTypes.POP,
                custom: NotificationSoundTypes.CHIME,
              }
              const soundType = soundMap[data.notification.type] || NotificationSoundTypes.CHIME
              playNotificationSound(soundType)
            } catch (err) {
              console.warn('[ActionableToast] Sound failed:', err)
            }
          }
        }
      } catch (error) {
        console.error('[ActionableToast] Error handling notification:', error)
      }
    }

    const handleNotificationUpdated = (data) => {
      try {
        console.log('[ActionableToast] Notification updated:', data)
        
        if (data?.notificationId) {
          setNotifications(prev => 
            prev.filter(n => n._id !== data.notificationId)
          )
        }
      } catch (error) {
        console.error('[ActionableToast] Error handling update:', error)
      }
    }

    const handleNotificationRemoved = (data) => {
      try {
        if (data?.notificationId) {
          setNotifications(prev => 
            prev.filter(n => n._id !== data.notificationId)
          )
        }
      } catch (error) {
        console.error('[ActionableToast] Error handling removal:', error)
      }
    }

    // Subscribe to events
    socket.on('actionable-notification', handleNewNotification)
    socket.on('actionable-notification-updated', handleNotificationUpdated)
    socket.on('actionable-notification-removed', handleNotificationRemoved)

    return () => {
      socket.off('actionable-notification', handleNewNotification)
      socket.off('actionable-notification-updated', handleNotificationUpdated)
      socket.off('actionable-notification-removed', handleNotificationRemoved)
    }
  }, [socket, isConnected])

  // Show a new actionable toast (for local creation)
  const showActionableToast = useCallback((notification) => {
    setNotifications(prev => {
      const exists = prev.some(n => n._id === notification._id)
      if (exists) return prev
      return [notification, ...prev]
    })
  }, [])

  // Dismiss a notification
  const dismissNotification = useCallback(async (notificationId) => {
    try {
      const token = localStorage.getItem('token')
      if (!token) return

      // Optimistic update
      setNotifications(prev => prev.filter(n => n._id !== notificationId))

      await fetch(`/api/actionable-notifications/${notificationId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ action: 'dismiss' })
      })
    } catch (error) {
      console.error('[ActionableToast] Error dismissing notification:', error)
      // Refetch on error
      fetchPendingNotifications()
    }
  }, [fetchPendingNotifications])

  // Execute an action on a notification
  const executeAction = useCallback(async (notificationId, actionId, reason = null) => {
    try {
      const token = localStorage.getItem('token')
      if (!token) return { success: false, message: 'Not authenticated' }

      const response = await fetch(`/api/actionable-notifications/${notificationId}/action`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ actionId, reason })
      })

      const result = await response.json()

      if (response.ok && result.success) {
        // Remove from local state
        setNotifications(prev => prev.filter(n => n._id !== notificationId))
        return result
      }

      return { success: false, message: result.message || 'Action failed' }
    } catch (error) {
      console.error('[ActionableToast] Error executing action:', error)
      return { success: false, message: error.message }
    }
  }, [])

  // Refresh notifications manually
  const refreshNotifications = useCallback(() => {
    fetchPendingNotifications()
  }, [fetchPendingNotifications])

  const pendingCount = notifications.filter(n => n.status === 'pending').length

  const value = {
    notifications,
    showActionableToast,
    dismissNotification,
    executeAction,
    refreshNotifications,
    pendingCount,
    isLoading
  }

  return (
    <ActionableToastContext.Provider value={value}>
      {children}
      {/* Render actionable toasts - higher z-index than regular notifications */}
      <div 
        className="fixed bottom-4 right-4 pointer-events-none" 
        style={{ zIndex: 2147483649 }}
      >
        <div className="flex flex-col-reverse gap-3 pointer-events-auto max-w-md">
          {notifications.slice(0, 5).map((notification) => (
            <ActionableToast
              key={notification._id}
              notification={notification}
              onDismiss={() => dismissNotification(notification._id)}
              onAction={(actionId, reason) => executeAction(notification._id, actionId, reason)}
            />
          ))}
        </div>
      </div>
    </ActionableToastContext.Provider>
  )
}

export function useActionableToast() {
  const context = useContext(ActionableToastContext)
  if (!context) {
    throw new Error('useActionableToast must be used within ActionableToastProvider')
  }
  return context
}
