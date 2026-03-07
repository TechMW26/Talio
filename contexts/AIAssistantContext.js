'use client'

import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react'

const AIAssistantContext = createContext(null)

// Error patterns that the AI assistant should intercept
const ERROR_PATTERNS = [
  { pattern: /invalid (credentials|email|password)/i, category: 'auth', severity: 'high' },
  { pattern: /no account found/i, category: 'auth', severity: 'high' },
  { pattern: /incorrect password/i, category: 'auth', severity: 'high' },
  { pattern: /session expired/i, category: 'session', severity: 'high' },
  { pattern: /not authorized|forbidden|access denied/i, category: 'permission', severity: 'high' },
  { pattern: /account.*deactivated/i, category: 'account', severity: 'high' },
  { pattern: /network error|failed to fetch|could not connect/i, category: 'network', severity: 'medium' },
  { pattern: /geolocation|location.*denied|gps/i, category: 'location', severity: 'medium' },
  { pattern: /check.?in failed|check.?out failed/i, category: 'attendance', severity: 'medium' },
  { pattern: /leave.*balance.*insufficient|no.*leave.*remaining/i, category: 'leave', severity: 'medium' },
  { pattern: /upload failed|file.*too large|unsupported.*format/i, category: 'upload', severity: 'medium' },
  { pattern: /not found|404/i, category: 'navigation', severity: 'low' },
  { pattern: /server error|something went wrong|internal error|500/i, category: 'server', severity: 'medium' },
  { pattern: /timeout|timed out/i, category: 'network', severity: 'medium' },
  { pattern: /already (checked|clocked) (in|out)/i, category: 'attendance', severity: 'low' },
  { pattern: /service.*unavailable|503/i, category: 'server', severity: 'medium' },
]

// Quick tips for immediate display (before AI responds)
const QUICK_TIPS = {
  auth: [
    'Double-check your email for typos',
    'Make sure Caps Lock is turned off',
    'Try using "Forgot Password" to reset',
  ],
  session: [
    'Your session has expired for security',
    'Simply log in again to continue',
    'This is normal after being inactive',
  ],
  permission: [
    'You may not have access to this feature',
    'Contact your administrator for permissions',
    'Some features are role-restricted',
  ],
  network: [
    'Check your internet connection',
    'Try refreshing the page',
    'Wait a moment and try again',
  ],
  location: [
    'Enable location access in your browser',
    'Make sure GPS is turned on',
    'Move to an area with better signal',
  ],
  attendance: [
    'Make sure you are within the office geofence',
    'Check if you have already checked in/out',
    'Try refreshing the page and retry',
  ],
  leave: [
    'Check your remaining leave balance',
    'Contact HR for leave adjustments',
    'Try a different leave type',
  ],
  upload: [
    'Check file size (usually max 5-10 MB)',
    'Use supported formats (PDF, JPG, PNG)',
    'Try compressing the file first',
  ],
  navigation: [
    'The page may have been moved or removed',
    'Check the URL for typos',
    'Go back to the dashboard and navigate again',
  ],
  server: [
    'This is a temporary server issue',
    'Wait a moment and try again',
    'If persistent, contact your administrator',
  ],
  account: [
    'Your account may have been disabled',
    'Contact your HR or administrator',
    'This cannot be self-resolved',
  ],
}

function classifyError(message) {
  if (!message || typeof message !== 'string') return null
  for (const { pattern, category, severity } of ERROR_PATTERNS) {
    if (pattern.test(message)) {
      return { category, severity, tips: QUICK_TIPS[category] || [] }
    }
  }
  return null
}

export function AIAssistantProvider({ children }) {
  const [isOpen, setIsOpen] = useState(false)
  const [errorContext, setErrorContext] = useState(null)
  const [classification, setClassification] = useState(null)
  const [aiResponse, setAiResponse] = useState('')
  const [isAiLoading, setIsAiLoading] = useState(false)
  const [conversationHistory, setConversationHistory] = useState([])
  const [errorLog, setErrorLog] = useState([])
  const cooldownRef = useRef(false)

  // Intercept an error and potentially trigger the assistant
  const interceptError = useCallback((message, meta = {}) => {
    if (!message || typeof message !== 'string') return
    if (cooldownRef.current) return

    // Log it
    const entry = {
      message,
      page: typeof window !== 'undefined' ? window.location.pathname : '',
      timestamp: new Date().toISOString(),
      ...meta,
    }
    setErrorLog(prev => [...prev.slice(-19), entry])

    const result = classifyError(message)
    if (result && result.severity !== 'low') {
      // Cooldown to avoid spamming
      cooldownRef.current = true
      setTimeout(() => { cooldownRef.current = false }, 5000)

      setClassification(result)
      setErrorContext(entry)
      setAiResponse('')
      setConversationHistory([])
      setIsOpen(true)

      // Auto-fetch AI guidance
      fetchAIHelp(entry, [])
    }
  }, [])

  // Fetch AI response
  const fetchAIHelp = useCallback(async (ctx, history, question) => {
    setIsAiLoading(true)
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
      const headers = { 'Content-Type': 'application/json' }
      if (token) headers['Authorization'] = `Bearer ${token}`

      const res = await fetch('/api/ai/assistant', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          errorContext: ctx,
          userQuestion: question || null,
          conversationHistory: history,
        }),
      })
      const data = await res.json()
      if (data.success) {
        setAiResponse(data.response)
        // Add to conversation
        if (question) {
          setConversationHistory(prev => [
            ...prev,
            { role: 'user', content: question },
            { role: 'assistant', content: data.response },
          ])
        } else {
          setConversationHistory([{ role: 'assistant', content: data.response }])
        }
      } else {
        setAiResponse('I\'m having trouble connecting right now. Please try the quick tips above or contact your administrator.')
      }
    } catch {
      setAiResponse('I\'m having trouble connecting right now. Please try the quick tips above or contact your administrator.')
    } finally {
      setIsAiLoading(false)
    }
  }, [])

  // User asks a follow-up question
  const askQuestion = useCallback((question) => {
    if (!question.trim()) return
    fetchAIHelp(errorContext, conversationHistory, question.trim())
  }, [errorContext, conversationHistory, fetchAIHelp])

  // Open assistant manually (without error context)
  const openAssistant = useCallback((question) => {
    setErrorContext(null)
    setClassification(null)
    setAiResponse('')
    setConversationHistory([])
    setIsOpen(true)
    if (question) {
      fetchAIHelp(null, [], question)
    }
  }, [fetchAIHelp])

  const closeAssistant = useCallback(() => {
    setIsOpen(false)
  }, [])

  return (
    <AIAssistantContext.Provider
      value={{
        isOpen,
        errorContext,
        classification,
        aiResponse,
        isAiLoading,
        conversationHistory,
        errorLog,
        interceptError,
        askQuestion,
        openAssistant,
        closeAssistant,
      }}
    >
      {children}
    </AIAssistantContext.Provider>
  )
}

export function useAIAssistant() {
  const ctx = useContext(AIAssistantContext)
  if (!ctx) throw new Error('useAIAssistant must be used within AIAssistantProvider')
  return ctx
}
