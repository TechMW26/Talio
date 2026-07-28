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
  HiOutlineGlobeAlt,
  HiOutlineExclamationTriangle
} from 'react-icons/hi2'
import toast from '@/utils/toast'
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button, Textarea, Skeleton } from '@heroui/react'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import useApiMutation from '@/hooks/useApiMutation'
import LoadingButton from '@/components/ui/LoadingButton'
import { DataErrorState } from '@/components/ui/ErrorBoundary'
import BackgroundRefreshIndicator from '@/components/ui/BackgroundRefreshIndicator'
import { copyTextToClipboard } from '@/utils/clipboard'

function getInsightItemClassName(tone = 'slate') {
  switch (tone) {
    case 'sky':
      return 'border-sky-200 bg-white/90 text-sky-900 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-100'
    case 'amber':
      return 'border-amber-200 bg-white/90 text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-100'
    case 'emerald':
      return 'border-emerald-200 bg-white/90 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-100'
    case 'violet':
      return 'border-violet-200 bg-white/90 text-violet-900 dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-100'
    case 'indigo':
      return 'border-indigo-200 bg-white/90 text-indigo-900 dark:border-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-100'
    default:
      return 'border-slate-200 bg-white/90 text-slate-900 dark:border-slate-700 dark:bg-slate-950/50 dark:text-slate-100'
  }
}

