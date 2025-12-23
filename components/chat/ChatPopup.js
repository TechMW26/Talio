'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { FaTimes, FaPaperPlane, FaUsers, FaPaperclip, FaFile, FaFilePdf, FaMinus, FaExpand, FaCompress } from 'react-icons/fa'
import { useChatWidget } from '@/contexts/ChatWidgetContext'
import { useSocket } from '@/contexts/SocketContext'
import { useUnreadMessages } from '@/contexts/UnreadMessagesContext'
import { useTheme } from '@/contexts/ThemeContext'
import { playNotificationSound } from '@/utils/audio'

export default function ChatPopup({ chat, index }) {
  const { closeChat, chatPositions, updateChatPosition, bringToFront, triggerSource, widgetPosition, getZIndex, focusedChatId, sidebarCollapsed, isAutoMinimized } = useChatWidget()
  const { isConnected, joinChat, leaveChat, onNewMessage, sendTyping, sendStopTyping, onUserTyping, onUserStopTyping } = useSocket()
  const { markChatAsRead, unreadChats } = useUnreadMessages()
  const { theme } = useTheme()

  const [messages, setMessages] = useState([])
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [currentUserId, setCurrentUserId] = useState(null)
  const [currentEmployeeId, setCurrentEmployeeId] = useState(null)
  const [isMinimized, setIsMinimized] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const [typingUsers, setTypingUsers] = useState({})
  const [animationState, setAnimationState] = useState('normal') // 'normal', 'minimizing', 'maximizing'
  const [minimizedUnread, setMinimizedUnread] = useState(0) // Track unread while minimized
  const [showMembersPanel, setShowMembersPanel] = useState(false) // Show group members panel
  const [memberSearchQuery, setMemberSearchQuery] = useState('') // Search members in panel

  const popupRef = useRef(null)
  const messagesEndRef = useRef(null)
  const messagesContainerRef = useRef(null)
  const isDragging = useRef(false)
  const dragOffset = useRef({ x: 0, y: 0 })
  const typingTimeoutRef = useRef(null)
  const fileInputRef = useRef(null)

  const primaryColor = theme?.primary?.[500] || '#3B82F6'
  const primaryDark = theme?.primary?.[600] || '#2563EB'

  // Get z-index from context - focused chat gets highest z-index
  const zIndex = getZIndex(chat._id)
  const isFocused = focusedChatId === chat._id

  // Get unread count for this chat
  const unreadCount = unreadChats?.[chat._id] || 0

  // Check if this chat should be auto-minimized
  const shouldAutoMinimize = isAutoMinimized(chat._id)

  // Sync auto-minimize state with local state
  useEffect(() => {
    // Don't auto-minimize if this chat is exempt (manually maximized)
    const isExempt = typeof window !== 'undefined' && window.__exemptChatId === chat._id
    if (shouldAutoMinimize && !isMinimized && !isExempt) {
      setIsMinimized(true)
      setAnimationState('minimizing')
      // Clear position to force recalculation for minimized state
      updateChatPosition?.(chat._id, null, null)
      setTimeout(() => setAnimationState('normal'), 300)
    }
  }, [shouldAutoMinimize, isMinimized, chat._id, updateChatPosition])

  // Glass morphism styles
  const glassStyle = {
    background: 'rgba(255, 255, 255, 0.7)',
    backdropFilter: 'blur(24px) saturate(180%)',
    WebkitBackdropFilter: 'blur(24px) saturate(180%)',
    border: '1px solid rgba(255, 255, 255, 0.25)',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.5)',
  }

  // Animation keyframes for genie effect
  const genieMinimizeAnimation = `
    @keyframes genieMinimize {
      0% {
        transform: scale(1) translateY(0);
        opacity: 1;
        border-radius: 16px;
      }
      50% {
        transform: scale(0.5, 0.8) translateY(50%);
        opacity: 0.8;
        border-radius: 12px;
      }
      100% {
        transform: scale(0.3, 0.1) translateY(100%);
        opacity: 0;
        border-radius: 8px;
      }
    }
    @keyframes genieMaximize {
      0% {
        transform: scale(0.3, 0.1) translateY(100%);
        opacity: 0;
        border-radius: 8px;
      }
      50% {
        transform: scale(0.5, 0.8) translateY(50%);
        opacity: 0.8;
        border-radius: 12px;
      }
      100% {
        transform: scale(1) translateY(0);
        opacity: 1;
        border-radius: 16px;
      }
    }
    @keyframes pulse {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.1); }
    }
    @keyframes slideIn {
      from {
        opacity: 0;
        transform: translateX(20px) scale(0.95);
      }
      to {
        opacity: 1;
        transform: translateX(0) scale(1);
      }
    }
    @keyframes bounce {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-3px); }
    }
  `

  // Handle minimize with animation
  const handleMinimize = () => {
    setAnimationState('minimizing')
    setMinimizedUnread(unreadCount) // Capture current unread count
    // Clear position to force recalculation for minimized state
    updateChatPosition?.(chat._id, null, null)
    setTimeout(() => {
      setIsMinimized(true)
      setAnimationState('normal')
    }, 300)
  }

  // Handle maximize with animation
  const handleMaximize = () => {
    // Calculate position for expanded state BEFORE updating state
    const expandedPosition = getDefaultPosition(true)

    setIsMinimized(false)
    setAnimationState('maximizing')
    bringToFront?.(chat._id)
    markChatAsRead?.(chat._id)
    setMinimizedUnread(0)

    // Set the calculated expanded position immediately
    updateChatPosition?.(chat._id, expandedPosition.x, expandedPosition.y)

    // Prevent auto-minimize by temporarily marking as exempt
    if (typeof window !== 'undefined') {
      window.__exemptChatId = chat._id
      setTimeout(() => {
        delete window.__exemptChatId
      }, 500)
    }
    setTimeout(() => {
      setAnimationState('normal')
    }, 300)
  }

  // Track unread messages while minimized
  useEffect(() => {
    if (isMinimized && unreadCount > minimizedUnread) {
      setMinimizedUnread(unreadCount)
    }
  }, [isMinimized, unreadCount, minimizedUnread])

  // Get current user
  useEffect(() => {
    const user = localStorage.getItem('user')
    if (user) {
      try {
        const parsed = JSON.parse(user)
        setCurrentUserId(parsed._id || parsed.id)
        const empId = parsed.employeeId?._id || parsed.employeeId || parsed.employee?._id || parsed.employee
        setCurrentEmployeeId(empId)
      } catch (e) { }
    }
  }, [])

  // Get chat name
  const getChatName = () => {
    if (chat.isGroup) return chat.name || 'Group Chat'
    const otherParticipant = chat.participants?.find(p => {
      const pId = p._id || p
      return pId !== currentEmployeeId && pId !== currentUserId
    })
    if (otherParticipant) {
      return `${otherParticipant.firstName || ''} ${otherParticipant.lastName || ''}`.trim() || otherParticipant.email || 'User'
    }
    return 'Chat'
  }

  // Get initials
  const getInitials = () => {
    const name = getChatName()
    return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
  }

  // Get other participant's profile picture (for 1-on-1 chats)
  const getOtherParticipantPicture = () => {
    if (chat.isGroup) return null
    const otherParticipant = chat.participants?.find(p => {
      const pId = p._id || p
      return pId !== currentEmployeeId && pId !== currentUserId
    })
    return otherParticipant?.profilePicture || null
  }

  // Join chat room and fetch messages
  useEffect(() => {
    if (chat._id) {
      fetchMessages()
      markChatAsRead?.(chat._id)

      if (isConnected) {
        joinChat?.(chat._id)
      }

      return () => {
        if (isConnected) {
          leaveChat?.(chat._id)
        }
      }
    }
  }, [chat._id, isConnected])

  // Listen for new messages
  useEffect(() => {
    if (!chat._id || !onNewMessage) return

    const unsubscribe = onNewMessage((data) => {
      const { chatId, message: newMessage } = data
      if (chatId === chat._id && newMessage) {
        setMessages(prev => {
          if (prev.some(msg => msg._id === newMessage._id)) return prev
          const senderId = newMessage.sender?._id || newMessage.sender
          if (senderId !== currentEmployeeId && senderId !== currentUserId) {
            playNotificationSound?.()
          }
          return [...prev, newMessage]
        })
        markChatAsRead?.(chat._id)
      }
    })

    return unsubscribe
  }, [chat._id, currentUserId, currentEmployeeId, onNewMessage, markChatAsRead])

  // Listen for typing
  useEffect(() => {
    if (!chat._id) return

    const unsubTyping = onUserTyping?.((data) => {
      if (data.chatId === chat._id && data.userId !== currentUserId && data.userId !== currentEmployeeId) {
        setTypingUsers(prev => ({ ...prev, [data.userId]: data.userName }))
      }
    })

    const unsubStopTyping = onUserStopTyping?.((data) => {
      if (data.chatId === chat._id) {
        setTypingUsers(prev => {
          const newTyping = { ...prev }
          delete newTyping[data.userId]
          return newTyping
        })
      }
    })

    return () => {
      unsubTyping?.()
      unsubStopTyping?.()
    }
  }, [chat._id, currentUserId, currentEmployeeId])

  // Auto scroll
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages])

  const fetchMessages = async () => {
    try {
      setLoading(true)
      const token = localStorage.getItem('token')
      if (!token) return

      const response = await fetch(`/api/chat/${chat._id}/messages`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await response.json()
      if (data.success) {
        setMessages(data.data || [])
      }
    } catch (error) {
      console.error('Error fetching messages:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSend = async () => {
    if (!message.trim() || sending) return

    const messageContent = message.trim()
    setMessage('')
    setSending(true)

    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/chat/${chat._id}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ content: messageContent })
      })

      const data = await response.json()
      if (!response.ok) {
        console.error('Send message error:', data)
        setMessage(messageContent) // Restore message on error
      } else if (data.success) {
        // Add message locally for immediate feedback
        setMessages(prev => {
          if (prev.some(msg => msg._id === data.data._id)) return prev
          return [...prev, data.data]
        })
      }

      sendStopTyping?.(chat._id)
    } catch (error) {
      console.error('Error sending message:', error)
      setMessage(messageContent) // Restore message on error
    } finally {
      setSending(false)
    }
  }

  const handleTyping = (e) => {
    setMessage(e.target.value)

    sendTyping?.(chat._id)

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current)
    }

    typingTimeoutRef.current = setTimeout(() => {
      sendStopTyping?.(chat._id)
    }, 2000)
  }

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // File upload - first upload to server, then send message with file info
  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      const token = localStorage.getItem('token')

      // Step 1: Upload the file
      const uploadFormData = new FormData()
      uploadFormData.append('file', file)

      const uploadResponse = await fetch('/api/upload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: uploadFormData
      })

      const uploadData = await uploadResponse.json()

      if (!uploadResponse.ok || !uploadData.success) {
        console.error('File upload error:', uploadData)
        return
      }

      // Step 2: Send message with file info
      const { fileUrl, fileName, fileType, fileSize } = uploadData.data

      const messageResponse = await fetch(`/api/chat/${chat._id}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          content: '',
          fileUrl,
          fileName,
          fileType,
          fileSize
        })
      })

      const messageData = await messageResponse.json()
      if (!messageResponse.ok) {
        console.error('Message send error:', messageData)
      } else if (messageData.success) {
        // Add message locally for immediate feedback
        setMessages(prev => {
          if (prev.some(msg => msg._id === messageData.data._id)) return prev
          return [...prev, messageData.data]
        })
      }
    } catch (error) {
      console.error('Error uploading file:', error)
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  // Dragging handlers
  const handleMouseDown = (e) => {
    if (e.target.closest('.popup-content')) return
    isDragging.current = true
    bringToFront?.(chat._id)
    const rect = popupRef.current?.getBoundingClientRect()
    if (rect) {
      dragOffset.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      }
    }
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }

  const handleMouseMove = useCallback((e) => {
    if (!isDragging.current) return
    const x = e.clientX - dragOffset.current.x
    const y = e.clientY - dragOffset.current.y
    updateChatPosition?.(chat._id, x, y)
  }, [chat._id, updateChatPosition])

  const handleMouseUp = useCallback(() => {
    isDragging.current = false
    document.removeEventListener('mousemove', handleMouseMove)
    document.removeEventListener('mouseup', handleMouseUp)
  }, [handleMouseMove])

  // Calculate position - place chat windows side by side near the widget
  const getDefaultPosition = (forceExpanded = false) => {
    if (typeof window === 'undefined') return { x: 640, y: 100 }

    // Use forced expanded state for calculations if provided (for maximize action)
    const useMinimized = forceExpanded ? false : (isMinimized || shouldAutoMinimize)
    const chatWidth = isExpanded ? 480 : (useMinimized ? 220 : 360)
    const chatHeight = isExpanded ? 580 : (useMinimized ? 52 : 450)
    const gap = 16 // Equal gap between chat windows
    const screenPadding = 20 // Padding from screen edges
    const bottomOffset = 24 // Distance from bottom
    const widgetWidth = 340
    const widgetHeight = 480
    const sidebarWidth = sidebarCollapsed ? 72 : 272 // 4.5rem or 17rem in pixels
    const minimizedHeight = 52 // Height of minimized chat box
    const minimizedGap = 8 // Gap between minimized chats at bottom

    // Get widget's actual position
    let widgetX, widgetY

    if (widgetPosition.x !== null && widgetPosition.y !== null) {
      // Widget was manually dragged - position chats near it
      widgetX = widgetPosition.x
      widgetY = widgetPosition.y
    } else if (triggerSource === 'sidebar') {
      // Widget is near sidebar - use dynamic sidebar width
      widgetX = sidebarWidth + 16
      widgetY = window.innerHeight - widgetHeight - bottomOffset
    } else {
      // Widget is near floating button (bottom right)
      widgetX = window.innerWidth - 88 - widgetWidth
      widgetY = window.innerHeight - widgetHeight - 88
    }

    // Position chat popups to the RIGHT of the widget, side by side
    const startX = widgetX + widgetWidth + gap

    // Calculate position based on visible (non-minimized) index
    // If this chat is minimized, position at bottom right corner
    if (useMinimized) {
      // Minimized chats stack at bottom right, above each other
      const minimizedIndex = index // Use actual index for minimized positioning
      const minimizedX = window.innerWidth - 200 - 24 // 180px width + padding
      const minimizedY = window.innerHeight - minimizedHeight - 12 - (minimizedIndex * (minimizedHeight + minimizedGap))
      return { x: minimizedX, y: minimizedY }
    }

    // For expanded chats, calculate position carefully to avoid off-screen
    // Calculate how many chats can fit to the right of widget
    const availableRightSpace = window.innerWidth - startX - screenPadding
    const maxChatsRight = Math.max(1, Math.floor(availableRightSpace / (chatWidth + gap)))

    let finalX, finalY

    if (index < maxChatsRight) {
      // This chat fits on the right side
      finalX = startX + (index * (chatWidth + gap))
    } else {
      // Need to position on the left side or stack
      const leftIndex = index - maxChatsRight
      finalX = widgetX - gap - chatWidth - (leftIndex * (chatWidth + gap))

      // If also goes off left edge, fall back to stacking on right
      if (finalX < screenPadding) {
        // Stack on the right side at a safe position
        finalX = Math.max(screenPadding, startX)
      }
    }

    // All chats at the same Y level (aligned with widget bottom)
    finalY = window.innerHeight - chatHeight - bottomOffset

    // Final bounds check - ensure completely within screen
    finalX = Math.max(screenPadding, Math.min(finalX, window.innerWidth - chatWidth - screenPadding))
    finalY = Math.max(screenPadding, Math.min(finalY, window.innerHeight - chatHeight - screenPadding))

    return { x: finalX, y: finalY }
  }

  const position = chatPositions?.[chat._id] || getDefaultPosition()

  // Typing indicator
  const typingText = Object.values(typingUsers).length > 0
    ? `${Object.values(typingUsers).join(', ')} typing...`
    : null

  // Check if message is from current user
  const isMyMessage = (msg) => {
    const senderId = msg.sender?._id || msg.sender
    return senderId === currentEmployeeId || senderId === currentUserId
  }

  // Render file message
  const renderFileMessage = (msg) => {
    if (msg.fileType?.startsWith('image/')) {
      return (
        <img
          src={msg.fileUrl}
          alt={msg.fileName}
          className="max-w-[200px] rounded-lg cursor-pointer hover:opacity-90"
        />
      )
    }

    const isPdf = msg.fileType === 'application/pdf'
    return (
      <a
        href={msg.fileUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2 p-2 bg-black/10 rounded-lg hover:bg-black/20 transition-colors"
      >
        {isPdf ? <FaFilePdf className="w-5 h-5" /> : <FaFile className="w-5 h-5" />}
        <span className="text-sm truncate max-w-[150px]">{msg.fileName}</span>
      </a>
    )
  }

  // Minimized state with notification bubble
  if (isMinimized) {
    const position = chatPositions?.[chat._id] || getDefaultPosition()
    return (
      <>
        <style>{genieMinimizeAnimation}</style>
        <div
          className="fixed rounded-xl cursor-pointer overflow-visible"
          style={{
            left: `${position.x}px`,
            top: `${position.y}px`,
            width: '180px',
            zIndex,
            animation: 'slideIn 0.3s ease-out',
            transition: 'left 0.4s cubic-bezier(0.4, 0, 0.2, 1), top 0.4s cubic-bezier(0.4, 0, 0.2, 1), transform 0.2s ease',
            ...glassStyle,
            background: 'rgba(255, 255, 255, 0.9)',
          }}
          onClick={handleMaximize}
          onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-2px) scale(1.02)'}
          onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0) scale(1)'}
        >
          {/* Notification Badge */}
          {minimizedUnread > 0 && (
            <div
              className="absolute -top-2 -right-2 min-w-[22px] h-[22px] rounded-full flex items-center justify-center text-white text-xs font-bold px-1.5 shadow-lg"
              style={{
                backgroundColor: '#EF4444',
                animation: 'pulse 2s infinite, bounce 0.5s ease-out',
                zIndex: zIndex + 1
              }}
            >
              {minimizedUnread > 99 ? '99+' : minimizedUnread}
            </div>
          )}

          <div
            className="px-3 py-2.5 flex items-center justify-between rounded-xl"
            style={{
              background: `linear-gradient(135deg, ${primaryColor}, ${primaryDark})`,
            }}
          >
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center text-[10px] font-medium text-white flex-shrink-0">
                {chat.isGroup ? <FaUsers className="w-3.5 h-3.5" /> : getInitials()}
              </div>
              <span className="text-white text-sm font-medium truncate">{getChatName()}</span>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation()
                closeChat?.(chat._id)
              }}
              className="p-1.5 hover:bg-gray-100 rounded-lg transition-all flex-shrink-0 hover:scale-110"
              style={{ backgroundColor: 'white' }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512" className="w-3 h-3" fill={primaryDark}>
                <path d="M342.6 150.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L192 210.7 86.6 105.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L146.7 256 41.4 361.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L192 301.3 297.4 406.6c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L237.3 256 342.6 150.6z" />
              </svg>
            </button>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <style>{genieMinimizeAnimation}</style>
      <div
        ref={popupRef}
        className="fixed rounded-2xl overflow-hidden flex flex-col"
        style={{
          width: isExpanded ? '480px' : '360px',
          height: isExpanded ? '580px' : '450px',
          left: `${position.x}px`,
          top: `${position.y}px`,
          zIndex,
          ...glassStyle,
          transition: 'left 0.4s cubic-bezier(0.4, 0, 0.2, 1), top 0.4s cubic-bezier(0.4, 0, 0.2, 1), width 0.3s ease, height 0.3s ease, box-shadow 0.2s ease',
          animation: animationState === 'minimizing'
            ? 'genieMinimize 0.3s ease-in forwards'
            : animationState === 'maximizing'
              ? 'genieMaximize 0.3s ease-out forwards'
              : 'slideIn 0.4s ease-out',
          boxShadow: isFocused
            ? `0 20px 50px rgba(0, 0, 0, 0.2), 0 0 0 2px ${primaryColor}40, inset 0 1px 0 rgba(255, 255, 255, 0.5)`
            : '0 8px 32px rgba(0, 0, 0, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.5)',
        }}
        onClick={() => bringToFront?.(chat._id)}
      >
        {/* Header */}
        <div
          className="px-3 py-2.5 flex items-center justify-between cursor-move select-none"
          style={{
            background: `linear-gradient(135deg, ${primaryColor}ee, ${primaryDark}ee)`,
          }}
          onMouseDown={handleMouseDown}
        >
          <div className="flex items-center gap-2 text-white min-w-0">
            <div 
              className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-medium flex-shrink-0 shadow-sm overflow-hidden"
              style={{ backgroundColor: getOtherParticipantPicture() ? 'transparent' : 'rgba(0, 0, 0, 0.3)' }}
            >
              {chat.isGroup ? (
                <FaUsers className="w-4 h-4 text-white" />
              ) : getOtherParticipantPicture() ? (
                <img 
                  src={getOtherParticipantPicture()} 
                  alt="" 
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="text-white">{getInitials()}</span>
              )}
            </div>
            <div className="min-w-0">
              <span className="font-medium text-sm truncate block">{getChatName()}</span>
              <span className="text-[10px] text-white/70">{chat.isGroup ? `${chat.participants?.length || 0} members` : 'Online'}</span>
            </div>
          </div>
          <div className="flex items-center gap-0.5 flex-shrink-0">
            {/* View Members Button - Only for group chats */}
            {chat.isGroup && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setShowMembersPanel(!showMembersPanel)
                }}
                className={`p-2 rounded-lg transition-all hover:scale-110 ${showMembersPanel ? 'ring-2 ring-white/50' : ''}`}
                style={{ backgroundColor: 'white' }}
                title="View Members"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 512" className="w-3.5 h-3.5" fill={primaryDark}>
                  <path d="M144 0a80 80 0 1 1 0 160A80 80 0 1 1 144 0zM512 0a80 80 0 1 1 0 160A80 80 0 1 1 512 0zM0 298.7C0 239.8 47.8 192 106.7 192h42.7c15.9 0 31 3.5 44.6 9.7c-1.3 7.2-1.9 14.7-1.9 22.3c0 38.2 16.8 72.5 43.3 96c-.2 0-.4 0-.7 0H21.3C9.6 320 0 310.4 0 298.7zM405.3 320c-.2 0-.4 0-.7 0c26.6-23.5 43.3-57.8 43.3-96c0-7.6-.7-15-1.9-22.3c13.6-6.3 28.7-9.7 44.6-9.7h42.7C592.2 192 640 239.8 640 298.7c0 11.8-9.6 21.3-21.3 21.3H405.3zM224 224a96 96 0 1 1 192 0 96 96 0 1 1 -192 0zM128 485.3C128 411.7 187.7 352 261.3 352H378.7C452.3 352 512 411.7 512 485.3c0 14.7-11.9 26.7-26.7 26.7H154.7c-14.7 0-26.7-11.9-26.7-26.7z" />
                </svg>
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation()
                setIsExpanded(!isExpanded)
              }}
              className="p-2 hover:bg-gray-100 rounded-lg transition-all hover:scale-110"
              style={{ backgroundColor: 'white' }}
              title={isExpanded ? 'Collapse' : 'Expand'}
            >
              {isExpanded ? (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512" className="w-3.5 h-3.5" fill={primaryDark}>
                  <path d="M160 64c0-17.7-14.3-32-32-32s-32 14.3-32 32v64H32c-17.7 0-32 14.3-32 32s14.3 32 32 32h96c17.7 0 32-14.3 32-32V64zM32 320c-17.7 0-32 14.3-32 32s14.3 32 32 32H96v64c0 17.7 14.3 32 32 32s32-14.3 32-32V352c0-17.7-14.3-32-32-32H32zM352 64c0-17.7-14.3-32-32-32s-32 14.3-32 32v96c0 17.7 14.3 32 32 32h96c17.7 0 32-14.3 32-32s-14.3-32-32-32H352V64zM320 320c-17.7 0-32 14.3-32 32v96c0 17.7 14.3 32 32 32s32-14.3 32-32V384h64c17.7 0 32-14.3 32-32s-14.3-32-32-32H320z" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512" className="w-3.5 h-3.5" fill={primaryDark}>
                  <path d="M32 32C14.3 32 0 46.3 0 64v96c0 17.7 14.3 32 32 32s32-14.3 32-32V96h64c17.7 0 32-14.3 32-32s-14.3-32-32-32H32zM64 352c0-17.7-14.3-32-32-32s-32 14.3-32 32v96c0 17.7 14.3 32 32 32h96c17.7 0 32-14.3 32-32s-14.3-32-32-32H64V352zM320 32c-17.7 0-32 14.3-32 32s14.3 32 32 32h64v64c0 17.7 14.3 32 32 32s32-14.3 32-32V64c0-17.7-14.3-32-32-32H320zM448 352c0-17.7-14.3-32-32-32s-32 14.3-32 32v64H320c-17.7 0-32 14.3-32 32s14.3 32 32 32h96c17.7 0 32-14.3 32-32V352z" />
                </svg>
              )}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                handleMinimize()
              }}
              className="p-2 hover:bg-gray-100 rounded-lg transition-all hover:scale-110"
              style={{ backgroundColor: 'white' }}
              title="Minimize"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512" className="w-3.5 h-3.5" fill={primaryDark}>
                <path d="M432 256c0 17.7-14.3 32-32 32H48c-17.7 0-32-14.3-32-32s14.3-32 32-32H400c17.7 0 32 14.3 32 32z" />
              </svg>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                closeChat?.(chat._id)
              }}
              className="p-2 hover:bg-gray-100 rounded-lg transition-all hover:scale-110"
              style={{ backgroundColor: 'white' }}
              title="Close"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512" className="w-3.5 h-3.5" fill={primaryDark}>
                <path d="M342.6 150.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L192 210.7 86.6 105.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L146.7 256 41.4 361.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L192 301.3 297.4 406.6c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L237.3 256 342.6 150.6z" />
              </svg>
            </button>
          </div>
        </div>

        {/* Group Members Panel - Slide over messages when open */}
        {showMembersPanel && chat.isGroup && (
          <div
            className="absolute inset-x-0 top-[52px] bottom-0 z-10 overflow-hidden rounded-b-2xl"
            style={{
              background: 'rgba(255, 255, 255, 0.95)',
              backdropFilter: 'blur(16px)',
              animation: 'slideIn 0.2s ease-out',
            }}
          >
            {/* Panel Header */}
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
              <div className="flex items-center gap-2">
                <FaUsers className="w-4 h-4" style={{ color: primaryColor }} />
                <span className="font-semibold text-sm text-gray-800">Group Members</span>
                <span className="text-xs text-gray-500">({chat.participants?.length || 0})</span>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setShowMembersPanel(false)
                  setMemberSearchQuery('')
                }}
                className="p-1.5 hover:bg-gray-200 rounded-lg transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512" className="w-3 h-3" fill="#6B7280">
                  <path d="M342.6 150.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L192 210.7 86.6 105.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L146.7 256 41.4 361.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L192 301.3 297.4 406.6c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L237.3 256 342.6 150.6z" />
                </svg>
              </button>
            </div>

            {/* Search Bar */}
            <div className="px-3 pt-2 pb-1">
              <div className="relative">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2" fill="#9CA3AF">
                  <path d="M416 208c0 45.9-14.9 88.3-40 122.7L502.6 457.4c12.5 12.5 12.5 32.8 0 45.3s-32.8 12.5-45.3 0L330.7 376c-34.4 25.2-76.8 40-122.7 40C93.1 416 0 322.9 0 208S93.1 0 208 0S416 93.1 416 208zM208 352a144 144 0 1 0 0-288 144 144 0 1 0 0 288z" />
                </svg>
                <input
                  type="text"
                  value={memberSearchQuery}
                  onChange={(e) => setMemberSearchQuery(e.target.value)}
                  placeholder="Search members..."
                  className="w-full pl-8 pr-3 py-2 bg-gray-100 rounded-lg text-xs focus:outline-none focus:ring-1 transition-all"
                  style={{ focusRing: primaryColor }}
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            </div>

            {/* Members List */}
            <div className="overflow-y-auto p-3 pt-2 space-y-2" style={{ maxHeight: 'calc(100% - 96px)' }}>
              {chat.participants?.filter((member) => {
                if (!memberSearchQuery.trim()) return true
                const fullName = `${member.firstName || ''} ${member.lastName || ''}`.toLowerCase()
                const code = (member.employeeCode || '').toLowerCase()
                const query = memberSearchQuery.toLowerCase()
                return fullName.includes(query) || code.includes(query)
              }).map((member) => {
                const memberId = member._id || member
                const isAdmin = chat.admin?._id === memberId || chat.admin === memberId
                const isCurrentUser = memberId === currentEmployeeId || memberId === currentUserId

                return (
                  <div
                    key={memberId}
                    className={`flex items-center gap-3 p-2.5 rounded-xl transition-colors ${isCurrentUser ? 'bg-blue-50' : 'hover:bg-gray-50'
                      }`}
                  >
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center overflow-hidden flex-shrink-0"
                      style={{
                        background: `linear-gradient(135deg, ${primaryColor}, ${primaryDark})`,
                      }}
                    >
                      {member.profilePicture ? (
                        <img src={member.profilePicture} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-white font-semibold text-xs">
                          {member.firstName?.[0]}{member.lastName?.[0]}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="font-medium text-gray-900 text-sm truncate">
                          {member.firstName || 'Unknown'} {member.lastName || ''}
                        </p>
                        {isCurrentUser && (
                          <span className="text-[9px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-medium">
                            You
                          </span>
                        )}
                        {isAdmin && (
                          <span className="text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-medium">
                            Admin
                          </span>
                        )}
                      </div>
                      {member.employeeCode && (
                        <p className="text-[10px] text-gray-500 truncate">{member.employeeCode}</p>
                      )}
                    </div>
                    {/* Send Message Button - Only for other members */}
                    {!isCurrentUser && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          // Close the members panel and the popup will remain for future DM feature
                          // For now just close the panel - DM feature can be added later
                          setShowMembersPanel(false)
                          setMemberSearchQuery('')
                        }}
                        className="flex-shrink-0 transition-colors hover:opacity-70"
                        style={{ color: primaryColor }}
                        title={`Message ${member.firstName || 'User'}`}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" className="w-4 h-4" fill="currentColor">
                          <path d="M498.1 5.6c10.1 7 15.4 19.1 13.5 31.2l-64 416c-1.5 9.7-7.4 18.2-16 23s-18.9 5.4-28 1.6L284 427.7l-68.5 74.1c-8.9 9.7-22.9 12.9-35.2 8.1S160 493.3 160 480V392c0-8.5 3.4-16.6 9.4-22.6l208-208c6.2-6.2 6.2-16.4 0-22.6s-16.4-6.2-22.6 0L121.4 340.4l-96.4-40.2c-9.6-4-16.1-12.9-16.9-23.1s4.9-19.8 14.1-24.8l464-256c9.6-5.3 21.5-5.2 31 .5z" />
                        </svg>
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Messages */}
        <div
          ref={messagesContainerRef}
          className="popup-content flex-1 overflow-y-auto p-3 space-y-3"
          style={{ background: 'rgba(248, 250, 252, 0.5)' }}
        >
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <div>
                <div
                  className="w-8 h-8 border-3 border-t-transparent rounded-full animate-spin mx-auto"
                  style={{ borderColor: primaryColor, borderTopColor: 'transparent' }}
                ></div>
                <p className="text-gray-500 text-xs mt-2">Loading messages...</p>
              </div>
            </div>
          ) : messages.length > 0 ? (
            messages.map((msg, idx) => {
              const isMine = isMyMessage(msg)
              return (
                <div key={msg._id || idx} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[75%] px-3.5 py-2.5 rounded-2xl ${isMine
                        ? 'text-white rounded-br-md shadow-sm'
                        : 'text-gray-800 rounded-bl-md shadow-sm'
                      }`}
                    style={isMine ? {
                      background: `linear-gradient(135deg, ${primaryColor}, ${primaryDark})`,
                    } : {
                      background: 'rgba(255, 255, 255, 0.85)',
                      border: '1px solid rgba(255, 255, 255, 0.3)',
                    }}
                  >
                    {!isMine && chat.isGroup && (
                      <p className="text-xs font-semibold mb-1" style={{ color: primaryColor }}>
                        {msg.sender?.firstName || 'User'}
                      </p>
                    )}
                    {msg.fileUrl ? renderFileMessage(msg) : (
                      <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">{msg.content}</p>
                    )}
                    <p className={`text-[10px] mt-1.5 ${isMine ? 'text-white/70' : 'text-gray-400'}`}>
                      {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              )
            })
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div
                className="w-14 h-14 rounded-full flex items-center justify-center mb-3"
                style={{ backgroundColor: `${primaryColor}20` }}
              >
                <FaUsers className="w-6 h-6" style={{ color: primaryColor }} />
              </div>
              <p className="text-gray-500 text-sm">No messages yet</p>
              <p className="text-gray-400 text-xs mt-1">Say hi to start the conversation! 👋</p>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Typing indicator */}
        {typingText && (
          <div className="px-3 py-1.5" style={{ background: 'rgba(255, 255, 255, 0.6)' }}>
            <p className="text-xs text-gray-500 italic flex items-center gap-1">
              <span className="flex gap-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0ms' }}></span>
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '150ms' }}></span>
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '300ms' }}></span>
              </span>
              {typingText}
            </p>
          </div>
        )}

        {/* Input */}
        <div className="popup-content p-3" style={{ background: 'rgba(255, 255, 255, 0.7)' }}>
          <div className="flex items-center gap-2">
            <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="p-2.5 rounded-xl transition-colors"
              style={{ background: 'rgba(0, 0, 0, 0.05)' }}
              title="Attach file"
            >
              <FaPaperclip className="w-4 h-4 text-gray-500" />
            </button>
            <input
              type="text"
              value={message}
              onChange={handleTyping}
              onKeyPress={handleKeyPress}
              placeholder="Type a message..."
              className="flex-1 px-4 py-2.5 rounded-xl text-sm focus:outline-none focus:ring-2 transition-all"
              style={{
                background: 'rgba(255, 255, 255, 0.8)',
                border: '1px solid rgba(255, 255, 255, 0.3)',
              }}
            />
            <button
              onClick={handleSend}
              disabled={!message.trim() || sending}
              className="transition-all disabled:opacity-30 hover:opacity-70"
              style={{
                color: (!message.trim() || sending) ? '#9CA3AF' : primaryColor,
              }}
              title="Send message"
            >
              {sending ? (
                <div
                  className="animate-spin rounded-full w-5 h-5 border-2 border-t-transparent"
                  style={{ borderColor: primaryColor, borderTopColor: 'transparent' }}
                ></div>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" className="w-5 h-5" fill="currentColor">
                  <path d="M498.1 5.6c10.1 7 15.4 19.1 13.5 31.2l-64 416c-1.5 9.7-7.4 18.2-16 23s-18.9 5.4-28 1.6L284 427.7l-68.5 74.1c-8.9 9.7-22.9 12.9-35.2 8.1S160 493.3 160 480V392c0-8.5 3.4-16.6 9.4-22.6l208-208c6.2-6.2 6.2-16.4 0-22.6s-16.4-6.2-22.6 0L121.4 340.4l-96.4-40.2c-9.6-4-16.1-12.9-16.9-23.1s4.9-19.8 14.1-24.8l464-256c9.6-5.3 21.5-5.2 31 .5z" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
