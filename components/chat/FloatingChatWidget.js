'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { FaCheck, FaComments, FaTimes, FaUsers, FaUserPlus, FaSearch } from 'react-icons/fa'
import { useChatWidget } from '@/contexts/ChatWidgetContext'
import { useSocket } from '@/contexts/SocketContext'
import { useUnreadMessages } from '@/contexts/UnreadMessagesContext'
import { useTheme } from '@/contexts/ThemeContext'
import Loader from '@/components/ui/Loader'
import toast from '@/utils/toast'
import useEmployeeDirectorySearch from '@/hooks/useEmployeeDirectorySearch'

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
  const { theme, isDarkMode } = useTheme()
  const { isConnected, requestPresence, onPresenceStatus, onPresenceUpdate } = useSocket()
  
  const [chats, setChats] = useState([])
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [showNewChat, setShowNewChat] = useState(false)
  const [showNewGroup, setShowNewGroup] = useState(false)
  const [selectedEmployees, setSelectedEmployees] = useState([])
  const [groupName, setGroupName] = useState('')
  const [creatingGroup, setCreatingGroup] = useState(false)
  const [composeError, setComposeError] = useState('')
  const [currentUserId, setCurrentUserId] = useState(null)
  const [currentEmployeeId, setCurrentEmployeeId] = useState(null)
  const [isDesktop, setIsDesktop] = useState(false)
  const [presenceByEmployee, setPresenceByEmployee] = useState({})
  const { employees, isLoading: loadingEmployees } = useEmployeeDirectorySearch({
    enabled: isWidgetOpen && (showNewChat || showNewGroup),
    query: searchQuery,
    limit: 100,
    includeAdmins: true,
  })
  
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

  const startNewChat = async (employeeId) => {
    try {
      setComposeError('')
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
      const data = await response.json().catch(() => null)
      if (response.ok && data?.success) {
        openChat(data.data)
        setShowNewChat(false)
        setSearchQuery('')
        fetchChats()
      } else {
        setComposeError(data?.message || 'Unable to start this conversation')
      }
    } catch (error) {
      console.error('Error creating chat:', error)
      setComposeError('Unable to start this conversation')
    }
  }

  const openComposer = (mode) => {
    setShowNewChat(mode === 'direct')
    setShowNewGroup(mode === 'group')
    setSearchQuery('')
    setComposeError('')
    if (mode === 'group') {
      setSelectedEmployees([])
      setGroupName('')
    }
  }

  const closeComposer = () => {
    setShowNewChat(false)
    setShowNewGroup(false)
    setSelectedEmployees([])
    setGroupName('')
    setSearchQuery('')
    setComposeError('')
  }

  const toggleGroupMember = (employeeId) => {
    setSelectedEmployees((current) => current.includes(employeeId)
      ? current.filter((id) => id !== employeeId)
      : [...current, employeeId])
  }

  const createGroup = async () => {
    const name = groupName.trim()
    if (!name || selectedEmployees.length === 0 || creatingGroup) return

    try {
      setCreatingGroup(true)
      setComposeError('')
      const token = localStorage.getItem('token')
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          isGroup: true,
          participants: selectedEmployees,
          name,
        })
      })
      const data = await response.json().catch(() => null)
      if (!response.ok || !data?.success) {
        throw new Error(data?.message || 'Unable to create the group')
      }

      openChat(data.data)
      closeComposer()
      await fetchChats()
      toast.success('Group created')
    } catch (error) {
      console.error('Error creating group:', error)
      setComposeError(error.message || 'Unable to create the group')
    } finally {
      setCreatingGroup(false)
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
    const searchableText = [
      emp.firstName,
      emp.lastName,
      emp.email,
      emp.employeeCode,
      emp.designation?.title,
      emp.department?.name,
    ].filter(Boolean).join(' ').toLowerCase()
    return searchableText.includes(searchQuery.trim().toLowerCase())
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
    background: isDarkMode ? 'rgba(24, 24, 27, 0.95)' : 'rgba(255, 255, 255, 0.9)',
    border: isDarkMode ? '1px solid rgba(51, 65, 85, 0.5)' : '1px solid rgba(255, 255, 255, 0.3)',
    boxShadow: isDarkMode ? '0 8px 32px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.05)' : '0 8px 32px rgba(0, 0, 0, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.4)',
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
          }}
        >
          {/* Header - Draggable */}
          <div 
            className="px-4 py-3 flex items-center justify-between cursor-move select-none"
            style={{ 
              background: `linear-gradient(135deg, ${primaryColor}ee, ${primaryDark}ee)`,
            }}
            onMouseDown={handleMouseDown}
          >
            <div className="flex items-center gap-2 text-white">
              <FaComments className="w-5 h-5" />
              <span className="font-semibold">Messages</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => openComposer('direct')}
                className="p-2 hover:bg-gray-100 dark:hover:bg-zinc-600 rounded-lg transition-colors"
                style={{ backgroundColor: isDarkMode ? '#27272a' : 'white' }}
                title="New Chat"
                aria-label="New chat"
              >
                <FaUserPlus className="h-4 w-4" style={{ color: primaryDark }} />
              </button>
              <button
                onClick={() => openComposer('group')}
                className="p-2 hover:bg-gray-100 dark:hover:bg-zinc-600 rounded-lg transition-colors"
                style={{ backgroundColor: isDarkMode ? '#27272a' : 'white' }}
                title="New Group"
                aria-label="New group"
              >
                <FaUsers className="h-4 w-4" style={{ color: primaryDark }} />
              </button>
              <button
                onClick={closeWidget}
                className="p-2 hover:bg-gray-100 dark:hover:bg-zinc-600 rounded-lg transition-colors"
                style={{ backgroundColor: isDarkMode ? '#27272a' : 'white' }}
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
            <div className="p-3" style={{ background: isDarkMode ? 'rgba(15, 23, 42, 0.5)' : 'rgba(255, 255, 255, 0.5)' }}>
              <div className="relative">
                <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                <input
                  type="text"
                  placeholder={showNewChat || showNewGroup ? "Search people..." : "Search conversations..."}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="input input-search text-sm"
                />
              </div>
            </div>

            {/* Chat List or New Chat */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden" style={{ background: isDarkMode ? 'rgba(15, 23, 42, 0.5)' : 'rgba(248, 250, 252, 0.5)' }}>
              {showNewChat || showNewGroup ? (
                <>
                  <div className="px-4 py-2.5 flex items-center justify-between" style={{ background: isDarkMode ? 'rgba(24, 24, 27, 0.6)' : 'rgba(255, 255, 255, 0.6)' }}>
                    <span className="text-sm font-medium" style={{ color: isDarkMode ? '#e4e4e7' : '#374151' }}>
                      {showNewGroup ? 'Create a group' : 'Start a conversation'}
                    </span>
                    <button
                      onClick={closeComposer}
                      className="text-xs font-medium px-2 py-1 rounded-md hover:bg-gray-100/50 transition-colors"
                      style={{ color: primaryColor }}
                    >
                      Back
                    </button>
                  </div>
                  {showNewGroup && (
                    <div className="space-y-2 border-b px-3 py-3" style={{ borderColor: isDarkMode ? 'rgba(51, 65, 85, 0.45)' : 'rgba(203, 213, 225, 0.7)' }}>
                      <label htmlFor="floating-chat-group-name" className="sr-only">Group name</label>
                      <input
                        id="floating-chat-group-name"
                        type="text"
                        value={groupName}
                        onChange={(event) => setGroupName(event.target.value)}
                        placeholder="Group name"
                        maxLength={80}
                        className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition focus:ring-2"
                        style={{
                          color: isDarkMode ? '#f4f4f5' : '#111827',
                          background: isDarkMode ? '#18181b' : '#ffffff',
                          borderColor: isDarkMode ? '#3f3f46' : '#d1d5db',
                          '--tw-ring-color': primaryColor,
                        }}
                      />
                      <p className="text-xs" style={{ color: isDarkMode ? '#a1a1aa' : '#6b7280' }}>
                        {selectedEmployees.length} member{selectedEmployees.length === 1 ? '' : 's'} selected
                      </p>
                    </div>
                  )}
                  {composeError && (
                    <div className="mx-3 mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200" role="alert">
                      {composeError}
                    </div>
                  )}
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
                          onClick={() => showNewGroup ? toggleGroupMember(emp._id) : startNewChat(emp._id)}
                          className="w-full px-4 py-3 transition-colors border-b"
                          style={{ display: 'flex', alignItems: 'center', gap: '12px', maxWidth: '100%', overflow: 'hidden', borderColor: isDarkMode ? 'rgba(51, 65, 85, 0.3)' : 'rgba(255, 255, 255, 0.3)' }}
                          aria-pressed={showNewGroup ? selectedEmployees.includes(emp._id) : undefined}
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
                              className="font-medium text-sm"
                              style={{ textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: 0, color: isDarkMode ? '#F1F5F9' : '#111827' }}
                            >
                              {emp.firstName} {emp.lastName}
                            </p>
                            <p 
                              className="text-xs"
                              style={{ textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: 0, color: isDarkMode ? '#94A3B8' : '#6B7280' }}
                            >
                              {emp.designation?.title || emp.department?.name || emp.email}
                            </p>
                          </div>
                          {showNewGroup && (
                            <span
                              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border"
                              style={{
                                color: selectedEmployees.includes(emp._id) ? 'white' : 'transparent',
                                backgroundColor: selectedEmployees.includes(emp._id) ? primaryColor : 'transparent',
                                borderColor: selectedEmployees.includes(emp._id) ? primaryColor : (isDarkMode ? '#52525b' : '#cbd5e1'),
                              }}
                              aria-hidden="true"
                            >
                              <FaCheck className="h-3 w-3" />
                            </span>
                          )}
                        </button>
                      ))
                    ) : (
                      <div className="p-8 text-center text-sm" style={{ color: isDarkMode ? '#94A3B8' : '#6B7280' }}>
                        {searchQuery ? 'No people found' : 'No team members available'}
                      </div>
                    )}
                  </div>
                  {showNewGroup && (
                    <div className="sticky bottom-0 border-t p-3 backdrop-blur-xl" style={{ background: isDarkMode ? 'rgba(24, 24, 27, 0.96)' : 'rgba(255, 255, 255, 0.96)', borderColor: isDarkMode ? '#3f3f46' : '#e5e7eb' }}>
                      <button
                        type="button"
                        onClick={createGroup}
                        disabled={!groupName.trim() || selectedEmployees.length === 0 || creatingGroup}
                        className="relative flex min-h-10 w-full items-center justify-center rounded-xl px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                        style={{ backgroundColor: primaryColor }}
                      >
                        <span className={creatingGroup ? 'invisible' : ''}>Create group</span>
                        {creatingGroup && <span className="absolute h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
                      </button>
                    </div>
                  )}
                </>
              ) : loading ? (
                <div className="p-8 text-center h-full flex items-center justify-center">
                  <div>
                    <Loader size="lg" />
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
                        className="w-full px-4 py-3 flex items-start gap-3 transition-colors cursor-pointer"
                        style={{ borderBottom: isDarkMode ? '1px solid rgba(51, 65, 85, 0.3)' : '1px solid rgba(255, 255, 255, 0.3)' }}
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
                            <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full shadow-sm" style={{ border: isDarkMode ? '2px solid #18181b' : '2px solid white' }}></div>
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
                                color: isDarkMode ? '#F1F5F9' : '#111827',
                                textAlign: 'left',
                                display: 'block'
                              }}
                            >
                              {getChatName(chat)}
                            </span>
                            <span style={{ flexShrink: 0, fontSize: '10px', color: isDarkMode ? '#71717a' : '#9CA3AF', whiteSpace: 'nowrap' }}>
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
                              color: isDarkMode ? '#94A3B8' : '#6B7280', 
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
                  <p className="font-medium" style={{ color: isDarkMode ? '#e4e4e7' : '#4B5563' }}>No conversations yet</p>
                  <p className="text-sm mt-1" style={{ color: isDarkMode ? '#71717a' : '#9CA3AF' }}>Start chatting with your team!</p>
                  <button
                    onClick={() => openComposer('direct')}
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
