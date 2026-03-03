'use client'

import { useState, useMemo } from 'react'
import { Skeleton } from '@heroui/react'
import { FaMapMarkerAlt, FaCheck, FaTimes, FaClock, FaUser, FaFilter } from 'react-icons/fa'
import { toast } from '@/utils/toast'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import useApiMutation from '@/hooks/useApiMutation'
import LoadingButton from '@/components/ui/LoadingButton'
import { DataErrorState } from '@/components/ui/ErrorBoundary'
import BackgroundRefreshIndicator from '@/components/ui/BackgroundRefreshIndicator'

export default function GeofencingPage() {
  const [filter, setFilter] = useState('all')
  const [processingId, setProcessingId] = useState(null)

  const userRole = useMemo(() => {
    if (typeof window === 'undefined') return ''
    try { return JSON.parse(localStorage.getItem('user'))?.role || '' } catch { return '' }
  }, [])

  // --- SWR data fetching (replaces manual fetch + 30s interval) ---
  const params = filter !== 'all' ? `?status=${filter}` : ''
  const { data: logsRes, error, isLoading, isValidating, mutate: refreshLogs } = useAuthedSWR(
    `/api/geofence/log${params}`,
    { refreshInterval: 30000 }
  )
  const logs = logsRes?.data || []
  const pendingRequests = useMemo(() =>
    logs.filter(log => log.outOfPremisesRequest?.status === 'pending'),
    [logs]
  )

  // --- Approval mutation ---
  const approvalMutation = useApiMutation({
    method: 'POST',
    invalidateKeys: ['/api/geofence/log'],
    onSuccess: (data) => {
      toast.success('Request processed successfully!')
      setProcessingId(null)
    },
    onError: (msg) => {
      toast.error(msg || 'Failed to process request')
      setProcessingId(null)
    },
  })

  const handleApproval = (logId, action, comments = '') => {
    setProcessingId(logId)
    approvalMutation.execute('/api/geofence/approve', { logId, action, comments })
  }

  const formatDate = (date) => {
    const d = new Date(date)
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  const formatDistance = (meters) => {
    if (meters < 1000) {
      return `${meters}m`
    }
    return `${(meters / 1000).toFixed(2)}km`
  }

  if (error) {
    return (
      <div className="p-6">
        <DataErrorState message="Failed to load geofencing data" onRetry={() => refreshLogs()} />
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-64 rounded-lg" />
        <Skeleton className="h-4 w-96 rounded-lg" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24 rounded-lg" />)}
        </div>
        <div className="space-y-3 mt-6">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-20 rounded-lg" />)}
        </div>
      </div>
    )
  }

  return (
    <div className="p-3 sm:p-6 pb-20 md:pb-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 flex items-center gap-2">
          <FaMapMarkerAlt className="text-primary-500" />
          Geofencing Monitoring
        </h1>
        <p className="text-gray-600 mt-1">Track employee locations and manage out-of-premises requests</p>
      </div>

      {/* Pending Requests Alert */}
      {pendingRequests.length > 0 && (
        <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-6">
          <div className="flex items-center">
            <FaClock className="text-yellow-600 mr-3" />
            <div>
              <p className="text-sm font-medium text-yellow-800">
                {pendingRequests.length} pending approval request{pendingRequests.length > 1 ? 's' : ''}
              </p>
              <p className="text-xs text-yellow-700 mt-1">
                Employees are waiting for approval to be outside office premises
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="bg-white rounded-lg shadow-md p-4 mb-6">
        <div className="flex items-center gap-2 mb-3">
          <FaFilter className="text-gray-500" />
          <span className="text-sm font-medium text-gray-700">Filter by Status:</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {['all', 'pending', 'approved', 'rejected'].map(status => (
            <button
              key={status}
              onClick={() => setFilter(status)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${filter === status
                  ? 'bg-primary-500 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
            >
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Logs List */}
      <div className="space-y-4">
        {logs.length === 0 ? (
          <div className="bg-white rounded-lg shadow-md p-8 text-center">
            <FaMapMarkerAlt className="text-gray-300 text-5xl mx-auto mb-4" />
            <p className="text-gray-600">No geofencing logs found</p>
            <p className="text-sm text-gray-500 mt-2">
              Logs will appear here when employees are tracked outside the geofence
            </p>
          </div>
        ) : (
          logs.map(log => (
            <div key={log._id} className="bg-white rounded-lg shadow-md p-4 sm:p-6">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                {/* Employee Info */}
                <div className="flex items-start gap-3 flex-1">
                  <div className="w-12 h-12 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0">
                    {log.employee?.profilePicture ? (
                      <img
                        src={log.employee.profilePicture}
                        alt={`${log.employee.firstName} ${log.employee.lastName}`}
                        className="w-12 h-12 rounded-full object-cover"
                      />
                    ) : (
                      <FaUser className="text-primary-500" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-gray-900">
                      {log.employee?.firstName} {log.employee?.lastName}
                    </h3>
                    <p className="text-sm text-gray-600">{log.employee?.employeeCode}</p>
                    {log.department && (
                      <p className="text-xs text-gray-500 mt-1">{log.department.name}</p>
                    )}
                  </div>
                </div>

                {/* Status Badge */}
                <div className="flex items-center gap-2">
                  {log.isWithinGeofence ? (
                    <span className="px-3 py-1 bg-green-100 text-green-800 text-xs font-medium rounded-full">
                      Inside Geofence
                    </span>
                  ) : (
                    <span className="px-3 py-1 bg-red-100 text-red-800 text-xs font-medium rounded-full">
                      Outside Geofence
                    </span>
                  )}
                </div>
              </div>

              {/* Location Details */}
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                <div>
                  <span className="text-gray-500">Distance from office:</span>
                  <p className="font-medium text-gray-900">{formatDistance(log.distanceFromCenter)}</p>
                </div>
                <div>
                  <span className="text-gray-500">Event Type:</span>
                  <p className="font-medium text-gray-900 capitalize">{log.eventType.replace('_', ' ')}</p>
                </div>
                <div>
                  <span className="text-gray-500">Time:</span>
                  <p className="font-medium text-gray-900">{formatDate(log.createdAt)}</p>
                </div>
              </div>

              {/* Out of Premises Request */}
              {log.outOfPremisesRequest && (
                <div className="mt-4 border-t pt-4">
                  <div className="bg-gray-50 rounded-lg p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-900 mb-2">Reason for being outside:</p>
                        <p className="text-sm text-gray-700">{log.outOfPremisesRequest.reason}</p>

                        {/* Status */}
                        <div className="mt-3 flex items-center gap-2">
                          <span className="text-xs text-gray-500">Status:</span>
                          {log.outOfPremisesRequest.status === 'pending' && (
                            <span className="px-2 py-1 bg-yellow-100 text-yellow-800 text-xs font-medium rounded">
                              Pending Approval
                            </span>
                          )}
                          {log.outOfPremisesRequest.status === 'approved' && (
                            <span className="px-2 py-1 bg-green-100 text-green-800 text-xs font-medium rounded flex items-center gap-1">
                              <FaCheck /> Approved
                            </span>
                          )}
                          {log.outOfPremisesRequest.status === 'rejected' && (
                            <span className="px-2 py-1 bg-red-100 text-red-800 text-xs font-medium rounded flex items-center gap-1">
                              <FaTimes /> Rejected
                            </span>
                          )}
                        </div>

                        {/* Reviewer Info */}
                        {log.outOfPremisesRequest.reviewedBy && (
                          <div className="mt-2 text-xs text-gray-600">
                            <p>
                              Reviewed by: {log.outOfPremisesRequest.reviewedBy.firstName} {log.outOfPremisesRequest.reviewedBy.lastName}
                            </p>
                            <p>On: {formatDate(log.outOfPremisesRequest.reviewedAt)}</p>
                            {log.outOfPremisesRequest.reviewerComments && (
                              <p className="mt-1 italic">"{log.outOfPremisesRequest.reviewerComments}"</p>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Approval Buttons */}
                      {log.outOfPremisesRequest.status === 'pending' && (
                        <div className="flex flex-col gap-2">
                          <button
                            onClick={() => {
                              const comments = prompt('Add comments (optional):')
                              handleApproval(log._id, 'approved', comments || '')
                            }}
                            className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors flex items-center gap-2 text-sm"
                          >
                            <FaCheck /> Approve
                          </button>
                          <button
                            onClick={() => {
                              const comments = prompt('Reason for rejection:')
                              if (comments) {
                                handleApproval(log._id, 'rejected', comments)
                              }
                            }}
                            className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors flex items-center gap-2 text-sm"
                          >
                            <FaTimes /> Reject
                          </button>
                        </div>
                      )}
                    </div>
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

