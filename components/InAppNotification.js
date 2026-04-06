'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { FaTimes, FaComment, FaTasks, FaBullhorn, FaBell } from 'react-icons/fa'
import { useRouter } from 'next/navigation'
import { useChatWidget } from '@/contexts/ChatWidgetContext'
import { useTheme } from '@/contexts/ThemeContext'

export default function InAppNotification({ notification, onClose }) {
  const [isVisible, setIsVisible] = useState(false)
  const isMountedRef = useRef(true)
  const timersRef = useRef([])
  const router = useRouter()
  const { openChat, openWidget } = useChatWidget()
  const { isDarkMode } = useTheme()

  const clearAllTimers = useCallback(() => {
    timersRef.current.forEach(timer => clearTimeout(timer))
    timersRef.current = []
  }, [])

  const handleClose = useCallback(() => {
    if (!isMountedRef.current) return

    setIsVisible(false)
    const timer = setTimeout(() => {
      if (isMountedRef.current && onClose) {
        onClose()
      }
    }, 300)
    timersRef.current.push(timer)
  }, [onClose])

  useEffect(() => {
    isMountedRef.current = true

    // Fade in animation
    const fadeInTimer = setTimeout(() => {
      if (isMountedRef.current) {
        setIsVisible(true)
      }
    }, 10)
    timersRef.current.push(fadeInTimer)

    // Auto close after 5 seconds
    const autoCloseTimer = setTimeout(() => {
      if (isMountedRef.current) {
        handleClose()
      }
    }, 5000)
    timersRef.current.push(autoCloseTimer)

    return () => {
      isMountedRef.current = false
      clearAllTimers()
    }
  }, [handleClose, clearAllTimers])

  const handleClick = useCallback((e) => {
    if (!isMountedRef.current) return

    // Prevent if clicking on close button
    if (e?.target?.closest && e.target.closest('button[aria-label="Close notification"]')) {
      return
    }

    console.log('[InAppNotification] Clicked notification:', {
      url: notification.url,
      type: notification.type,
      title: notification.title,
      chatId: notification.chatId
    })

    // For message notifications on desktop, open chat widget directly
    if (notification.type === 'message' && notification.chatId && typeof window !== 'undefined' && window.innerWidth >= 768) {
      console.log('[InAppNotification] Opening chat widget for chatId:', notification.chatId)
      
      // Fetch chat data if not provided, or use provided data
      const openChatDirectly = async () => {
        try {
          // If we have sender info, build a minimal chat object
          if (notification.senderInfo || notification.chatData) {
            const chatData = notification.chatData || {
              _id: notification.chatId,
              participants: notification.senderInfo ? [notification.senderInfo] : []
            }
            
            // If we need to fetch full chat data
            const token = localStorage.getItem('token')
            if (token) {
              const response = await fetch(`/api/chat/${notification.chatId}`, {
                headers: {
                  'Authorization': `Bearer ${token}`
                }
              })
              
              if (response.ok) {
                const fullChatData = await response.json()
                openChat(fullChatData)
              } else {
                // Use minimal data
                openChat(chatData)
              }
            } else {
              openChat(chatData)
            }
          } else {
            // Fetch chat data from API
            const token = localStorage.getItem('token')
            if (token) {
              const response = await fetch(`/api/chat/${notification.chatId}`, {
                headers: {
                  'Authorization': `Bearer ${token}`
                }
              })
              
              if (response.ok) {
                const chatData = await response.json()
                openChat(chatData)
              }
            }
          }
        } catch (error) {
          console.error('[InAppNotification] Error fetching chat data:', error)
          // Fall back to URL navigation
          if (notification.url) {
            router.push(notification.url)
          }
        }
      }
      
      openChatDirectly()
      handleClose()
      return
    }

    // Default behavior: navigate to URL
    if (notification.url) {
      console.log('[InAppNotification] Navigating to:', notification.url)
      router.push(notification.url)
      // Close after a short delay to allow navigation to start
      const timer = setTimeout(() => {
        if (isMountedRef.current) {
          handleClose()
        }
      }, 100)
      timersRef.current.push(timer)
    } else {
      handleClose()
    }
  }, [notification, router, handleClose, openChat])

  const getIconAndColor = () => {
    switch (notification.type) {
      case 'message':
        return {
          icon: <FaComment className="w-5 h-5" />,
          bgColor: isDarkMode ? 'rgba(59, 130, 246, 0.15)' : '#EFF6FF',
          iconColor: isDarkMode ? '#60A5FA' : '#2563EB',
          progressColor: '#3B82F6'
        }
      case 'task_assigned':
      case 'task_status_update':
      case 'task_completed':
        return {
          icon: <FaTasks className="w-5 h-5" />,
          bgColor: isDarkMode ? 'rgba(16, 185, 129, 0.15)' : '#ECFDF5',
          iconColor: isDarkMode ? '#34D399' : '#059669',
          progressColor: '#10B981'
        }
      case 'announcement':
        return {
          icon: <FaBullhorn className="w-5 h-5" />,
          bgColor: isDarkMode ? 'rgba(249, 115, 22, 0.15)' : '#FFF7ED',
          iconColor: isDarkMode ? '#FB923C' : '#EA580C',
          progressColor: '#F97316'
        }
      default:
        return {
          icon: <FaBell className="w-5 h-5" />,
          bgColor: isDarkMode ? 'rgba(59, 130, 246, 0.15)' : '#EFF6FF',
          iconColor: isDarkMode ? '#60A5FA' : '#2563EB',
          progressColor: '#3B82F6'
        }
    }
  }

  const { icon, bgColor, iconColor, progressColor } = getIconAndColor()

  return (
    <div
      className={`max-w-sm w-full rounded-xl shadow-2xl border overflow-hidden transition-all duration-300 transform ${
        isVisible ? 'translate-x-0 opacity-100 scale-100' : 'translate-x-full opacity-0 scale-95'
      } ${notification.url ? 'cursor-pointer hover:shadow-3xl active:scale-95' : ''}`}
      onClick={handleClick}
      role={notification.url ? 'button' : 'alert'}
      tabIndex={notification.url ? 0 : -1}
      onKeyDown={(e) => {
        if (notification.url && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          handleClick(e)
        }
      }}
      style={{
        backgroundColor: isDarkMode ? '#18181b' : '#FFFFFF',
        borderColor: progressColor,
        borderWidth: '2px',
        pointerEvents: 'auto'
      }}
    >
      {/* Header with gradient */}
      <div
        className="h-1.5"
        style={{ background: `linear-gradient(90deg, ${progressColor} 0%, ${iconColor} 100%)` }}
      />

      <div className="p-4">
        <div className="flex items-start gap-3">
          {/* Icon */}
          <div
            className="flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center shadow-sm"
            style={{
              backgroundColor: bgColor,
              color: iconColor
            }}
          >
            {icon}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <h4 className="text-sm font-bold line-clamp-1" style={{ color: isDarkMode ? '#F1F5F9' : '#111827' }}>
                {notification.title}
              </h4>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  handleClose()
                }}
                className="flex-shrink-0 transition-colors p-1 rounded-full"
                style={{ color: isDarkMode ? '#71717a' : '#9CA3AF' }}
                aria-label="Close notification"
              >
                <FaTimes className="w-3.5 h-3.5" />
              </button>
            </div>
            <p className="text-sm mt-1.5 line-clamp-2 leading-relaxed" style={{ color: isDarkMode ? '#94A3B8' : '#4B5563' }}>
              {notification.message}
            </p>
            {notification.url && (
              <p className="text-xs font-medium mt-2" style={{ color: iconColor }}>
                Click to view →
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Animated progress bar */}
      <div className="h-1" style={{ backgroundColor: isDarkMode ? '#27272a' : '#F3F4F6' }}>
        <div
          className="h-full transition-all duration-[5000ms] ease-linear"
          style={{
            width: isVisible ? '0%' : '100%',
            backgroundColor: progressColor
          }}
        />
      </div>
    </div>
  )
}

