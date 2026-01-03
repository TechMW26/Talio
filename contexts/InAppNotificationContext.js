'use client'

import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import InAppNotification from '@/components/InAppNotification'
import { useSocket } from './SocketContext'
import { playNotificationSound, playMessageNotificationSound, playTaskDoneSound } from '@/utils/audio'

const InAppNotificationContext = createContext({
  showNotification: () => { }
})

export function InAppNotificationProvider({ children }) {
  const [notifications, setNotifications] = useState([])
  const {
    socket,
    isConnected,
    onNewMessage,
    onTaskUpdate,
    onAnnouncement,
    onGeofenceApproval,
    onLeaveStatusUpdate,
    onExpenseStatusUpdate,
    onTravelStatusUpdate,
    onProjectAssignment,
    onPerformanceReview,
    onHelpdeskTicket,
    onDocumentUpdate,
    onAssetUpdate,
    onPayrollUpdate
  } = useSocket()
  const pathname = usePathname()

  const showNotification = useCallback((notification, playSoundEffect = true) => {
    const id = Date.now() + Math.random()
    const newNotification = { ...notification, id }

    setNotifications(prev => [...prev, newNotification])

    // Play appropriate sound based on notification type
    if (playSoundEffect && notification.type !== 'message') {
      // Play task done sound for completions and approvals
      if (
        notification.type === 'task_completed' ||
        notification.type === 'project_completed' ||
        notification.type === 'project_approved' ||
        notification.type === 'task_approved' ||
        notification.soundType === 'taskDone'
      ) {
        playTaskDoneSound().catch((err) => {
          console.warn('[InAppNotification] Task done sound failed:', err)
        })
      } else {
        // Default notification sound
        playNotificationSound().catch((err) => {
          console.warn('[InAppNotification] Notification sound failed:', err)
        })
      }
    }
  }, [])

  const removeNotification = useCallback((id) => {
    setNotifications(prev => prev.filter(n => n.id !== id))
  }, [])

  // Listen for new messages via Socket.IO
  // CRITICAL: All message handling wrapped in try-catch to prevent crashes
  useEffect(() => {
    // Wait for socket to be connected
    if (!socket || !isConnected) {
      console.log('[InAppNotification] Socket not connected yet, isConnected:', isConnected)
      return
    }

    if (!onNewMessage) {
      console.log('[InAppNotification] onNewMessage not available yet')
      return
    }

    console.log('[InAppNotification] Setting up message listener, socket connected:', isConnected)

    const unsubscribe = onNewMessage((data) => {
      try {
        console.log('[InAppNotification] Raw message data received:', data)

        // Safely destructure with defaults
        const chatId = data?.chatId
        const message = data?.message
        const senderId = data?.senderId

        if (!message) {
          console.warn('[InAppNotification] No message in data')
          return
        }

        // Get current user ID
        const userStr = localStorage.getItem('user')
        if (!userStr) {
          console.warn('[InAppNotification] No user in localStorage')
          return
        }

        let user
        try {
          user = JSON.parse(userStr)
        } catch (parseError) {
          console.error('[InAppNotification] Error parsing user data:', parseError)
          return
        }

        const currentUserId = user?.employeeId || user?._id

        if (!currentUserId) {
          console.warn('[InAppNotification] No currentUserId found')
          return
        }

        // Normalize IDs to strings for comparison - with safe access
        let currentUserIdStr = ''
        try {
          currentUserIdStr = typeof currentUserId === 'object'
            ? (currentUserId?._id || currentUserId?.toString?.() || '')
            : String(currentUserId || '')
        } catch (e) {
          currentUserIdStr = ''
        }

        const messageSenderId = senderId || message?.sender?._id || message?.sender
        let messageSenderIdStr = ''
        try {
          messageSenderIdStr = typeof messageSenderId === 'object'
            ? (messageSenderId?._id || messageSenderId?.toString?.() || '')
            : String(messageSenderId || '')
        } catch (e) {
          messageSenderIdStr = ''
        }

        // Only show notification if:
        // 1. Message is NOT from current user
        // 2. User is NOT on the chat page OR not viewing this specific chat
        const isOnChatPage = pathname?.startsWith('/dashboard/chat') || false
        const isFromCurrentUser = currentUserIdStr && messageSenderIdStr && (messageSenderIdStr === currentUserIdStr)
        const shouldShowNotification = !isFromCurrentUser && !isOnChatPage

        console.log('[InAppNotification] Message received:', {
          chatId,
          currentUserId: currentUserIdStr,
          messageSenderId: messageSenderIdStr,
          isFromCurrentUser,
          isOnChatPage,
          shouldShowNotification,
          pathname
        })

        if (shouldShowNotification) {
          // Safely get sender name
          const senderFirstName = message?.sender?.firstName || ''
          const senderLastName = message?.sender?.lastName || ''
          const senderName = senderFirstName
            ? `${senderFirstName} ${senderLastName}`.trim()
            : 'Someone'

          // Build chat data for opening chat widget directly
          const chatData = {
            _id: chatId,
            // Include participant info from sender for display
            participants: message?.sender ? [message.sender] : [],
            senderInfo: message?.sender || null
          }

          // Safely get message content
          const messageContent = message?.content || message?.text || message?.fileName || 'Sent a message'

          const notificationData = {
            title: `New message from ${senderName}`,
            message: messageContent,
            url: `/dashboard/chat?chatId=${chatId}`,
            type: 'message',
            // Include chat data so clicking notification can open chat widget
            chatId: chatId,
            chatData: chatData,
            senderInfo: message?.sender || null
          }

          console.log('[InAppNotification] Showing notification:', notificationData)

          // Play message notification sound (MP3 on desktop)
          playMessageNotificationSound().catch((err) => {
            console.warn('[InAppNotification] Message notification sound failed:', err)
          })

          // Show notification without playing default sound (we just played the MP3)
          showNotification(notificationData, false)
        } else {
          console.log('[InAppNotification] Not showing notification - conditions not met')
        }
      } catch (error) {
        // CRITICAL: Catch ALL errors to prevent app crash
        console.error('[InAppNotification] Error handling message:', error)
      }
    })

    return unsubscribe
  }, [socket, isConnected, onNewMessage, pathname, showNotification])

  // Listen for task updates via Socket.IO
  useEffect(() => {
    if (!onTaskUpdate) return

    const unsubscribe = onTaskUpdate((data) => {
      try {
        const { task, action } = data || {}

        // Get current user ID
        const userStr = localStorage.getItem('user')
        if (!userStr) return

        let user
        try {
          user = JSON.parse(userStr)
        } catch (e) {
          console.error('[InAppNotification] Error parsing user data:', e)
          return
        }

        const currentUserId = user?.employeeId || user?._id

        // Only show notification if task update is relevant to current user
        const isAssignedToMe = task?.assignedTo?._id === currentUserId || task?.assignedTo === currentUserId
        const isCreatedByMe = task?.createdBy?._id === currentUserId || task?.createdBy === currentUserId

        if (isAssignedToMe || isCreatedByMe) {
          let title = 'Task Update'
          let message = task?.title || 'A task has been updated'
          let notificationType = 'task_status_update'

          if (action === 'assigned') {
            title = 'New Task Assigned'
            message = `You have been assigned: ${task?.title}`
            notificationType = 'task_assigned'
          } else if (action === 'completed') {
            title = 'Task Completed'
            message = `Task completed: ${task?.title}`
            notificationType = 'task_completed'
          } else if (action === 'approved') {
            title = 'Task Approved'
            message = `Task approved: ${task?.title}`
            notificationType = 'task_approved'
          } else if (action === 'status_update') {
            title = 'Task Status Updated'
            message = `${task?.title} - Status: ${task?.status}`
          }

          showNotification({
            title,
            message,
            url: `/dashboard/tasks/my-tasks`,
            type: notificationType
          })
        }
      } catch (error) {
        console.error('[InAppNotification] Error handling task update:', error)
      }
    })

    return unsubscribe
  }, [onTaskUpdate, showNotification])

  // Listen for announcements via Socket.IO
  useEffect(() => {
    if (!onAnnouncement) return

    const unsubscribe = onAnnouncement((data) => {
      try {
        const { announcement } = data || {}

        showNotification({
          title: 'New Announcement',
          message: announcement?.title || 'A new announcement has been posted',
          url: `/dashboard/announcements`,
          type: 'announcement'
        })
      } catch (error) {
        console.error('[InAppNotification] Error handling announcement:', error)
      }
    })

    return unsubscribe
  }, [onAnnouncement, showNotification])

  // Listen for geofence approval/rejection events via Socket.IO
  useEffect(() => {
    if (!onGeofenceApproval) return

    const unsubscribe = onGeofenceApproval((data) => {
      try {
        const { action, log, notification } = data || {}

        const isApproved = action === 'approved'
        const icon = isApproved ? '✅' : '❌'

        showNotification({
          title: `${icon} ${notification?.title || 'Geofence Update'}`,
          message: notification?.body || 'Geofence status updated',
          url: notification?.url || '/dashboard/geofence',
          type: 'geofence_approval'
        })
      } catch (error) {
        console.error('[InAppNotification] Error handling geofence:', error)
      }
    })

    return unsubscribe
  }, [onGeofenceApproval, showNotification])

  // Listen for leave status updates via Socket.IO
  useEffect(() => {
    if (!onLeaveStatusUpdate) return

    const unsubscribe = onLeaveStatusUpdate((data) => {
      try {
        const { leave, action } = data || {}

        const icon = action === 'approved' ? '✅' : action === 'rejected' ? '❌' : '📋'
        const actionText = action === 'approved' ? 'Approved' : action === 'rejected' ? 'Rejected' : 'Updated'

        showNotification({
          title: `${icon} Leave ${actionText}`,
          message: `Your leave request has been ${action || 'updated'}`,
          url: '/dashboard/leave',
          type: 'leave_status_update'
        })
      } catch (error) {
        console.error('[InAppNotification] Error handling leave status:', error)
      }
    })

    return unsubscribe
  }, [onLeaveStatusUpdate, showNotification])

  // Listen for expense status updates via Socket.IO
  useEffect(() => {
    if (!onExpenseStatusUpdate) return

    const unsubscribe = onExpenseStatusUpdate((data) => {
      try {
        const { expense, action } = data || {}

        const icon = action === 'approved' ? '✅' : action === 'rejected' ? '❌' : '💰'
        const actionText = action === 'approved' ? 'Approved' : action === 'rejected' ? 'Rejected' : 'Updated'

        showNotification({
          title: `${icon} Expense ${actionText}`,
          message: `Your expense claim has been ${action || 'updated'}`,
          url: '/dashboard/expenses',
          type: 'expense_status_update'
        })
      } catch (error) {
        console.error('[InAppNotification] Error handling expense status:', error)
      }
    })

    return unsubscribe
  }, [onExpenseStatusUpdate, showNotification])

  // Listen for travel status updates via Socket.IO
  useEffect(() => {
    if (!onTravelStatusUpdate) return

    const unsubscribe = onTravelStatusUpdate((data) => {
      try {
        const { travel, action } = data || {}

        const icon = action === 'approved' ? '✅' : action === 'rejected' ? '❌' : '✈️'
        const actionText = action === 'approved' ? 'Approved' : action === 'rejected' ? 'Rejected' : 'Updated'

        showNotification({
          title: `${icon} Travel ${actionText}`,
          message: `Your travel request has been ${action || 'updated'}`,
          url: '/dashboard/travel',
          type: 'travel_status_update'
        })
      } catch (error) {
        console.error('[InAppNotification] Error handling travel status:', error)
      }
    })

    return unsubscribe
  }, [onTravelStatusUpdate, showNotification])

  // Listen for project assignments via Socket.IO
  useEffect(() => {
    if (!onProjectAssignment) return

    const unsubscribe = onProjectAssignment((data) => {
      try {
        const { project, action, assignedBy } = data || {}

        let title = '📊 Project Updated'
        let notificationType = 'project_update'

        if (action === 'assigned') {
          title = '📊 New Project Assigned'
          notificationType = 'project_assignment'
        } else if (action === 'completed') {
          title = '🎉 Project Completed'
          notificationType = 'project_completed'
        } else if (action === 'approved') {
          title = '✅ Project Approved'
          notificationType = 'project_approved'
        }

        const message = action === 'assigned'
          ? `You have been assigned to project: ${project?.name || 'Untitled'}`
          : action === 'completed'
            ? `Project completed: ${project?.name || 'Untitled'}`
            : action === 'approved'
              ? `Project approved: ${project?.name || 'Untitled'}`
              : `Project updated: ${project?.name || 'Untitled'}`

        showNotification({
          title,
          message,
          url: '/dashboard/projects',
          type: notificationType
        })
      } catch (error) {
        console.error('[InAppNotification] Error handling project assignment:', error)
      }
    })

    return unsubscribe
  }, [onProjectAssignment, showNotification])

  // Listen for performance review events via Socket.IO
  useEffect(() => {
    if (!onPerformanceReview) return

    const unsubscribe = onPerformanceReview((data) => {
      try {
        const { review, action } = data || {}

        const icon = action === 'approved' ? '✅' : action === 'rejected' ? '❌' : '📈'
        const actionText = action === 'new' ? 'New Review Created' : action === 'approved' ? 'Review Approved' : action === 'rejected' ? 'Review Rejected' : 'Review Updated'

        showNotification({
          title: `${icon} Performance ${actionText}`,
          message: data?.message || 'Your performance review has been updated',
          url: '/dashboard/performance',
          type: 'performance_review'
        })
      } catch (error) {
        console.error('[InAppNotification] Error handling performance review:', error)
      }
    })

    return unsubscribe
  }, [onPerformanceReview, showNotification])

  // Listen for helpdesk ticket events via Socket.IO
  useEffect(() => {
    if (!onHelpdeskTicket) return

    const unsubscribe = onHelpdeskTicket((data) => {
      try {
        const { ticket, action } = data || {}

        const icon = action === 'assigned' ? '🎫' : action === 'resolved' ? '✅' : action === 'closed' ? '🔒' : '📝'
        const actionText = action === 'assigned' ? 'Ticket Assigned' : action === 'resolved' ? 'Ticket Resolved' : action === 'closed' ? 'Ticket Closed' : 'Ticket Updated'

        showNotification({
          title: `${icon} ${actionText}`,
          message: `Ticket #${ticket?.ticketNumber || ticket?._id || 'Unknown'}: ${ticket?.subject || 'No subject'}`,
          url: '/dashboard/helpdesk',
          type: 'helpdesk_ticket'
        })
      } catch (error) {
        console.error('[InAppNotification] Error handling helpdesk ticket:', error)
      }
    })

    return unsubscribe
  }, [onHelpdeskTicket, showNotification])

  // Listen for document updates via Socket.IO
  useEffect(() => {
    if (!onDocumentUpdate) return

    const unsubscribe = onDocumentUpdate((data) => {
      try {
        const { document, action } = data || {}

        const icon = action === 'approved' ? '✅' : action === 'rejected' ? '❌' : '📄'
        const actionText = action === 'approved' ? 'Document Approved' : action === 'rejected' ? 'Document Rejected' : action === 'uploaded' ? 'New Document' : 'Document Updated'

        showNotification({
          title: `${icon} ${actionText}`,
          message: document?.name || 'Document has been updated',
          url: '/dashboard/documents',
          type: 'document_update'
        })
      } catch (error) {
        console.error('[InAppNotification] Error handling document update:', error)
      }
    })

    return unsubscribe
  }, [onDocumentUpdate, showNotification])

  // Listen for asset updates via Socket.IO
  useEffect(() => {
    if (!onAssetUpdate) return

    const unsubscribe = onAssetUpdate((data) => {
      try {
        const { asset, action } = data || {}

        const icon = action === 'assigned' ? '🔧' : action === 'returned' ? '↩️' : '📦'
        const actionText = action === 'assigned' ? 'Asset Assigned' : action === 'returned' ? 'Asset Returned' : 'Asset Updated'

        showNotification({
          title: `${icon} ${actionText}`,
          message: `${asset?.name || 'Asset'} - ${asset?.assetCode || ''}`,
          url: '/dashboard/assets',
          type: 'asset_update'
        })
      } catch (error) {
        console.error('[InAppNotification] Error handling asset update:', error)
      }
    })

    return unsubscribe
  }, [onAssetUpdate, showNotification])

  // Listen for payroll updates via Socket.IO
  useEffect(() => {
    if (!onPayrollUpdate) return

    const unsubscribe = onPayrollUpdate((data) => {
      try {
        const { payroll, action } = data || {}

        const icon = action === 'generated' ? '💰' : action === 'processed' ? '✅' : '💵'
        const actionText = action === 'generated' ? 'Payroll Generated' : action === 'processed' ? 'Payroll Processed' : 'Payroll Updated'

        showNotification({
          title: `${icon} ${actionText}`,
          message: data?.message || 'Your payroll has been updated',
          url: '/dashboard/payroll',
          type: 'payroll_update'
        })
      } catch (error) {
        console.error('[InAppNotification] Error handling payroll update:', error)
      }
    })

    return unsubscribe
  }, [onPayrollUpdate, showNotification])


  return (
    <InAppNotificationContext.Provider value={{ showNotification }}>
      {children}
      {/* Render notifications - z-index higher than MIRA (2147483647) */}
      <div className="fixed top-20 md:top-4 right-0 left-0 md:left-auto md:right-4 pointer-events-none" style={{ zIndex: 2147483648 }}>
        <div className="flex flex-col gap-3 p-4 md:p-0 pointer-events-auto max-w-sm mx-auto md:mx-0">
          {notifications.map((notification) => (
            <InAppNotification
              key={notification.id}
              notification={notification}
              onClose={() => removeNotification(notification.id)}
            />
          ))}
        </div>
      </div>
    </InAppNotificationContext.Provider>
  )
}

export function useInAppNotification() {
  const context = useContext(InAppNotificationContext)
  if (!context) {
    throw new Error('useInAppNotification must be used within InAppNotificationProvider')
  }
  return context
}

