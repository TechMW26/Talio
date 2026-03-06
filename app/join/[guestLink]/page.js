'use client'

import { useState, useEffect, use } from 'react'
import { useRouter } from 'next/navigation'
import { HiOutlineVideoCamera, HiOutlineUser, HiOutlineClock, HiOutlineCalendar } from 'react-icons/hi2'
import toast from '@/utils/toast'
import Loader from '@/components/ui/Loader'

export default function GuestJoinPage({ params }) {
  const router = useRouter()
  const { guestLink } = use(params)
  
  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState(false)
  const [meeting, setMeeting] = useState(null)
  const [error, setError] = useState(null)
  const [guestName, setGuestName] = useState('')

  // Validate guest link on mount
  useEffect(() => {
    validateGuestLink()
  }, [guestLink])

  const validateGuestLink = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/meetings/guest/${guestLink}`)
      const data = await response.json()

      if (data.success) {
        setMeeting(data.data)
      } else {
        setError(data.message || 'Invalid meeting link')
      }
    } catch (err) {
      console.error('Error validating guest link:', err)
      setError('Failed to load meeting information')
    } finally {
      setLoading(false)
    }
  }

  const handleJoin = async (e) => {
    e.preventDefault()
    
    if (!guestName.trim() || guestName.trim().length < 2) {
      toast.error('Please enter your name (at least 2 characters)')
      return
    }

    try {
      setJoining(true)
      
      const response = await fetch(`/api/meetings/guest/${guestLink}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guestName: guestName.trim() })
      })

      const data = await response.json()

      if (data.success) {
        // Store guest info in sessionStorage for the meeting room
        sessionStorage.setItem('guestInfo', JSON.stringify({
          guestName: data.data.guestName,
          guestToken: data.data.guestToken,
          isGuest: true
        }))

        toast.success('Joining meeting...')
        
        // Redirect to meeting room
        router.push(`/join/${guestLink}/room`)
      } else {
        toast.error(data.message || 'Failed to join meeting')
      }
    } catch (err) {
      console.error('Error joining meeting:', err)
      toast.error('Failed to join meeting')
    } finally {
      setJoining(false)
    }
  }

  // Format date/time
  const formatDateTime = (date) => {
    return new Date(date).toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    })
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-indigo-50 dark:bg-[#0F172A] flex items-center justify-center p-4">
        <div className="text-center">
          <Loader size="lg" className="mb-4" />
          <p className="text-gray-600">Loading meeting information...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-indigo-50 dark:bg-[#0F172A] flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl p-8 text-center shadow-xl border border-gray-200">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <HiOutlineVideoCamera className="w-8 h-8 text-red-500" />
          </div>
          <h1 className="text-xl font-bold text-gray-800 mb-2">Unable to Join Meeting</h1>
          <p className="text-gray-500 mb-6">{error}</p>
          <button
            onClick={() => window.location.href = '/'}
            className="px-6 py-2 text-indigo-600 hover:text-indigo-700 font-medium"
          >
            Go to Homepage
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        {/* Talio Branding */}
        <div className="text-center mb-6">
          <h2 className="text-2xl font-bold text-indigo-600">Talio</h2>
          <p className="text-gray-500 text-sm">You're invited to join a meeting</p>
        </div>

        <div className="bg-white rounded-2xl p-6 shadow-xl border border-gray-200">
          {/* Meeting Info */}
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-indigo-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <HiOutlineVideoCamera className="w-8 h-8 text-indigo-600" />
            </div>
            <h1 className="text-xl font-bold text-gray-800 mb-2">
              {meeting?.title || 'Video Meeting'}
            </h1>
            {meeting?.description && (
              <p className="text-gray-500 text-sm mb-4">{meeting.description}</p>
            )}
          </div>

          {/* Meeting Time */}
          <div className="bg-gray-50 rounded-xl p-4 mb-6 space-y-2">
            <div className="flex items-center gap-3 text-sm text-gray-600">
              <HiOutlineCalendar className="w-5 h-5 text-indigo-500" />
              <span>{formatDateTime(meeting?.scheduledStart)}</span>
            </div>
            <div className="flex items-center gap-3 text-sm text-gray-600">
              <HiOutlineClock className="w-5 h-5 text-indigo-500" />
              <span>
                Until {new Date(meeting?.scheduledEnd).toLocaleTimeString('en-US', {
                  hour: 'numeric',
                  minute: '2-digit',
                  hour12: true
                })}
              </span>
            </div>
          </div>

          {/* Guest Name Form */}
          <form onSubmit={handleJoin}>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Enter your name to join
              </label>
              <div className="relative">
                <HiOutlineUser className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  placeholder="Your name"
                  className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  maxLength={50}
                  autoFocus
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={joining || !guestName.trim()}
              className={`w-full py-3 rounded-xl font-medium transition-colors ${
                joining || !guestName.trim()
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-indigo-600 text-white hover:bg-indigo-700'
              }`}
            >
              {joining ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader size="xs" />
                  Joining...
                </span>
              ) : (
                'Join Meeting'
              )}
            </button>
          </form>

          {/* Footer note */}
          <p className="text-xs text-gray-400 text-center mt-4">
            By joining, you agree to follow the meeting guidelines
          </p>
        </div>

        {/* Powered by */}
        <p className="text-center text-xs text-gray-400 mt-4">
          Powered by Talio HRMS
        </p>
      </div>
    </div>
  )
}
