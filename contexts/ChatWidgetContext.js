'use client'

import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react'

const ChatWidgetContext = createContext(null)

export function ChatWidgetProvider({ children }) {
  const [isWidgetOpen, setIsWidgetOpen] = useState(false)
  const [openChats, setOpenChats] = useState([]) // Array of open chat windows
  const [widgetPosition, setWidgetPosition] = useState({ x: null, y: null })
  const [chatPositions, setChatPositions] = useState({}) // { chatId: { x, y } }
  const [triggerSource, setTriggerSource] = useState('button') // 'button' or 'sidebar'
  const [focusedChatId, setFocusedChatId] = useState(null) // Track which chat is on top
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true) // Track sidebar state
  const [minimizedChats, setMinimizedChats] = useState(new Set()) // Track auto-minimized chats
  const zIndexCounter = useRef(10000) // Counter for z-index management

  // Calculate available width and auto-minimize chats when needed
  useEffect(() => {
    const calculateMinimizedChats = () => {
      if (typeof window === 'undefined') return

      const screenWidth = window.innerWidth
      const sidebarWidth = sidebarCollapsed ? 72 : 272 // 4.5rem or 17rem
      const widgetWidth = 340
      const chatWidth = 360
      const gap = 16
      const padding = 40

      // Available width for chats (right of widget)
      const widgetStartX = triggerSource === 'sidebar' ? sidebarWidth + 16 : screenWidth - 88 - widgetWidth
      const availableWidth = screenWidth - widgetStartX - widgetWidth - gap - padding

      // How many chats can fit without minimizing
      const maxChatsVisible = Math.max(1, Math.floor(availableWidth / (chatWidth + gap)))

      // Check if there's a manually maximized chat (exempted from auto-minimize)
      const exemptChatId = window.__exemptChatId

      // Auto-minimize older chats (first opened) when we exceed available space
      const newMinimized = new Set()
      if (openChats.length > maxChatsVisible) {
        // If there's an exempt chat (manually maximized), make space for it
        if (exemptChatId) {
          const exemptIndex = openChats.findIndex(c => c._id === exemptChatId)
          if (exemptIndex !== -1) {
            // Keep the manually maximized chat expanded
            // Minimize others to make space, prioritizing oldest chats
            let minimizeCount = openChats.length - maxChatsVisible
            for (let i = 0; i < openChats.length && minimizeCount > 0; i++) {
              if (openChats[i]._id !== exemptChatId) {
                newMinimized.add(openChats[i]._id)
                minimizeCount--
              }
            }
          }
        } else {
          // Normal behavior: minimize from the first (oldest) chat, keeping recent ones expanded
          for (let i = 0; i < openChats.length - maxChatsVisible; i++) {
            newMinimized.add(openChats[i]._id)
          }
        }
      }

      // Reset positions when minimization changes to trigger recalculation
      if (newMinimized.size !== minimizedChats.size) {
        setChatPositions({})
      }

      setMinimizedChats(newMinimized)
    }

    calculateMinimizedChats()
    window.addEventListener('resize', calculateMinimizedChats)
    return () => window.removeEventListener('resize', calculateMinimizedChats)
  }, [openChats, sidebarCollapsed, triggerSource, minimizedChats.size])

  // Toggle main chat list widget - always reset position to open near source
  const toggleWidget = useCallback((source = 'button') => {
    setTriggerSource(source)
    // Reset widget position so it opens at the default position for this source
    setWidgetPosition({ x: null, y: null })
    setIsWidgetOpen(prev => !prev)
  }, [])

  const openWidget = useCallback((source = 'button') => {
    setTriggerSource(source)
    // Reset widget position so it opens at the default position for this source
    setWidgetPosition({ x: null, y: null })
    setIsWidgetOpen(true)
  }, [])

  const closeWidget = useCallback(() => {
    setIsWidgetOpen(false)
  }, [])

  // Open a specific chat in a new popup window
  const openChat = useCallback((chat) => {
    setOpenChats(prev => {
      // Don't duplicate
      if (prev.some(c => c._id === chat._id)) {
        // If already open, just bring to front
        setFocusedChatId(chat._id)
        zIndexCounter.current += 1
        return prev
      }
      return [...prev, chat]
    })
    // Set this chat as focused
    setFocusedChatId(chat._id)
    zIndexCounter.current += 1
  }, [])

  // Close a specific chat popup and reset positions for auto-alignment
  const closeChat = useCallback((chatId) => {
    setOpenChats(prev => prev.filter(c => c._id !== chatId))
    // Clear ALL positions so remaining chats auto-realign
    setChatPositions({})
    // Clear focused if it was the closed chat
    setFocusedChatId(prev => prev === chatId ? null : prev)
  }, [])

  // Close all chat popups
  const closeAllChats = useCallback(() => {
    setOpenChats([])
    setChatPositions({})
    setFocusedChatId(null)
  }, [])

  // Reset all chat positions to trigger auto-alignment
  const resetChatPositions = useCallback(() => {
    setChatPositions({})
  }, [])

  // Update widget position (for dragging)
  const updateWidgetPosition = useCallback((x, y) => {
    setWidgetPosition({ x, y })
  }, [])

  // Update chat popup position (for dragging)
  const updateChatPosition = useCallback((chatId, x, y) => {
    if (x === null || y === null) {
      // Clear position to trigger recalculation
      setChatPositions(prev => {
        const newPositions = { ...prev }
        delete newPositions[chatId]
        return newPositions
      })
    } else {
      setChatPositions(prev => ({
        ...prev,
        [chatId]: { x, y }
      }))
    }
  }, [])

  // Bring chat to front (z-index management) - just update focused state, don't reorder
  const bringToFront = useCallback((chatId) => {
    setFocusedChatId(chatId)
    zIndexCounter.current += 1
  }, [])

  // Get z-index for a chat
  const getZIndex = useCallback((chatId) => {
    if (chatId === focusedChatId) {
      return zIndexCounter.current
    }
    // Non-focused chats get base z-index
    return 10000
  }, [focusedChatId])

  // Check if a chat is auto-minimized
  const isAutoMinimized = useCallback((chatId) => {
    return minimizedChats.has(chatId)
  }, [minimizedChats])

  // Update sidebar collapsed state (called from layout)
  const updateSidebarCollapsed = useCallback((collapsed) => {
    setSidebarCollapsed(collapsed)
    // Reset chat positions when sidebar state changes
    setChatPositions({})
  }, [])

  const value = {
    isWidgetOpen,
    openChats,
    widgetPosition,
    chatPositions,
    triggerSource,
    focusedChatId,
    sidebarCollapsed,
    minimizedChats,
    toggleWidget,
    openWidget,
    closeWidget,
    openChat,
    closeChat,
    closeAllChats,
    updateWidgetPosition,
    updateChatPosition,
    bringToFront,
    resetChatPositions,
    getZIndex,
    isAutoMinimized,
    updateSidebarCollapsed
  }

  return (
    <ChatWidgetContext.Provider value={value}>
      {children}
    </ChatWidgetContext.Provider>
  )
}

export function useChatWidget() {
  const context = useContext(ChatWidgetContext)
  if (!context) {
    // Return safe defaults instead of throwing, to prevent crashes
    // This can happen if the component is rendered outside the provider temporarily
    console.warn('[ChatWidgetContext] useChatWidget called outside ChatWidgetProvider, returning safe defaults')
    return {
      isWidgetOpen: false,
      openChats: [],
      widgetPosition: { x: null, y: null },
      chatPositions: {},
      triggerSource: 'button',
      focusedChatId: null,
      sidebarCollapsed: true,
      minimizedChats: new Set(),
      toggleWidget: () => { },
      openWidget: () => { },
      closeWidget: () => { },
      openChat: () => { },
      closeChat: () => { },
      closeAllChats: () => { },
      updateWidgetPosition: () => { },
      updateChatPosition: () => { },
      bringToFront: () => { },
      resetChatPositions: () => { },
      getZIndex: () => 10000,
      isAutoMinimized: () => false,
      updateSidebarCollapsed: () => { }
    }
  }
  return context
}
