'use client'

import { useState, useEffect, useCallback } from 'react'
import { Select, SelectItem } from '@heroui/react'
import {
  HiOutlineCamera,
  HiOutlinePhoto,
  HiOutlineClock,
  HiOutlineChevronLeft,
  HiOutlineChevronRight,
  HiOutlineXMark,
  HiOutlineFunnel,
  HiOutlineArrowPath,
  HiOutlineUser,
  HiOutlineShieldCheck,
  HiOutlineExclamationTriangle
} from 'react-icons/hi2'
import ModalPortal from '@/components/ModalPortal'
import Loader from '@/components/ui/Loader'

/**
 * RawCaptureViewer Component
 * Displays raw screen captures with filtering and role-based access
 */
export default function RawCaptureViewer({ userId = null, date = null, showFilters = true }) {
  const [captures, setCaptures] = useState([])
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedDate, setSelectedDate] = useState(date || new Date().toISOString().split('T')[0])
  const [captureType, setCaptureType] = useState('all') // 'all', 'automatic', 'manual'
  const [selectedCapture, setSelectedCapture] = useState(null)
  const [user, setUser] = useState(null)
  const [targetUser, setTargetUser] = useState(null)
  const [error, setError] = useState(null)

  // Get current user
  useEffect(() => {
    const userData = localStorage.getItem('user')
    if (userData) {
      setUser(JSON.parse(userData))
    }
  }, [])

  // Fetch captures
  const fetchCaptures = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      
      const token = localStorage.getItem('token')
      if (!token) {
        setError('Not authenticated')
        setLoading(false)
        return
      }

      let url = `/api/activity/captures?date=${selectedDate}`
      if (userId) {
        url += `&userId=${userId}`
      }
      if (captureType !== 'all') {
        url += `&type=${captureType}`
      }

      const res = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      if (!res.ok) {
        const errorData = await res.json()
        if (res.status === 403) {
          setError(errorData.error || 'Permission denied')
        } else {
          setError(errorData.error || 'Failed to fetch captures')
        }
        setLoading(false)
        return
      }

      const data = await res.json()
      setCaptures(data.data?.captures || [])
      setSessions(data.data?.sessions || [])
      setTargetUser(data.data?.user || null)
      
    } catch (error) {
      console.error('Error fetching captures:', error)
      setError('Failed to load captures')
    } finally {
      setLoading(false)
    }
  }, [selectedDate, userId, captureType])

  useEffect(() => {
    fetchCaptures()
  }, [fetchCaptures])

  // Navigate date
  const changeDate = (direction) => {
    const d = new Date(selectedDate)
    d.setDate(d.getDate() + direction)
    setSelectedDate(d.toISOString().split('T')[0])
  }

  // Format time
  const formatTime = (timestamp) => {
    if (!timestamp) return '--:--'
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  }

  // Group captures by session - sessions are already sorted by latest first from API
  // Map each session with its captures
  const groupedCaptures = sessions.map((session, idx) => ({
    ...session,
    // Display number: 1 = latest, 2 = second latest, etc.
    displayNumber: idx + 1,
    captures: captures.filter(c => {
      const captureTime = new Date(c.timestamp).getTime()
      const sessionStart = new Date(session.startTime).getTime()
      const sessionEnd = new Date(session.endTime).getTime()
      return captureTime >= sessionStart && captureTime <= sessionEnd
    }).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)) // Sort captures within session by time
  }))

  // Get ungrouped captures (not in any session)
  const ungroupedCaptures = captures.filter(c => {
    return !sessions.some(session => {
      const captureTime = new Date(c.timestamp).getTime()
      const sessionStart = new Date(session.startTime).getTime()
      const sessionEnd = new Date(session.endTime).getTime()
      return captureTime >= sessionStart && captureTime <= sessionEnd
    })
  })

  return (
    <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b bg-gray-50">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-blue-500 to-cyan-600 rounded-xl">
              <HiOutlineCamera className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Raw Captures</h3>
              {targetUser && (
                <p className="text-xs text-gray-500 flex items-center gap-1">
                  <HiOutlineUser className="w-3 h-3" />
                  {targetUser.name || targetUser.email}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Date Navigation */}
            <div className="flex items-center bg-white rounded-lg border">
              <button
                onClick={() => changeDate(-1)}
                className="p-2 hover:bg-gray-100 rounded-l-lg transition"
              >
                <HiOutlineChevronLeft className="w-4 h-4" />
              </button>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                max={new Date().toISOString().split('T')[0]}
                className="border-0 focus:ring-0 text-sm w-32 text-center"
              />
              <button
                onClick={() => changeDate(1)}
                disabled={selectedDate >= new Date().toISOString().split('T')[0]}
                className="p-2 hover:bg-gray-100 rounded-r-lg transition disabled:opacity-50"
              >
                <HiOutlineChevronRight className="w-4 h-4" />
              </button>
            </div>

            {/* Refresh */}
            <button
              onClick={fetchCaptures}
              disabled={loading}
              className="p-2 hover:bg-gray-100 rounded-lg transition"
            >
              <HiOutlineArrowPath className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Filters */}
        {showFilters && (
          <div className="mt-3 flex items-center gap-2">
            <HiOutlineFunnel className="w-4 h-4 text-gray-400" />
            <Select
              selectedKeys={[captureType]}
              onChange={(e) => setCaptureType(e.target.value)}
              aria-label="Capture Type Filter"
              size="sm"
              classNames={{ trigger: "bg-white" }}
            >
              <SelectItem key="all">All Captures</SelectItem>
              <SelectItem key="automatic">Automatic Only</SelectItem>
              <SelectItem key="manual">Manual Only</SelectItem>
            </Select>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-4">
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <Loader size="md" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-48 text-center">
            <HiOutlineExclamationTriangle className="w-12 h-12 text-red-300 mb-3" />
            <p className="text-red-600 font-medium">{error}</p>
            <button
              onClick={fetchCaptures}
              className="mt-3 px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition text-sm"
            >
              Try Again
            </button>
          </div>
        ) : captures.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-center">
            <HiOutlinePhoto className="w-12 h-12 text-gray-300 mb-3" />
            <p className="text-gray-500">No captures found for this date</p>
            {['admin'].includes(targetUser?.role) && (
              <div className="mt-3 flex items-center gap-2 px-4 py-2 bg-yellow-50 text-yellow-700 rounded-lg text-sm">
                <HiOutlineShieldCheck className="w-4 h-4" />
                Admin screens are not captured
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Summary */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <div className="bg-blue-50 rounded-lg p-3">
                <p className="text-xs text-blue-600 font-medium">Total Captures</p>
                <p className="text-2xl font-bold text-blue-700">{captures.length}</p>
              </div>
              <div className="bg-purple-50 rounded-lg p-3">
                <p className="text-xs text-purple-600 font-medium">Sessions</p>
                <p className="text-2xl font-bold text-purple-700">{sessions.length}</p>
              </div>
              <div className="bg-green-50 rounded-lg p-3">
                <p className="text-xs text-green-600 font-medium">Automatic</p>
                <p className="text-2xl font-bold text-green-700">
                  {captures.filter(c => !c.isManual).length}
                </p>
              </div>
              <div className="bg-orange-50 rounded-lg p-3">
                <p className="text-xs text-orange-600 font-medium">Manual</p>
                <p className="text-2xl font-bold text-orange-700">
                  {captures.filter(c => c.isManual).length}
                </p>
              </div>
            </div>

            {/* Sessions with captures */}
            {groupedCaptures.map((session, sessionIndex) => (
              <div key={session._id} className="mb-6">
                <div className="flex items-center gap-2 mb-3">
                  <div className="h-px flex-1 bg-gray-200"></div>
                  <span className="text-xs font-medium text-gray-500 px-2 py-1 bg-gray-100 rounded-full">
                    {session.sessionTitle || `Session ${session.displayNumber}`} • {formatTime(session.startTime)} - {formatTime(session.endTime)}
                    {session.isComplete && ' ✓'}
                    {session.analysis?.isAnalyzed && ' ★'}
                  </span>
                  <div className="h-px flex-1 bg-gray-200"></div>
                </div>
                
                <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 gap-2">
                  {session.captures.map((capture, index) => (
                    <div
                      key={capture.path}
                      className="relative group cursor-pointer rounded-lg overflow-hidden border border-gray-200 hover:border-blue-400 hover:shadow-md transition"
                      onClick={() => setSelectedCapture(capture)}
                    >
                      <div className="aspect-video bg-gray-100">
                        <img
                          src={capture.path}
                          alt={`Capture ${index + 1}`}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      </div>
                      <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] px-1 py-0.5 flex items-center justify-between">
                        <span className="flex items-center gap-0.5">
                          <HiOutlineClock className="w-2.5 h-2.5" />
                          {formatTime(capture.timestamp).slice(0, 5)}
                        </span>
                        {capture.isManual && (
                          <span className="bg-orange-500 text-white text-[8px] px-1 rounded">M</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {/* Ungrouped captures */}
            {ungroupedCaptures.length > 0 && (
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="h-px flex-1 bg-gray-200"></div>
                  <span className="text-xs font-medium text-gray-500 px-2 py-1 bg-gray-100 rounded-full">
                    Other Captures
                  </span>
                  <div className="h-px flex-1 bg-gray-200"></div>
                </div>
                
                <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 gap-2">
                  {ungroupedCaptures.map((capture, index) => (
                    <div
                      key={capture.path}
                      className="relative group cursor-pointer rounded-lg overflow-hidden border border-gray-200 hover:border-blue-400 hover:shadow-md transition"
                      onClick={() => setSelectedCapture(capture)}
                    >
                      <div className="aspect-video bg-gray-100">
                        <img
                          src={capture.path}
                          alt={`Capture ${index + 1}`}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      </div>
                      <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] px-1 py-0.5">
                        {formatTime(capture.timestamp).slice(0, 5)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Full Screen Viewer Modal */}
      <ModalPortal show={!!selectedCapture}>
        {selectedCapture && (
        <div
          className="fixed inset-0 z-[9999] bg-black/90 backdrop-blur-[10px] flex items-center justify-center p-4 animate-[overlay-blur-in_0.3s_cubic-bezier(0.16,1,0.3,1)_forwards]"
          onClick={() => setSelectedCapture(null)}
        >
          <button
            onClick={() => setSelectedCapture(null)}
            className="absolute top-4 right-4 p-2 text-black bg-white/80 hover:bg-white rounded-lg transition shadow-lg"
          >
            <HiOutlineXMark className="w-6 h-6" />
          </button>
          
          <div className="max-w-6xl w-full" onClick={e => e.stopPropagation()}>
            <img
              src={selectedCapture.path}
              alt="Full capture"
              className="w-full h-auto max-h-[85vh] object-contain rounded-lg"
            />
            <div className="mt-4 text-center text-white">
              <p className="text-lg font-medium">
                {new Date(selectedCapture.timestamp).toLocaleString()}
              </p>
              <p className="text-sm text-gray-400">
                {(selectedCapture.size / 1024).toFixed(1)} KB
                {selectedCapture.isManual && ' • Manual Capture'}
              </p>
            </div>
          </div>

          {/* Navigation */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              const currentIndex = captures.findIndex(c => c.path === selectedCapture.path)
              if (currentIndex > 0) {
                setSelectedCapture(captures[currentIndex - 1])
              }
            }}
            className="absolute left-4 top-1/2 -translate-y-1/2 p-3 text-black bg-white/80 hover:bg-white rounded-lg transition shadow-lg disabled:opacity-50"
            disabled={captures.findIndex(c => c.path === selectedCapture.path) === 0}
          >
            <HiOutlineChevronLeft className="w-8 h-8" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              const currentIndex = captures.findIndex(c => c.path === selectedCapture.path)
              if (currentIndex < captures.length - 1) {
                setSelectedCapture(captures[currentIndex + 1])
              }
            }}
            className="absolute right-4 top-1/2 -translate-y-1/2 p-3 text-black bg-white/80 hover:bg-white rounded-lg transition shadow-lg disabled:opacity-50"
            disabled={captures.findIndex(c => c.path === selectedCapture.path) === captures.length - 1}
          >
            <HiOutlineChevronRight className="w-8 h-8" />
          </button>
        </div>
        )}
      </ModalPortal>
    </div>
  )
}
