'use client'

import { createContext, useContext, useState, useCallback, useRef } from 'react'
import toast from 'react-hot-toast'
import { getMiraClientContext } from '@/lib/miraClientContext'
import { executeMiraUiAction } from '@/lib/miraUiAction'
import { resolveMiraSnapshot } from '@/lib/miraSnapshotClient'
import { advanceMiraTaskBank, mergeMiraTaskPlan, recordMiraTaskOutcome } from '@/lib/miraTaskBank'
import { miraNavigationPath } from '@/lib/miraNavigation'
import { buildMiraDismissalResponse } from '@/lib/miraDismissal'
import { readMiraEvents } from '@/lib/miraStream'
import { matchMiraViewMode } from '@/lib/miraViewMode'
import { compactMiraHistory } from '@/lib/miraChatBudget'
import { miraSpeechSummary } from '@/lib/miraSpokenReply'

const MiraChatContext = createContext()

function getAuthToken() {
  return localStorage.getItem('token') || document.cookie.match(/token=([^;]+)/)?.[1] || ''
}

export function MiraChatProvider({ children }) {
  const [isOpen, setIsOpen] = useState(false)
  const [viewMode, setViewModeState] = useState('chat')
  const setViewMode = useCallback(mode => {
    if (['chat', 'expanded', 'pip'].includes(mode)) setViewModeState(mode)
  }, [])
  const [messages, setMessages] = useState([])
  const [isThinking, setIsThinking] = useState(false)
  const [tokens, setTokens] = useState({ tokensUsed: 0, tokenLimit: 100, tokensRemaining: 100 })
  const [sessions, setSessions] = useState([])
  const [activeSessionId, setActiveSessionId] = useState(null)
  const [showHistory, setShowHistory] = useState(false)
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const abortControllerRef = useRef(null)
  const sendingRef = useRef(false)
  const saveQueueRef = useRef(Promise.resolve())
  const sessionTargetRef = useRef({ id: null })

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
        const resolvedSelections = new Set(data.session.messages.map(m => m.data?.resolvedSelectionId).filter(Boolean))
        setMessages(data.session.messages.map((m, i) => ({
          id: new Date(m.timestamp).getTime() + i,
          role: m.role,
          content: m.content,
          data: m.data?.selectionId && resolvedSelections.has(m.data.selectionId)
            ? { ...m.data, actionResult: { ...m.data.actionResult, resolved: true } } : m.data || null,
          timestamp: new Date(m.timestamp)
        })))
        setActiveSessionId(sessionId)
        sessionTargetRef.current = { id: sessionId }
        setShowHistory(false)
      }
    } catch { /* ignore */ }
  }, [])

  // Create a new session
  const startNewChat = useCallback(async () => {
    setMessages([])
    setActiveSessionId(null)
    sessionTargetRef.current = { id: null }
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
        sessionTargetRef.current = { id: null }
      }
    } catch { /* ignore */ }
  }, [activeSessionId])

  // Save messages to session (create or append)
  const saveToSession = useCallback(async (userMsg, aiMsg, branchHistory = null, target = sessionTargetRef.current) => {
    try {
      const token = getAuthToken()
      const newMsgs = [
        ...(userMsg ? [{ role: 'user', content: userMsg.content, data: userMsg.data, timestamp: userMsg.timestamp }] : []),
        { role: 'assistant', content: aiMsg.content, data: aiMsg.data, timestamp: aiMsg.timestamp }
      ]

      if (target.id) {
        // Append to existing session
        const saved = await fetch(`/api/ai/mira-chat/sessions/${target.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ messages: newMsgs, ...(branchHistory !== null ? { replaceFromIndex: branchHistory.length, expectedMessageCount: messages.length } : {}) })
        })
        if (!saved.ok) {
          const error = await saved.json().catch(() => ({}))
          throw new Error(error.message || 'Could not save this conversation. Your response is still visible here.')
        }
      } else {
        // Create new session
        const createRes = await fetch('/api/ai/mira-chat/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ title: (userMsg?.content || 'MIRA task queue').slice(0, 50) })
        })
        const createData = await createRes.json()
        if (createData.success) {
          const sessionId = createData.session._id
          target.id = sessionId
          if (sessionTargetRef.current === target) setActiveSessionId(sessionId)
          // Append messages
          const saved = await fetch(`/api/ai/mira-chat/sessions/${sessionId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ messages: [...(branchHistory || []).map(m => ({ role: m.role, content: m.content, data: m.data, timestamp: m.timestamp })), ...newMsgs] })
          })
          if (!saved.ok) throw new Error('Could not save this conversation. Your response is still visible here.')
        }
      }
    } catch (error) { toast.error(error.message || 'Could not save this conversation. Please try again.') }
  }, [activeSessionId, messages.length])

  const openChat = useCallback((options = {}) => {
    setViewModeState(options.mode === 'pip' ? 'pip' : 'chat')
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

  const toggleChat = useCallback(() => { setViewModeState('chat'); setIsOpen(prev => !prev) }, [])
  const toggleHistory = useCallback(() => {
    setShowHistory(prev => {
      if (!prev) fetchSessions() // refresh when opening
      return !prev
    })
  }, [fetchSessions])

  const sendMessage = useCallback(async (text, options = {}) => {
    const dismissal = !options.attachments?.length && buildMiraDismissalResponse(text)
    if (dismissal) {
      setMessages(previous => {
        const id = Math.max(Date.now(), ...previous.map(message => (Number(message.id) || 0) + 1))
        return [...previous,
          { id, role: 'user', content: text, timestamp: new Date() },
          { id: id + 1, role: 'assistant', content: dismissal.message, data: dismissal, timestamp: new Date() },
        ]
      })
      if (dismissal.action.type === 'dismiss') closeChat()
      return dismissal.message
    }
    const requestedView = !options.attachments?.length && matchMiraViewMode(text)
    if (requestedView) {
      setViewMode(requestedView)
      setIsOpen(true)
      const reply = /[\u0900-\u097f]/u.test(text) ? 'Theek hai.' : 'Done.'
      options.onResponse?.(reply)
      return reply
    }
    if (!text.trim() || isThinking || sendingRef.current) return
    let resolvedAction = null
    let resolvedSelectionId = null
    if (options.resolvePerson) {
      const source = messages.find(m => m.id === options.resolvePerson.messageId)
      const resolution = source?.data?.actionResult?.resolution
      const person = resolution?.candidates?.find(p => p.value === options.resolvePerson.value)
      if (!person || source.data.actionResult.resolved) return
      resolvedSelectionId = source.data.selectionId
      resolvedAction = { ...source.data.action, fields: { ...source.data.action.fields } }
      const field = resolution.field
      resolvedAction.fields[field] = Array.isArray(resolvedAction.fields[field])
        ? resolvedAction.fields[field].map(value => value === resolution.query ? person.value : value)
        : person.value
    }
    sendingRef.current = true

    const branchIndex = options.replaceFromId !== undefined ? messages.findIndex(m => m.id === options.replaceFromId && m.role === 'user') : -1
    const history = (branchIndex >= 0 ? messages.slice(0, branchIndex) : messages).map(m => m.id === options.resolvePerson?.messageId
      ? { ...m, data: { ...m.data, actionResult: { ...m.data.actionResult, resolved: true } } } : m)

    const nextId = Math.max(Date.now(), messages.reduce((max, message) => Math.max(max, Number(message.id) || 0), 0) + 1)
    const userMsg = { id: nextId, role: 'user', content: text, ...(options.attachments?.length ? { data: { attachments: options.attachments } } : {}), timestamp: new Date() }
    let nextReplyId = userMsg.id + 1
    const saveTarget = sessionTargetRef.current
    setMessages([...history, userMsg])
    setIsThinking(true)

    try {
      const token = getAuthToken()
      abortControllerRef.current = new AbortController()
      const requestController = abortControllerRef.current

      let conversationHistory = compactMiraHistory(history)
      let taskBank = advanceMiraTaskBank([...history].reverse().find(message => message.data?.taskBank)?.data.taskBank, text)
      let queueMessage = text
      let lastReply = ''
      for (let queueStep = 0; queueStep < 8; queueStep += 1) {
      const replyId = nextReplyId
      requestController.signal.throwIfAborted()

      const res = resolvedAction && queueStep === 0 ? { json: async () => ({ success: true, response: { message: '', action: resolvedAction, cards: [], suggestedQuestions: [] } }) } : await fetch('/api/ai/mira-chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ message: queueMessage, attachments: options.attachments || [], conversationHistory, taskBank, clientContext: getMiraClientContext(), stream: true, inputMode: options.inputMode === 'voice' ? 'voice' : 'chat' }),
        signal: abortControllerRef.current.signal
      })

      let data
      if (res.headers?.get('content-type')?.includes('text/event-stream')) {
        await readMiraEvents(res.body, event => {
          if (event.type === 'error') throw new Error(event.message)
          if (event.type === 'complete') data = event
          if (event.type === 'speech') options.onPartialSpeech?.(event.speech)
          if (event.type === 'message') {
            options.onPartialResponse?.(event.message)
            const partial = { id: replyId, role: 'assistant', content: event.message, streaming: true, timestamp: new Date() }
            setMessages(prev => prev.some(m => m.id === replyId) ? prev.map(m => m.id === replyId ? partial : m) : [...prev, partial])
          }
        })
        if (!data) throw new Error('Incomplete reply')
      } else data = await res.json()

      if (data.success) {
        data.response.taskBank = data.response.taskBank || mergeMiraTaskPlan(taskBank, data.response, text)
        if (data.tokens) setTokens(data.tokens)
        if (data.response.action?.type === 'generate_image') {
          const pendingImage = { id: replyId, role: 'assistant', content: data.response.message, data: { ...data.response, image: { status: 'pending' } }, timestamp: new Date() }
          setMessages(prev => prev.some(m => m.id === replyId) ? prev.map(m => m.id === replyId ? pendingImage : m) : [...prev, pendingImage])
          let outcome
          try {
          const imageResponse = await fetch('/api/ai/mira-images', {
            method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ action: data.response.action, requestId: crypto.randomUUID() }),
            signal: abortControllerRef.current.signal,
          })
          outcome = await imageResponse.json()
          } catch {
            outcome = { success: false, uncertain: true, message: 'Image generation was interrupted. Check whether an image was produced before retrying.' }
          }
          data.response.image = outcome.success ? outcome.image : { status: 'failed' }
          data.response.message = outcome.success
            ? (/[\u0900-\u097f]/u.test(text) ? 'Aapki image taiyaar hai.' : 'Your image is ready.')
            : (outcome.message || 'Image generation failed. Please try again.')
          data.response.actionResult = { success: Boolean(outcome.success), uncertain: outcome.uncertain === true, message: data.response.message }
          data.response.suggestedQuestions = []
        }
        if (data.response.action?.type === 'ui_action') {
          const outcome = await executeMiraUiAction(data.response.action, {
            signal: abortControllerRef.current.signal,
            resolveSnapshot: snapshot => resolveMiraSnapshot(snapshot, { token, signal: abortControllerRef.current.signal }),
          })
          data.response.actionResult = outcome
          data.response.message = outcome.message
          data.response.suggestedQuestions = []
        }
        if (data.response.action && !['navigate', 'dismiss', 'generate_image', 'ui_action'].includes(data.response.action.type)) {
          window.dispatchEvent(new CustomEvent('mira:activity', { detail: { label: data.response.action.type.replaceAll('_', ' '), phase: 'working' } }))
          // Execute only a newly generated requested action, never a rendered/saved message.
          let outcome
          try {
            const actionResponse = await fetch('/api/ai/mira-actions', {
              method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ action: data.response.action, confirmed: true }),
              signal: abortControllerRef.current.signal,
            })
            outcome = await actionResponse.json()
          } catch {
            outcome = { success: false, uncertain: true, message: 'The connection was interrupted. Check the destination before trying again; the action may have completed.' }
          }
          data.response.actionResult = outcome
          window.dispatchEvent(new CustomEvent('mira:activity', { detail: { label: outcome.success ? 'Completed' : outcome.resolution ? 'Waiting for your choice' : 'Action failed', phase: 'done' } }))
          if (outcome.resolution) data.response.selectionId = String(userMsg.id)
          if (resolvedSelectionId) data.response.resolvedSelectionId = resolvedSelectionId
          data.response.message = outcome.message || (outcome.success ? 'Completed successfully.' : 'The action could not be completed.')
          data.response.suggestedQuestions = []
        }
        data.response.taskBank = recordMiraTaskOutcome(data.response.taskBank, data.response.actionResult)
        const remainingTasks = data.response.taskBank.tasks.filter(task => task.status !== 'completed')
        const aiMsg = {
          id: replyId,
          role: 'assistant',
          content: data.response.message,
          data: data.response,
          timestamp: new Date()
        }
        setMessages(prev => prev.some(m => m.id === replyId) ? prev.map(m => m.id === replyId ? aiMsg : m) : [...prev, aiMsg])
        // Start voice as soon as the reply is visible, without waiting on persistence.
        if (data.response.action?.type === 'dismiss') closeChat()
        else options.onResponse?.(aiMsg.content)
        if (data.response.action?.type !== 'dismiss') {
          // Execution results supersede any proposed action narration.
          options.onSpeech?.(miraSpeechSummary(data.response.actionResult ? aiMsg.content : data.response.speech || aiMsg.content))
        }
        if (data.response.action?.type === 'navigate' && miraNavigationPath(data.response.action.page)) {
          setViewMode('pip')
          window.dispatchEvent(new CustomEvent('mira:navigate', { detail: { page: data.response.action.page } }))
        }
        const navigation = data.response.actionResult?.navigation
        if (navigation && miraNavigationPath(navigation.page, navigation.id)) {
          setViewMode('pip')
          window.dispatchEvent(new CustomEvent('mira:navigate', { detail: navigation }))
        }
        // Persistence is ordered but never holds the completed reply in thinking state.
        // Capture the target so switching chats cannot redirect a queued save.
        const savedUser = queueStep === 0 ? userMsg : null
        const savedBranch = queueStep === 0 && branchIndex >= 0 ? history : null
        saveQueueRef.current = saveQueueRef.current.catch(() => {}).then(() =>
          saveToSession(savedUser, aiMsg, savedBranch, saveTarget))
        lastReply = aiMsg.content
        if (!data.response.actionResult?.success || data.response.actionResult.uncertain || !remainingTasks.length || remainingTasks[0].status !== 'pending') return lastReply
        taskBank = data.response.taskBank
        conversationHistory = [...conversationHistory, ...(queueStep === 0 ? [{ role: 'user', content: text }] : []), ...compactMiraHistory([aiMsg])].slice(-10)
        queueMessage = remainingTasks[0].request
        nextReplyId += 1
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
        return
      }
      }
      return lastReply
    } catch (err) {
      window.dispatchEvent(new CustomEvent('mira:activity', { detail: { label: 'Stopped', phase: 'done' } }))
      setMessages(prev => prev.filter(m => m.id !== nextReplyId))
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
      sendingRef.current = false
      setIsThinking(false)
      abortControllerRef.current = null
    }
  }, [messages, isThinking, saveToSession, closeChat, setViewMode])

  const clearHistory = useCallback(() => {
    setMessages([])
    setActiveSessionId(null)
    sessionTargetRef.current = { id: null }
  }, [])

  return (
    <MiraChatContext.Provider value={{
      isOpen, openChat, closeChat, toggleChat,
      viewMode, setViewMode,
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
      viewMode: 'chat', setViewMode: () => {},
      messages: [], sendMessage: () => {}, clearHistory: () => {},
      isThinking: false, tokens: { tokensUsed: 0, tokenLimit: 100, tokensRemaining: 100 },
      sessions: [], activeSessionId: null, showHistory: false,
      toggleHistory: () => {}, loadSession: () => {}, startNewChat: () => {},
      deleteSession: () => {}, sessionsLoading: false
    }
  }
  return context
}
