'use client'

import { useState, useCallback, useEffect, useRef, useId } from 'react'
import { FaTimes, FaExclamationTriangle, FaHourglassHalf, FaRegBell, FaRegClock } from 'react-icons/fa'
import { useRouter } from 'next/navigation'
import toast from '@/utils/toast'
import Loader from '@/components/ui/Loader'

/**
 * ActionableToast Component
 * 
 * A persistent toast notification that requires user action.
 * Supports multiple action buttons with different styles and behaviors.
 * Can call API endpoints or navigate to URLs.
 */
export default function ActionableToast({ notification, onDismiss, onAction, onSnooze }) {
  const titleId = useId()
  const reasonId = useId()
  const [isVisible, setIsVisible] = useState(false)
  const [loadingAction, setLoadingAction] = useState(null)
  const [showReasonInput, setShowReasonInput] = useState(false)
  const [reason, setReason] = useState('')
  const [selectedAction, setSelectedAction] = useState(null)
  const [showConfirmation, setShowConfirmation] = useState(false)
  const isMountedRef = useRef(true)
  const router = useRouter()
  const canSnooze = typeof onSnooze === 'function'
  const handleSnooze = async () => {
    if (loadingAction !== null) return
    setLoadingAction('snooze')
    try {
      await onSnooze()
      toast.success('Reminder set for 1 hour. No decision was made.')
    } catch (error) {
      toast.error(error.message || 'Unable to set reminder. Please try again.')
    } finally {
      if (isMountedRef.current) setLoadingAction(null)
    }
  }

  // Animation on mount
  useEffect(() => {
    isMountedRef.current = true
    const timer = setTimeout(() => {
      if (isMountedRef.current) {
        setIsVisible(true)
      }
    }, 10)

    return () => {
      isMountedRef.current = false
      clearTimeout(timer)
    }
  }, [])

  // Handle dismiss with animation
  const handleDismiss = useCallback((force = false, persistDismissal = true) => {
    if (notification.displaySettings?.dismissible === false && !force) return
    setIsVisible(false)
    setTimeout(() => {
      if (isMountedRef.current && persistDismissal) {
        onDismiss?.()
      }
    }, 300)
  }, [notification.displaySettings?.dismissible, onDismiss])

  // Handle action click
  const handleActionClick = useCallback(async (action) => {
    // Handle view action - navigate and dismiss
    if (action.id === 'view') {
      if (notification.url) {
        router.push(notification.url)
      }
      handleDismiss()
      onAction?.(action.id)
      return
    }

    // Handle dismiss action
    if (action.id === 'dismiss' || action.id === 'dismissed') {
      handleDismiss()
      onAction?.(action.id)
      return
    }

    // Check if action requires confirmation
    if (action.requiresConfirmation && !showConfirmation) {
      setSelectedAction(action)
      setShowConfirmation(true)
      return
    }

    // Check if action requires reason
    if (action.requiresReason && !reason.trim()) {
      setSelectedAction(action)
      setShowReasonInput(true)
      return
    }

    // Execute the action
    setLoadingAction(action.id)
    setShowConfirmation(false)

    try {
      // If the action has an endpoint, call it directly from the client
      // This avoids the unreliable server-to-self fetch proxy pattern
      if (action.endpoint) {
        const token = localStorage.getItem('token')
        const payload = { ...(action.payload || {}) }
        if (reason) {
          payload.reason = reason
          payload.rejectionReason = reason
        }

        const method = (action.method || 'POST').toUpperCase()
        const fetchOptions = {
          method,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          }
        }
        // Only include body for methods that support it
        if (['POST', 'PUT', 'PATCH'].includes(method)) {
          fetchOptions.body = JSON.stringify(payload)
        }

        const endpointResponse = await fetch(action.endpoint, fetchOptions)

        // Handle non-JSON responses gracefully (e.g. 404 HTML pages)
        let endpointResult
        const contentType = endpointResponse.headers.get('content-type') || ''
        if (contentType.includes('application/json')) {
          endpointResult = await endpointResponse.json()
        } else {
          endpointResult = { message: `Request failed with status ${endpointResponse.status}` }
        }

        if (!endpointResponse.ok) {
          toast.error(endpointResult?.message || 'Action failed')
          if (isMountedRef.current) {
            setLoadingAction(null)
            setReason('')
            setShowReasonInput(false)
            setSelectedAction(null)
          }
          return
        }

        // Endpoint succeeded - mark notification as actioned (skip server-side proxy)
        await onAction?.(action.id, reason || null, true)
        toast.success(endpointResult?.message || 'Action completed successfully')
        handleDismiss(true, false)
      } else {
        // No endpoint - just mark as actioned via the backend
        const result = await onAction?.(action.id, reason || null, false)

        if (result?.success) {
          toast.success(result.message || 'Action completed successfully')
          if (result.url) router.push(result.url)
          handleDismiss(true, false)
        } else {
          toast.error(result?.message || 'Action failed')
        }
      }
    } catch (error) {
      console.error('[ActionableToast] Action error:', error)
      toast.error('Something went wrong')
    } finally {
      if (isMountedRef.current) {
        setLoadingAction(null)
        setReason('')
        setShowReasonInput(false)
        setSelectedAction(null)
      }
    }
  }, [notification, router, handleDismiss, onAction, reason, showConfirmation])

  // Submit reason and execute action
  const handleReasonSubmit = useCallback((e) => {
    e?.preventDefault()
    if (selectedAction) {
      handleActionClick(selectedAction)
    }
  }, [selectedAction, handleActionClick])

  // Cancel reason input
  const handleCancelReason = useCallback(() => {
    setShowReasonInput(false)
    setReason('')
    setSelectedAction(null)
    setShowConfirmation(false)
  }, [])

  // Get icon for notification type
  const getTypeIcon = () => {
    if (notification.type === 'probation_approval' || notification.icon === 'probation') {
      return <FaHourglassHalf className="h-5 w-5 text-amber-500" aria-hidden="true" />
    }
    return <FaRegBell className="h-4 w-4 text-default-500" aria-hidden="true" />
  }

  // Get button style based on variant
  const getButtonStyle = (variant) => {
    const styles = {
      primary: 'bg-primary text-primary-foreground hover:opacity-90',
      secondary: 'border border-default-200 bg-transparent text-default-700 hover:bg-default-100',
      success: 'bg-primary text-primary-foreground hover:opacity-90',
      danger: 'border border-danger-200 bg-transparent text-danger-600 dark:text-danger-400 hover:bg-danger-50',
      warning: 'border border-default-200 bg-transparent text-default-700 hover:bg-default-100'
    }
    return styles[variant] || styles.primary
  }

  // Get priority indicator
  const getPriorityBadge = () => {
    if (notification.priority === 'urgent') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
          <FaExclamationTriangle className="w-3 h-3" />
          Urgent
        </span>
      )
    }
    return null
  }

  return (
    <div
      role="region"
      aria-labelledby={titleId}
      className={`
        w-full bg-white dark:bg-zinc-950 rounded-2xl shadow-lg border border-gray-200 dark:border-zinc-800
        overflow-hidden
        transition-[transform,opacity] duration-200 motion-reduce:transition-none transform
        ${isVisible ? 'translate-x-0 opacity-100 scale-100' : 'translate-x-full opacity-0 scale-95'}
      `}
    >
      {/* Header */}
      <div className="px-4 pt-4 pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-default-100 flex-shrink-0">{getTypeIcon()}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 id={titleId} className="font-semibold text-gray-900 dark:text-zinc-100 text-sm leading-5">
                  {notification.title}
                </h3>
                {getPriorityBadge()}
              </div>
              <p className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">
                {notification.createdBy?.firstName 
                  ? `From ${notification.createdBy.firstName} ${notification.createdBy.lastName || ''}`
                  : formatTimeAgo(notification.createdAt)
                }
              </p>
            </div>
          </div>
          {(notification.displaySettings?.dismissible !== false || canSnooze) && (
            <button
              onClick={notification.displaySettings?.dismissible === false ? handleSnooze : () => handleDismiss()}
              disabled={loadingAction !== null}
              className="p-2 rounded-full hover:bg-default-100 transition-colors disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              aria-label={notification.displaySettings?.dismissible === false ? 'Dismiss and remind me in 1 hour' : 'Dismiss notification'}
              title={notification.displaySettings?.dismissible === false ? 'Remind me in 1 hour' : 'Dismiss'}
            >
              <FaTimes className="w-4 h-4 text-gray-500 dark:text-zinc-400" />
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="px-4 py-3">
        <p className="max-h-40 overflow-y-auto text-sm leading-6 text-gray-600 dark:text-zinc-300 whitespace-pre-wrap break-words">
          {notification.message}
        </p>
      </div>

      {/* Reason Input (if needed) */}
      {showReasonInput && selectedAction && (
        <div className="px-4 pb-3">
          <form onSubmit={handleReasonSubmit}>
            <label htmlFor={reasonId} className="block text-sm font-medium text-gray-700 dark:text-zinc-200 mb-1">
              {selectedAction.reasonPrompt || 'Please provide a reason'}
            </label>
            <textarea
              id={reasonId}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Enter reason..."
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg 
                       bg-white text-gray-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100
                       focus:ring-2 focus:ring-blue-500 focus:border-transparent
                       resize-none"
              rows={2}
              required
              autoFocus
            />
            <div className="flex justify-end gap-2 mt-2">
              <button
                type="button"
                onClick={handleCancelReason}
                className="px-3 py-1.5 text-sm rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 dark:bg-zinc-800 dark:hover:bg-zinc-700 dark:text-zinc-200"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!reason.trim() || loadingAction !== null}
                className={`px-3 py-1.5 text-sm rounded-lg ${getButtonStyle(selectedAction.variant)}`}
              >
                {loadingAction === selectedAction.id ? (
                  <Loader size="xs" />
                ) : (
                  selectedAction.label
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Confirmation Dialog */}
      {showConfirmation && selectedAction && (
        <div className="px-4 pb-3">
          <div className="p-3 bg-default-50 border border-default-200 rounded-xl">
            <p className="text-sm text-default-700">
              {selectedAction.confirmationMessage || 'Are you sure you want to proceed?'}
            </p>
            <div className="flex justify-end gap-2 mt-2">
              <button
                type="button"
                onClick={handleCancelReason}
                className="px-3 py-1.5 text-sm rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleActionClick(selectedAction)}
                disabled={loadingAction !== null}
                className={`px-3 py-1.5 text-sm rounded-full disabled:opacity-50 ${getButtonStyle(selectedAction.variant)}`}
              >
                {loadingAction === selectedAction.id ? (
                  <Loader size="xs" />
                ) : (
                  'Confirm'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Actions */}
      {!showReasonInput && !showConfirmation && notification.actions && notification.actions.length > 0 && (
        <div className="px-4 pb-3 pt-1">
          <div className="flex flex-wrap gap-2 justify-end">
            {notification.actions.map((action) => (
              <button
                key={action.id}
                onClick={() => handleActionClick(action)}
                disabled={loadingAction !== null}
                className={`
                  px-4 py-2 text-sm font-medium rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary
                  disabled:opacity-50 disabled:cursor-not-allowed
                  flex items-center gap-2
                  ${getButtonStyle(action.variant)}
                `}
              >
                {loadingAction === action.id ? (
                  <Loader size="xs" />
                ) : null}
                {action.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {canSnooze && <div className="px-4 pb-3 flex justify-end">
        <button type="button" onClick={handleSnooze} disabled={loadingAction !== null}
          className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs text-default-500 hover:text-default-800 hover:bg-default-100 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
          <FaRegClock aria-hidden="true" className="h-3 w-3" />
          {loadingAction === 'snooze' ? 'Setting reminder…' : 'Remind me in 1 hour'}
        </button>
      </div>}

      {/* View button if URL exists and no other actions */}
      {!showReasonInput && !showConfirmation && notification.url && (!notification.actions || notification.actions.length === 0) && (
        <div className="px-4 pb-3 pt-1">
          <div className="flex gap-2 justify-end">
            <button
              onClick={handleDismiss}
              disabled={loadingAction !== null || notification.displaySettings?.dismissible === false}
              className="px-4 py-2 text-sm font-medium rounded-full text-default-600 hover:bg-default-100 disabled:opacity-40"
            >
              Dismiss
            </button>
            <button
              onClick={() => {
                router.push(notification.url)
                handleDismiss()
              }}
              disabled={loadingAction !== null}
              className="px-4 py-2 text-sm font-medium rounded-full bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40"
            >
              View Details
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// Helper function to format time ago
function formatTimeAgo(dateString) {
  if (!dateString) return ''
  
  const date = new Date(dateString)
  const now = new Date()
  const diffInSeconds = Math.floor((now - date) / 1000)
  
  if (diffInSeconds < 60) return 'Just now'
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`
  if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)}d ago`
  
  return date.toLocaleDateString()
}
