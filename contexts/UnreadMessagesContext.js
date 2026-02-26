'use client'

import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react'
import { useSocket } from './SocketContext'
import { handleSessionExpired } from '@/utils/userHelper'

const UnreadMessagesContext = createContext({
  unreadCount: 0,
  unreadChats: {},
  markChatAsRead: () => { },
  refreshUnreadCount: () => { }
})

export function UnreadMessagesProvider({ children }) {
  const [unreadCount, setUnreadCount] = useState(0)
  const [unreadChats, setUnreadChats] = useState({}) // { chatId: count }
  const { onNewMessage, subscribe, isConnected } = useSocket()
  const debounceTimerRef = useRef(null)
  const wasConnectedRef = useRef(null) // null = never connected yet

  // Fetch unread count from API
  const fetchUnreadCount = async () => {
    try {
      const token = localStorage.getItem('token')
      if (!token) return

      const response = await fetch('/api/chat/unread', {
        headers: { 'Authorization': `Bearer ${token}` }
      })

      if (!response.ok) {
        // Handle 401 - session expired, redirect to login
        if (response.status === 401) {
          handleSessionExpired()
          return
        }
        console.error('[UnreadMessages] API error:', response.status)
        return
      }

      const result = await response.json()

      if (result.success) {
        setUnreadCount(result.totalUnread)
        setUnreadChats(result.unreadByChat || {})
      }
    } catch (error) {
      // Silently ignore fetch errors (network issues, etc.)
      // This prevents console spam when user is not logged in or server is unreachable
      if (error.name !== 'TypeError') {
        console.error('[UnreadMessages] Error fetching unread count:', error)
      }
    }
  }

  // Mark chat as read
  const markChatAsRead = async (chatId) => {
    try {
      const token = localStorage.getItem('token')
      if (!token) return

      const response = await fetch(`/api/chat/${chatId}/mark-read`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      })

      if (response.ok) {
        // Update local state
        setUnreadChats(prev => {
          const newUnread = { ...prev }
          const chatUnread = newUnread[chatId] || 0
          setUnreadCount(prevCount => Math.max(0, prevCount - chatUnread))
          delete newUnread[chatId]
          return newUnread
        })
      }
    } catch (error) {
      console.error('[UnreadMessages] Error marking chat as read:', error)
    }
  }

  // Listen for new messages via WebSocket
  useEffect(() => {
    if (!onNewMessage) {
      console.log('[UnreadMessages] onNewMessage not available yet')
      return
    }

    console.log('[UnreadMessages] Setting up message listener')

    const unsubscribe = onNewMessage((data) => {
      try {
        console.log('[UnreadMessages] Raw message data received:', data)

        // Safe destructuring with defaults
        const chatId = data?.chatId
        const message = data?.message
        const senderId = data?.senderId

        if (!message) {
          console.warn('[UnreadMessages] No message in data')
          return
        }

        // Get current user ID
        const userStr = localStorage.getItem('user')
        if (!userStr) {
          console.warn('[UnreadMessages] No user in localStorage')
          return
        }

        let user
        try {
          user = JSON.parse(userStr)
        } catch (parseError) {
          console.error('[UnreadMessages] Error parsing user data:', parseError)
          return
        }

        const currentUserId = user?.employeeId || user?._id
        if (!currentUserId) {
          console.warn('[UnreadMessages] No currentUserId found')
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

        console.log('[UnreadMessages] New message received:', {
          chatId,
          currentUserId: currentUserIdStr,
          messageSenderId: messageSenderIdStr,
          isFromCurrentUser: messageSenderIdStr === currentUserIdStr
        })

        // Only increment unread count if message is NOT from current user
        if (messageSenderIdStr && currentUserIdStr && messageSenderIdStr !== currentUserIdStr) {
          console.log('[UnreadMessages] Incrementing unread count for chat:', chatId)

          // Increment unread count for this chat
          setUnreadChats(prev => ({
            ...prev,
            [chatId]: (prev[chatId] || 0) + 1
          }))

          setUnreadCount(prev => prev + 1)
        } else {
          console.log('[UnreadMessages] Message is from current user, not incrementing unread count')
        }
      } catch (error) {
        // CRITICAL: Catch ALL errors to prevent app crash
        console.error('[UnreadMessages] Error handling message:', error)
      }
    })

    return unsubscribe
  }, [onNewMessage])

  // Debounced fetch — prevents rapid-fire API calls when multiple socket events arrive
  const debouncedFetchUnread = useCallback(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = setTimeout(() => {
      fetchUnreadCount()
    }, 500) // Wait 500ms after last event before fetching
  }, [])

  // Fetch unread count on mount and listen for real-time updates (pure event-driven, zero polling)
  useEffect(() => {
    fetchUnreadCount()

    // Listen for server-pushed unread count updates instead of polling
    const unsubscribe = subscribe('chat.unread.updated', (data) => {
      console.log('[UnreadMessages] Received chat.unread.updated event')
      debouncedFetchUnread()
    })

    return () => {
      if (unsubscribe) unsubscribe()
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    }
  }, [subscribe, debouncedFetchUnread])

  // Re-fetch on socket reconnect to catch any events missed during disconnect
  // null→true (first connect): skip (mount useEffect already fetches)
  // true→false (disconnect): no-op
  // false→true (reconnect): re-fetch to sync missed events
  useEffect(() => {
    if (isConnected && wasConnectedRef.current === false) {
      console.log('[UnreadMessages] Socket reconnected — syncing unread count')
      fetchUnreadCount()
    }
    wasConnectedRef.current = isConnected
  }, [isConnected])

  return (
    <UnreadMessagesContext.Provider value={{
      unreadCount,
      unreadChats,
      markChatAsRead,
      refreshUnreadCount: fetchUnreadCount
    }}>
      {children}
    </UnreadMessagesContext.Provider>
  )
}

export function useUnreadMessages() {
  const context = useContext(UnreadMessagesContext)
  if (!context) {
    throw new Error('useUnreadMessages must be used within UnreadMessagesProvider')
  }
  return context
}

