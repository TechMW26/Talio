'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { FaTimes, FaCheck, FaExclamationTriangle } from 'react-icons/fa'
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
export default function ActionableToast({ notification, onDismiss, onAction }) {
  const [isVisible, setIsVisible] = useState(false)
  const [loadingAction, setLoadingAction] = useState(null)
  const [showReasonInput, setShowReasonInput] = useState(false)
  const [reason, setReason] = useState('')
  const [selectedAction, setSelectedAction] = useState(null)
  const [showConfirmation, setShowConfirmation] = useState(false)
  const isMountedRef = useRef(true)
  const router = useRouter()

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
  const handleDismiss = useCallback(() => {
    setIsVisible(false)
    setTimeout(() => {
      if (isMountedRef.current) {
        onDismiss?.()
      }
    }, 300)
  }, [onDismiss])

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
    if (action.requiresReason && !reason && !showReasonInput) {
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

        // Endpoint succeeded — mark notification as actioned (skip server-side proxy)
        await onAction?.(action.id, reason || null, true)
        toast.success(endpointResult?.message || 'Action completed successfully')
        handleDismiss()
      } else {
        // No endpoint — just mark as actioned via the backend
        const result = await onAction?.(action.id, reason || null, false)

        if (result?.success) {
          toast.success(result.message || 'Action completed successfully')
          if (result.url) router.push(result.url)
          handleDismiss()
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
  }, [notification, router, handleDismiss, onAction, reason, showConfirmation, showReasonInput])

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
    const icons = {
      project_invitation: '📊',
      task_assignment: '✅',
      meeting_invitation: '📅',
      leave_approval: '🏖️',
      expense_approval: '💰',
      document_approval: '📄',
      travel_approval: '✈️',
      attendance_correction: '⏰',
      helpdesk_assignment: '🎫',
      announcement: '📢',
      generic: '🔔'
    }
    return notification.icon || icons[notification.type] || '🔔'
  }

  // Get button style based on variant
  const getButtonStyle = (variant) => {
    const styles = {
      primary: 'bg-blue-600 hover:bg-blue-700 text-white',
      secondary: 'bg-gray-100 hover:bg-gray-200 text-gray-700',
      success: 'bg-green-600 hover:bg-green-700 text-white',
      danger: 'bg-red-600 hover:bg-red-700 text-white',
      warning: 'bg-amber-500 hover:bg-amber-600 text-white'
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
    if (notification.priority === 'high') {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800">
          High Priority
        </span>
      )
    }
    return null
  }

  return (
    <div
      className={`
        w-full max-w-md bg-white rounded-xl shadow-2xl 
        overflow-hidden
        transition-all duration-300 transform
        ${isVisible ? 'translate-x-0 opacity-100 scale-100' : 'translate-x-full opacity-0 scale-95'}
      `}
    >
      {/* Header */}
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="text-2xl flex-shrink-0">{getTypeIcon()}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-semibold text-gray-900 text-sm">
                  {notification.title}
                </h3>
                {getPriorityBadge()}
              </div>
              <p className="text-xs text-gray-500 mt-0.5">
                {notification.createdBy?.firstName 
                  ? `From ${notification.createdBy.firstName} ${notification.createdBy.lastName || ''}`
                  : formatTimeAgo(notification.createdAt)
                }
              </p>
            </div>
          </div>
          <button
            onClick={handleDismiss}
            className="p-1.5 rounded-full hover:bg-gray-200 transition-colors"
            aria-label="Dismiss notification"
          >
            <FaTimes className="w-4 h-4 text-gray-500" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="px-4 py-3">
        <p className="text-sm text-gray-700 whitespace-pre-wrap">
          {notification.message}
        </p>
      </div>

      {/* Reason Input (if needed) */}
      {showReasonInput && selectedAction && (
        <div className="px-4 pb-3">
          <form onSubmit={handleReasonSubmit}>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {selectedAction.reasonPrompt || 'Please provide a reason'}
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Enter reason..."
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg 
                       bg-white text-gray-900
                       focus:ring-2 focus:ring-blue-500 focus:border-transparent
                       resize-none"
              rows={2}
              autoFocus
            />
            <div className="flex justify-end gap-2 mt-2">
              <button
                type="button"
                onClick={handleCancelReason}
                className="px-3 py-1.5 text-sm rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                className={`px-3 py-1.5 text-sm rounded-lg ${getButtonStyle(selectedAction.variant)}`}
              >
                {loadingAction === selectedAction.id ? (
                  <Loader size="xs" />
                ) : (
                  'Submit'
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Confirmation Dialog */}
      {showConfirmation && selectedAction && (
        <div className="px-4 pb-3">
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <p className="text-sm text-amber-800">
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
                className={`px-3 py-1.5 text-sm rounded-lg ${getButtonStyle(selectedAction.variant)}`}
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
        <div className="px-4 py-3 bg-gray-50 border-t border-gray-100">
          <div className="flex flex-wrap gap-2 justify-end">
            {notification.actions.map((action) => (
              <button
                key={action.id}
                onClick={() => handleActionClick(action)}
                disabled={loadingAction !== null}
                className={`
                  px-4 py-2 text-sm font-medium rounded-lg transition-all
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

      {/* View button if URL exists and no other actions */}
      {!showReasonInput && !showConfirmation && notification.url && (!notification.actions || notification.actions.length === 0) && (
        <div className="px-4 py-3 bg-gray-50 border-t border-gray-100">
          <div className="flex gap-2 justify-end">
            <button
              onClick={handleDismiss}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700"
            >
              Dismiss
            </button>
            <button
              onClick={() => {
                router.push(notification.url)
                handleDismiss()
              }}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white"
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
