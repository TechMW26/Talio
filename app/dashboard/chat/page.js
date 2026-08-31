'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { FaUserPlus, FaUsers, FaTimes, FaFile, FaImage, FaFilePdf, FaUser, FaComments, FaArrowDown, FaArrowLeft } from 'react-icons/fa'
import { useSocket } from '@/contexts/SocketContext'
import { useUnreadMessages } from '@/contexts/UnreadMessagesContext'
import { useTheme } from '@/contexts/ThemeContext'
import { useChatWidget } from '@/contexts/ChatWidgetContext'
import UnreadBadge from '@/components/UnreadBadge'
import { playNotificationSound } from '@/utils/audio'
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button, Input, Checkbox, Skeleton } from '@heroui/react'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import { useAuthedSWRStatic } from '@/hooks/useAuthedSWR'
import { uploadAuthenticatedFile } from '@/lib/client/uploadFile'

export default function ChatPage() {
  const router = useRouter()
  const { openWidget } = useChatWidget()
  // --- SWR: Initial data loads ---
  const { data: chatsRes, isLoading: chatsLoading, mutate: refreshChats } = useAuthedSWR('/api/chat')
  const { data: employeesRes, isLoading: employeesLoading } = useAuthedSWRStatic('/api/employees/list?includeAdmins=true')

  const currentUserId = useMemo(() => chatsRes?.currentUserId || null, [chatsRes])
  const employees = useMemo(() => employeesRes?.data || [], [employeesRes])

  const [chats, setChats] = useState([])
  const [selectedChat, setSelectedChat] = useState(null)
  const [messages, setMessages] = useState([])
  const [message, setMessage] = useState('')
  const [chatSearchQuery] = useState('')
  const [employeeSearchQuery, setEmployeeSearchQuery] = useState('')
  const [sending, setSending] = useState(false)
  const [showNewChatModal, setShowNewChatModal] = useState(false)
  const [showGroupModal, setShowGroupModal] = useState(false)
  const [selectedEmployees, setSelectedEmployees] = useState([])
  const [groupName, setGroupName] = useState('')
  const [presenceByEmployee, setPresenceByEmployee] = useState({})
  const [uploadingFile, setUploadingFile] = useState(false)
  const [lightboxImage, setLightboxImage] = useState(null)
  const [typingUsers, setTypingUsers] = useState({})
  const [showScrollButton, setShowScrollButton] = useState(false)
  const [isUserScrolling, setIsUserScrolling] = useState(false)
  const [replyingTo, setReplyingTo] = useState(null)
  const [showReactionPicker, setShowReactionPicker] = useState(null)
  const [swipedMessage, setSwipedMessage] = useState(null)
  const [showMembersModal, setShowMembersModal] = useState(false)
  const [memberSearchQuery, setMemberSearchQuery] = useState('')
  const messagesEndRef = useRef(null)
  const messagesContainerRef = useRef(null)
  const fileInputRef = useRef(null)
  const typingTimeoutRef = useRef(null)
  const touchStartX = useRef(0)
  const touchStartY = useRef(0)
  const longPressTimer = useRef(null)
  const { currentTheme, themes } = useTheme()

  // Redirect desktop users to dashboard and open chat widget
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth >= 768) {
      openWidget()
      router.push('/dashboard')
    }
  }, [openWidget, router])

  // Available reactions
  const reactions = ['👍', '❤️', '😂', '😮', '😢', '🙏']

  // Get Socket.IO context
  // Note: sendMessage is removed - server now broadcasts messages automatically
  const { isConnected, joinChat, leaveChat, onNewMessage, sendTyping, sendStopTyping, onUserTyping, onUserStopTyping, onMessageReaction, onMessageDeleted, requestPresence, onPresenceStatus, onPresenceUpdate } = useSocket()

  // Get unread messages context
  const { markChatAsRead, unreadChats } = useUnreadMessages()

  // Seed local chats state from SWR data
  useEffect(() => {
    if (chatsRes?.data) {
      setChats(chatsRes.data)
    }
  }, [chatsRes])

  // WebSocket: Join/leave chat rooms
  useEffect(() => {
    if (selectedChat && isConnected) {
      // Join the chat room
      joinChat(selectedChat._id)

      // Fetch initial messages only once
      fetchMessages(selectedChat._id)

      // Cleanup: leave chat when component unmounts or chat changes
      return () => {
        leaveChat(selectedChat._id)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChat?._id, isConnected])

  // WebSocket: Listen for new messages
  useEffect(() => {
    if (!selectedChat) return

    console.log('[Chat Page] Setting up message listener for chat:', selectedChat._id)

    const unsubscribe = onNewMessage((data) => {
      try {
        console.log('[Chat Page] Raw message data received:', data)

        // Safe property access
        const chatId = data?.chatId
        const newMessage = data?.message

        if (!newMessage) {
          console.warn('[Chat Page] No message in data')
          return
        }

        // Only update if it's for the current chat
        if (chatId === selectedChat._id) {
          console.log('📨 [Chat Page] Received new message for current chat:', newMessage)

          // Add message to the list if it's not already there
          setMessages(prev => {
            const exists = prev.some(msg => msg._id === newMessage._id)
            if (exists) {
              console.log('[Chat Page] Message already exists, skipping')
              return prev
            }

            // Play notification sound if message is from someone else
            const messageSenderId = newMessage?.sender?._id || newMessage?.sender
            if (messageSenderId && messageSenderId !== currentUserId) {
              console.log('[Chat Page] Playing notification sound')
              playNotificationSound()
            }

            console.log('[Chat Page] Adding message to list')
            return [...prev, newMessage]
          })
        } else {
          console.log('[Chat Page] Message is for different chat:', chatId, 'current:', selectedChat._id)
        }

        // Update chat list to show latest message and reorder
        setChats(prev => {
          const chatIndex = prev.findIndex(c => c._id === chatId)
          if (chatIndex === -1) return prev

          const updatedChats = [...prev]
          const chat = { ...updatedChats[chatIndex] }

          // Update last message info
          chat.lastMessage = newMessage?.content || newMessage?.fileName || 'File'
          chat.lastMessageAt = newMessage?.createdAt

          // Move to top
          updatedChats.splice(chatIndex, 1)
          updatedChats.unshift(chat)

          return updatedChats
        })
      } catch (error) {
        console.error('[Chat Page] Error handling new message:', error)
      }
    })

    return unsubscribe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChat?._id])

  // WebSocket: Listen for typing indicators
  useEffect(() => {
    if (!selectedChat) return

    const unsubscribeTyping = onUserTyping((data) => {
      const { userId, userName, chatId } = data
      if (chatId === selectedChat._id && userId !== currentUserId) {
        setTypingUsers(prev => ({ ...prev, [userId]: userName }))
      }
    })

    const unsubscribeStopTyping = onUserStopTyping((data) => {
      const { userId, chatId } = data
      if (chatId === selectedChat._id) {
        setTypingUsers(prev => {
          const newTyping = { ...prev }
          delete newTyping[userId]
          return newTyping
        })
      }
    })

    // Listen for message reactions
    const unsubscribeReaction = onMessageReaction?.((data) => {
      if (data.chatId === selectedChat?._id) {
        setMessages(prev => prev.map(msg =>
          msg._id === data.messageId ? data.message : msg
        ))
      }
    })

    // Listen for message deletions
    const unsubscribeDelete = onMessageDeleted?.((data) => {
      if (data.chatId === selectedChat?._id) {
        setMessages(prev => prev.filter(msg => msg._id !== data.messageId))
      }
    })

    return () => {
      unsubscribeTyping?.()
      unsubscribeStopTyping?.()
      unsubscribeReaction?.()
      unsubscribeDelete?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChat?._id, currentUserId])

  // WebSocket: Presence updates
  useEffect(() => {
    const unsubscribeStatus = onPresenceStatus?.((data) => {
      const updates = data?.employees || []
      updatePresenceState(updates)
    })

    const unsubscribeUpdate = onPresenceUpdate?.((data) => {
      const updates = data?.employeeId ? [data] : data?.employees || []
      updatePresenceState(updates)
    })

    return () => {
      unsubscribeStatus?.()
      unsubscribeUpdate?.()
    }
  }, [onPresenceStatus, onPresenceUpdate])

  const getOtherParticipant = useCallback((chat) => {
    if (!chat || chat.isGroup) return null
    return chat.participants.find(p => p._id !== currentUserId) || null
  }, [currentUserId])

  // Request presence for selected direct chat
  useEffect(() => {
    if (!selectedChat || selectedChat.isGroup) return
    const other = getOtherParticipant(selectedChat)
    if (other?._id) {
      requestPresence?.([other._id])
    }
  }, [selectedChat, requestPresence, currentUserId, getOtherParticipant])

  // Auto-scroll to bottom when messages change (only if user is not scrolling up)
  useEffect(() => {
    if (!isUserScrolling) {
      scrollToBottom('auto') // Use instant scroll for initial load
    }
  }, [messages, isUserScrolling])

  // Detect scroll position to show/hide scroll-to-bottom button
  const handleScroll = () => {
    if (!messagesContainerRef.current) return

    const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 100

    setShowScrollButton(!isNearBottom)
    setIsUserScrolling(!isNearBottom)
  }

  const scrollToBottom = (behavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior })
    setShowScrollButton(false)
    setIsUserScrolling(false)
  }

  // Touch handlers for swipe to reply
  const handleTouchStart = (e, msg) => {
    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY

    // Start long press timer
    longPressTimer.current = setTimeout(() => {
      setShowReactionPicker(msg._id)
    }, 500)
  }

  const handleTouchMove = (e, msg) => {
    // Cancel long press if user moves
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
    }

    const touchX = e.touches[0].clientX
    const touchY = e.touches[0].clientY
    const deltaX = touchX - touchStartX.current
    const deltaY = touchY - touchStartY.current

    // Only trigger swipe if horizontal movement is greater than vertical
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 50) {
      setSwipedMessage(msg._id)
    }
  }

  const handleTouchEnd = (e, msg) => {
    // Cancel long press timer
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
    }

    const touchX = e.changedTouches[0].clientX
    const deltaX = touchX - touchStartX.current

    // Swipe right to reply (for received messages on left, swipe right)
    // Swipe left to reply (for sent messages on right, swipe left)
    const isMine = msg.sender._id === currentUserId
    const swipeThreshold = 80

    if (!isMine && deltaX > swipeThreshold) {
      // Swiped right on received message
      setReplyingTo(msg)
      setSwipedMessage(null)
    } else if (isMine && deltaX < -swipeThreshold) {
      // Swiped left on sent message
      setReplyingTo(msg)
      setSwipedMessage(null)
    } else {
      setSwipedMessage(null)
    }
  }

  // Add reaction to message
  const handleReaction = async (messageId, reaction) => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/chat/${selectedChat._id}/messages/${messageId}/react`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reaction })
      })
      const result = await response.json()

      if (result.success) {
        // Update message locally
        setMessages(prev => prev.map(msg =>
          msg._id === messageId ? result.data : msg
        ))
      }
    } catch (error) {
      console.error('Error adding reaction:', error)
    } finally {
      setShowReactionPicker(null)
    }
  }

  // Delete message
  const handleDeleteMessage = async (messageId) => {
    if (!confirm('Delete this message?')) return

    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/chat/${selectedChat._id}/messages/${messageId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const result = await response.json()

      if (result.success) {
        // Remove message locally
        setMessages(prev => prev.filter(msg => msg._id !== messageId))
      }
    } catch (error) {
      console.error('Error deleting message:', error)
    } finally {
      setShowReactionPicker(null)
    }
  }



  const fetchMessages = async (chatId) => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/chat/${chatId}/messages`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const result = await response.json()
      if (result.success) {
        setMessages(result.data)
        // Mark chat as read when viewing messages
        markChatAsRead(chatId)
      }
    } catch (error) {
      console.error('Error:', error)
    }
  }

  const handleSendMessage = async () => {
    if (!message.trim() || !selectedChat || sending) return

    // Stop typing indicator
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current)
      sendStopTyping(selectedChat._id, currentUserId)
    }

    setSending(true)
    const messageContent = message
    const replyToMessage = replyingTo
    setMessage('') // Clear input immediately for better UX
    setReplyingTo(null) // Clear reply

    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/chat/${selectedChat._id}/messages`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: messageContent,
          replyTo: replyToMessage?._id
        })
      })
      const result = await response.json()
      if (result.success) {
        // Server will broadcast via WebSocket automatically
        // Add message locally for immediate feedback (WebSocket handler will prevent duplicates)
        setMessages(prev => {
          const exists = prev.some(msg => msg._id === result.data._id)
          if (exists) return prev
          return [...prev, result.data]
        })

        // Update chat list
        setChats(prev => {
          const chatIndex = prev.findIndex(c => c._id === selectedChat._id)
          if (chatIndex === -1) return prev

          const updatedChats = [...prev]
          const chat = { ...updatedChats[chatIndex] }
          chat.lastMessage = result.data.content || result.data.fileName || 'File'
          chat.lastMessageAt = result.data.createdAt

          // Move to top
          updatedChats.splice(chatIndex, 1)
          updatedChats.unshift(chat)

          return updatedChats
        })
      } else {
        // Restore message if failed
        setMessage(messageContent)
        setReplyingTo(replyToMessage)
      }
    } catch (error) {
      console.error('Error:', error)
      // Restore message if failed
      setMessage(messageContent)
      setReplyingTo(replyToMessage)
    } finally {
      setSending(false)
    }
  }

  // Handle typing indicator
  const handleTyping = () => {
    if (!selectedChat || !currentUserId) return

    // Get current user name
    const userData = localStorage.getItem('user')
    const userName = userData ? JSON.parse(userData).firstName : 'User'

    // Send typing indicator
    sendTyping(selectedChat._id, currentUserId, userName)

    // Clear existing timeout
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current)
    }

    // Set timeout to stop typing after 2 seconds of inactivity
    typingTimeoutRef.current = setTimeout(() => {
      sendStopTyping(selectedChat._id, currentUserId)
    }, 2000)
  }

  const handleFileUpload = async (e) => {
    const file = e.target.files[0]
    if (!file || !selectedChat) return
    setUploadingFile(true)
    try {
      const token = localStorage.getItem('token')
      const uploadResult = await uploadAuthenticatedFile(file, { category: 'chat', token })

      if (uploadResult.success) {
        const response = await fetch(`/api/chat/${selectedChat._id}/messages`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: `Sent a file: ${uploadResult.data.fileName}`,
            fileUrl: uploadResult.data.fileUrl,
            fileId: uploadResult.data.fileId,
            fileName: uploadResult.data.fileName,
            fileType: uploadResult.data.fileType,
            fileSize: uploadResult.data.fileSize
          })
        })
        const result = await response.json()
        if (result.success) {
          setMessages([...messages, result.data])
          refreshChats()
        }
      }
    } catch (error) {
      console.error('Error:', error)
    } finally {
      setUploadingFile(false)
    }
  }

  const updatePresenceState = (updates) => {
    if (!updates || updates.length === 0) return
    setPresenceByEmployee(prev => {
      const next = { ...prev }
      updates.forEach(update => {
        if (!update?.employeeId) return
        next[update.employeeId] = {
          isOnline: !!update.isOnline,
          lastSeenAt: update.lastSeenAt || null
        }
      })
      return next
    })
  }

  const handleCreateChat = async (employeeId) => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ isGroup: false, participants: [employeeId] })
      })
      const result = await response.json()
      if (result.success) {
        refreshChats()
        setSelectedChat(result.data)
        setShowNewChatModal(false)
      }
    } catch (error) {
      console.error('Error:', error)
    }
  }

  const handleCreateGroup = async () => {
    if (!groupName.trim() || selectedEmployees.length === 0) return
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ isGroup: true, participants: selectedEmployees, name: groupName })
      })
      const result = await response.json()
      if (result.success) {
        refreshChats()
        setSelectedChat(result.data)
        setShowGroupModal(false)
        setGroupName('')
        setSelectedEmployees([])
      }
    } catch (error) {
      console.error('Error:', error)
    }
  }

  const getChatName = (chat) => {
    if (chat.isGroup) return chat.name
    const other = getOtherParticipant(chat)
    return other ? `${other.firstName} ${other.lastName}` : 'Unknown'
  }

  const getChatAvatar = (chat) => {
    if (chat.isGroup) return null
    const other = getOtherParticipant(chat)
    return other?.profilePicture
  }

  const getPresenceText = (chat) => {
    if (!chat || chat.isGroup) return null
    const other = getOtherParticipant(chat)
    const otherId = other?._id?.toString?.() || other?._id
    const presence = otherId ? presenceByEmployee[otherId] : null
    if (presence?.isOnline) return 'Online'
    if (presence?.lastSeenAt) return `Last seen ${formatLastSeen(presence.lastSeenAt)}`
    return 'Offline'
  }

  const getFileIcon = (fileType) => {
    if (fileType?.startsWith('image/')) return <FaImage className="text-blue-500 text-2xl" />
    if (fileType === 'application/pdf') return <FaFilePdf className="text-red-500 text-2xl" />
    return <FaFile className="text-gray-500 text-2xl" />
  }

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }

  const formatTime = (date) => {
    const d = new Date(date)
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  }

  const formatMessageTime = (date) => {
    const d = new Date(date)
    const now = new Date()
    const diffDays = Math.floor((now - d) / 86400000)

    // If today, show time
    if (diffDays === 0) {
      return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    }
    // If yesterday
    if (diffDays === 1) {
      return 'Yesterday ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    }
    // If within a week, show day name
    if (diffDays < 7) {
      return d.toLocaleDateString('en-US', { weekday: 'short' }) + ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    }
    // Otherwise show date
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  }

  const formatLastSeen = (date) => {
    if (!date) return 'recently'
    const d = new Date(date)
    const now = new Date()
    const diffMs = now - d
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return 'just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    if (diffDays < 7) return d.toLocaleDateString('en-US', { weekday: 'short', hour: '2-digit', minute: '2-digit' })
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const getDateSeparator = (date) => {
    const d = new Date(date)
    const now = new Date()
    const diffDays = Math.floor((now - d) / 86400000)

    if (diffDays === 0) return 'Today'
    if (diffDays === 1) return 'Yesterday'
    if (diffDays < 7) return d.toLocaleDateString('en-US', { weekday: 'long' })
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  }

  const filteredChats = chats.filter(chat =>
    getChatName(chat).toLowerCase().includes(chatSearchQuery.toLowerCase())
  )

  const filteredEmployees = employeeSearchQuery.trim()
    ? employees.filter(emp =>
      `${emp.firstName} ${emp.lastName}`.toLowerCase().includes(employeeSearchQuery.toLowerCase()) ||
      emp.email?.toLowerCase().includes(employeeSearchQuery.toLowerCase()) ||
      emp.employeeCode?.toLowerCase().includes(employeeSearchQuery.toLowerCase())
    )
    : employees.slice(0, 10) // Show first 10 employees by default

  if (chatsLoading) {
    return (
      <div className="fixed inset-0 bg-gray-50 pt-20 px-4">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <div>
              <Skeleton className="h-7 w-32 rounded-lg mb-2" />
              <Skeleton className="h-4 w-48 rounded-lg" />
            </div>
            <div className="flex gap-2">
              <Skeleton className="w-14 h-14 rounded-full" />
              <Skeleton className="w-14 h-14 rounded-full" />
            </div>
          </div>
          <div className="bg-white rounded-2xl shadow-md overflow-hidden">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-4 border-b border-gray-100">
                <Skeleton className="w-12 h-12 rounded-full flex-shrink-0" />
                <div className="flex-1">
                  <Skeleton className="h-4 w-32 rounded mb-2" />
                  <Skeleton className="h-3 w-48 rounded" />
                </div>
                <Skeleton className="h-3 w-10 rounded" />
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      {/* Header - Hide on mobile when chat is selected, always show on desktop */}
      <div className={`${selectedChat ? 'hidden md:flex' : 'flex'} fixed top-[72px] left-0 right-0 z-[45] bg-white px-4 py-3 md:relative md:top-auto md:left-auto md:right-auto md:z-auto md:px-0 md:pt-0 md:pb-0 md:mb-4 items-center justify-between md:bg-transparent md:page-container shadow-sm md:shadow-none`}>
        <div>
          <h1 className="text-xl md:text-2xl lg:text-3xl font-bold text-gray-800">Chat</h1>
          <p className="text-xs md:text-sm lg:text-base text-gray-600 mt-1">Connect with your team</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowNewChatModal(true)}
            className="bg-[#6B7FFF] text-white w-14 h-14 rounded-full hover:bg-[#5A6EEE] transition-colors flex items-center justify-center shadow-md"
            title="New Chat"
          >
            <FaUserPlus className="text-base" />
          </button>
          <button
            onClick={() => setShowGroupModal(true)}
            className="bg-[#00D9A5] text-white w-14 h-14 rounded-full hover:bg-[#00C794] transition-colors flex items-center justify-center shadow-md"
            title="New Group"
          >
            <FaUsers className="text-base" />
          </button>
        </div>
      </div>

      {/* Chat Container - Full screen edge-to-edge on mobile */}
      <div className={`${selectedChat
        ? 'fixed top-[60px] left-0 right-0 bottom-[72px] z-[60] md:relative md:top-auto md:left-auto md:right-auto md:bottom-auto md:rounded-2xl md:h-100%'
        : 'fixed top-[140px] left-0 right-0 bottom-[72px] z-[40] bg-white md:relative md:top-auto md:left-auto md:right-auto md:bottom-auto md:rounded-2xl md:shadow-md md:h-auto md:mt-0 px-4'
        }`} style={{
          height: 'auto',
          maxHeight: 'none'
        }}>
        <div className="grid grid-cols-1 md:grid-cols-3 h-full m-0 p-0">
          {/* Chat List - Hide on mobile when chat is selected */}
          <div className={`border-r border-gray-100 flex flex-col h-full m-0 p-0 ${selectedChat ? 'hidden md:flex' : 'flex'}`}>
            {/* Chat list - no header, just the list */}
            <div className="overflow-y-auto flex-1 m-0 p-0">
              {filteredChats.length === 0 ? (
                <div className="px-4 py-4 text-center text-gray-500 text-sm">
                  No chats yet. Start a new conversation!
                </div>
              ) : (
                <>
                  {filteredChats.map((chat) => (
                    <div
                      key={chat._id}
                      onClick={() => setSelectedChat(chat)}
                      className={`py-4 px-0 md:py-4 md:px-4 cursor-pointer hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-b-0 ${selectedChat?._id === chat._id ? 'bg-gray-50' : ''
                        }`}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className="w-12 h-12 md:w-11 md:h-11 rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden relative"
                          style={{
                            background: `linear-gradient(135deg, ${themes[currentTheme]?.primary?.[600] || '#2563EB'} 0%, ${themes[currentTheme]?.primary?.[500] || '#3B82F6'} 100%)`
                          }}
                        >
                          {getChatAvatar(chat) ? (
                            <img src={getChatAvatar(chat)} alt="" className="w-full h-full object-cover" />
                          ) : chat.isGroup ? (
                            <FaUsers className="text-white text-lg" />
                          ) : (
                            <FaUser className="text-white text-lg" />
                          )}
                          {unreadChats[chat._id] > 0 && (
                            <UnreadBadge count={unreadChats[chat._id]} />
                          )}
                        </div>
                        <div className="flex-1 min-w-0 pr-2">
                          <div className="flex items-center justify-between mb-1">
                            <h3 className={`font-semibold truncate text-[15px] ${unreadChats[chat._id] > 0 ? 'text-gray-900' : 'text-gray-900'}`}>{getChatName(chat)}</h3>
                            <span className="text-xs text-gray-400 ml-2 flex-shrink-0">{chat.lastMessageAt ? formatTime(chat.lastMessageAt) : ''}</span>
                          </div>
                          <p className={`text-sm truncate ${unreadChats[chat._id] > 0 ? 'text-gray-900 font-semibold' : 'text-gray-500'}`}>{chat.lastMessage || 'No messages yet'}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>

          {/* Chat Messages - Full screen on mobile */}
          <div className={`md:col-span-2 flex flex-col h-full overflow-hidden ${selectedChat ? 'flex' : 'hidden md:flex'}`}>
            {selectedChat ? (
              <>
                {/* Chat Header - Clean minimal design */}
                <div className="px-4 py-3 md:px-6 md:py-4 bg-white flex items-center gap-3 flex-shrink-0 border-b border-gray-100">
                  <button
                    onClick={() => setSelectedChat(null)}
                    className="text-gray-600 hover:text-gray-900 -ml-1 md:hidden"
                    title="Back to chats"
                  >
                    <FaArrowLeft className="text-xl" />
                  </button>
                  <div
                    className="w-11 h-11 md:w-10 md:h-10 rounded-full flex items-center justify-center overflow-hidden flex-shrink-0"
                    style={{
                      background: `linear-gradient(135deg, ${themes[currentTheme]?.primary?.[600] || '#2563EB'} 0%, ${themes[currentTheme]?.primary?.[500] || '#3B82F6'} 100%)`
                    }}
                  >
                    {getChatAvatar(selectedChat) ? (
                      <img src={getChatAvatar(selectedChat)} alt="" className="w-full h-full object-cover" />
                    ) : selectedChat.isGroup ? (
                      <FaUsers className="text-white text-base" />
                    ) : (
                      <FaUser className="text-white text-lg" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-gray-900 text-lg md:text-base truncate">{getChatName(selectedChat)}</h3>
                    {selectedChat.isGroup ? (
                      <p className="text-xs text-gray-500">{selectedChat.participants?.length || 0} members</p>
                    ) : (
                      <p className="text-xs text-gray-500">{getPresenceText(selectedChat)}</p>
                    )}
                  </div>
                  {/* View Members Button - Only for group chats */}
                  {selectedChat.isGroup && (
                    <button
                      onClick={() => setShowMembersModal(true)}
                      className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-full transition-colors"
                      title="View Members"
                    >
                      <FaUsers className="text-lg" />
                    </button>
                  )}
                </div>

                {/* Messages Area - Clean white background with scroll */}
                <div
                  ref={messagesContainerRef}
                  onScroll={handleScroll}
                  className="flex-1 overflow-y-auto -mt-[0.8em] mb-12 overflow-x-hidden px-4 py-6 pb-44 md:pb-12 md:px-6 md:py-6 space-y-4 bg-white min-h-0"
                >
                  {messages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-gray-400">
                      <FaComments className="text-5xl mb-3 opacity-30" />
                      <p className="text-sm text-gray-400">No messages yet. Start the conversation!</p>
                    </div>
                  ) : (
                    messages.map((msg, idx) => {
                      const isMine = msg.sender._id === currentUserId
                      const showDateSeparator = idx === 0 || getDateSeparator(messages[idx - 1].createdAt) !== getDateSeparator(msg.createdAt)

                      return (
                        <div key={idx}>
                          {/* Date separator */}
                          {showDateSeparator && (
                            <div className="flex justify-center mb-4 mt-2">
                              <span className="text-xs text-gray-400 bg-gray-100 px-3 py-1 rounded-full">
                                {getDateSeparator(msg.createdAt)}
                              </span>
                            </div>
                          )}

                          <div className={`flex ${isMine ? 'justify-end' : 'justify-start'} mb-3 relative`}>
                            {/* Swipe Reply Indicator */}
                            {swipedMessage === msg._id && (
                              <div className={`absolute top-1/2 -translate-y-1/2 ${isMine ? 'right-full mr-2' : 'left-full ml-2'}`}>
                                <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                                </svg>
                              </div>
                            )}

                            <div
                              className={`max-w-[80%] sm:max-w-sm ${isMine ? '' : 'flex items-start gap-2.5'} transition-transform duration-200`}
                              style={{
                                transform: swipedMessage === msg._id
                                  ? isMine ? 'translateX(-30px)' : 'translateX(30px)'
                                  : 'translateX(0)'
                              }}
                              onTouchStart={(e) => handleTouchStart(e, msg)}
                              onTouchMove={(e) => handleTouchMove(e, msg)}
                              onTouchEnd={(e) => handleTouchEnd(e, msg)}
                            >
                              {!isMine && (
                                <div
                                  className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden"
                                  style={{
                                    background: `linear-gradient(135deg, ${themes[currentTheme]?.primary?.[600] || '#2563EB'} 0%, ${themes[currentTheme]?.primary?.[500] || '#3B82F6'} 100%)`
                                  }}
                                >
                                  {msg.sender.profilePicture ? (
                                    <img src={msg.sender.profilePicture} alt="" className="w-full h-full object-cover" />
                                  ) : (
                                    <FaUser className="text-white text-sm" />
                                  )}
                                </div>
                              )}
                              <div className="flex-1 relative">
                                {msg.fileUrl ? (
                                  <div
                                    className={`px-4 py-3 rounded-2xl relative ${isMine ? 'text-white rounded-br-md' : 'bg-white text-gray-900 rounded-bl-md shadow-sm border border-gray-100'}`}
                                    style={isMine ? {
                                      background: `linear-gradient(135deg, ${themes[currentTheme]?.primary?.[600] || '#2563EB'} 0%, ${themes[currentTheme]?.primary?.[500] || '#3B82F6'} 100%)`
                                    } : {}}
                                  >
                                    {/* Reply Preview */}
                                    {msg.replyTo && (
                                      <div className={`mb-2 pb-2 border-l-2 pl-2 ${isMine ? 'border-white/50' : 'border-gray-300'}`}>
                                        <p className="text-xs opacity-75 font-semibold">{msg.replyTo.sender?.firstName || 'User'}</p>
                                        <p className="text-xs opacity-75 truncate">{msg.replyTo.content || 'File'}</p>
                                      </div>
                                    )}

                                    {msg.fileType?.startsWith('image/') ? (
                                      <img
                                        src={msg.fileUrl}
                                        alt={msg.fileName}
                                        className="max-w-full rounded-lg mb-2 cursor-pointer hover:opacity-90 transition-opacity"
                                        onClick={() => setLightboxImage(msg.fileUrl)}
                                      />
                                    ) : (
                                      <div className="flex items-center gap-3">
                                        {getFileIcon(msg.fileType)}
                                        <div className="flex-1 min-w-0">
                                          <p className="text-sm font-semibold truncate">{msg.fileName}</p>
                                          <p className="text-xs opacity-75">{formatFileSize(msg.fileSize)}</p>
                                        </div>
                                      </div>
                                    )}
                                    {msg.content && <p className="text-[15px] leading-relaxed mb-1">{msg.content}</p>}
                                    <p className="text-xs mt-1 opacity-75">{formatMessageTime(msg.createdAt)}</p>

                                    {/* Reactions */}
                                    {msg.reactions && msg.reactions.length > 0 && (
                                      <div className="flex gap-1 mt-2 flex-wrap">
                                        {Object.entries(
                                          msg.reactions.reduce((acc, r) => {
                                            acc[r.reaction] = (acc[r.reaction] || 0) + 1
                                            return acc
                                          }, {})
                                        ).map(([reaction, count]) => (
                                          <span key={reaction} className="text-xs bg-white/20 px-2 py-0.5 rounded-full">
                                            {reaction} {count > 1 && count}
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <div
                                    className={`px-4 py-3 rounded-2xl relative ${isMine ? 'text-white rounded-br-md' : 'bg-white text-gray-900 rounded-bl-md shadow-sm border border-gray-100'}`}
                                    style={isMine ? {
                                      background: `linear-gradient(135deg, ${themes[currentTheme]?.primary?.[600] || '#2563EB'} 0%, ${themes[currentTheme]?.primary?.[500] || '#3B82F6'} 100%)`
                                    } : {}}
                                  >
                                    {/* Reply Preview */}
                                    {msg.replyTo && (
                                      <div className={`mb-2 pb-2 border-l-2 pl-2 ${isMine ? 'border-white/50' : 'border-gray-300'}`}>
                                        <p className="text-xs opacity-75 font-semibold">{msg.replyTo.sender?.firstName || 'User'}</p>
                                        <p className="text-xs opacity-75 truncate">{msg.replyTo.content || 'File'}</p>
                                      </div>
                                    )}

                                    {!isMine && selectedChat.isGroup && <p className="text-xs font-semibold mb-1 opacity-90">{msg.sender.firstName} {msg.sender.lastName}</p>}
                                    <p className="text-[15px] leading-relaxed mb-1">{msg.content}</p>
                                    <p className="text-xs opacity-75">{formatMessageTime(msg.createdAt)}</p>

                                    {/* Reactions */}
                                    {msg.reactions && msg.reactions.length > 0 && (
                                      <div className="flex gap-1 mt-2 flex-wrap">
                                        {Object.entries(
                                          msg.reactions.reduce((acc, r) => {
                                            acc[r.reaction] = (acc[r.reaction] || 0) + 1
                                            return acc
                                          }, {})
                                        ).map(([reaction, count]) => (
                                          <span key={reaction} className="text-xs bg-white/20 px-2 py-0.5 rounded-full">
                                            {reaction} {count > 1 && count}
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                )}

                                {/* Reaction Picker */}
                                {showReactionPicker === msg._id && (
                                  <div
                                    className={`fixed z-[200] ${isMine ? 'right-4' : 'left-4'}`}
                                    style={{
                                      bottom: '140px',
                                      maxWidth: 'calc(100vw - 2rem)'
                                    }}
                                  >
                                    <div className="bg-white rounded-2xl shadow-2xl px-4 py-3 flex gap-3 border border-gray-200 items-center">
                                      {reactions.map(reaction => (
                                        <button
                                          key={reaction}
                                          onClick={() => handleReaction(msg._id, reaction)}
                                          className="text-2xl hover:scale-125 transition-transform active:scale-110"
                                        >
                                          {reaction}
                                        </button>
                                      ))}
                                      <div className="w-px h-6 bg-gray-200"></div>
                                      <button
                                        onClick={() => handleDeleteMessage(msg._id)}
                                        className="text-red-500 hover:scale-125 transition-transform text-xl active:scale-110"
                                        title="Delete message"
                                      >
                                        🗑️
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    })
                  )}

                  {/* Typing Indicator */}
                  {Object.keys(typingUsers).length > 0 && (
                    <div className="flex justify-start mb-3">
                      <div className="flex items-start gap-2.5">
                        <div
                          className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
                          style={{
                            background: `linear-gradient(135deg, ${themes[currentTheme]?.primary?.[600] || '#2563EB'} 0%, ${themes[currentTheme]?.primary?.[500] || '#3B82F6'} 100%)`
                          }}
                        >
                          <FaUser className="text-white text-sm" />
                        </div>
                        <div className="px-4 py-3 rounded-2xl bg-white text-gray-900 rounded-bl-md shadow-sm border border-gray-100">
                          <p className="text-xs text-gray-500 mb-1">
                            {Object.values(typingUsers).join(', ')} {Object.keys(typingUsers).length === 1 ? 'is' : 'are'} typing...
                          </p>
                          <div className="flex gap-1">
                            <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                            <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                            <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  <div ref={messagesEndRef} />
                </div>

                {/* Reaction Picker Backdrop */}
                {showReactionPicker && (
                  <div
                    className="fixed inset-0 bg-black/20 backdrop-blur-[10px] z-[199]"
                    onClick={() => setShowReactionPicker(null)}
                  />
                )}

                {/* Scroll to Bottom Button */}
                {showScrollButton && (
                  <button
                    onClick={() => scrollToBottom('smooth')}
                    className="fixed bottom-[180px] right-6 md:absolute md:bottom-24 md:right-8 w-12 h-12 rounded-full shadow-lg flex items-center justify-center z-50 transition-all hover:scale-110"
                    style={{
                      background: `linear-gradient(135deg, ${themes[currentTheme]?.primary?.[600] || '#2563EB'} 0%, ${themes[currentTheme]?.primary?.[500] || '#3B82F6'} 100%)`
                    }}
                    title="Scroll to latest message"
                  >
                    <FaArrowDown className="text-white text-lg" />
                  </button>
                )}

                {/* Message Input - Sleek minimal design */}
                <div className="fixed bottom-[72px] left-0 right-0 px-4 py-2 bg-white border-t border-gray-100 z-[100] md:relative md:bottom-auto md:left-auto md:right-auto md:px-6 md:py-2 flex-shrink-0">
                  {/* Reply Preview */}
                  {replyingTo && (
                    <div className="mb-2 bg-gray-50 rounded-lg p-[10px] flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-gray-600 mb-1">
                          Replying to {replyingTo.sender?.firstName || 'User'}
                        </p>
                        <p className="text-sm text-gray-700 truncate">
                          {replyingTo.content || replyingTo.fileName || 'File'}
                        </p>
                      </div>
                      <button
                        onClick={() => setReplyingTo(null)}
                        className="text-gray-400 hover:text-gray-600 flex-shrink-0"
                      >
                        <FaTimes className="text-sm" />
                      </button>
                    </div>
                  )}

                  <div className="flex items-center gap-2 max-w-full">
                    <input
                      ref={fileInputRef}
                      type="file"
                      onChange={handleFileUpload}
                      className="hidden"
                      accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip,.rar,.ppt,.pptx,.mp4,.mp3,.avi,.mov,.svg,.json,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/zip,application/x-rar-compressed,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,image/*,video/*,audio/*"
                    />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadingFile}
                      className="transition-colors disabled:opacity-50 flex-shrink-0 p-2.5 rounded-full"
                      style={{
                        color: themes[currentTheme]?.primary?.[600] || '#2563EB'
                      }}
                      title="Attach file"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                    </button>
                    <input
                      type="text"
                      value={message}
                      onChange={(e) => {
                        setMessage(e.target.value)
                        handleTyping()
                      }}
                      onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
                      placeholder="Type a message..."
                      className="flex-1 min-w-0 px-4 py-2.5 border-0 rounded-full focus:outline-none text-[15px] bg-gray-50 text-gray-900 placeholder-gray-400"
                    />
                    <button
                      onClick={handleSendMessage}
                      disabled={sending || !message.trim()}
                      className="transition-all disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0"
                      style={{
                        color: (sending || !message.trim())
                          ? '#9CA3AF'
                          : themes[currentTheme]?.primary?.[600] || '#2563EB'
                      }}
                      title="Send message"
                    >
                      {sending ? (
                        <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" className="w-6 h-6" fill="currentColor">
                          <path d="M498.1 5.6c10.1 7 15.4 19.1 13.5 31.2l-64 416c-1.5 9.7-7.4 18.2-16 23s-18.9 5.4-28 1.6L284 427.7l-68.5 74.1c-8.9 9.7-22.9 12.9-35.2 8.1S160 493.3 160 480V392c0-8.5 3.4-16.6 9.4-22.6l208-208c6.2-6.2 6.2-16.4 0-22.6s-16.4-6.2-22.6 0L121.4 340.4l-96.4-40.2c-9.6-4-16.1-12.9-16.9-23.1s4.9-19.8 14.1-24.8l464-256c9.6-5.3 21.5-5.2 31 .5z" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-gray-400 ">
                <div className="text-center">
                  <FaComments className="text-6xl mx-auto mb-4 opacity-30" />
                  <p className="text-base text-gray-400">Select a chat to start messaging</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* New Chat Modal */}
      <Modal isOpen={showNewChatModal} onOpenChange={setShowNewChatModal} size="md">
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>New Chat</ModalHeader>
              <ModalBody>
                <Input
                  type="text"
                  value={employeeSearchQuery}
                  onChange={(e) => setEmployeeSearchQuery(e.target.value)}
                  placeholder="Search employees..."
                  variant="bordered"
                  classNames={{
                    inputWrapper: "bg-default-50 dark:bg-[#18181b] shadow-none",
                  }}
                  className="mb-4"
                />
                <div className="space-y-2 max-h-96 overflow-y-auto scrollbar-hide">
                  {filteredEmployees.length === 0 ? (
                    <div className="text-center text-default-500 py-8 text-sm">
                      {employeeSearchQuery ? 'No employees found' : 'No employees available'}
                    </div>
                  ) : (
                    <>
                      {filteredEmployees.map((emp) => (
                        <div
                          key={emp._id}
                          onClick={() => handleCreateChat(emp._id)}
                          className="flex items-center gap-3 p-3 rounded-lg hover:bg-default-100 cursor-pointer"
                        >
                          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center overflow-hidden">
                            {emp.profilePicture ? (
                              <img src={emp.profilePicture} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <span className="text-white font-bold">{emp.firstName[0]}</span>
                            )}
                          </div>
                          <div>
                            <p className="font-semibold text-default-800 text-sm">{emp.firstName} {emp.lastName}</p>
                            <p className="text-xs text-default-500">{emp.designation?.title || 'Employee'}</p>
                          </div>
                        </div>
                      ))}
                      {!employeeSearchQuery && employees.length > 10 && (
                        <div className="text-center text-xs text-default-500 py-2 border-t border-default-200">
                          Showing 10 of {employees.length} employees. Use search to find more.
                        </div>
                      )}
                    </>
                  )}
                </div>
              </ModalBody>
            </>
          )}
        </ModalContent>
      </Modal>

      {/* New Group Modal */}
      <Modal isOpen={showGroupModal} onOpenChange={setShowGroupModal} size="md">
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>New Group</ModalHeader>
              <ModalBody>
                <div className="space-y-3 mb-4">
                  <Input
                    type="text"
                    value={groupName}
                    onChange={(e) => setGroupName(e.target.value)}
                    placeholder="Group name..."
                  />
                  <Input
                    type="text"
                    value={employeeSearchQuery}
                    onChange={(e) => setEmployeeSearchQuery(e.target.value)}
                    placeholder="Search employees..."
                    variant="bordered"
                    classNames={{
                      inputWrapper: "bg-default-50 dark:bg-[#18181b] shadow-none",
                    }}
                  />
                </div>
                <div className="space-y-2 mb-4 max-h-96 overflow-y-auto scrollbar-hide">
                  {filteredEmployees.length === 0 ? (
                    <div className="text-center text-default-500 py-8 text-sm">
                      {employeeSearchQuery ? 'No employees found' : 'No employees available'}
                    </div>
                  ) : (
                    <>
                      {filteredEmployees.map((emp) => (
                        <div
                          key={emp._id}
                          onClick={() => {
                            if (selectedEmployees.includes(emp._id)) {
                              setSelectedEmployees(selectedEmployees.filter(id => id !== emp._id))
                            } else {
                              setSelectedEmployees([...selectedEmployees, emp._id])
                            }
                          }}
                          className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer ${selectedEmployees.includes(emp._id) ? 'bg-primary-50 border-2 border-primary-500' : 'hover:bg-default-100'}`}
                        >
                          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center overflow-hidden">
                            {emp.profilePicture ? (
                              <img src={emp.profilePicture} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <span className="text-white font-bold">{emp.firstName[0]}</span>
                            )}
                          </div>
                          <div className="flex-1">
                            <p className="font-semibold text-default-800 text-sm">{emp.firstName} {emp.lastName}</p>
                            <p className="text-xs text-default-500">{emp.designation?.title || 'Employee'}</p>
                          </div>
                          {selectedEmployees.includes(emp._id) && (
                            <div className="w-6 h-6 rounded-full bg-primary-600 flex items-center justify-center">
                              <FaTimes className="text-white text-xs" />
                            </div>
                          )}
                        </div>
                      ))}
                      {!employeeSearchQuery && employees.length > 10 && (
                        <div className="text-center text-xs text-default-500 py-2 border-t border-default-200">
                          Showing 10 of {employees.length} employees. Use search to find more.
                        </div>
                      )}
                    </>
                  )}
                </div>
              </ModalBody>
              <ModalFooter>
                <Button
                  color="success"
                  onPress={handleCreateGroup}
                  isDisabled={!groupName.trim() || selectedEmployees.length === 0}
                  className="w-full"
                >
                  Create Group ({selectedEmployees.length} members)
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      {/* Lightbox for images */}
      {lightboxImage && (
        <div
          className="fixed inset-0 bg-black bg-opacity-90 backdrop-blur-[10px] z-[200] flex items-center justify-center p-4"
          onClick={() => setLightboxImage(null)}
        >
          <button
            onClick={() => setLightboxImage(null)}
            className="absolute top-4 right-4 text-white hover:text-gray-300 transition-colors z-[201]"
            title="Close"
          >
            <FaTimes className="text-3xl" />
          </button>
          <div className="relative max-w-7xl max-h-full">
            <img
              src={lightboxImage}
              alt="Full size"
              className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}

      {/* Group Members Modal */}
      {showMembersModal && selectedChat?.isGroup && (
        <div className="fixed inset-0 modal-overlay flex items-center justify-center p-4">
          <div className="bg-white rounded-[30px] max-w-md w-full max-h-[80vh] overflow-hidden shadow-2xl">
            {/* Modal Header */}
            <div
              className="px-5 py-4 flex items-center justify-between border-b border-gray-100"
              style={{
                background: `linear-gradient(135deg, ${themes[currentTheme]?.primary?.[600] || '#2563EB'} 0%, ${themes[currentTheme]?.primary?.[500] || '#3B82F6'} 100%)`
              }}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
                  <FaUsers className="text-white text-lg" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">{selectedChat.name}</h2>
                  <p className="text-white/80 text-xs">{selectedChat.participants?.length || 0} members</p>
                </div>
              </div>
              <button
                onClick={() => setShowMembersModal(false)}
                className="p-2 text-white/80 hover:text-white hover:bg-white/10 rounded-full transition-colors"
              >
                <FaTimes className="text-lg" />
              </button>
            </div>

            {/* Search Bar */}
            <div className="px-4 pt-3 pb-2">
              <div className="input-with-icon">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" className="input-icon" fill="#9CA3AF">
                  <path d="M416 208c0 45.9-14.9 88.3-40 122.7L502.6 457.4c12.5 12.5 12.5 32.8 0 45.3s-32.8 12.5-45.3 0L330.7 376c-34.4 25.2-76.8 40-122.7 40C93.1 416 0 322.9 0 208S93.1 0 208 0S416 93.1 416 208zM208 352a144 144 0 1 0 0-288 144 144 0 1 0 0 288z" />
                </svg>
                <input
                  type="text"
                  value={memberSearchQuery}
                  onChange={(e) => setMemberSearchQuery(e.target.value)}
                  placeholder="Search members..."
                  className="input input-search text-sm"
                />
              </div>
            </div>

            {/* Members List */}
            <div className="px-4 pb-4 overflow-y-auto max-h-[50vh] space-y-2">
              {selectedChat.participants?.filter((member) => {
                if (!memberSearchQuery.trim()) return true
                const fullName = `${member.firstName || ''} ${member.lastName || ''}`.toLowerCase()
                const code = (member.employeeCode || '').toLowerCase()
                const query = memberSearchQuery.toLowerCase()
                return fullName.includes(query) || code.includes(query)
              }).map((member) => {
                const isAdmin = selectedChat.admin?._id === member._id || selectedChat.admin === member._id
                const isCurrentUser = member._id === currentUserId

                return (
                  <div
                    key={member._id}
                    className={`flex items-center gap-3 p-3 rounded-xl transition-colors ${isCurrentUser ? 'bg-blue-50' : 'hover:bg-gray-50'
                      }`}
                  >
                    <div
                      className="w-11 h-11 rounded-full flex items-center justify-center overflow-hidden flex-shrink-0"
                      style={{
                        background: `linear-gradient(135deg, ${themes[currentTheme]?.primary?.[600] || '#2563EB'} 0%, ${themes[currentTheme]?.primary?.[500] || '#3B82F6'} 100%)`
                      }}
                    >
                      {member.profilePicture ? (
                        <img src={member.profilePicture} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-white font-semibold text-sm">
                          {member.firstName?.[0]}{member.lastName?.[0]}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-gray-900 text-sm truncate">
                          {member.firstName} {member.lastName}
                        </p>
                        {isCurrentUser && (
                          <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-medium">
                            You
                          </span>
                        )}
                        {isAdmin && (
                          <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-medium">
                            Admin
                          </span>
                        )}
                      </div>
                      {member.employeeCode && (
                        <p className="text-xs text-gray-500 truncate">{member.employeeCode}</p>
                      )}
                    </div>
                    {/* Send Message Button - Only for other members */}
                    {!isCurrentUser && (
                      <button
                        onClick={async () => {
                          // Start or open direct chat with this member
                          await handleStartChat(member._id)
                          setShowMembersModal(false)
                          setMemberSearchQuery('')
                        }}
                        className="flex-shrink-0 transition-colors hover:opacity-70"
                        style={{ color: themes[currentTheme]?.primary?.[600] || '#2563EB' }}
                        title={`Message ${member.firstName}`}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" className="w-5 h-5" fill="currentColor">
                          <path d="M498.1 5.6c10.1 7 15.4 19.1 13.5 31.2l-64 416c-1.5 9.7-7.4 18.2-16 23s-18.9 5.4-28 1.6L284 427.7l-68.5 74.1c-8.9 9.7-22.9 12.9-35.2 8.1S160 493.3 160 480V392c0-8.5 3.4-16.6 9.4-22.6l208-208c6.2-6.2 6.2-16.4 0-22.6s-16.4-6.2-22.6 0L121.4 340.4l-96.4-40.2c-9.6-4-16.1-12.9-16.9-23.1s4.9-19.8 14.1-24.8l464-256c9.6-5.3 21.5-5.2 31 .5z" />
                        </svg>
                      </button>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Modal Footer */}
            <div className="px-4 py-3 border-t border-gray-100 bg-gray-50">
              <button
                onClick={() => {
                  setShowMembersModal(false)
                  setMemberSearchQuery('')
                }}
                className="w-full py-2.5 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-xl font-medium text-sm transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
