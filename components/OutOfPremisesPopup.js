'use client'

import { useState, useEffect } from 'react'
import { FaMapMarkerAlt, FaTimes } from 'react-icons/fa'
import { toast } from '@/utils/toast'

export default function OutOfPremisesPopup() {
  const [isOpen, setIsOpen] = useState(false)
  const [position, setPosition] = useState(null)
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const handleGeofenceExit = (event) => {
      setPosition(event.detail.position)
      setIsOpen(true)
    }

    window.addEventListener('geofence-exit', handleGeofenceExit)
    return () => window.removeEventListener('geofence-exit', handleGeofenceExit)
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (!reason.trim()) {
      toast.error('Please provide a reason')
      return
    }

    setSubmitting(true)

    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/geofence/log', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          eventType: 'outside_during_hours',
          reason: reason.trim()
        })
      })

      const data = await response.json()
      if (data.success) {
        toast.success('Your request has been sent to your department head for approval')
        setIsOpen(false)
        setReason('')
      } else {
        toast.error(data.message || 'Failed to submit request')
      }
    } catch (error) {
      console.error('Error submitting request:', error)
      toast.error('Failed to submit request')
    } finally {
      setSubmitting(false)
    }
  }

  const handleClose = () => {
    if (!submitting) {
      setIsOpen(false)
      setReason('')
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9950] p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
        {/* Header */}
        <div className="bg-red-500 text-white px-6 py-4 rounded-t-lg flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FaMapMarkerAlt className="text-2xl" />
            <div>
              <h2 className="text-lg font-bold">Outside Office Premises</h2>
              <p className="text-sm text-red-100">During work hours</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            disabled={submitting}
            className="text-white hover:text-red-100 transition-colors disabled:opacity-50"
          >
            <FaTimes className="text-xl" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-6">
          <div className="mb-4">
            <p className="text-gray-700 mb-4">
              You have been detected outside the office premises during work hours.
              Please provide a reason for your department head's approval.
            </p>

            <label className="block text-sm font-medium text-gray-700 mb-2">
              Reason for being outside office premises *
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="E.g., Client meeting, bank work, personal emergency..."
              required
              rows={4}
              disabled={submitting}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none disabled:bg-gray-100"
            />
          </div>

          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4">
            <p className="text-xs text-yellow-800">
              <strong>Note:</strong> Your request will be sent to your department head for approval.
              You will be notified once it's reviewed.
            </p>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleClose}
              disabled={submitting}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors disabled:opacity-50"
            >
              {submitting ? 'Submitting...' : 'Submit Request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

