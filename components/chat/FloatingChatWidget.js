'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { FaComments, FaTimes, FaUsers, FaUserPlus, FaSearch } from 'react-icons/fa'
import { useChatWidget } from '@/contexts/ChatWidgetContext'
import { useSocket } from '@/contexts/SocketContext'
import { useUnreadMessages } from '@/contexts/UnreadMessagesContext'
import { useTheme } from '@/contexts/ThemeContext'
import Loader from '@/components/ui/Loader'

export default function FloatingChatWidget() {
  const { 
    isWidgetOpen, 
    toggleWidget, 
    closeWidget, 
    openChat,
    widgetPosition,
    updateWidgetPosition,
    triggerSource,
    sidebarCollapsed
  } = useChatWidget()
  const { unreadChats } = useUnreadMessages()
  const { theme } = useTheme()
  const { isConnected, requestPresence, onPresenceStatus, onPresenceUpdate } = useSocket()
  
  const [chats, setChats] = useState([])
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(false)
  const [loadingEmployees, setLoadingEmployees] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [showNewChat, setShowNewChat] = useState(false)
  const [currentUserId, setCurrentUserId] = useState(null)
  const [currentEmployeeId, setCurrentEmployeeId] = useState(null)
  const [isDesktop, setIsDesktop] = useState(false)
  const [presenceByEmployee, setPresenceByEmployee] = useState({})
  
  const widgetRef = useRef(null)
  const isDragging = useRef(false)
  const dragOffset = useRef({ x: 0, y: 0 })

  const primaryColor = theme?.primary?.[500] || '#3B82F6'
  const primaryDark = theme?.primary?.[600] || '#2563EB'

  // Check if desktop
  useEffect(() => {
    const checkDesktop = () => {
      setIsDesktop(typeof window !== 'undefined' && window.innerWidth >= 768)
    }
    checkDesktop()
    window.addEventListener('resize', checkDesktop)
    return () => window.removeEventListener('resize', checkDesktop)
  }, [])

  // Get current user ID and employee ID
  useEffect(() => {
    const user = localStorage.getItem('user')
    if (user) {
      try {
        const parsed = JSON.parse(user)
        setCurrentUserId(parsed._id || parsed.id)
        // Get employee ID - could be stored directly or nested
        const empId = parsed.employeeId?._id || parsed.employeeId || parsed.employee?._id || parsed.employee
        setCurrentEmployeeId(empId)
      } catch (e) {
        console.error('Error parsing user data:', e)
      }
    }
  }, [])

  // Fetch chats when widget opens
  useEffect(() => {
    if (isWidgetOpen) {
      fetchChats()
    }
  }, [isWidgetOpen])

  const fetchChats = async () => {
    try {
      setLoading(true)
      const token = localStorage.getItem('token')
      const response = await fetch('/api/chat', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await response.json()
      if (data.success) {
        setChats(data.data || [])
        // Store current user ID from response if available
        if (data.currentUserId) {
          setCurrentEmployeeId(data.currentUserId)
        }
      }
    } catch (error) {
      console.error('Error fetching chats:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchEmployees = async () => {
    try {
      setLoadingEmployees(true)
      const token = localStorage.getItem('token')
      // Include admins for chat - we want all users to be searchable
      const response = await fetch('/api/employees/list?includeAdmins=true', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await response.json()
      if (data.success) {
        // The API already filters out the current user
        setEmployees(data.data || [])
      }
    } catch (error) {
      console.error('Error fetching employees:', error)
    } finally {
      setLoadingEmployees(false)
    }
  }

  const startNewChat = async (employeeId) => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          participants: [employeeId],
          isGroup: false
        })
      })
      const data = await response.json()
      if (data.success) {
        openChat(data.data)
        setShowNewChat(false)
        setSearchQuery('')
        fetchChats()
      }
    } catch (error) {
      console.error('Error creating chat:', error)
    }
  }

  // Dragging handlers
  const handleMouseDown = (e) => {
    if (e.target.closest('.chat-widget-content')) return
    isDragging.current = true
    const rect = widgetRef.current?.getBoundingClientRect()
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
    updateWidgetPosition(x, y)
  }, [updateWidgetPosition])

  const handleMouseUp = useCallback(() => {
    isDragging.current = false
    document.removeEventListener('mousemove', handleMouseMove)
    document.removeEventListener('mouseup', handleMouseUp)
  }, [handleMouseMove])

  // Get chat display name
  const getChatName = (chat) => {
    if (chat.isGroup) return chat.name || 'Group Chat'
    const otherParticipant = chat.participants?.find(p => {
      const pId = (p._id || p).toString()
      const currentEmpId = currentEmployeeId?.toString()
      // Only compare Employee IDs (participants are Employee documents)
      return pId !== currentEmpId
    })
    if (otherParticipant) {
      return `${otherParticipant.firstName || ''} ${otherParticipant.lastName || ''}`.trim() || otherParticipant.email || 'User'
    }
    return 'Chat'
  }

  // Get other participant's profile picture (for 1-on-1 chats)
  const getChatAvatar = (chat) => {
    if (chat.isGroup) return null
    const otherParticipant = chat.participants?.find(p => {
      const pId = (p._id || p).toString()
      const currentEmpId = currentEmployeeId?.toString()
      // Only compare Employee IDs (participants are Employee documents)
      return pId !== currentEmpId
    })
    return otherParticipant?.profilePicture || null
  }

  const getOtherParticipantId = (chat) => {
    if (chat.isGroup) return null
    const otherParticipant = chat.participants?.find(p => {
      const pId = (p._id || p).toString()
      const currentEmpId = currentEmployeeId?.toString()
      return pId !== currentEmpId
    })
    return otherParticipant?._id?.toString?.() || otherParticipant?.toString?.() || null
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

  const isChatOnline = (chat) => {
    if (!chat || chat.isGroup) return false
    const otherId = getOtherParticipantId(chat)
    return otherId ? !!presenceByEmployee[otherId]?.isOnline : false
  }

  // Get initials from chat name
  const getChatInitials = (chat) => {
    const name = getChatName(chat)
    return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
  }

  // Get unread count for a chat
  const getUnreadCount = (chatId) => {
    return unreadChats?.[chatId] || 0
  }

  // Total unread count
  const totalUnread = Object.values(unreadChats || {}).reduce((a, b) => a + b, 0)

  // Filter chats by search
  const filteredChats = chats.filter(chat => {
    const name = getChatName(chat).toLowerCase()
    return name.includes(searchQuery.toLowerCase())
  })

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

  useEffect(() => {
    if (!isWidgetOpen || !isConnected || chats.length === 0) return
    const employeeIds = chats
      .filter(chat => !chat.isGroup)
      .map(chat => getOtherParticipantId(chat))
      .filter(Boolean)
    if (employeeIds.length > 0) {
      requestPresence?.(Array.from(new Set(employeeIds)))
    }
  }, [isWidgetOpen, isConnected, chats, currentEmployeeId, requestPresence])

  // Filter employees by search
  const filteredEmployees = employees.filter(emp => {
    const name = `${emp.firstName || ''} ${emp.lastName || ''}`.toLowerCase()
    return name.includes(searchQuery.toLowerCase())
  })

  // Don't render on mobile
  if (!isDesktop) return null

  // Calculate widget position based on trigger source
  // If manually dragged, use dragged position
  // If triggered from sidebar, position near sidebar (left side)
  // If triggered from floating button, position near the button (bottom right)
  const getWidgetStyle = () => {
    if (widgetPosition.x !== null && widgetPosition.y !== null) {
      return {
        left: `${widgetPosition.x}px`,
        top: `${widgetPosition.y}px`,
      }
    }
    
    if (triggerSource === 'sidebar') {
      // Position based on sidebar collapsed state
      const sidebarWidth = sidebarCollapsed ? '4.5rem' : '17rem'
      return {
        left: `calc(${sidebarWidth} + 16px)`,
        bottom: '24px',
      }
    }
    
    // Default: near the floating button (bottom right)
    return {
      right: '88px',
      bottom: '88px',
    }
  }

  const widgetStyle = getWidgetStyle()

  // Glass morphism styles
  const glassStyle = {
    background: 'rgba(255, 255, 255, 0.75)',
    backdropFilter: 'blur(20px) saturate(180%)',
    WebkitBackdropFilter: 'blur(20px) saturate(180%)',
    border: '1px solid rgba(255, 255, 255, 0.3)',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.4)',
  }
  
  // Animation styles
  const animationStyles = `
    @keyframes pulseNotification {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.15); }
    }
    @keyframes bounceIn {
      0% { transform: scale(0.3); opacity: 0; }
      50% { transform: scale(1.05); }
      70% { transform: scale(0.9); }
      100% { transform: scale(1); opacity: 1; }
    }
    @keyframes slideUp {
      from { opacity: 0; transform: translateY(20px) scale(0.95); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes float {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-5px); }
    }
  `

  return (
    <>
      <style>{animationStyles}</style>

      {/* Chat List Widget - Glass UI */}
      {isWidgetOpen && (
        <div
          ref={widgetRef}
          className="fixed rounded-2xl overflow-hidden overflow-x-hidden z-[9999] flex flex-col"
          style={{
            width: '340px',
            height: '480px',
            ...glassStyle,
            ...widgetStyle,
            animation: 'slideUp 0.3s ease-out',
            transition: 'left 0.3s ease, top 0.3s ease, right 0.3s ease, bottom 0.3s ease',
          }}
        >
          {/* Header - Draggable */}
          <div 
            className="px-4 py-3 flex items-center justify-between cursor-move select-none"
            style={{ 
              background: `linear-gradient(135deg, ${primaryColor}ee, ${primaryDark}ee)`,
              backdropFilter: 'blur(10px)',
            }}
            onMouseDown={handleMouseDown}
          >
            <div className="flex items-center gap-2 text-white">
              <FaComments className="w-5 h-5" />
              <span className="font-semibold">Messages</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  setShowNewChat(true)
                  fetchEmployees()
                }}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                style={{ backgroundColor: 'white' }}
                title="New Chat"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 512" className="w-4 h-4" fill={primaryDark}>
                  <path d="M96 128a128 128 0 1 1 256 0A128 128 0 1 1 96 128zM0 482.3C0 383.8 79.8 304 178.3 304h91.4C368.2 304 448 383.8 448 482.3c0 16.4-13.3 29.7-29.7 29.7H29.7C13.3 512 0 498.7 0 482.3zM504 312V248H440c-13.3 0-24-10.7-24-24s10.7-24 24-24h64V136c0-13.3 10.7-24 24-24s24 10.7 24 24v64h64c13.3 0 24 10.7 24 24s-10.7 24-24 24H552v64c0 13.3-10.7 24-24 24s-24-10.7-24-24z"/>
                </svg>
              </button>
              <button
                onClick={closeWidget}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                style={{ backgroundColor: 'white' }}
                title="Close"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512" className="w-4 h-4" fill={primaryDark}>
                  <path d="M342.6 150.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L192 210.7 86.6 105.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L146.7 256 41.4 361.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L192 301.3 297.4 406.6c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L237.3 256 342.6 150.6z"/>
                </svg>
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="chat-widget-content flex-1 flex flex-col overflow-hidden overflow-x-hidden">
            {/* Search */}
            <div className="p-3" style={{ background: 'rgba(255, 255, 255, 0.5)' }}>
              <div className="relative">
                <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                <input
                  type="text"
                  placeholder={showNewChat ? "Search people..." : "Search conversations..."}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl text-sm focus:outline-none focus:ring-2 transition-all"
                  style={{ 
                    background: 'rgba(255, 255, 255, 0.7)',
                    border: '1px solid rgba(255, 255, 255, 0.3)',
                    focusRing: primaryColor
                  }}
                />
              </div>
            </div>

            {/* Chat List or New Chat */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden" style={{ background: 'rgba(248, 250, 252, 0.5)' }}>
              {showNewChat ? (
                <>
                  <div className="px-4 py-2.5 flex items-center justify-between" style={{ background: 'rgba(255, 255, 255, 0.6)' }}>
                    <span className="text-sm font-medium text-gray-700">Start a conversation</span>
                    <button
                      onClick={() => {
                        setShowNewChat(false)
                        setSearchQuery('')
                      }}
                      className="text-xs font-medium px-2 py-1 rounded-md hover:bg-gray-100/50 transition-colors"
                      style={{ color: primaryColor }}
                    >
                      Back
                    </button>
                  </div>
                  <div>
                    {loadingEmployees ? (
                      <div className="p-8 flex flex-col items-center justify-center">
                        <Loader size="lg" />
                        <p className="text-gray-500 text-sm mt-3">Loading people...</p>
                      </div>
                    ) : filteredEmployees.length > 0 ? (
                      filteredEmployees.map(emp => (
                        <button
                          key={emp._id}
                          onClick={() => startNewChat(emp._id)}
                          className="w-full px-4 py-3 hover:bg-white/60 transition-colors border-b border-white/30"
                          style={{ display: 'flex', alignItems: 'center', gap: '12px', maxWidth: '100%', overflow: 'hidden' }}
                        >
                          <div 
                            className="rounded-full flex items-center justify-center text-white font-medium text-sm shadow-sm overflow-hidden"
                            style={{ width: '44px', height: '44px', minWidth: '44px', backgroundColor: primaryColor }}
                          >
                            {emp.profilePicture ? (
                              <img src={emp.profilePicture} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <>{emp.firstName?.[0]}{emp.lastName?.[0]}</>
                            )}
                          </div>
                          <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                            <p 
                              className="font-medium text-gray-900 text-sm"
                              style={{ textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: 0 }}
                            >
                              {emp.firstName} {emp.lastName}
                            </p>
                            <p 
                              className="text-xs text-gray-500"
                              style={{ textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: 0 }}
                            >
                              {emp.designation?.title || emp.department?.name || emp.email}
                            </p>
                          </div>
                        </button>
                      ))
                    ) : (
                      <div className="p-8 text-center text-gray-500 text-sm">
                        {searchQuery ? 'No people found' : 'No team members available'}
                      </div>
                    )}
                  </div>
                </>
              ) : loading ? (
                <div className="p-8 text-center h-full flex items-center justify-center">
                  <div>
                    <Loader size="lg" />
                    <p className="text-gray-500 text-sm mt-2">Loading chats...</p>
                  </div>
                </div>
              ) : filteredChats.length > 0 ? (
                <div className="w-full">
                  {filteredChats.map(chat => {
                    const unreadCount = getUnreadCount(chat._id)
                    return (
                      <div
                        key={chat._id}
                        onClick={() => openChat(chat)}
                        className="w-full px-4 py-3 flex items-start gap-3 hover:bg-white/60 transition-colors border-b border-white/30 cursor-pointer"
                      >
                        {/* Avatar - fixed width */}
                        <div className="relative" style={{ width: '44px', flexShrink: 0 }}>
                          <div 
                            className="w-11 h-11 rounded-full flex items-center justify-center text-white font-medium text-sm shadow-sm overflow-hidden"
                            style={{ backgroundColor: chat.isGroup ? primaryDark : primaryColor }}
                          >
                            {chat.isGroup ? (
                              <FaUsers className="w-5 h-5" />
                            ) : getChatAvatar(chat) ? (
                              <img src={getChatAvatar(chat)} alt="" className="w-full h-full object-cover" />
                            ) : (
                              getChatInitials(chat)
                            )}
                          </div>
                          {!chat.isGroup && isChatOnline(chat) && (
                            <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-2 border-white shadow-sm"></div>
                          )}
                        </div>
                        {/* Content - takes remaining space */}
                        <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                          {/* First row: Name + Time + Badge */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%' }}>
                            <span 
                              style={{ 
                                flex: 1, 
                                minWidth: 0, 
                                overflow: 'hidden', 
                                textOverflow: 'ellipsis', 
                                whiteSpace: 'nowrap',
                                fontWeight: 500,
                                fontSize: '14px',
                                color: '#111827',
                                textAlign: 'left',
                                display: 'block'
                              }}
                            >
                              {getChatName(chat)}
                            </span>
                            <span style={{ flexShrink: 0, fontSize: '10px', color: '#9CA3AF', whiteSpace: 'nowrap' }}>
                              {chat.lastMessageAt ? new Date(chat.lastMessageAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                            </span>
                            {unreadCount > 0 && (
                              <span 
                                style={{ 
                                  flexShrink: 0, 
                                  width: '20px', 
                                  height: '20px', 
                                  borderRadius: '50%', 
                                  backgroundColor: primaryColor,
                                  color: 'white',
                                  fontSize: '12px',
                                  fontWeight: 'bold',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center'
                                }}
                              >
                                {unreadCount > 9 ? '9+' : unreadCount}
                              </span>
                            )}
                          </div>
                          {/* Second row: Last message */}
                          <p 
                            style={{ 
                              margin: '2px 0 0 0',
                              fontSize: '12px', 
                              color: '#6B7280', 
                              overflow: 'hidden', 
                              textOverflow: 'ellipsis', 
                              whiteSpace: 'nowrap',
                              textAlign: 'left',
                              width: '100%'
                            }}
                          >
                            {chat.lastMessage?.content || 'Start a conversation'}
                          </p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="p-8 text-center h-full flex flex-col items-center justify-center">
                  <div 
                    className="w-16 h-16 rounded-full flex items-center justify-center mb-4"
                    style={{ backgroundColor: `${primaryColor}20` }}
                  >
                    <FaComments className="w-8 h-8" style={{ color: primaryColor }} />
                  </div>
                  <p className="text-gray-600 font-medium">No conversations yet</p>
                  <p className="text-gray-400 text-sm mt-1">Start chatting with your team!</p>
                  <button
                    onClick={() => {
                      setShowNewChat(true)
                      fetchEmployees()
                    }}
                    className="mt-4 px-4 py-2 text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity shadow-sm"
                    style={{ backgroundColor: primaryColor }}
                  >
                    Start a Chat
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