function InsightItems({ items = [], tone = 'slate' }) {
  return (
    <div className="mt-3 grid gap-2.5">
      {items.map((item, itemIndex) => (
        <div
          key={`${tone}-${itemIndex}`}
          className={`flex items-start gap-3 rounded-3xl border px-4 py-3 text-sm font-medium leading-6 shadow-sm ${getInsightItemClassName(tone)}`}
        >
          <span className="mt-1.5 h-2.5 w-2.5 flex-shrink-0 rounded-full bg-current opacity-70" />
          <p className="min-w-0 flex-1 break-words">{item}</p>
        </div>
      ))}
    </div>
  )
}

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
    onError: (message) => toast.error(message || 'Failed to update guest access'),
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
    const enabled = !guestAccess?.guestAccessEnabled
    const previousResponse = guestAccessRes

    await refreshGuestAccess({
      ...guestAccessRes,
      success: true,
      data: {
        ...guestAccess,
        guestAccessEnabled: enabled,
      },
    }, false)

    const result = await toggleGuestMutation.execute(`/api/meetings/${id}/guest-access`, {
      enabled,
    })

    if (!result?.data) {
      await refreshGuestAccess(previousResponse, false)
      return
    }

    await refreshGuestAccess({
      ...result,
      data: {
        ...guestAccess,
        ...result.data,
      },
    }, false)
    toast.success(result.message || (enabled ? 'Guest access enabled' : 'Guest access disabled'))
  }

  const copyGuestLink = async () => {
    try {
      await copyTextToClipboard(guestAccess?.guestUrl)
      toast.success('Guest link copied to clipboard!')
    } catch (error) {
      toast.error(error.message || 'Unable to copy the guest link')
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
      timeZone: 'Asia/Kolkata',
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    })
  }

  const formatTime = (date) => {
    return new Date(date).toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const formatSummaryDateTime = (date) => {
    if (!date) return null

    return new Date(date).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
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
        <div className="max-w-[1440px] mx-auto">
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
  const normalizedSummaryEntries = summaryEntries.map((entry, index) => ({
    ...entry,
    sessionNumber: Number(entry?.sessionNumber) || index + 1,
  }))
  const fallbackSessionNumber = normalizedSummaryEntries.length > 0
    ? normalizedSummaryEntries[normalizedSummaryEntries.length - 1].sessionNumber
    : 1
  const participantNotes = [...(meeting.aiParticipantNotes || [])].map(note => ({
    ...note,
    sessionNumber: Number(note?.sessionNumber) || fallbackSessionNumber,
  }))

  const timelineSessionNumbers = [...new Set([
    ...normalizedSummaryEntries.map(entry => entry.sessionNumber),
    ...participantNotes.map(note => note.sessionNumber),
  ])].sort((left, right) => left - right)

  const timelineSessions = timelineSessionNumbers.map((sessionNumber, index) => {
    const summaryEntry = normalizedSummaryEntries.find(entry => entry.sessionNumber === sessionNumber) || null
    const notes = participantNotes
      .filter(note => note.sessionNumber === sessionNumber)
      .sort((left, right) => {
        if (!currentUserName) return 0
        if (left.speakerName === currentUserName) return -1
        if (right.speakerName === currentUserName) return 1
        return 0
      })

    return {
      sessionNumber,
      sessionTag: summaryEntry?.sessionTag || notes[0]?.sessionTag || `Session ${sessionNumber}`,
      generatedAt: summaryEntry?.generatedAt || notes[0]?.generatedAt || null,
      language: summaryEntry?.language || notes[0]?.language || 'auto',
      summaryEntry,
      participantNotes: notes,
      index,
    }
  })

  const latestSummary = timelineSessions.length > 0
    ? timelineSessions[timelineSessions.length - 1].summaryEntry
    : null
  const hasRightRailContent = canGenerateInsights || timelineSessions.length > 0

  return (
    <div className="page-container">
      <BackgroundRefreshIndicator isRefreshing={isValidating && !loading} />
      <div className="mx-auto">
        {/* Header */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/dashboard/meetings"
            className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3.5 py-2 text-sm font-medium text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-800"
          >
            <HiOutlineArrowLeft className="w-4 h-4" />
            Back to Meetings
          </Link>

          {meeting.isOrganizer && (
            <div className="flex flex-wrap gap-2">
              {meeting.status === 'scheduled' && (
                <button
                  onClick={handleCancelMeeting}
                  className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3.5 py-2 text-sm font-medium text-amber-700 transition-colors hover:border-amber-300 hover:bg-amber-100"
                >
                  <HiOutlineXMark className="w-4 h-4" />
                  Cancel
                </button>
              )}
              <button
                onClick={() => setShowDeleteModal(true)}
                className="inline-flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-3.5 py-2 text-sm font-medium text-red-700 transition-colors hover:border-red-300 hover:bg-red-100"
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
          <div className={`border-b border-gray-200 dark:border-gray-800 px-5 py-5 ${meeting.type === 'online' ? 'bg-indigo-50 dark:bg-slate-950' : 'bg-amber-50 dark:bg-slate-950'}`}>
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div className="min-w-0 flex items-start gap-4">
                <div className={`flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-2xl ${meeting.type === 'online' ? 'bg-indigo-100 text-indigo-600' : 'bg-amber-100 text-amber-600'}`}>
                  {meeting.type === 'online' ? (
                    <HiOutlineVideoCamera className="w-7 h-7" />
                  ) : (
                    <HiOutlineMapPin className="w-7 h-7" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-3">
                    <h1 className="truncate text-2xl font-semibold text-gray-900">
                      {meeting.title}
                    </h1>
                    <span className={`px-3 py-1 rounded-full text-sm font-medium capitalize ${getStatusColor(meeting.status)}`}>
                      {meeting.status}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-gray-600">
                    <span className="rounded-full border border-gray-200 bg-white px-3 py-1 font-medium capitalize text-gray-700">
                      {meeting.type} Meeting
                    </span>
                    <span className="rounded-full border border-gray-200 bg-white px-3 py-1 font-medium text-gray-700">
                      {meeting.priority} priority
                    </span>
                    <span className="text-gray-400">{formatDate(meeting.scheduledStart)}</span>
                    <span className="text-gray-400">{formatTime(meeting.scheduledStart)} - {formatTime(meeting.scheduledEnd)}</span>
                  </div>

                  {meeting.description && (
                    <p className="mt-3 max-w-3xl text-sm leading-6 text-gray-600">
                      {meeting.description}
                    </p>
                  )}
                </div>
              </div>

              {meeting.status !== 'cancelled' && (
                <div className="flex flex-wrap items-center gap-2 xl:max-w-[460px] xl:justify-end">
                {/* Join button for online meetings */}
                {meeting.type === 'online' && (isNow || isUpcoming) && (meeting.isOrganizer || meeting.myInviteStatus === 'accepted') && (
                  <Link
                    href={`/dashboard/meetings/room/${meeting.roomId}`}
                    className="inline-flex items-center gap-2 rounded-full bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
                  >
                    <HiOutlinePlayCircle className="w-4 h-4" />
                    {isNow ? 'Join Now' : 'Join Meeting'}
                  </Link>
                )}

                {/* Response buttons for pending invites */}
                {!meeting.isOrganizer && meeting.myInviteStatus === 'pending' && (
                  <>
                    <button
                      onClick={() => handleRespond('accepted')}
                      disabled={respondMutation.isLoading}
                      className="inline-flex items-center gap-2 rounded-full bg-green-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-green-700 disabled:opacity-50"
                    >
                      <HiOutlineCheck className="w-4 h-4" />
                      Accept
                    </button>
                    <button
                      onClick={() => setShowRejectModal(true)}
                      disabled={respondMutation.isLoading}
                      className="inline-flex items-center gap-2 rounded-full bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                    >
                      <HiOutlineXMark className="w-4 h-4" />
                      Decline
                    </button>
                    <button
                      onClick={() => handleRespond('maybe')}
                      disabled={respondMutation.isLoading}
                      className="inline-flex items-center gap-2 rounded-full border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-100 disabled:opacity-50"
                    >
                      <HiOutlineQuestionMarkCircle className="w-4 h-4" />
                      Maybe
                    </button>
                  </>
                )}
                </div>
              )}
            </div>
          </div>

          <div className={hasRightRailContent ? 'lg:grid lg:grid-cols-[minmax(0,860px)_minmax(460px,1fr)] lg:items-stretch' : ''}>
            <div className={hasRightRailContent ? 'min-w-0 lg:flex lg:h-full lg:min-h-0 lg:flex-col lg:border-r lg:border-gray-200 lg:dark:border-gray-700' : 'min-w-0'}>
              {/* Meeting Details */}
              <div className="p-6 border-b border-gray-200">
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
                          type="button"
                          role="switch"
                          aria-label="Allow guests to join with a shareable link"
                          aria-checked={guestAccess.guestAccessEnabled}
                          aria-busy={toggleGuestMutation.isLoading}
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
                          <input
                            readOnly
                            value={guestAccess.guestUrl}
                            onFocus={event => event.target.select()}
                            aria-label="Guest meeting link"
                            className="min-w-0 flex-1 truncate rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200"
                          />
                          <button
                            type="button"
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
                      {acceptedInvitees.map((inv, index) => (
                        <div
                          key={inv._id || inv.employee?._id || `accepted-${index}`}
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
                      {pendingInvitees.map((inv, index) => (
                        <div
                          key={inv._id || inv.employee?._id || `pending-${index}`}
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
                      {rejectedInvitees.map((inv, index) => (
                        <div
                          key={inv._id || inv.employee?._id || `rejected-${index}`}
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

              {/* Transcript (if available) */}
              {meeting.transcript && meeting.transcript.length > 0 && (
                <div className="flex flex-col overflow-hidden p-6 lg:h-full lg:min-h-0 lg:flex-1">
                  <div className="flex items-center justify-between gap-3 mb-4">
                    <h3 className="text-sm font-medium text-gray-500 dark:text-gray-300 flex items-center gap-2">
                      <HiOutlineMicrophone className="w-5 h-5" />
                      Transcript History
                    </h3>
                    {meeting.transcriptLanguages?.length > 0 && (
                      <div className="flex flex-wrap gap-2 justify-end">
                        {meeting.transcriptLanguages.map(language => (
                          <span
                            key={language}
                            className="px-2 py-1 rounded-full bg-gray-100 text-xs font-medium text-gray-600 uppercase dark:bg-gray-800 dark:text-white"
                          >
                            {language}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-1 min-h-0 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-900/45">
                    <div className="h-full min-h-0 flex-1 overflow-y-auto space-y-3 pr-1">
                    {meeting.transcript.map((segment, index) => (
                      <div key={index} className="rounded-xl border border-slate-200 bg-white/90 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/70">
                        <div className="flex items-center justify-between gap-3 mb-1">
                          <p className="text-xs text-gray-500 dark:text-gray-300">
                            {segment.speakerName || 'Unknown'}
                          </p>
                          <p className="text-xs text-gray-400 dark:text-gray-300 uppercase">
                            {segment.language || 'auto'} • {formatTime(segment.timestamp)}
                          </p>
                        </div>
                        <p className="text-gray-900 dark:text-white">{segment.text}</p>
                      </div>
                    ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {hasRightRailContent && (
              <div className="min-w-0 bg-gray-50/60 dark:bg-gray-950/40 lg:flex lg:h-full lg:min-h-0 lg:flex-col">
                {/* Mira Notes Timeline */}
                {(timelineSessions.length > 0 || canGenerateInsights) && (
                  <div className="p-6 border-b border-gray-200 dark:border-gray-700">
                    <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                      <div>
                        <h3 className="text-sm font-medium text-gray-500 dark:text-gray-300 flex items-center gap-2">
                          <HiOutlineSparkles className="w-5 h-5 text-purple-500 dark:text-purple-300" />
                          Mira Notes Timeline
                        </h3>
                        {latestSummary?.generatedAt && (
                          <p className="text-xs text-gray-400 dark:text-gray-300 mt-1">
                            Latest update: {formatSummarySessionTag(latestSummary, timelineSessions.length - 1)} • {latestSummary.language || 'auto'}
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

                    {timelineSessions.length > 0 ? (
                      <div className="space-y-8">
                        {timelineSessions.map((session, index) => (
                          <div key={`${session.sessionNumber}-${session.generatedAt || index}`} className="relative">
                            {index > 0 && (
                              <div className="mb-6 flex items-center gap-3">
                                <div className="h-px flex-1 bg-gradient-to-r from-transparent via-purple-200 to-slate-200 dark:via-purple-700 dark:to-slate-700" />
                                <span className="rounded-full border border-purple-200 bg-purple-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-purple-700 dark:border-purple-800 dark:bg-purple-950/40 dark:text-purple-200">
                                  Timeline Break
                                </span>
                                <div className="h-px flex-1 bg-gradient-to-l from-transparent via-purple-200 to-slate-200 dark:via-purple-700 dark:to-slate-700" />
                              </div>
                            )}

                            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-purple-600 dark:text-purple-300">
                                  {session.sessionTag}
                                </p>
                                <p className="mt-1 text-xs text-gray-400 dark:text-gray-300">
                                  {session.generatedAt ? formatSummaryDateTime(session.generatedAt) : 'Awaiting Mira generation'}
                                  {session.language ? ` • ${session.language}` : ''}
                                </p>
                              </div>

                              <div className="flex flex-wrap gap-2">
                                {session.summaryEntry?.summary && (
                                  <span className="rounded-full border border-purple-200 bg-purple-50 px-3 py-1 text-xs font-medium text-purple-700 dark:border-purple-800 dark:bg-purple-950/40 dark:text-purple-200">
                                    Mira Summary
                                  </span>
                                )}
                                {session.participantNotes.length > 0 && (
                                  <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                                    {session.participantNotes.length} participant note{session.participantNotes.length === 1 ? '' : 's'}
                                  </span>
                                )}
                              </div>
                            </div>

                            {session.summaryEntry?.summary && (
                              <div className="rounded-2xl border border-purple-200 bg-gradient-to-br from-white via-purple-50/70 to-slate-50 p-5 shadow-sm dark:border-purple-900 dark:from-slate-950 dark:via-purple-950/20 dark:to-slate-950">
                                <div className="flex items-start gap-3">
                                  <div className="rounded-2xl bg-purple-100 p-3 text-purple-600 dark:bg-purple-950/60 dark:text-purple-200">
                                    <HiOutlineSparkles className="h-5 w-5" />
                                  </div>
                                  <div>
                                    <h4 className="text-base font-semibold text-slate-900 dark:text-white">Session Summary</h4>
                                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-300">
                                      Mira structured the main discussion, outcomes, and follow-up items for this session.
                                    </p>
                                  </div>
                                </div>

                                <p className="mt-4 whitespace-pre-line text-sm leading-7 text-slate-900 dark:text-white">
                                  {session.summaryEntry.summary}
                                </p>

                                <div className="mt-4 grid gap-3">
                                  {[
                                    {
                                      title: 'Key Points',
                                      items: session.summaryEntry.keyPoints,
                                      cardClass: 'border-sky-200 bg-sky-50/80 dark:border-sky-900 dark:bg-sky-950/30',
                                      tone: 'sky',
                                    },
                                    {
                                      title: 'Action Items',
                                      items: session.summaryEntry.actionItems,
                                      cardClass: 'border-amber-200 bg-amber-50/80 dark:border-amber-900 dark:bg-amber-950/30',
                                      tone: 'amber',
                                    },
                                    {
                                      title: 'Decisions',
                                      items: session.summaryEntry.decisions,
                                      cardClass: 'border-emerald-200 bg-emerald-50/80 dark:border-emerald-900 dark:bg-emerald-950/30',
                                      tone: 'emerald',
                                    },
                                    {
                                      title: 'Next Steps',
                                      items: session.summaryEntry.nextSteps,
                                      cardClass: 'border-violet-200 bg-violet-50/80 dark:border-violet-900 dark:bg-violet-950/30',
                                      tone: 'violet',
                                    },
                                  ].filter(section => section.items?.length > 0).map(section => (
                                    <div key={`${session.sessionNumber}-${section.title}`} className={`rounded-xl border p-4 ${section.cardClass}`}>
                                      <h5 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-600 dark:text-slate-200">
                                        {section.title}
                                      </h5>
                                      <InsightItems items={section.items} tone={section.tone} />
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {session.participantNotes.length > 0 && (
                              <div className="mt-4 grid gap-4">
                                {session.participantNotes.map((note, noteIndex) => (
                                  <div
                                    key={`${session.sessionNumber}-${note.employee?._id || note.speakerName || 'note'}-${noteIndex}`}
                                    className={`rounded-2xl border p-4 shadow-sm ${note.speakerName === currentUserName
                                      ? 'border-indigo-200 bg-indigo-50/80 dark:border-indigo-800 dark:bg-indigo-950/30'
                                      : 'border-slate-200 bg-white/90 dark:border-slate-700 dark:bg-slate-900/80'
                                      }`}
                                  >
                                    <div className="flex items-start justify-between gap-3">
                                      <div>
                                        <p className="text-sm font-semibold text-slate-900 dark:text-white">
                                          {note.speakerName}
                                          {note.speakerName === currentUserName && (
                                            <span className="ml-1 text-indigo-600 dark:text-indigo-300">(You)</span>
                                          )}
                                        </p>
                                        <p className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-400 dark:text-slate-300">
                                          {note.language || 'auto'}
                                        </p>
                                      </div>
                                      <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
                                        Participant Note
                                      </span>
                                    </div>

                                    <p className="mt-3 text-sm leading-7 text-slate-900 dark:text-white">
                                      {note.summary}
                                    </p>

                                    <div className="mt-4 space-y-3">
                                      {[
                                        {
                                          title: 'Key Contributions',
                                          items: note.keyContributions,
                                          tone: 'sky',
                                        },
                                        {
                                          title: 'Action Items',
                                          items: note.actionItems,
                                          tone: 'amber',
                                        },
                                        {
                                          title: 'Follow Ups',
                                          items: note.followUps,
                                          tone: 'emerald',
                                        },
                                      ].filter(section => section.items?.length > 0).map(section => (
                                        <div key={`${note.speakerName}-${section.title}`}>
                                          <h5 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-300">
                                            {section.title}
                                          </h5>
                                          <InsightItems items={section.items} tone={section.tone} />
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-4 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-900/60 dark:text-white">
                        The meeting has transcript or notes available, but Mira has not generated a structured timeline yet.
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
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
                    <p className="mt-2 flex items-center gap-1.5 text-sm font-medium text-red-600">
                      <HiOutlineExclamationTriangle className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                      This action cannot be undone.
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
