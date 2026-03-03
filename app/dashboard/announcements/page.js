'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import toast from '@/utils/toast'
import { useSocket, REALTIME_EVENTS } from '@/contexts/SocketContext'
import { Skeleton } from '@heroui/react'
import { FaPlus, FaBullhorn, FaCalendarAlt, FaExclamationTriangle, FaUsers, FaEdit, FaTrash } from 'react-icons/fa'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import useApiMutation from '@/hooks/useApiMutation'
import { DataErrorState } from '@/components/ui/ErrorBoundary'
import BackgroundRefreshIndicator from '@/components/ui/BackgroundRefreshIndicator'

export default function AnnouncementsPage() {
  const router = useRouter()

  const user = useMemo(() => {
    if (typeof window === 'undefined') return null
    try { return JSON.parse(localStorage.getItem('user')) } catch { return null }
  }, [])

  // --- SWR data fetching ---
  const { data: announcementsRes, error, isLoading, isValidating, mutate: refreshAnnouncements } = useAuthedSWR('/api/announcements')
  const announcements = announcementsRes?.data || []

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

  // --- Delete mutation ---
  const deleteMutation = useApiMutation({
    method: 'DELETE',
    invalidateKeys: ['/api/announcements'],
    onSuccess: () => toast.success('Announcement deleted successfully'),
    onError: (msg) => toast.error(msg || 'Failed to delete announcement'),
  })

  const handleDelete = (announcementId) => {
    if (!confirm('Are you sure you want to delete this announcement?')) return
    deleteMutation.execute(`/api/announcements/${announcementId}`)
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
    return user && (user.role === 'admin' || user.role === 'admin' || user.role === 'hr' || user.role === 'department_head' || user.role === 'manager')
  }

  return (
    <div className="p-3 sm:p-6 pb-20 sm:pb-6">
      {/* Header */}
      <div className="flex md:justify-between md:items-center md:flex-row flex-col gap-                3 sm:gap-4 mb-4 sm:mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-gray-800">Announcements</h1>
          <p className="text-sm sm:text-base text-gray-600 mt-1">
            Company-wide announcements and updates
            <BackgroundRefreshIndicator isValidating={isValidating && !isLoading} position="inline" />
          </p>
        </div>
        {canManageAnnouncements() && (
          <button
            onClick={() => router.push('/dashboard/announcements/create')}
            className="w-full md:w-auto px-4 py-2 text-sm sm:text-base bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors flex items-center justify-center space-x-2"
          >
            <FaPlus className="w-3 h-3 sm:w-4 sm:h-4" />
            <span>New Announcement</span>
          </button>
        )}
      </div>

      {/* Announcements List */}
      <div className="space-y-3 sm:space-y-4">
        {error ? (
          <DataErrorState message="Failed to load announcements" onRetry={() => refreshAnnouncements()} />
        ) : isLoading ? (
          <div className="space-y-3 sm:space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="bg-white rounded-lg shadow-md p-4 sm:p-6 space-y-3">
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
              </div>
            ))}
          </div>
        ) : announcements.length === 0 ? (
          <div className="bg-white rounded-lg shadow-md p-6 sm:p-8 text-center text-sm sm:text-base text-gray-500">
            No announcements found
          </div>
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
                    <h3 className="text-base sm:text-xl font-bold text-gray-800 break-words">
                      {announcement.title}
                    </h3>
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

                {announcement.isActive && (
                  <span className="px-2 sm:px-3 py-0.5 sm:py-1 bg-green-100 text-green-800 text-xs font-semibold rounded-full h-fit flex-shrink-0">
                    Active
                  </span>
                )}
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
    </div>
  )
}

