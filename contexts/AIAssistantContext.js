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
  {
    pattern: /\b(?:failed|unable|could not|can't|cannot)\b(?:\s+to)?\s+(?:load|fetch|save|update|create|delete|submit|approve|reject|assign|upload|download|process|complete|verify|clear|send|generate|start|revoke|connect|join|share|schedule)\b/i,
    category: 'workflow',
    severity: 'medium',
  },
  { pattern: /\b(?:action|operation|request|import|verification)\s+failed\b/i, category: 'workflow', severity: 'medium' },
]

// Quick tips for immediate display (before AI responds)
const QUICK_TIPS = {
  auth: [
    'Double-check your email for typos',
    'Ensure Caps Lock is turned off',
    'Use "Forgot Password" to reset your credentials',
  ],
  session: [
    'Log in again - your session refreshes automatically',
    'This is normal after a period of inactivity',
    'Your data is safe, just sign back in',
  ],
  permission: [
    'Reach out to your administrator for access',
    'Some features are available for specific roles',
    'Check if this feature is enabled for your team',
  ],
  network: [
    'Check your internet connection',
    'Refresh the page and try again',
    'Wait a moment, then retry',
  ],
  location: [
    'Open browser settings and allow location access for Talio',
    'Ensure device location services are turned on',
    'Move to an area with a clearer GPS signal',
  ],
  attendance: [
    'Make sure you are within the office geofence area',
    'Check if you have already checked in or out today',
    'Refresh the page and try again',
  ],
  leave: [
    'Review your remaining leave balance in the Leave section',
    'Reach out to HR if you need a leave adjustment',
    'Try selecting a different leave type',
  ],
  upload: [
    'Ensure your file is under the size limit (5–10 MB)',
    'Use supported formats: PDF, JPG, or PNG',
    'Try compressing the file and re-uploading',
  ],
  navigation: [
    'The page may have been moved or is no longer available',
    'Check the URL for any typos',
    'Head back to the Dashboard and navigate from there',
  ],
  server: [
    'This is a temporary service interruption',
    'Wait a moment and try your action again',
    'If it persists, reach out to your administrator',
  ],
  account: [
    'Contact your HR or administrator for account help',
    'Your account status may need to be reviewed',
    'This usually requires admin assistance to resolve',
  ],
  workflow: [
    'Keep the popup open so your entered information is not lost',
    'Review the required fields, then try the action once more',
    'If it still does not complete, use Helpdesk and include the popup name',
  ],
}

export function classifyError(message) {
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
  const [isSolutionProvided, setIsSolutionProvided] = useState(false)
  const [errorLog, setErrorLog] = useState([])
  const cooldownRef = useRef(false)

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
        // Disable further input once a tangible solution is provided
        setIsSolutionProvided(true)
      } else {
        setAiResponse('I\'m having trouble connecting right now. Please try the quick tips above or contact your administrator.')
      }
    } catch {
      setAiResponse('I\'m having trouble connecting right now. Please try the quick tips above or contact your administrator.')
    } finally {
      setIsAiLoading(false)
    }
  }, [])

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
      setIsSolutionProvided(false)
      setIsOpen(true)

      // Auto-fetch AI guidance
      fetchAIHelp(entry, [])
    }
  }, [fetchAIHelp])

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
    setIsSolutionProvided(false)
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
        isSolutionProvided,
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
