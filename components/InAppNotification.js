'use client'

import { useEffect, useState, useRef, useCallback, useId } from 'react'
import { FaTimes, FaComment, FaTasks, FaBullhorn, FaBell, FaArrowRight } from 'react-icons/fa'
import { useRouter } from 'next/navigation'
import { useChatWidget } from '@/contexts/ChatWidgetContext'

export default function InAppNotification({ notification, onClose }) {
  const titleId = useId()
  const [isVisible, setIsVisible] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState('')
  const mounted = useRef(false)
  const closing = useRef(false)
  const closeTimer = useRef(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const router = useRouter()
  const { openChat } = useChatWidget()
  const isChat = notification.type === 'message' && notification.chatId
  const canOpen = Boolean(notification.url || isChat)

  const handleClose = useCallback(() => {
    if (closing.current) return
    closing.current = true
    setIsVisible(false)
    closeTimer.current = setTimeout(() => {
      if (mounted.current) onCloseRef.current?.()
    }, 220)
  }, [])

  useEffect(() => {
    mounted.current = true
    const timer = setTimeout(() => setIsVisible(true), 10)
    return () => {
      mounted.current = false
      clearTimeout(timer)
      clearTimeout(closeTimer.current)
    }
  }, [])

  // Give actions reading time; never dismiss while the user interacts.
  useEffect(() => {
    if (hovered || focused || opening) return
    const timer = setTimeout(handleClose, 8000)
    return () => clearTimeout(timer)
  }, [hovered, focused, opening, handleClose])

  const handleOpen = async () => {
    if (opening || closing.current) return
    setOpening(true)
    setError('')
    try {
      if (isChat && window.innerWidth >= 768) {
        let chat = notification.chatData || { _id: notification.chatId, participants: notification.senderInfo ? [notification.senderInfo] : [] }
        const token = localStorage.getItem('token')
        if (token) {
          try {
            const response = await fetch(`/api/chat/${notification.chatId}`, { headers: { Authorization: `Bearer ${token}` } })
            if (response.ok) chat = await response.json()
          } catch { /* The existing conversation identity remains usable offline. */ }
        }
        if (mounted.current) openChat(chat)
      } else {
        router.push(notification.url || `/dashboard/chat?chatId=${encodeURIComponent(notification.chatId)}`)
      }
      if (mounted.current) handleClose()
    } catch {
      if (mounted.current) setError('Could not open this notification. Please try again.')
    } finally {
      if (mounted.current) setOpening(false)
    }
  }

  const isTask = notification.type?.startsWith('task')
  const Icon = isChat ? FaComment : isTask ? FaTasks : notification.type === 'announcement' ? FaBullhorn : FaBell
  const category = isChat ? 'Message' : isTask ? 'Task update' : notification.type === 'announcement' ? 'Announcement' : 'Notification'
  const actionLabel = isChat ? 'Open conversation' : isTask ? 'View task' : notification.type === 'announcement' ? 'Read announcement' : 'View details'

  return <section className="talio-notification-card notice-enter" data-visible={isVisible} aria-labelledby={titleId}
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onFocusCapture={() => setFocused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false) }}>
    <div className="notice-header">
      <span className="notice-icon" aria-hidden="true"><Icon className="h-4 w-4" /></span>
      <div className="notice-content" role="status">
        <p className="notice-meta">{category} · Just now</p>
        <h3 id={titleId} className="notice-title">{notification.title}</h3>
      </div>
      <button type="button" className="notice-close" onClick={handleClose} aria-label="Close notification"><FaTimes className="h-4 w-4" /></button>
    </div>
    <p className="notice-message">{notification.message}</p>
    {error && <p role="alert" className="notice-message">{error}</p>}
    <div className="notice-actions">
      <button type="button" className="notice-button" onClick={handleClose}>Dismiss</button>
      {canOpen && <button type="button" className="notice-button notice-button-primary" onClick={handleOpen} disabled={opening}>
        {opening ? 'Opening…' : actionLabel}<FaArrowRight aria-hidden="true" className="h-3 w-3" />
      </button>}
    </div>
  </section>
}

