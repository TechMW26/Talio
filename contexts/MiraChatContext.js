'use client'

import { createContext, useContext, useState, useCallback, useRef } from 'react'

const MiraChatContext = createContext()

function getAuthToken() {
  return localStorage.getItem('token') || document.cookie.match(/token=([^;]+)/)?.[1] || ''
}

export function MiraChatProvider({ children }) {
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState([])
  const [isThinking, setIsThinking] = useState(false)
  const [tokens, setTokens] = useState({ tokensUsed: 0, tokenLimit: 100, tokensRemaining: 100 })
  const [sessions, setSessions] = useState([])
  const [activeSessionId, setActiveSessionId] = useState(null)
  const [showHistory, setShowHistory] = useState(false)
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const abortControllerRef = useRef(null)

  const fetchTokens = useCallback(async () => {
    try {
      const token = getAuthToken()
      if (!token) return
      const res = await fetch('/api/ai/mira-chat/tokens', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await res.json()
      if (data.success) setTokens(data.tokens)
    } catch { /* ignore */ }
  }, [])

  // Fetch session list
  const fetchSessions = useCallback(async () => {
    try {
      setSessionsLoading(true)
      const token = getAuthToken()
      if (!token) return
      const res = await fetch('/api/ai/mira-chat/sessions', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await res.json()
      if (data.success) setSessions(data.sessions)
    } catch { /* ignore */ }
    finally { setSessionsLoading(false) }
  }, [])

  // Load a specific session's messages
  const loadSession = useCallback(async (sessionId) => {
    try {
      const token = getAuthToken()
      const res = await fetch(`/api/ai/mira-chat/sessions/${sessionId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await res.json()
      if (data.success) {
        setMessages(data.session.messages.map((m, i) => ({
          id: new Date(m.timestamp).getTime() + i,
          role: m.role,
          content: m.content,
          data: m.data || null,
          timestamp: new Date(m.timestamp)
        })))
        setActiveSessionId(sessionId)
        setShowHistory(false)
      }
    } catch { /* ignore */ }
  }, [])

  // Create a new session
  const startNewChat = useCallback(async () => {
    setMessages([])
    setActiveSessionId(null)
    setShowHistory(false)
  }, [])

  // Delete a session
  const deleteSession = useCallback(async (sessionId) => {
    try {
      const token = getAuthToken()
      await fetch(`/api/ai/mira-chat/sessions/${sessionId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      })
      setSessions(prev => prev.filter(s => s._id !== sessionId))
      if (activeSessionId === sessionId) {
        setMessages([])
        setActiveSessionId(null)
      }
    } catch { /* ignore */ }
  }, [activeSessionId])

  // Save messages to session (create or append)
  const saveToSession = useCallback(async (userMsg, aiMsg) => {
    try {
      const token = getAuthToken()
      const newMsgs = [
        { role: 'user', content: userMsg.content, timestamp: userMsg.timestamp },
        { role: 'assistant', content: aiMsg.content, data: aiMsg.data, timestamp: aiMsg.timestamp }
      ]

      if (activeSessionId) {
        // Append to existing session
        await fetch(`/api/ai/mira-chat/sessions/${activeSessionId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ messages: newMsgs })
        })
      } else {
        // Create new session
        const createRes = await fetch('/api/ai/mira-chat/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ title: userMsg.content.length > 50 ? userMsg.content.substring(0, 50) + '...' : userMsg.content })
        })
        const createData = await createRes.json()
        if (createData.success) {
          const sessionId = createData.session._id
          setActiveSessionId(sessionId)
          // Append messages
          await fetch(`/api/ai/mira-chat/sessions/${sessionId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ messages: newMsgs })
          })
        }
      }
    } catch { /* ignore — saving is best-effort */ }
  }, [activeSessionId])

  const openChat = useCallback(() => {
    setIsOpen(true)
    fetchTokens()
    fetchSessions()
  }, [fetchTokens, fetchSessions])

  const closeChat = useCallback(() => {
    setIsOpen(false)
    setShowHistory(false)
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
  }, [])

  const toggleChat = useCallback(() => setIsOpen(prev => !prev), [])
  const toggleHistory = useCallback(() => {
    setShowHistory(prev => {
      if (!prev) fetchSessions() // refresh when opening
      return !prev
    })
  }, [fetchSessions])

  const sendMessage = useCallback(async (text) => {
    if (!text.trim() || isThinking) return

    const userMsg = { id: Date.now(), role: 'user', content: text, timestamp: new Date() }
    setMessages(prev => [...prev, userMsg])
    setIsThinking(true)

    try {
      const token = getAuthToken()
      abortControllerRef.current = new AbortController()

      const conversationHistory = messages.slice(-10).map(m => ({
        role: m.role,
        content: m.role === 'assistant' ? (m.data?.message || m.content) : m.content
      }))

      const res = await fetch('/api/ai/mira-chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ message: text, conversationHistory }),
        signal: abortControllerRef.current.signal
      })

      const data = await res.json()

      if (data.success) {
        if (data.tokens) setTokens(data.tokens)
        const aiMsg = {
          id: Date.now() + 1,
          role: 'assistant',
          content: data.response.message,
          data: data.response,
          timestamp: new Date()
        }
        setMessages(prev => [...prev, aiMsg])
        // Save to session in background
        saveToSession(userMsg, aiMsg)
      } else {
        if (data.tokens) setTokens(data.tokens)
        const errMsg = {
          id: Date.now() + 1,
          role: 'assistant',
          content: data.message || 'I encountered an issue. Please try again.',
          data: { message: data.message || 'I encountered an issue. Please try again.', cards: [], suggestedQuestions: [] },
          timestamp: new Date()
        }
        setMessages(prev => [...prev, errMsg])
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        setMessages(prev => [...prev, {
          id: Date.now() + 1,
          role: 'assistant',
          content: 'I\'m having trouble connecting right now. Please try again in a moment.',
          data: { message: 'I\'m having trouble connecting right now. Please try again in a moment.', cards: [], suggestedQuestions: [] },
          timestamp: new Date()
        }])
      }
    } finally {
      setIsThinking(false)
      abortControllerRef.current = null
    }
  }, [messages, isThinking, saveToSession])

  const clearHistory = useCallback(() => {
    setMessages([])
    setActiveSessionId(null)
  }, [])

  return (
    <MiraChatContext.Provider value={{
      isOpen, openChat, closeChat, toggleChat,
      messages, sendMessage, clearHistory,
      isThinking, tokens,
      sessions, activeSessionId, showHistory,
      toggleHistory, loadSession, startNewChat, deleteSession, sessionsLoading
    }}>
      {children}
    </MiraChatContext.Provider>
  )
}

export function useMiraChat() {
  const context = useContext(MiraChatContext)
  if (!context) {
    return {
      isOpen: false, openChat: () => {}, closeChat: () => {}, toggleChat: () => {},
      messages: [], sendMessage: () => {}, clearHistory: () => {},
      isThinking: false, tokens: { tokensUsed: 0, tokenLimit: 100, tokensRemaining: 100 },
      sessions: [], activeSessionId: null, showHistory: false,
      toggleHistory: () => {}, loadSession: () => {}, startNewChat: () => {},
      deleteSession: () => {}, sessionsLoading: false
    }
  }
  return context
}
