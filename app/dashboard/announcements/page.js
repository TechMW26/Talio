'use client'
import { Surface } from '@/components/ui/fernly'


import { Heading1, NativeButton, Heading3 } from '@/components/ui/fernly/native'
import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import toast from '@/utils/toast'
import { useSocket, REALTIME_EVENTS } from '@/contexts/SocketContext'
import { Skeleton } from '@/components/ui/fernly'
import { FaPlus, FaBullhorn, FaCalendarAlt, FaExclamationTriangle, FaUsers, FaEdit, FaTrash } from 'react-icons/fa'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import { DataErrorState } from '@/components/ui/ErrorBoundary'
import BackgroundRefreshIndicator from '@/components/ui/BackgroundRefreshIndicator'
import { ConfirmModal } from '@/components/ui/heroui/Modal'

export default function AnnouncementsPage() {
  const router = useRouter()

  const user = useMemo(() => {
    if (typeof window === 'undefined') return null
    try { return JSON.parse(localStorage.getItem('user')) } catch { return null }
  }, [])

  // --- SWR data fetching ---
  const { data: announcementsRes, error, isLoading, isValidating, mutate: refreshAnnouncements } = useAuthedSWR('/api/announcements')
  const announcements = announcementsRes?.data || []

  // Drafts waiting for HR/Admin approval (holiday announcements are prepared automatically)
  const canApproveDrafts = Boolean(user && ['admin', 'super_admin', 'hr'].includes(user.role))
  const { data: draftsRes, mutate: refreshDrafts } = useAuthedSWR(canApproveDrafts ? '/api/announcements?status=draft' : null)
  const drafts = draftsRes?.data || []
  const [draftEdits, setDraftEdits] = useState({})
  const [draftBusyId, setDraftBusyId] = useState(null)
  const draftValue = (draft, field) => draftEdits[draft._id]?.[field] ?? draft[field] ?? ''
  const editDraft = (id, field, value) => setDraftEdits(current => ({ ...current, [id]: { ...current[id], [field]: value } }))

  const handleDraft = async (draft, action) => {
    setDraftBusyId(draft._id)
    try {
      const token = localStorage.getItem('token')
      const publish = action === 'publish'
      const response = await fetch(`/api/announcements/${draft._id}`, {
        method: publish ? 'PUT' : 'DELETE',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: publish ? JSON.stringify({ title: draftValue(draft, 'title'), content: draftValue(draft, 'content'), status: 'published', publishDate: new Date().toISOString() }) : undefined,
      })
      const data = await response.json()
      if (!response.ok || data.success === false) throw new Error(data.message)
      toast.success(publish ? 'Announcement published' : 'Draft discarded')
      await Promise.all([refreshDrafts(), refreshAnnouncements()])
    } catch (err) {
      toast.error(err.message || 'Could not update the draft')
    } finally {
      setDraftBusyId(null)
    }
  }

  // Real-time updates
  const { socket, isConnected, onAnnouncementUpdate, subscribe } = useSocket()

  // Subscribe to real-time announcement updates
  useState(() => {
    if (!socket || !isConnected) return

    const handleAnnouncementUpdate = (data) => {
      console.log('🔄 [Announcements] Real-time update received:', data)
      refreshAnnouncements()
    }

    const unsub1 = onAnnouncementUpdate?.(handleAnnouncementUpdate)
    const unsub2 = subscribe?.(REALTIME_EVENTS.ANNOUNCEMENT_CREATED, handleAnnouncementUpdate)
    const unsub3 = subscribe?.(REALTIME_EVENTS.ANNOUNCEMENT_UPDATED, handleAnnouncementUpdate)

    return () => {
      unsub1?.()
      unsub2?.()
      unsub3?.()
    }
  })

  // --- Delete announcement with optimistic UI ---
  const [deletingId, setDeletingId] = useState(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState(null)

  const handleDeleteClick = (announcementId) => {
    setDeleteConfirmId(announcementId)
  }

  const handleDeleteConfirm = async () => {
    const announcementId = deleteConfirmId
    setDeleteConfirmId(null)
    setDeletingId(announcementId)

    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/announcements/${announcementId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      })
      const data = await response.json()

      if (response.ok && data.success !== false) {
        toast.success('Announcement deleted successfully')
        // Optimistic: update SWR cache immediately by filtering out the deleted item
        await refreshAnnouncements(
          (current) => {
            if (!current) return current
            return {
              ...current,
              data: (current.data || []).filter(a => a._id !== announcementId),
            }
          },
          { revalidate: true }
        )
      } else {
        toast.error(data.message || 'Failed to delete announcement')
      }
    } catch (err) {
      toast.error('Failed to delete announcement')
    } finally {
      setDeletingId(null)
    }
  }

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'high': return 'text-red-600 bg-red-50 border-red-200'
      case 'medium': return 'text-yellow-600 bg-yellow-50 border-yellow-200'
      case 'low': return 'text-green-600 bg-green-50 border-green-200'
      default: return 'text-gray-600 bg-gray-50 border-gray-200'
    }
  }

  const getPriorityIcon = (priority) => {
    switch (priority) {
      case 'high': return FaExclamationTriangle
      case 'medium': return FaBullhorn
      case 'low': return FaCalendarAlt
      default: return FaBullhorn
    }
  }

  const canManageAnnouncements = () => {
    return user && (user.role === 'admin' || user.role === 'super_admin' || user.role === 'hr' || user.role === 'department_head' || user.role === 'manager')
  }

  return (
    <div className="p-3 sm:p-6 pb-20 sm:pb-6">
      {/* Header */}
      <div className="flex md:justify-between md:items-center md:flex-row flex-col gap-                3 sm:gap-4 mb-4 sm:mb-6">
        <div>
          <Heading1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-gray-800">Announcements</Heading1>
          <p className="text-sm sm:text-base text-gray-600 mt-1">
            Company-wide announcements and updates
            <BackgroundRefreshIndicator isValidating={isValidating && !isLoading} position="inline" />
          </p>
        </div>
        {canManageAnnouncements() && (
          <NativeButton
            onClick={() => router.push('/dashboard/announcements/create')}
            className="w-full md:w-auto px-4 py-2 text-sm sm:text-base bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors flex items-center justify-center space-x-2"
          >
            <FaPlus className="w-3 h-3 sm:w-4 sm:h-4" />
            <span>New Announcement</span>
          </NativeButton>
        )}
      </div>

      {/* Drafts waiting for approval */}
      {canApproveDrafts && drafts.length > 0 && (
        <div className="mb-4 sm:mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 sm:p-5">
          <Heading3 className="text-base sm:text-lg font-semibold text-amber-800">Waiting for your approval ({drafts.length})</Heading3>
          <p className="text-xs sm:text-sm text-amber-700 mt-1 mb-3">
            Prepared automatically from the holiday calendar. Employees see it only after you click Publish.
          </p>
          <div className="space-y-3">
            {drafts.map((draft) => (
              <div key={draft._id} className="rounded-lg bg-white p-3 sm:p-4 shadow-sm">
                <input
                  className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-800"
                  value={draftValue(draft, 'title')}
                  onChange={(e) => editDraft(draft._id, 'title', e.target.value)}
                  aria-label="Announcement title"
                />
                <textarea
                  className="mt-2 w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-700"
                  rows={6}
                  value={draftValue(draft, 'content')}
                  onChange={(e) => editDraft(draft._id, 'content', e.target.value)}
                  aria-label="Announcement message"
                />
                <div className="mt-2 flex flex-col sm:flex-row gap-2 sm:justify-end">
                  <NativeButton
                    onClick={() => handleDraft(draft, 'discard')}
                    disabled={draftBusyId === draft._id}
                    className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Discard
                  </NativeButton>
                  <NativeButton
                    onClick={() => handleDraft(draft, 'publish')}
                    disabled={draftBusyId === draft._id || !String(draftValue(draft, 'title')).trim() || !String(draftValue(draft, 'content')).trim()}
                    className="px-4 py-2 text-sm rounded-lg bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-50"
                  >
                    {draftBusyId === draft._id ? 'Saving...' : 'Publish to everyone'}
                  </NativeButton>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Announcements List */}
      <div className="space-y-3 sm:space-y-4">
        {error ? (
          <DataErrorState message="Failed to load announcements" onRetry={() => refreshAnnouncements()} />
        ) : isLoading ? (
          <div className="space-y-3 sm:space-y-4">
            {[...Array(3)].map((_, i) => (
              <Surface key={i} className="bg-white rounded-lg shadow-md p-4 sm:p-6 space-y-3">
                <div className="flex items-center gap-3">
                  <Skeleton className="w-6 h-6 rounded" />
                  <Skeleton className="h-5 w-1/3 rounded-lg" />
                  <Skeleton className="w-16 h-5 rounded-full" />
                </div>
                <Skeleton className="h-4 w-full rounded-lg" />
                <Skeleton className="h-4 w-2/3 rounded-lg" />
                <div className="flex gap-3">
                  <Skeleton className="h-3 w-24 rounded-lg" />
                  <Skeleton className="h-3 w-32 rounded-lg" />
                </div>
              </Surface>
            ))}
          </div>
        ) : announcements.length === 0 ? (
          <Surface className="bg-white rounded-lg shadow-md p-6 sm:p-8 text-center text-sm sm:text-base text-gray-500">
            No announcements found
          </Surface>
        ) : (
          announcements.map((announcement) => (
            <div
              key={announcement._id}
              className={`rounded-lg shadow-md p-4 sm:p-6 hover:shadow-lg transition-shadow ${announcement.isDepartmentAnnouncement
                ? 'bg-purple-50 border-l-4 border-purple-500'
                : 'bg-white'
                }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center space-x-2 sm:space-x-3 mb-2 flex-wrap">
                    <FaBullhorn className={`text-base sm:text-xl flex-shrink-0 ${announcement.isDepartmentAnnouncement ? 'text-purple-600' : 'text-primary-500'
                      }`} />
                    <Heading3 className="text-base sm:text-xl font-bold text-gray-800 break-words">
                      {announcement.title}
                    </Heading3>
                    <span className={`px-2 sm:px-3 py-0.5 sm:py-1 text-xs font-semibold rounded-full ${announcement.priority === 'high' ? 'bg-red-100 text-red-800' :
                      announcement.priority === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                        'bg-blue-100 text-blue-800'
                      }`}>
                      {announcement.priority}
                    </span>
                    {announcement.isDepartmentAnnouncement && (
                      <span className="px-2 sm:px-3 py-0.5 sm:py-1 text-xs font-semibold rounded-full bg-purple-100 text-purple-800">
                        Department
                      </span>
                    )}
                  </div>

                  <p className="text-sm sm:text-base text-gray-600 mb-3 sm:mb-4 whitespace-pre-wrap break-words">
                    {announcement.content}
                  </p>

                  <div className="flex items-center space-x-3 sm:space-x-4 text-xs sm:text-sm text-gray-500 flex-wrap gap-2">
                    <div className="flex items-center space-x-1">
                      <FaCalendarAlt className="flex-shrink-0" />
                      <span className="whitespace-nowrap">
                        {new Date(announcement.createdAt).toLocaleDateString('en-US', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </span>
                    </div>
                    {announcement.createdBy && (
                      <span className="truncate">
                        By {announcement.createdBy.firstName} {announcement.createdBy.lastName}
                      </span>
                    )}
                    {announcement.departments && announcement.departments.length > 0 && (
                      <span className="px-2 py-0.5 sm:py-1 bg-purple-100 text-purple-700 rounded text-xs font-medium truncate">
                        {announcement.departments.map(d => d.name).join(', ')}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  {announcement.isActive && (
                    <span className="px-2 sm:px-3 py-0.5 sm:py-1 bg-green-100 text-green-800 text-xs font-semibold rounded-full h-fit">
                      Active
                    </span>
                  )}
                  {canManageAnnouncements() && (
                    <NativeButton
                      onClick={() => handleDeleteClick(announcement._id)}
                      disabled={deletingId === announcement._id}
                      className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                      title="Delete announcement"
                    >
                      {deletingId === announcement._id ? (
                        <svg className="animate-spin w-3.5 h-3.5 sm:w-4 sm:h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                      ) : (
                        <FaTrash className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                      )}
                    </NativeButton>
                  )}
                </div>
              </div>

              {announcement.attachments && announcement.attachments.length > 0 && (
                <div className="mt-3 sm:mt-4 pt-3 sm:pt-4 border-t border-gray-200">
                  <p className="text-xs sm:text-sm font-medium text-gray-700 mb-2">Attachments:</p>
                  <div className="flex flex-wrap gap-2">
                    {announcement.attachments.map((attachment, index) => (
                      <a
                        key={index}
                        href={attachment}
                        className="text-xs sm:text-sm text-primary-600 hover:text-primary-800 underline"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Attachment {index + 1}
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={!!deleteConfirmId}
        onClose={() => setDeleteConfirmId(null)}
        onConfirm={handleDeleteConfirm}
        title="Delete Announcement"
        message="Are you sure you want to delete this announcement? This action cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
        isLoading={!!deletingId}
      />
    </div>
  )
}

