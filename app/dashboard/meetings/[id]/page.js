'use client'

import { useState, use, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  HiOutlineArrowLeft,
  HiOutlineVideoCamera,
  HiOutlineMapPin,
  HiOutlineCalendarDays,
  HiOutlineClock,
  HiOutlineUserGroup,
  HiOutlineCheck,
  HiOutlineXMark,
  HiOutlineQuestionMarkCircle,
  HiOutlineTrash,
  HiOutlinePlayCircle,
  HiOutlineDocumentText,
  HiOutlineMicrophone,
  HiOutlineSparkles,
  HiOutlineClipboardDocumentList,
  HiOutlineClipboard,
  HiOutlineGlobeAlt
} from 'react-icons/hi2'
import toast from '@/utils/toast'
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button, Textarea, Skeleton } from '@heroui/react'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import useApiMutation from '@/hooks/useApiMutation'
import LoadingButton from '@/components/ui/LoadingButton'
import { DataErrorState } from '@/components/ui/ErrorBoundary'
import BackgroundRefreshIndicator from '@/components/ui/BackgroundRefreshIndicator'

export default function MeetingDetailPage({ params }) {
  const router = useRouter()
  const { id } = use(params)
  const [showRejectModal, setShowRejectModal] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const currentUser = useMemo(() => {
    if (typeof window === 'undefined') return null
    const rawUser = localStorage.getItem('user')
    return rawUser ? JSON.parse(rawUser) : null
  }, [])
  const currentUserName = useMemo(() => {
    const fullName = `${currentUser?.firstName || ''} ${currentUser?.lastName || ''}`.trim()
    return fullName || null
  }, [currentUser])

  // SWR data fetching
  const { data: meetingRes, error: meetingError, isLoading: meetingLoading, isValidating: meetingValidating, mutate: refreshMeeting } = useAuthedSWR(
    id ? `/api/meetings/${id}` : null
  )
  const { data: guestAccessRes, isValidating: guestValidating, mutate: refreshGuestAccess } = useAuthedSWR(
    id ? `/api/meetings/${id}/guest-access` : null
  )

  const meeting = meetingRes?.data || null
  const guestAccess = guestAccessRes?.data || null
  const loading = meetingLoading
  const isValidating = meetingValidating || guestValidating

  // Mutations
  const respondMutation = useApiMutation({
    method: 'POST',
    invalidateKeys: [id ? `/api/meetings/${id}` : null].filter(Boolean),
    onSuccess: (data) => {
      setShowRejectModal(false)
      setRejectReason('')
    },
    onError: (err) => toast.error(err.message || 'Failed to respond to invitation'),
  })

  const toggleGuestMutation = useApiMutation({
    method: 'POST',
    invalidateKeys: [id ? `/api/meetings/${id}/guest-access` : null].filter(Boolean),
    onSuccess: (data) => {
      refreshGuestAccess()
      toast.success(data.message)
    },
    onError: (err) => toast.error(err.message || 'Failed to update guest access'),
  })

  const deleteMutation = useApiMutation({
    method: 'DELETE',
    onSuccess: () => {
      toast.success('Meeting permanently deleted')
      router.push('/dashboard/meetings')
    },
    onError: (err) => toast.error(err.message || 'Failed to delete meeting'),
  })

  const summaryMutation = useApiMutation({
    method: 'POST',
    invalidateKeys: [id ? `/api/meetings/${id}` : null].filter(Boolean),
    onSuccess: (data) => {
      toast.success(
        data?.data?.generated === false
          ? (data?.message || 'Mira summary is already up to date')
          : (data?.message || 'Mira summary updated')
      )
      refreshMeeting()
    },
    onError: (err) => toast.error(err.message || 'Failed to generate Mira summary'),
  })

  const toggleGuestAccess = async () => {
    await toggleGuestMutation.execute(`/api/meetings/${id}/guest-access`, {
      enabled: !guestAccess?.guestAccessEnabled
    })
  }

  const copyGuestLink = () => {
    if (guestAccess?.guestUrl) {
      navigator.clipboard.writeText(guestAccess.guestUrl)
      toast.success('Guest link copied to clipboard!')
    }
  }

  const handleRespond = async (response, reason = '') => {
    const data = await respondMutation.execute(`/api/meetings/${id}/respond`, { response, reason })
    if (data) {
      toast.success(`Meeting invitation ${response}`)
    }
  }

  const handleCancelMeeting = async () => {
    if (!confirm('Are you sure you want to cancel this meeting? All invitees will be notified.')) return

    const data = await deleteMutation.execute(`/api/meetings/${id}?reason=Cancelled by organizer`, null, { method: 'DELETE' })
    if (data) {
      toast.success('Meeting cancelled')
      router.push('/dashboard/meetings')
    }
  }

  const handleDeleteMeeting = async () => {
    const data = await deleteMutation.execute(`/api/meetings/${id}?permanent=true`, null, { method: 'DELETE' })
    if (data) {
      setShowDeleteModal(false)
    }
  }

  const handleGenerateSummary = async () => {
    await summaryMutation.execute(`/api/meetings/${id}/summary`, { language: 'auto' })
  }

  const formatDate = (date) => {
    return new Date(date).toLocaleDateString('en-IN', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    })
  }

  const formatTime = (date) => {
    return new Date(date).toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const formatSummaryDateTime = (date) => {
    if (!date) return null

    return new Date(date).toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const formatSummarySessionTag = (entry, index) => {
    if (entry?.sessionTag) {
      return entry.sessionTag
    }

    if (entry?.sessionStartedAt && entry?.sessionEndedAt) {
      return `Session ${entry.sessionNumber || index + 1} • ${formatSummaryDateTime(entry.sessionStartedAt)} to ${formatSummaryDateTime(entry.sessionEndedAt)}`
    }

    if (entry?.generatedAt) {
      return `Session ${entry.sessionNumber || index + 1} • Generated ${formatSummaryDateTime(entry.generatedAt)}`
    }

    return `Session ${entry?.sessionNumber || index + 1}`
  }

  const getStatusColor = (status) => {
    switch (status) {
      case 'scheduled': return 'bg-blue-100 text-blue-700'
      case 'in-progress': return 'bg-green-100 text-green-700'
      case 'completed': return 'bg-gray-100 text-gray-700'
      case 'cancelled': return 'bg-red-100 text-red-700'
      default: return 'bg-gray-100 text-gray-700'
    }
  }

  const getInviteStatusColor = (status) => {
    switch (status) {
      case 'accepted': return 'bg-green-100 text-green-700'
      case 'rejected': return 'bg-red-100 text-red-700'
      case 'maybe': return 'bg-amber-100 text-amber-700'
      case 'pending': return 'bg-yellow-100 text-yellow-700'
      default: return 'bg-gray-100 text-gray-700'
    }
  }

  if (meetingError) {
    return <DataErrorState error={meetingError} onRetry={() => refreshMeeting()} />
  }

  if (loading) {
    return (
      <div className="page-container">
        <div className="max-w-4xl mx-auto">
          <div className="space-y-4">
            <Skeleton className="h-8 w-1/4 rounded-lg" />
            <Skeleton className="h-64 rounded-xl" />
            <Skeleton className="h-48 rounded-xl" />
          </div>
        </div>
      </div>
    )
  }

  if (!meeting) {
    return (
      <div className="page-container flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-gray-800 mb-2">Meeting not found</h2>
          <Link href="/dashboard/meetings" className="text-indigo-600 hover:text-indigo-700">
            Back to meetings
          </Link>
        </div>
      </div>
    )
  }

  const isUpcoming = new Date(meeting.scheduledStart) > new Date()
  const isNow = new Date() >= new Date(meeting.scheduledStart) && new Date() <= new Date(meeting.scheduledEnd)
  const acceptedInvitees = meeting.invitees?.filter(i => i.status === 'accepted') || []
  const pendingInvitees = meeting.invitees?.filter(i => i.status === 'pending') || []
  const rejectedInvitees = meeting.invitees?.filter(i => i.status === 'rejected') || []
  const canGenerateInsights = (meeting.transcript?.length || 0) > 0 || !!meeting.notes || (meeting.mom?.length || 0) > 0
  const summaryEntries = Array.isArray(meeting.aiSummary?.history) && meeting.aiSummary.history.length > 0
    ? meeting.aiSummary.history
    : meeting.aiSummary?.summary
      ? [meeting.aiSummary]
      : []
  const latestSummary = summaryEntries.length > 0 ? summaryEntries[summaryEntries.length - 1] : null
  const participantNotes = [...(meeting.aiParticipantNotes || [])].sort((left, right) => {
    if (!currentUserName) return 0
    if (left.speakerName === currentUserName) return -1
    if (right.speakerName === currentUserName) return 1
    return 0
  })

  return (
    <div className="page-container">
      <BackgroundRefreshIndicator isRefreshing={isValidating && !loading} />
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <Link
            href="/dashboard/meetings"
            className="flex items-center gap-2 text-gray-600 hover:text-gray-800"
          >
            <HiOutlineArrowLeft className="w-5 h-5" />
            Back to Meetings
          </Link>

          {meeting.isOrganizer && (
            <div className="flex gap-2">
              {meeting.status === 'scheduled' && (
                <button
                  onClick={handleCancelMeeting}
                  className="flex items-center gap-2 px-4 py-2 text-amber-600 border border-amber-600 rounded-lg hover:bg-amber-50"
                >
                  <HiOutlineXMark className="w-4 h-4" />
                  Cancel
                </button>
              )}
              <button
                onClick={() => setShowDeleteModal(true)}
                className="flex items-center gap-2 px-4 py-2 text-red-600 border border-red-600 rounded-lg hover:bg-red-50"
              >
                <HiOutlineTrash className="w-4 h-4" />
                Delete
              </button>
            </div>
          )}
        </div>

        {/* Main Content */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
          {/* Meeting Header */}
          <div className={`p-6 ${meeting.type === 'online' ? 'bg-indigo-50' : 'bg-amber-50'}`}>
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-4">
                <div className={`p-3 rounded-xl ${meeting.type === 'online' ? 'bg-indigo-100' : 'bg-amber-100'}`}>
                  {meeting.type === 'online' ? (
                    <HiOutlineVideoCamera className="w-8 h-8 text-indigo-600" />
                  ) : (
                    <HiOutlineMapPin className="w-8 h-8 text-amber-600" />
                  )}
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-gray-800 mb-2">
                    {meeting.title}
                  </h1>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className={`px-3 py-1 rounded-full text-sm font-medium capitalize ${getStatusColor(meeting.status)}`}>
                      {meeting.status}
                    </span>
                    <span className="text-sm text-gray-600 capitalize">
                      {meeting.type} Meeting
                    </span>
                    <span className="text-sm text-gray-500">
                      • {meeting.priority} priority
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Join/Response Actions */}
            {meeting.status !== 'cancelled' && (
              <div className="mt-6 flex flex-wrap gap-3">
                {/* Join button for online meetings */}
                {meeting.type === 'online' && (isNow || isUpcoming) && (meeting.isOrganizer || meeting.myInviteStatus === 'accepted') && (
                  <Link
                    href={`/dashboard/meetings/room/${meeting.roomId}`}
                    className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white font-medium rounded-xl hover:bg-indigo-700 transition-colors"
                  >
                    <HiOutlinePlayCircle className="w-5 h-5" />
                    {isNow ? 'Join Now' : 'Join Meeting'}
                  </Link>
                )}

                {/* Response buttons for pending invites */}
                {!meeting.isOrganizer && meeting.myInviteStatus === 'pending' && (
                  <>
                    <button
                      onClick={() => handleRespond('accepted')}
                      disabled={respondMutation.isLoading}
                      className="flex items-center gap-2 px-6 py-3 bg-green-600 text-white font-medium rounded-xl hover:bg-green-700 transition-colors disabled:opacity-50"
                    >
                      <HiOutlineCheck className="w-5 h-5" />
                      Accept
                    </button>
                    <button
                      onClick={() => setShowRejectModal(true)}
                      disabled={respondMutation.isLoading}
                      className="flex items-center gap-2 px-6 py-3 bg-red-600 text-white font-medium rounded-xl hover:bg-red-700 transition-colors disabled:opacity-50"
                    >
                      <HiOutlineXMark className="w-5 h-5" />
                      Decline
                    </button>
                    <button
                      onClick={() => handleRespond('maybe')}
                      disabled={respondMutation.isLoading}
                      className="flex items-center gap-2 px-6 py-3 border border-gray-300 text-gray-700 font-medium rounded-xl hover:bg-gray-100 transition-colors disabled:opacity-50"
                    >
                      <HiOutlineQuestionMarkCircle className="w-5 h-5" />
                      Maybe
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Meeting Details */}
          <div className="p-6 border-b border-gray-200">
            {meeting.description && (
              <p className="text-gray-600 mb-6">
                {meeting.description}
              </p>
            )}

            {latestSummary?.summary && (
              <div className="mb-6 rounded-xl border border-purple-200 bg-purple-50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-medium text-purple-700 flex items-center gap-2">
                      <HiOutlineSparkles className="w-5 h-5" />
                      Mira Summary
                    </h3>
                    <p className="text-xs text-purple-600 mt-1">
                      {formatSummarySessionTag(latestSummary, summaryEntries.length - 1)}
                    </p>
                  </div>
                  <span className="text-xs uppercase tracking-wide text-purple-600">
                    {latestSummary.language || 'auto'}
                  </span>
                </div>

                <p className="mt-3 text-sm text-purple-950 whitespace-pre-line">
                  {latestSummary.summary}
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Date */}
              <div className="flex items-center gap-3 p-4 bg-gray-50 rounded-xl">
                <HiOutlineCalendarDays className="w-6 h-6 text-gray-400" />
                <div>
                  <p className="text-sm text-gray-500">Date</p>
                  <p className="font-medium text-gray-800">
                    {formatDate(meeting.scheduledStart)}
                  </p>
                </div>
              </div>

              {/* Time */}
              <div className="flex items-center gap-3 p-4 bg-gray-50 rounded-xl">
                <HiOutlineClock className="w-6 h-6 text-gray-400" />
                <div>
                  <p className="text-sm text-gray-500">Time</p>
                  <p className="font-medium text-gray-800">
                    {formatTime(meeting.scheduledStart)} - {formatTime(meeting.scheduledEnd)}
                    <span className="text-gray-500 ml-2">({meeting.duration} min)</span>
                  </p>
                </div>
              </div>

              {/* Location (offline) or Meeting Link (online) */}
              {meeting.type === 'offline' && meeting.location && (
                <div className="flex items-center gap-3 p-4 bg-gray-50 rounded-xl md:col-span-2">
                  <HiOutlineMapPin className="w-6 h-6 text-gray-400" />
                  <div>
                    <p className="text-sm text-gray-500">Location</p>
                    <p className="font-medium text-gray-800">
                      {meeting.location}
                    </p>
                  </div>
                </div>
              )}

              {meeting.type === 'online' && meeting.roomId && (
                <div className="flex items-center gap-3 p-4 bg-gray-50 rounded-xl md:col-span-2">
                  <HiOutlineVideoCamera className="w-6 h-6 text-gray-400" />
                  <div className="flex-1">
                    <p className="text-sm text-gray-500">Meeting Room</p>
                    <Link
                      href={`/dashboard/meetings/room/${meeting.roomId}`}
                      className="inline-flex items-center gap-2 mt-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
                    >
                      <HiOutlinePlayCircle className="w-4 h-4" />
                      Join Meeting Room
                    </Link>
                  </div>
                </div>
              )}

              {/* Guest Link Sharing - Only for online meetings and organizer */}
              {meeting.type === 'online' && meeting.isOrganizer && guestAccess && (
                <div className="p-4 bg-indigo-50 dark:bg-indigo-950/30 rounded-xl md:col-span-2 border border-indigo-100 dark:border-indigo-800">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <HiOutlineGlobeAlt className="w-5 h-5 text-indigo-600" />
                      <span className="font-medium text-gray-800">Guest Access</span>
                    </div>
                    <button
                      onClick={toggleGuestAccess}
                      disabled={toggleGuestMutation.isLoading}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${guestAccess.guestAccessEnabled ? 'bg-indigo-600' : 'bg-gray-300'
                        } ${toggleGuestMutation.isLoading ? 'opacity-50' : ''}`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${guestAccess.guestAccessEnabled ? 'translate-x-6' : 'translate-x-1'
                          }`}
                      />
                    </button>
                  </div>

                  <p className="text-sm text-gray-600 mb-3">
                    Allow anyone with the link to join without signing in
                  </p>

                  {guestAccess.guestAccessEnabled && guestAccess.guestUrl && (
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-600 truncate">
                        {guestAccess.guestUrl}
                      </div>
                      <button
                        onClick={copyGuestLink}
                        className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
                      >
                        <HiOutlineClipboard className="w-4 h-4" />
                        Copy
                      </button>
                    </div>
                  )}

                  {guestAccess.guests && guestAccess.guests.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-indigo-100">
                      <p className="text-xs text-gray-500 mb-2">
                        {guestAccess.guests.length} guest(s) have joined via link
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Organizer */}
          <div className="p-6 border-b border-gray-200">
            <h3 className="text-sm font-medium text-gray-500 mb-3">Organizer</h3>
            <div className="flex items-center gap-3">
              {meeting.organizer?.profilePicture ? (
                <img
                  src={meeting.organizer.profilePicture}
                  alt={meeting.organizer.firstName}
                  className="w-10 h-10 rounded-full object-cover"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center">
                  <span className="font-medium text-indigo-600">
                    {meeting.organizer?.firstName?.[0]}{meeting.organizer?.lastName?.[0]}
                  </span>
                </div>
              )}
              <div>
                <p className="font-medium text-gray-800">
                  {meeting.organizer?.firstName} {meeting.organizer?.lastName}
                  {meeting.isOrganizer && <span className="text-gray-500 ml-1">(You)</span>}
                </p>
                <p className="text-sm text-gray-500">{meeting.organizer?.email}</p>
              </div>
            </div>
          </div>

          {/* Invitees */}
          <div className="p-6 border-b border-gray-200">
            <h3 className="text-sm font-medium text-gray-500 mb-4 flex items-center gap-2">
              <HiOutlineUserGroup className="w-5 h-5" />
              Invitees ({meeting.invitees?.length || 0})
            </h3>

            {/* Accepted */}
            {acceptedInvitees.length > 0 && (
              <div className="mb-4">
                <p className="text-xs font-medium text-green-600 mb-2">
                  Accepted ({acceptedInvitees.length})
                </p>
                <div className="flex flex-wrap gap-2">
                  {acceptedInvitees.map(inv => (
                    <div
                      key={inv.employee?._id}
                      className="flex items-center gap-2 px-3 py-1.5 bg-green-50 rounded-full"
                    >
                      {inv.employee?.profilePicture ? (
                        <img
                          src={inv.employee.profilePicture}
                          alt=""
                          className="w-5 h-5 rounded-full object-cover"
                        />
                      ) : (
                        <div className="w-5 h-5 rounded-full bg-green-200 flex items-center justify-center">
                          <span className="text-[10px] font-medium text-green-700">
                            {inv.employee?.firstName?.[0]}{inv.employee?.lastName?.[0]}
                          </span>
                        </div>
                      )}
                      <span className="text-sm text-green-700">
                        {inv.employee?.firstName} {inv.employee?.lastName}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Pending */}
            {pendingInvitees.length > 0 && (
              <div className="mb-4">
                <p className="text-xs font-medium text-yellow-600 mb-2">
                  Pending ({pendingInvitees.length})
                </p>
                <div className="flex flex-wrap gap-2">
                  {pendingInvitees.map(inv => (
                    <div
                      key={inv.employee?._id}
                      className="flex items-center gap-2 px-3 py-1.5 bg-yellow-50 rounded-full"
                    >
                      <span className="text-sm text-yellow-700">
                        {inv.employee?.firstName} {inv.employee?.lastName}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Declined */}
            {rejectedInvitees.length > 0 && (
              <div>
                <p className="text-xs font-medium text-red-600 mb-2">
                  Declined ({rejectedInvitees.length})
                </p>
                <div className="flex flex-wrap gap-2">
                  {rejectedInvitees.map(inv => (
                    <div
                      key={inv.employee?._id}
                      className="flex items-center gap-2 px-3 py-1.5 bg-red-50 rounded-full"
                      title={inv.rejectionReason || 'No reason provided'}
                    >
                      <span className="text-sm text-red-700">
                        {inv.employee?.firstName} {inv.employee?.lastName}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Agenda */}
          {meeting.agenda && meeting.agenda.length > 0 && (
            <div className="p-6 border-b border-gray-200">
              <h3 className="text-sm font-medium text-gray-500 mb-4 flex items-center gap-2">
                <HiOutlineClipboardDocumentList className="w-5 h-5" />
                Agenda
              </h3>
              <ul className="space-y-2">
                {meeting.agenda.map((item, index) => (
                  <li key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <span className="text-gray-800">
                      {index + 1}. {item.title}
                    </span>
                    <span className="text-sm text-gray-500">{item.duration} min</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Mira Summary */}
          {(meeting.aiSummary?.summary || canGenerateInsights) && (
            <div className="p-6 border-b border-gray-200">
              <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                <div>
                  <h3 className="text-sm font-medium text-gray-500 flex items-center gap-2">
                    <HiOutlineSparkles className="w-5 h-5 text-purple-500" />
                    Mira Summary
                  </h3>
                  {latestSummary?.generatedAt && (
                    <p className="text-xs text-gray-400 mt-1">
                      {formatSummarySessionTag(latestSummary, summaryEntries.length - 1)} • {latestSummary.language || 'auto'}
                    </p>
                  )}
                </div>

                {canGenerateInsights && (
                  <LoadingButton
                    size="sm"
                    color="secondary"
                    variant="flat"
                    onPress={handleGenerateSummary}
                    isLoading={summaryMutation.isLoading}
                  >
                    {summaryMutation.isLoading
                      ? 'Generating...'
                      : meeting.aiSummary?.summary
                        ? 'Refresh Mira Summary'
                        : 'Generate Mira Summary'}
                  </LoadingButton>
                )}
              </div>

              {summaryEntries.length > 0 ? (
                <div className="space-y-4">
                  {summaryEntries.map((summaryEntry, index) => (
                    <div key={`${summaryEntry.generatedAt || index}-${summaryEntry.sessionNumber || index}`} className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                        <p className="text-xs font-medium uppercase tracking-wide text-purple-600">
                          {formatSummarySessionTag(summaryEntry, index)}
                        </p>
                        <span className="text-xs text-gray-400">
                          {summaryEntry.generatedAt ? formatSummaryDateTime(summaryEntry.generatedAt) : 'Pending'}
                        </span>
                      </div>

                      <p className="text-gray-600 whitespace-pre-line">{summaryEntry.summary}</p>

                      {summaryEntry.keyPoints?.length > 0 && (
                        <div className="mt-4">
                          <h4 className="text-sm font-medium text-gray-800 mb-2">Key Points</h4>
                          <ul className="list-disc pl-5 space-y-1">
                            {summaryEntry.keyPoints.map((point, i) => (
                              <li key={i} className="text-sm text-gray-600">{point}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {summaryEntry.actionItems?.length > 0 && (
                        <div className="mt-4">
                          <h4 className="text-sm font-medium text-gray-800 mb-2">Action Items</h4>
                          <ul className="list-disc pl-5 space-y-1">
                            {summaryEntry.actionItems.map((item, i) => (
                              <li key={i} className="text-sm text-gray-600">{item}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {summaryEntry.decisions?.length > 0 && (
                        <div className="mt-4">
                          <h4 className="text-sm font-medium text-gray-800 mb-2">Decisions</h4>
                          <ul className="list-disc pl-5 space-y-1">
                            {summaryEntry.decisions.map((item, i) => (
                              <li key={i} className="text-sm text-gray-600">{item}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {summaryEntry.nextSteps?.length > 0 && (
                        <div className="mt-4">
                          <h4 className="text-sm font-medium text-gray-800 mb-2">Next Steps</h4>
                          <ul className="list-disc pl-5 space-y-1">
                            {summaryEntry.nextSteps.map((item, i) => (
                              <li key={i} className="text-sm text-gray-600">{item}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-4 text-sm text-gray-500">
                  The meeting has transcript or notes available, but Mira has not generated a summary yet.
                </div>
              )}
            </div>
          )}

          {/* Participant Notes */}
          {participantNotes.length > 0 && (
            <div className="p-6 border-b border-gray-200">
              <h3 className="text-sm font-medium text-gray-500 mb-4 flex items-center gap-2">
                <HiOutlineDocumentText className="w-5 h-5" />
                Participant Notes
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {participantNotes.map((note, index) => (
                  <div
                    key={`${note.employee?._id || note.speakerName || 'note'}-${index}`}
                    className={`rounded-xl border p-4 ${note.speakerName === currentUserName
                      ? 'border-indigo-200 bg-indigo-50'
                      : 'border-gray-200 bg-gray-50'
                      }`}
                  >
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <p className="font-medium text-gray-800">
                        {note.speakerName}
                        {note.speakerName === currentUserName && (
                          <span className="text-indigo-600 ml-1">(You)</span>
                        )}
                      </p>
                      <span className="text-xs text-gray-400 uppercase">{note.language || 'auto'}</span>
                    </div>

                    <p className="text-sm text-gray-600">{note.summary}</p>

                    {note.keyContributions?.length > 0 && (
                      <div className="mt-3">
                        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Key Contributions</h4>
                        <ul className="list-disc pl-5 space-y-1">
                          {note.keyContributions.map((item, itemIndex) => (
                            <li key={itemIndex} className="text-sm text-gray-600">{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {note.actionItems?.length > 0 && (
                      <div className="mt-3">
                        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Action Items</h4>
                        <ul className="list-disc pl-5 space-y-1">
                          {note.actionItems.map((item, itemIndex) => (
                            <li key={itemIndex} className="text-sm text-gray-600">{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {note.followUps?.length > 0 && (
                      <div className="mt-3">
                        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Follow Ups</h4>
                        <ul className="list-disc pl-5 space-y-1">
                          {note.followUps.map((item, itemIndex) => (
                            <li key={itemIndex} className="text-sm text-gray-600">{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Transcript (if available) */}
          {meeting.transcript && meeting.transcript.length > 0 && (
            <div className="p-6">
              <div className="flex items-center justify-between gap-3 mb-4">
                <h3 className="text-sm font-medium text-gray-500 flex items-center gap-2">
                  <HiOutlineMicrophone className="w-5 h-5" />
                  Transcript History
                </h3>
                {meeting.transcriptLanguages?.length > 0 && (
                  <div className="flex flex-wrap gap-2 justify-end">
                    {meeting.transcriptLanguages.map(language => (
                      <span
                        key={language}
                        className="px-2 py-1 rounded-full bg-gray-100 text-xs font-medium text-gray-600 uppercase"
                      >
                        {language}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="max-h-96 overflow-y-auto space-y-3">
                {meeting.transcript.map((segment, index) => (
                  <div key={index} className="p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center justify-between gap-3 mb-1">
                      <p className="text-xs text-gray-500">
                        {segment.speakerName || 'Unknown'}
                      </p>
                      <p className="text-xs text-gray-400 uppercase">
                        {segment.language || 'auto'} • {formatTime(segment.timestamp)}
                      </p>
                    </div>
                    <p className="text-gray-800">{segment.text}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      <Modal isOpen={showDeleteModal} onOpenChange={setShowDeleteModal} size="md">
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="border-b border-red-100 bg-red-50">
                <span className="text-red-700">Delete Meeting Permanently</span>
              </ModalHeader>
              <ModalBody>
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
                    <HiOutlineTrash className="w-5 h-5 text-red-600" />
                  </div>
                  <div>
                    <p className="font-medium text-default-900 mb-1">Are you sure you want to delete this meeting?</p>
                    <p className="text-sm text-default-600">
                      This will permanently delete <strong>"{meeting?.title}"</strong> from the database.
                      All associated data including invitees, transcripts, and AI summaries will be removed.
                    </p>
                    <p className="text-sm text-red-600 mt-2 font-medium">
                      ⚠️ This action cannot be undone.
                    </p>
                  </div>
                </div>
              </ModalBody>
              <ModalFooter>
                <Button
                  variant="light"
                  onPress={onClose}
                  isDisabled={deleteMutation.isLoading}
                >
                  Cancel
                </Button>
                <LoadingButton
                  color="danger"
                  onPress={handleDeleteMeeting}
                  isLoading={deleteMutation.isLoading}
                >
                  {deleteMutation.isLoading ? 'Deleting...' : 'Delete Permanently'}
                </LoadingButton>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      {/* Reject Modal */}
      <Modal isOpen={showRejectModal} onOpenChange={setShowRejectModal} size="md">
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>Decline Meeting</ModalHeader>
              <ModalBody>
                <p className="text-sm text-default-600 mb-4">
                  Please provide a reason for declining (optional):
                </p>
                <Textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Reason for declining..."
                  minRows={3}
                />
              </ModalBody>
              <ModalFooter>
                <Button
                  variant="light"
                  onPress={onClose}
                >
                  Cancel
                </Button>
                <LoadingButton
                  color="danger"
                  onPress={() => handleRespond('rejected', rejectReason)}
                  isLoading={respondMutation.isLoading}
                >
                  {respondMutation.isLoading ? 'Declining...' : 'Decline'}
                </LoadingButton>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  )
}
