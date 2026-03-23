'use client'

import { useState, useEffect } from 'react'
import toast from '@/utils/toast'
import { FaClock, FaCheck, FaTimes, FaBell, FaMapMarkerAlt } from 'react-icons/fa'
import Loader from '@/components/ui/Loader'
import ModalPortal from '@/components/ui/ModalPortal'

/**
 * OvertimePrompt Component
 * 
 * Shows a modal/prompt when the system detects an employee hasn't clocked out
 * 30 minutes after their shift ended. Asks if they're working overtime or forgot.
 * Also checks geolocation - if user is outside office, auto-clocks out.
 */
export default function OvertimePrompt({ userId, onClose, onResponse }) {
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [pendingRequest, setPendingRequest] = useState(null)
  const [checkingLocation, setCheckingLocation] = useState(false)
  const [locationStatus, setLocationStatus] = useState(null)

  useEffect(() => {
    fetchPendingOvertimeRequest()
  }, [])

  // Check geolocation when prompt is shown
  useEffect(() => {
    if (pendingRequest && !loading) {
      checkGeolocation()
    }
  }, [pendingRequest, loading])

  const checkGeolocation = async () => {
    setCheckingLocation(true)
    setLocationStatus('Checking your location...')

    try {
      // Get current position
      if (!navigator.geolocation) {
        setLocationStatus('Geolocation not supported')
        setCheckingLocation(false)
        return
      }

      const position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0
        })
      })

      const { latitude, longitude } = position.coords
      setLocationStatus('Verifying office location...')

      // Call API to check if within geofence
      const token = localStorage.getItem('token')
      const response = await fetch('/api/attendance/geolocation-check', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ latitude, longitude })
      })

      const data = await response.json()

      if (data.success) {
        if (data.autoCheckout) {
          // User was auto-clocked out because they left office
          toast.success('You were automatically clocked out (left office area)')
          setLocationStatus('📍 Clocked out - You left the office area')
          if (onResponse) {
            onResponse(false, { checkOutTime: data.checkOutTime, autoCheckout: true })
          }
          // Close after short delay
          setTimeout(() => {
            if (onClose) onClose()
          }, 2000)
        } else if (data.withinGeofence) {
          setLocationStatus(`📍 You're at: ${data.location || 'Office'}`)
        } else if (!data.isCheckedIn) {
          setLocationStatus('Already clocked out')
          setTimeout(() => {
            if (onClose) onClose()
          }, 1500)
        }
      }
    } catch (error) {
      console.error('Geolocation check failed:', error)
      if (error.code === 1) {
        setLocationStatus('Location access denied')
      } else {
        setLocationStatus('Could not verify location')
      }
    } finally {
      setCheckingLocation(false)
    }
  }

  const fetchPendingOvertimeRequest = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/attendance/overtime?status=pending', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await response.json()

      if (data.success && data.data.length > 0) {
        setPendingRequest(data.data[0])
      }
    } catch (error) {
      console.error('Failed to fetch overtime request:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleResponse = async (isWorkingOvertime) => {
    if (!pendingRequest) return

    setSubmitting(true)
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/attendance/overtime', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          requestId: pendingRequest._id,
          isWorkingOvertime
        })
      })

      const data = await response.json()

      if (data.success) {
        toast.success(data.message)
        if (onResponse) {
          onResponse(isWorkingOvertime, data)
        }
        if (onClose) {
          onClose()
        }
        setPendingRequest(null)
      } else {
        toast.error(data.message || 'Failed to process response')
      }
    } catch (error) {
      console.error('Failed to respond to overtime:', error)
      toast.error('Failed to process response')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return null
  }

  if (!pendingRequest) {
    return null
  }

  const scheduledTime = new Date(pendingRequest.scheduledCheckOut).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit'
  })

  return (
    <ModalPortal isOpen={true}>
    <div className="modal-overlay">
      <div className="bg-white rounded-[30px] shadow-2xl max-w-md w-full mx-4 overflow-hidden animate-modal-enter" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="bg-gradient-to-r from-orange-500 to-red-500 px-6 py-4 text-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="bg-white/20 p-2 rounded-full animate-pulse">
                <FaBell className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-xl font-bold">Overtime Check</h2>
                <p className="text-orange-100 text-sm">Response Required</p>
              </div>
            </div>
            <button
              onClick={() => onClose && onClose()}
              className="text-white/80 hover:text-white transition-colors"
              aria-label="Close"
            >
              <FaTimes className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6">
          {/* Location Status */}
          {(checkingLocation || locationStatus) && (
            <div className={`flex items-center justify-center space-x-2 mb-4 p-3 rounded-lg ${locationStatus?.includes('Clocked out') ? 'bg-green-50 text-green-700' :
                locationStatus?.includes('Office') ? 'bg-blue-50 text-blue-700' :
                  'bg-gray-50 text-gray-600'
              }`}>
              {checkingLocation ? (
                <Loader size="xs" />
              ) : (
                <FaMapMarkerAlt className="w-4 h-4" />
              )}
              <span className="text-sm">{locationStatus}</span>
            </div>
          )}

          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-orange-100 rounded-full mb-4">
              <FaClock className="w-8 h-8 text-orange-500" />
            </div>
            <h3 className="text-lg font-semibold text-gray-800 mb-2">
              Your shift ended at {scheduledTime}
            </h3>
            <p className="text-gray-600">
              It&apos;s been 30 minutes since your shift ended and you haven&apos;t clocked out yet.
            </p>
          </div>

          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
            <p className="text-yellow-800 text-sm text-center">
              <strong>Are you working overtime?</strong><br />
              If yes, your overtime hours will be recorded. If no, you&apos;ll be clocked out now.
            </p>
          </div>

          {/* Buttons */}
          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={() => handleResponse(false)}
              disabled={submitting || (locationStatus?.includes('Clocked out'))}
              className="flex items-center justify-center space-x-2 px-4 py-3 bg-gray-100 text-gray-700 rounded-xl font-medium hover:bg-gray-200 transition-colors disabled:opacity-50"
            >
              <FaTimes className="w-5 h-5" />
              <span>No, Clock Me Out</span>
            </button>
            <button
              onClick={() => handleResponse(true)}
              disabled={submitting || (locationStatus?.includes('Clocked out'))}
              className="flex items-center justify-center space-x-2 px-4 py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-xl font-medium hover:from-green-600 hover:to-emerald-700 transition-colors disabled:opacity-50"
            >
              <FaCheck className="w-5 h-5" />
              <span>Yes, Working OT</span>
            </button>
          </div>

          <p className="text-xs text-gray-400 text-center mt-4">
            If you don&apos;t respond within 30 minutes, you&apos;ll be automatically clocked out.
          </p>
        </div>
      </div>
    </div>
    </ModalPortal>
  )
}

/**
 * Hook to check for pending overtime requests
 */
export function useOvertimeCheck() {
  const [hasPendingRequest, setHasPendingRequest] = useState(false)
  const [pendingRequest, setPendingRequest] = useState(null)

  useEffect(() => {
    const checkForPendingRequests = async () => {
      try {
        const token = localStorage.getItem('token')
        if (!token) return

        const response = await fetch('/api/attendance/overtime?status=pending', {
          headers: { 'Authorization': `Bearer ${token}` }
        })
        const data = await response.json()

        if (data.success && data.data.length > 0) {
          setHasPendingRequest(true)
          setPendingRequest(data.data[0])
        } else {
          setHasPendingRequest(false)
          setPendingRequest(null)
        }
      } catch (error) {
        console.error('Failed to check overtime requests:', error)
      }
    }

    // Check immediately
    checkForPendingRequests()

    // Then check every minute
    const interval = setInterval(checkForPendingRequests, 60000)

    return () => clearInterval(interval)
  }, [])

  return { hasPendingRequest, pendingRequest, refresh: () => setHasPendingRequest(false) }
}
