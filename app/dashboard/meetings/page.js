'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@heroui/react'
import { 
  HiOutlineCalendarDays, 
  HiOutlinePlus, 
  HiOutlineVideoCamera, 
  HiOutlineMapPin,
  HiOutlineClock,
  HiOutlineUserGroup,
  HiOutlineCheck,
  HiOutlineXMark,
  HiOutlineQuestionMarkCircle,
  HiOutlineFunnel,
  HiOutlineMagnifyingGlass,
  HiOutlineChevronLeft,
  HiOutlineChevronRight,
  HiOutlineEllipsisVertical
} from 'react-icons/hi2'
import toast from '@/utils/toast'
import { useSocket, REALTIME_EVENTS } from '@/contexts/SocketContext'
import CreateMeetingModal from './components/CreateMeetingModal'
import MeetingCard from './components/MeetingCard'

export default function MeetingsPage() {
  const [meetings, setMeetings] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [filter, setFilter] = useState({
    type: 'all',
    status: '',
    view: 'all'
  })
  const [searchQuery, setSearchQuery] = useState('')
  const [currentDate, setCurrentDate] = useState(new Date())
  const [viewMode, setViewMode] = useState('list') // list, calendar
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 20,
    total: 0,
    pages: 1
  })

  // Real-time updates
  const { socket, isConnected, onMeetingUpdate, subscribe } = useSocket()

  const fetchMeetings = useCallback(async () => {
    try {
      setLoading(true)
      const token = localStorage.getItem('token')
      
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString()
      })

      if (filter.type !== 'all') params.append('type', filter.type)
      if (filter.status) params.append('status', filter.status)
      if (filter.view !== 'all') params.append('view', filter.view)

      const response = await fetch(`/api/meetings?${params}`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      })

      const data = await response.json()
      if (data.success) {
        setMeetings(data.data)
        setPagination(prev => ({
          ...prev,
          total: data.pagination.total,
          pages: data.pagination.pages
        }))
      } else {
        toast.error(data.message || 'Failed to fetch meetings')
      }
    } catch (error) {
      console.error('Error fetching meetings:', error)
      toast.error('Failed to load meetings')
    } finally {
      setLoading(false)
    }
  }, [filter, pagination.page, pagination.limit])

  // Subscribe to real-time meeting updates
  useEffect(() => {
    if (!socket || !isConnected) return

    const handleMeetingUpdate = (data) => {
      console.log('🔄 [Meetings] Real-time update received:', data)
      fetchMeetings()
    }

    const unsub1 = onMeetingUpdate?.(handleMeetingUpdate)
    const unsub2 = subscribe?.(REALTIME_EVENTS.MEETING_CREATED, handleMeetingUpdate)
    const unsub3 = subscribe?.(REALTIME_EVENTS.MEETING_UPDATED, handleMeetingUpdate)
    const unsub4 = subscribe?.(REALTIME_EVENTS.MEETING_CANCELLED, handleMeetingUpdate)
    // Also listen for meeting-invite events
    const unsub5 = subscribe?.('meeting-invite', handleMeetingUpdate)
    const unsub6 = subscribe?.('meeting-response', handleMeetingUpdate)

    return () => {
      unsub1?.()
      unsub2?.()
      unsub3?.()
      unsub4?.()
      unsub5?.()
      unsub6?.()
    }
  }, [socket, isConnected, fetchMeetings, onMeetingUpdate, subscribe])

  useEffect(() => {
    fetchMeetings()
    
    // Trigger meeting expiry check on page load (handles meetings that have passed)
    const expirePassedMeetings = async () => {
      try {
        const token = localStorage.getItem('token')
        await fetch('/api/meetings/expire-past', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` }
        })
      } catch (error) {
        // Silently fail - this is a background cleanup task
        console.log('[Meetings] Background expiry check completed')
      }
    }
    expirePassedMeetings()
  }, [fetchMeetings])

  const handleMeetingCreated = (newMeeting) => {
    setMeetings(prev => [newMeeting, ...prev])
    setShowCreateModal(false)
    toast.success('Meeting scheduled successfully!')
  }

  const handleRespondToInvite = async (meetingId, response, reason = '') => {
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/meetings/${meetingId}/respond`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ response, reason })
      })

      const data = await res.json()
      if (data.success) {
        // Update local state
        setMeetings(prev => prev.map(m => 
          m._id === meetingId 
            ? { ...m, myInviteStatus: response }
            : m
        ))
        toast.success(`Meeting invitation ${response}`)
      } else {
        toast.error(data.message || 'Failed to respond')
      }
    } catch (error) {
      console.error('Error responding to invite:', error)
      toast.error('Failed to respond to invitation')
    }
  }

  const filteredMeetings = meetings.filter(meeting => {
    if (!searchQuery) return true
    const query = searchQuery.toLowerCase()
    return (
      meeting.title?.toLowerCase().includes(query) ||
      meeting.description?.toLowerCase().includes(query) ||
      meeting.organizer?.firstName?.toLowerCase().includes(query) ||
      meeting.organizer?.lastName?.toLowerCase().includes(query)
    )
  })

  const upcomingMeetings = filteredMeetings.filter(m => 
    new Date(m.scheduledStart) > new Date() && m.status !== 'cancelled'
  )
  
  const todayMeetings = filteredMeetings.filter(m => {
    const today = new Date()
    const meetingDate = new Date(m.scheduledStart)
    return meetingDate.toDateString() === today.toDateString() && m.status !== 'cancelled'
  })

  const pendingInvites = filteredMeetings.filter(m => 
    m.myInviteStatus === 'pending' && m.status !== 'cancelled'
  )

  return (
    <div className="page-container">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <HiOutlineCalendarDays className="w-7 h-7 text-indigo-600" />
            Meetings
          </h1>
          <p className="text-gray-600 mt-1">
            Schedule and manage your meetings
          </p>
        </div>

        <Button
          onPress={() => setShowCreateModal(true)}
          color="primary"
          startContent={<HiOutlinePlus className="w-5 h-5" />}
        >
          Schedule Meeting
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <HiOutlineCalendarDays className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-800">{todayMeetings.length}</p>
              <p className="text-sm text-gray-500">Today</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 rounded-lg">
              <HiOutlineClock className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-800">{upcomingMeetings.length}</p>
              <p className="text-sm text-gray-500">Upcoming</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-100 rounded-lg">
              <HiOutlineQuestionMarkCircle className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-800">{pendingInvites.length}</p>
              <p className="text-sm text-gray-500">Pending</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-100 rounded-lg">
              <HiOutlineUserGroup className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-800">{meetings.length}</p>
              <p className="text-sm text-gray-500">Total</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters and Search */}
      <div className="bg-white rounded-lg shadow-md p-4 mb-6">
        <div className="flex flex-col md:flex-row gap-4">
          {/* Search */}
          <div className="relative flex-1">
            <HiOutlineMagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search meetings..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-2">
            <select
              value={filter.type}
              onChange={(e) => setFilter(prev => ({ ...prev, type: e.target.value }))}
              className="px-4 py-2.5 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              <option value="all">All Types</option>
              <option value="online">Online</option>
              <option value="offline">Offline</option>
            </select>

            <select
              value={filter.view}
              onChange={(e) => setFilter(prev => ({ ...prev, view: e.target.value }))}
              className="px-4 py-2.5 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              <option value="all">All Meetings</option>
              <option value="my-meetings">My Meetings</option>
              <option value="invited">Invited</option>
            </select>

            <select
              value={filter.status}
              onChange={(e) => setFilter(prev => ({ ...prev, status: e.target.value }))}
              className="px-4 py-2.5 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              <option value="">All Status</option>
              <option value="scheduled">Scheduled</option>
              <option value="in-progress">In Progress</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
        </div>
      </div>

      {/* Pending Invitations */}
      {pendingInvites.length > 0 && (
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-2">
            <HiOutlineQuestionMarkCircle className="w-5 h-5 text-amber-500" />
            Pending Invitations ({pendingInvites.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {pendingInvites.slice(0, 3).map(meeting => (
              <MeetingCard 
                key={meeting._id} 
                meeting={meeting}
                onRespond={handleRespondToInvite}
                showResponseActions
              />
            ))}
          </div>
        </div>
      )}

      {/* Today's Meetings */}
      {todayMeetings.length > 0 && (
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-2">
            <HiOutlineClock className="w-5 h-5 text-green-500" />
            Today's Meetings ({todayMeetings.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {todayMeetings.map(meeting => (
              <MeetingCard 
                key={meeting._id} 
                meeting={meeting}
                onRespond={handleRespondToInvite}
              />
            ))}
          </div>
        </div>
      )}

      {/* All Meetings */}
      <div>
        <h2 className="text-lg font-semibold text-gray-800 mb-3">
          All Meetings
        </h2>
        
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="bg-white rounded-xl p-4 animate-pulse shadow-sm border border-gray-100">
                <div className="h-4 bg-gray-200 rounded w-3/4 mb-3"></div>
                <div className="h-3 bg-gray-200 rounded w-1/2 mb-2"></div>
                <div className="h-3 bg-gray-200 rounded w-2/3"></div>
              </div>
            ))}
          </div>
        ) : filteredMeetings.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-xl shadow-sm border border-gray-100">
            <HiOutlineCalendarDays className="w-16 h-16 mx-auto text-gray-300 mb-4" />
            <h3 className="text-lg font-medium text-gray-800 mb-2">
              No meetings found
            </h3>
            <p className="text-gray-500 mb-4">
              {searchQuery ? 'Try adjusting your search' : 'Schedule your first meeting to get started'}
            </p>
            <Button
              onPress={() => setShowCreateModal(true)}
              color="primary"
              startContent={<HiOutlinePlus className="w-5 h-5" />}
            >
              Schedule Meeting
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredMeetings.map(meeting => (
              <MeetingCard 
                key={meeting._id} 
                meeting={meeting}
                onRespond={handleRespondToInvite}
              />
            ))}
          </div>
        )}

        {/* Pagination */}
        {pagination.pages > 1 && (
          <div className="flex justify-center items-center gap-2 mt-6">
            <button
              onClick={() => setPagination(prev => ({ ...prev, page: prev.page - 1 }))}
              disabled={pagination.page === 1}
              className="p-2 rounded-lg border border-gray-200 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
            >
              <HiOutlineChevronLeft className="w-5 h-5 text-gray-600" />
            </button>
            <span className="text-sm text-gray-600">
              Page {pagination.page} of {pagination.pages}
            </span>
            <button
              onClick={() => setPagination(prev => ({ ...prev, page: prev.page + 1 }))}
              disabled={pagination.page === pagination.pages}
              className="p-2 rounded-lg border border-gray-200 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
            >
              <HiOutlineChevronRight className="w-5 h-5 text-gray-600" />
            </button>
          </div>
        )}
      </div>

      {/* Create Meeting Modal */}
      {showCreateModal && (
        <CreateMeetingModal
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          onSuccess={handleMeetingCreated}
        />
      )}
    </div>
  )
}
