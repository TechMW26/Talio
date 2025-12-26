'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  HiOutlineVideoCamera,
  HiOutlineMapPin,
  HiOutlineClock,
  HiOutlineUserGroup,
  HiOutlineCheck,
  HiOutlineXMark,
  HiOutlineQuestionMarkCircle,
  HiOutlineCalendarDays,
  HiOutlineEllipsisVertical,
  HiOutlinePlayCircle,
  HiOutlineDocumentText
} from 'react-icons/hi2'
import ModalPortal from '@/components/ui/ModalPortal'

export default function MeetingCard({ meeting, onRespond, showResponseActions = false }) {
  const [showRejectModal, setShowRejectModal] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [responding, setResponding] = useState(false)

  const formatDate = (date) => {
    return new Date(date).toLocaleDateString('en-IN', {
      weekday: 'short',
      day: 'numeric',
      month: 'short'
    })
  }

  const formatTime = (date) => {
    return new Date(date).toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const getStatusColor = (status) => {
    switch (status) {
      case 'scheduled':
        return 'bg-blue-100 text-blue-700'
      case 'in-progress':
        return 'bg-green-100 text-green-700'
      case 'completed':
        return 'bg-gray-100 text-gray-700'
      case 'cancelled':
        return 'bg-red-100 text-red-700'
      default:
        return 'bg-gray-100 text-gray-700'
    }
  }

  const getInviteStatusBadge = (status) => {
    switch (status) {
      case 'accepted':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-700">
            <HiOutlineCheck className="w-3 h-3" />
            Accepted
          </span>
        )
      case 'rejected':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-red-100 text-red-700">
            <HiOutlineXMark className="w-3 h-3" />
            Declined
          </span>
        )
      case 'maybe':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-amber-100 text-amber-700">
            <HiOutlineQuestionMarkCircle className="w-3 h-3" />
            Maybe
          </span>
        )
      case 'pending':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-yellow-100 text-yellow-700">
            <HiOutlineClock className="w-3 h-3" />
            Pending
          </span>
        )
      default:
        return null
    }
  }

  const handleRespond = async (response) => {
    setResponding(true)
    try {
      if (response === 'rejected' && !rejectReason) {
        setShowRejectModal(true)
        setResponding(false)
        return
      }
      await onRespond(meeting._id, response, rejectReason)
      setShowRejectModal(false)
      setRejectReason('')
    } finally {
      setResponding(false)
    }
  }

  const handleRejectSubmit = async () => {
    setResponding(true)
    try {
      await onRespond(meeting._id, 'rejected', rejectReason)
      setShowRejectModal(false)
      setRejectReason('')
    } finally {
      setResponding(false)
    }
  }

  const isUpcoming = new Date(meeting.scheduledStart) > new Date()
  const isNow = new Date() >= new Date(meeting.scheduledStart) && new Date() <= new Date(meeting.scheduledEnd)

  const acceptedCount = meeting.invitees?.filter(i => i.status === 'accepted').length || 0
  const totalInvitees = meeting.invitees?.length || 0

  return (
    <>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-lg transition-shadow">
        {/* Header */}
        <div className={`px-4 py-3 ${meeting.type === 'online' ? 'bg-indigo-50' : 'bg-amber-50'}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {meeting.type === 'online' ? (
                <HiOutlineVideoCamera className="w-5 h-5 text-indigo-600" />
              ) : (
                <HiOutlineMapPin className="w-5 h-5 text-amber-600" />
              )}
              <span className="text-sm font-medium text-gray-600 capitalize">
                {meeting.type} Meeting
              </span>
            </div>
            <span className={`text-xs px-2 py-1 rounded-full capitalize ${getStatusColor(meeting.status)}`}>
              {meeting.status}
            </span>
          </div>
        </div>

        {/* Content */}
        <div className="p-4">
          <Link href={`/dashboard/meetings/${meeting._id}`}>
            <h3 className="font-semibold text-gray-800 mb-2 hover:text-indigo-600 transition-colors line-clamp-2">
              {meeting.title}
            </h3>
          </Link>

          {meeting.description && (
            <p className="text-sm text-gray-500 mb-3 line-clamp-2">
              {meeting.description}
            </p>
          )}

          {/* Date & Time */}
          <div className="flex items-center gap-2 text-sm text-gray-600 mb-2">
            <HiOutlineCalendarDays className="w-4 h-4" />
            <span>{formatDate(meeting.scheduledStart)}</span>
            <span>•</span>
            <span>{formatTime(meeting.scheduledStart)} - {formatTime(meeting.scheduledEnd)}</span>
          </div>

          {/* Location (for offline) */}
          {meeting.type === 'offline' && meeting.location && (
            <div className="flex items-center gap-2 text-sm text-gray-600 mb-2">
              <HiOutlineMapPin className="w-4 h-4" />
              <span className="line-clamp-1">{meeting.location}</span>
            </div>
          )}

          {/* Organizer */}
          <div className="flex items-center gap-2 mb-3">
            {meeting.organizer?.profilePicture ? (
              <img 
                src={meeting.organizer.profilePicture} 
                alt={meeting.organizer.firstName}
                className="w-6 h-6 rounded-full object-cover"
              />
            ) : (
              <div className="w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center">
                <span className="text-xs font-medium text-indigo-600">
                  {meeting.organizer?.firstName?.[0]}{meeting.organizer?.lastName?.[0]}
                </span>
              </div>
            )}
            <span className="text-sm text-gray-600">
              {meeting.isOrganizer ? 'You' : `${meeting.organizer?.firstName} ${meeting.organizer?.lastName}`}
            </span>
            {meeting.isOrganizer && (
              <span className="text-xs px-1.5 py-0.5 bg-indigo-100 text-indigo-600 rounded">
                Organizer
              </span>
            )}
          </div>

          {/* Attendees count */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <HiOutlineUserGroup className="w-4 h-4" />
              <span>{acceptedCount}/{totalInvitees} attending</span>
            </div>

            {/* My invite status */}
            {!meeting.isOrganizer && meeting.myInviteStatus && (
              getInviteStatusBadge(meeting.myInviteStatus)
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="px-4 py-3 bg-gray-50 border-t border-gray-100">
          {/* Response actions for pending invites */}
          {showResponseActions && meeting.myInviteStatus === 'pending' && !meeting.isOrganizer ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleRespond('accepted')}
                disabled={responding}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
              >
                <HiOutlineCheck className="w-4 h-4" />
                Accept
              </button>
              <button
                onClick={() => setShowRejectModal(true)}
                disabled={responding}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                <HiOutlineXMark className="w-4 h-4" />
                Decline
              </button>
              <button
                onClick={() => handleRespond('maybe')}
                disabled={responding}
                className="flex items-center justify-center gap-1.5 px-3 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50"
              >
                <HiOutlineQuestionMarkCircle className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              {/* Join meeting button for online meetings */}
              {meeting.type === 'online' && (isNow || (isUpcoming && meeting.status === 'scheduled')) && (meeting.isOrganizer || meeting.myInviteStatus === 'accepted') && (
                <Link
                  href={`/dashboard/meetings/room/${meeting.roomId}`}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
                >
                  <HiOutlinePlayCircle className="w-4 h-4" />
                  {isNow ? 'Join Now' : 'Join Meeting'}
                </Link>
              )}

              {/* View details */}
              <Link
                href={`/dashboard/meetings/${meeting._id}`}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-100 transition-colors"
              >
                <HiOutlineDocumentText className="w-4 h-4" />
                View Details
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Reject Reason Modal */}
      <ModalPortal isOpen={showRejectModal}>
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setShowRejectModal(false)}>
          <div className="modal-backdrop" />
          <div className="modal-container modal-md">
            <div className="modal-header">
              <h3 className="modal-title">Decline Meeting</h3>
              <button onClick={() => setShowRejectModal(false)} className="modal-close-btn">
                <HiOutlineXMark className="w-5 h-5" />
              </button>
            </div>
            <div className="modal-body">
              <p className="text-sm text-gray-600 mb-4">
                Please provide a reason for declining this meeting invitation (optional):
              </p>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Reason for declining..."
                className="modal-textarea"
                rows={3}
              />
            </div>
            <div className="modal-footer">
              <button
                onClick={() => setShowRejectModal(false)}
                className="modal-btn modal-btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleRejectSubmit}
                disabled={responding}
                className="modal-btn modal-btn-danger"
              >
                {responding ? 'Declining...' : 'Decline'}
              </button>
            </div>
          </div>
        </div>
      </ModalPortal>
    </>
  )
}
