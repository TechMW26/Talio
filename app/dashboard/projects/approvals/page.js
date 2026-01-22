'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import toast from '@/utils/toast'
import { Card, CardBody, Button, Chip, Skeleton, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Spinner } from '@heroui/react'
import { 
  FaArrowLeft, FaCheck, FaTimes, FaTrash, FaProjectDiagram,
  FaClock, FaCheckCircle, FaTimesCircle, FaFilter,
  FaExclamationTriangle, FaTasks, FaUser, FaCalendarAlt, FaEye
} from 'react-icons/fa'
import { playNotificationSound, NotificationSoundTypes } from '@/lib/notificationSounds'
import Portal from '@/components/ui/Portal'

const requestTypeLabels = {
  'task_deletion': 'Task Deletion',
  'task_completion': 'Task Completion',
  'task_review': 'Task Review',
  'project_completion': 'Project Completion',
  'member_removal': 'Member Removal',
  'all': 'All Types'
}

const requestTypeChipColors = {
  'task_deletion': 'danger',
  'task_completion': 'success',
  'task_review': 'primary',
  'project_completion': 'secondary',
  'member_removal': 'warning'
}

const requestTypeColors = {
  'task_deletion': 'bg-danger-100 text-danger-700 border-danger-200',
  'task_completion': 'bg-success-100 text-success-700 border-success-200',
  'task_review': 'bg-primary-100 text-primary-700 border-primary-200',
  'project_completion': 'bg-secondary-100 text-secondary-700 border-secondary-200',
  'member_removal': 'bg-warning-100 text-warning-700 border-warning-200'
}

const requestTypeIcons = {
  'task_deletion': FaTrash,
  'task_completion': FaCheckCircle,
  'task_review': FaEye,
  'project_completion': FaProjectDiagram,
  'member_removal': FaUser
}

const statusColors = {
  'pending': 'warning',
  'approved': 'success',
  'rejected': 'danger'
}

export default function ApprovalsPage() {
  const router = useRouter()
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('pending')
  const [typeFilter, setTypeFilter] = useState('all')
  const [processingId, setProcessingId] = useState(null)
  const [stats, setStats] = useState({ pending: 0, approved: 0, rejected: 0 })
  const [typeStats, setTypeStats] = useState({})
  const [showRejectModal, setShowRejectModal] = useState(false)
  const [selectedRequest, setSelectedRequest] = useState(null)
  const [rejectComment, setRejectComment] = useState('')
  const [unmarkSubtasks, setUnmarkSubtasks] = useState(false)
  const [subtasksToUnmark, setSubtasksToUnmark] = useState([]) // Array of subtask IDs
  const [subtaskComments, setSubtaskComments] = useState({}) // Object mapping subtask ID to comment
  const [newStatus, setNewStatus] = useState('in-progress') // For tasks without subtasks
  const [taskDetails, setTaskDetails] = useState(null) // Full task details for rejection modal
  const [loadingTask, setLoadingTask] = useState(false)

  // Auto-refresh refs
  const refreshIntervalRef = useRef(null)
  const lastFetchRef = useRef(Date.now())

  const fetchRequests = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true)
      const token = localStorage.getItem('token')
      const params = new URLSearchParams({ status: statusFilter })
      if (typeFilter !== 'all') {
        params.append('type', typeFilter)
      }
      const response = await fetch(`/api/projects/approvals?${params.toString()}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })

      const data = await response.json()
      if (data.success) {
        setRequests(prev => {
          if (JSON.stringify(prev) !== JSON.stringify(data.data)) {
            // Play sound if new pending requests arrived
            if (silent && statusFilter === 'pending' && data.data.length > prev.length) {
              playNotificationSound(NotificationSoundTypes.ALERT)
            }
            return data.data
          }
          return prev
        })
        if (data.stats) {
          setStats(data.stats)
        }
        if (data.typeStats) {
          setTypeStats(data.typeStats)
        }
        lastFetchRef.current = Date.now()
      } else if (!silent) {
        toast.error(data.message || 'Failed to fetch requests')
      }
    } catch (error) {
      console.error('Fetch requests error:', error)
      if (!silent) toast.error('An error occurred')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [statusFilter, typeFilter])

  useEffect(() => {
    fetchRequests()
  }, [statusFilter, typeFilter, fetchRequests])

  // Auto-refresh every 10 seconds
  useEffect(() => {
    refreshIntervalRef.current = setInterval(() => {
      fetchRequests(true)
    }, 10000)

    const handleFocus = () => {
      if (Date.now() - lastFetchRef.current > 5000) {
        fetchRequests(true)
      }
    }

    window.addEventListener('focus', handleFocus)

    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current)
      }
      window.removeEventListener('focus', handleFocus)
    }
  }, [fetchRequests])

  const handleApprove = async (requestId) => {
    try {
      setProcessingId(requestId)
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/projects/approvals/${requestId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ action: 'approve' })
      })

      const data = await response.json()
      if (data.success) {
        playNotificationSound(NotificationSoundTypes.SUCCESS)
        toast.success('Request approved')
        fetchRequests()
      } else {
        playNotificationSound(NotificationSoundTypes.WARNING)
        toast.error(data.message)
      }
    } catch (error) {
      playNotificationSound(NotificationSoundTypes.WARNING)
      toast.error('Failed to approve request')
    } finally {
      setProcessingId(null)
    }
  }

  // Fetch task details when opening reject modal for task_review or task_completion
  const openRejectModal = async (request) => {
    setSelectedRequest(request)
    setRejectComment('')
    setUnmarkSubtasks(false)
    setSubtasksToUnmark([])
    setSubtaskComments({})
    setNewStatus('in-progress')
    setTaskDetails(null)
    setShowRejectModal(true)

    // If it's a task review/completion, fetch full task details including subtasks
    if ((request.type === 'task_review' || request.type === 'task_completion') && request.relatedTask?._id) {
      try {
        setLoadingTask(true)
        const token = localStorage.getItem('token')
        const res = await fetch(`/api/projects/${request.project._id || request.project}/tasks/${request.relatedTask._id}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        })
        const data = await res.json()
        if (data.success) {
          setTaskDetails(data.data)
        }
      } catch (error) {
        console.error('Error fetching task details:', error)
      } finally {
        setLoadingTask(false)
      }
    }
  }

  const handleReject = async () => {
    if (!selectedRequest) return

    try {
      setProcessingId(selectedRequest._id)
      const token = localStorage.getItem('token')
      
      // Build request body based on task type
      const requestBody = { 
        action: 'reject', 
        comment: rejectComment
      }
      
      // For tasks with subtasks, include which ones to unmark
      if (taskDetails?.subtasks && taskDetails.subtasks.length > 0) {
        if (subtasksToUnmark.length > 0) {
          requestBody.subtasksToUnmark = subtasksToUnmark
          requestBody.subtaskComments = subtaskComments
        } else if (unmarkSubtasks) {
          requestBody.unmarkSubtasks = true
        }
      } else {
        // For tasks without subtasks, include the new status
        requestBody.newStatus = newStatus
      }
      
      const response = await fetch(`/api/projects/approvals/${selectedRequest._id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(requestBody)
      })

      const data = await response.json()
      if (data.success) {
        playNotificationSound(NotificationSoundTypes.UPDATE)
        toast.success('Request rejected')
        setShowRejectModal(false)
        setSelectedRequest(null)
        setRejectComment('')
        setUnmarkSubtasks(false)
        setSubtasksToUnmark([])
        setSubtaskComments({})
        setNewStatus('in-progress')
        setTaskDetails(null)
        fetchRequests()
      } else {
        playNotificationSound(NotificationSoundTypes.WARNING)
        toast.error(data.message)
      }
    } catch (error) {
      playNotificationSound(NotificationSoundTypes.WARNING)
      toast.error('Failed to reject request')
    } finally {
      setProcessingId(null)
    }
  }

  const formatDate = (date) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  return (
    <div className="page-container">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center">
          <Button
            isIconOnly
            variant="light"
            onPress={() => router.push('/dashboard/projects')}
            className="mr-4"
          >
            <FaArrowLeft className="text-default-600" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-default-800">Request Approvals</h1>
            <p className="text-default-500 text-sm">Manage pending requests for your projects</p>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card 
          isPressable
          shadow="sm"
          className={`cursor-pointer transition-all ${
            statusFilter === 'pending' ? 'ring-2 ring-warning' : ''
          }`}
          onPress={() => setStatusFilter('pending')}
        >
          <CardBody className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-default-500">Pending</p>
                <p className="text-2xl font-bold text-warning">{stats.pending}</p>
              </div>
              <div className="p-3 bg-warning-100 rounded-lg">
                <FaClock className="text-warning text-xl" />
              </div>
            </div>
          </CardBody>
        </Card>
        <Card 
          isPressable
          shadow="sm"
          className={`cursor-pointer transition-all ${
            statusFilter === 'approved' ? 'ring-2 ring-success' : ''
          }`}
          onPress={() => setStatusFilter('approved')}
        >
          <CardBody className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-default-500">Approved</p>
                <p className="text-2xl font-bold text-success">{stats.approved}</p>
              </div>
              <div className="p-3 bg-success-100 rounded-lg">
                <FaCheckCircle className="text-success text-xl" />
              </div>
            </div>
          </CardBody>
        </Card>
        <Card 
          isPressable
          shadow="sm"
          className={`cursor-pointer transition-all ${
            statusFilter === 'rejected' ? 'ring-2 ring-danger' : ''
          }`}
          onPress={() => setStatusFilter('rejected')}
        >
          <CardBody className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-default-500">Rejected</p>
                <p className="text-2xl font-bold text-danger">{stats.rejected}</p>
              </div>
              <div className="p-3 bg-danger-100 rounded-lg">
                <FaTimesCircle className="text-danger text-xl" />
              </div>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Type Filter Bar */}
      <Card shadow="sm" className="mb-6">
        <CardBody className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <FaFilter className="text-default-400" />
            <span className="text-sm font-medium text-default-700">Filter by Type</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={typeFilter === 'all' ? 'solid' : 'flat'}
              color={typeFilter === 'all' ? 'default' : 'default'}
              onPress={() => setTypeFilter('all')}
              className={typeFilter === 'all' ? 'bg-default-800 text-white' : ''}
            >
              All Types
              <span className="ml-2 px-2 py-0.5 rounded-full text-xs bg-white/20">
                {stats.pending + stats.approved + stats.rejected}
              </span>
            </Button>
            {['task_completion', 'task_review', 'task_deletion', 'project_completion', 'member_removal'].map(type => {
              const IconComponent = requestTypeIcons[type]
              const count = typeStats[type] || 0
              return (
                <Button
                  key={type}
                  size="sm"
                  variant={typeFilter === type ? 'flat' : 'light'}
                  color={typeFilter === type ? requestTypeChipColors[type] : 'default'}
                  onPress={() => setTypeFilter(type)}
                  startContent={IconComponent && <IconComponent className="text-sm" />}
                >
                  {requestTypeLabels[type]}
                  {count > 0 && (
                    <span className={`ml-1 px-2 py-0.5 rounded-full text-xs ${
                      typeFilter === type ? 'bg-white/30' : 'bg-default-200'
                    }`}>
                      {count}
                    </span>
                  )}
                </Button>
              )
            })}
          </div>
        </CardBody>
      </Card>

      {/* Requests List */}
      {loading ? (
        <Card shadow="sm">
          <CardBody className="p-8 text-center">
            <Spinner size="lg" className="mx-auto" />
            <p className="mt-4 text-default-600">Loading requests...</p>
          </CardBody>
        </Card>
      ) : requests.length === 0 ? (
        <Card shadow="sm">
          <CardBody className="p-8 text-center">
            <FaCheckCircle className="text-6xl text-default-300 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-default-700 mb-2">
              {statusFilter === 'pending' ? 'No pending requests' : `No ${statusFilter} requests`}
            </h3>
            <p className="text-default-500">
              {statusFilter === 'pending' 
                ? 'All caught up! No requests need your attention right now.'
                : `You don't have any ${statusFilter} requests yet.`
              }
            </p>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-4">
          {requests.map((request) => (
            <Card 
              key={request._id} 
              shadow="sm"
              className="hover:shadow-md transition-shadow"
            >
              <CardBody className="p-5">
                {/* Header */}
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <Chip color={requestTypeChipColors[request.type]} variant="flat" size="sm">
                      {requestTypeLabels[request.type]}
                    </Chip>
                    <Chip color={statusColors[request.status]} variant="flat" size="sm">
                      {request.status.charAt(0).toUpperCase() + request.status.slice(1)}
                    </Chip>
                  </div>
                  <div className="flex items-center text-sm text-default-500">
                    <FaCalendarAlt className="mr-1" />
                    {formatDate(request.createdAt)}
                  </div>
                </div>

                {/* Project Info */}
                <div className="flex items-center gap-2 mb-3">
                  <FaProjectDiagram className="text-default-400" />
                  <span className="font-medium text-default-700">{request.project?.name}</span>
                </div>

                {/* Request Details */}
                <div className="bg-default-50 rounded-lg p-4 mb-4">
                  {request.type === 'task_deletion' && request.relatedTask && (
                    <div className="flex items-start gap-3">
                      <FaTasks className="text-default-400 mt-1" />
                      <div>
                        <p className="font-medium text-default-800">{request.relatedTask.title || request.metadata?.taskTitle}</p>
                        <p className="text-sm text-default-500 mt-1">
                          Status: {request.relatedTask.status} • Priority: {request.relatedTask.priority || request.metadata?.taskPriority}
                        </p>
                      </div>
                    </div>
                  )}
                  
                  {request.reason && (
                    <div className="mt-3 pt-3 border-t border-default-200">
                      <p className="text-sm text-default-600">
                        <span className="font-medium">Reason:</span> {request.reason}
                      </p>
                    </div>
                  )}
                </div>

                {/* Requester Info */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-primary-500 flex items-center justify-center text-white text-sm font-medium overflow-hidden">
                      {request.requestedBy?.profilePicture ? (
                        <img 
                          src={request.requestedBy.profilePicture} 
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span>
                          {request.requestedBy?.firstName?.[0]}{request.requestedBy?.lastName?.[0]}
                        </span>
                      )}
                    </div>
                    <div>
                      <p className="font-medium text-default-700">
                        {request.requestedBy?.firstName} {request.requestedBy?.lastName}
                      </p>
                      <p className="text-xs text-default-500">Requested by</p>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  {request.status === 'pending' && (
                    <div className="flex gap-2">
                      <Button
                        color="success"
                        onPress={() => handleApprove(request._id)}
                        isDisabled={processingId === request._id}
                        isLoading={processingId === request._id}
                        startContent={!processingId && <FaCheck />}
                      >
                        Approve
                      </Button>
                      <Button
                        color="danger"
                        onPress={() => openRejectModal(request)}
                        isDisabled={processingId === request._id}
                        startContent={<FaTimes />}
                      >
                        Reject
                      </Button>
                    </div>
                  )}

                  {/* Reviewed Info */}
                  {request.status !== 'pending' && request.reviewedBy && (
                    <div className="text-right">
                      <p className="text-sm text-default-600">
                        {request.status === 'approved' ? 'Approved' : 'Rejected'} by{' '}
                        <span className="font-medium">
                          {request.reviewedBy?.firstName} {request.reviewedBy?.lastName}
                        </span>
                      </p>
                      {request.reviewedAt && (
                        <p className="text-xs text-default-500">{formatDate(request.reviewedAt)}</p>
                      )}
                      {request.reviewerComment && (
                        <p className="text-sm text-default-500 mt-1 italic">"{request.reviewerComment}"</p>
                      )}
                    </div>
                  )}
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {/* Reject Modal */}
      {showRejectModal && selectedRequest && (
      <Portal>
        <div className="fixed inset-0 modal-overlay flex items-center justify-center z-[9999] p-4 overflow-y-auto">
          <div className="bg-content1 rounded-2xl shadow-2xl w-full max-w-2xl animate-modal-enter my-8">
            <div className="px-6 py-4 bg-default-50 border-b border-default-200">
              <h3 className="text-xl font-bold text-default-800">Reject Task Review</h3>
              {selectedRequest.relatedTask?.title && (
                <p className="text-sm text-default-500 mt-1">Task: {selectedRequest.relatedTask.title}</p>
              )}
            </div>
            <div className="p-6 max-h-[70vh] overflow-y-auto">
              {loadingTask ? (
                <div className="flex items-center justify-center py-8">
                  <Spinner size="md" />
                </div>
              ) : (
                <>
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-default-700 mb-2">
                      Rejection Reason
                    </label>
                    <textarea
                      value={rejectComment}
                      onChange={(e) => setRejectComment(e.target.value)}
                      placeholder="Explain why this task is being rejected..."
                      rows={3}
                      className="w-full px-4 py-2 border border-default-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
                    />
                  </div>

                  {/* For tasks WITH subtasks - show subtask selection */}
                  {taskDetails?.subtasks && taskDetails.subtasks.length > 0 ? (
                    <div className="mb-4">
                      <div className="flex items-center justify-between mb-3">
                        <label className="block text-sm font-medium text-default-700">
                          Select subtasks to mark as incomplete
                        </label>
                        <button
                          type="button"
                          onClick={() => {
                            if (subtasksToUnmark.length === taskDetails.subtasks.length) {
                              setSubtasksToUnmark([])
                            } else {
                              setSubtasksToUnmark(taskDetails.subtasks.map(st => st._id))
                            }
                          }}
                          className="text-xs text-primary-600 hover:text-primary-700"
                        >
                          {subtasksToUnmark.length === taskDetails.subtasks.length ? 'Deselect All' : 'Select All'}
                        </button>
                      </div>
                      <div className="space-y-3 max-h-60 overflow-y-auto border border-default-200 rounded-lg p-3 bg-default-50">
                        {taskDetails.subtasks.map((subtask) => {
                          const isSelected = subtasksToUnmark.includes(subtask._id)
                          return (
                            <div key={subtask._id} className={`p-3 rounded-lg border transition-all ${
                              isSelected ? 'border-danger-300 bg-danger-50' : 'border-default-200 bg-content1'
                            }`}>
                              <div className="flex items-start gap-3">
                                <input
                                  type="checkbox"
                                  id={`subtask-${subtask._id}`}
                                  checked={isSelected}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setSubtasksToUnmark(prev => [...prev, subtask._id])
                                    } else {
                                      setSubtasksToUnmark(prev => prev.filter(id => id !== subtask._id))
                                      // Also remove comment
                                      setSubtaskComments(prev => {
                                        const copy = { ...prev }
                                        delete copy[subtask._id]
                                        return copy
                                      })
                                    }
                                  }}
                                  className="w-4 h-4 mt-1 text-danger border-default-300 rounded focus:ring-danger"
                                />
                                <div className="flex-1">
                                  <label htmlFor={`subtask-${subtask._id}`} className="text-sm font-medium text-default-800 cursor-pointer">
                                    {subtask.title}
                                  </label>
                                  {subtask.completed && (
                                    <Chip size="sm" color="success" variant="flat" className="ml-2">
                                      Completed
                                    </Chip>
                                  )}
                                  {isSelected && (
                                    <div className="mt-2">
                                      <input
                                        type="text"
                                        placeholder="Add comment for this subtask (optional)..."
                                        value={subtaskComments[subtask._id] || ''}
                                        onChange={(e) => setSubtaskComments(prev => ({
                                          ...prev,
                                          [subtask._id]: e.target.value
                                        }))}
                                        className="w-full px-3 py-1.5 text-sm border border-default-300 rounded focus:ring-2 focus:ring-danger focus:border-transparent"
                                      />
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                      {subtasksToUnmark.length > 0 && (
                        <p className="text-sm text-danger mt-2">
                          {subtasksToUnmark.length} subtask(s) will be marked as incomplete
                        </p>
                      )}
                    </div>
                  ) : (
                    /* For tasks WITHOUT subtasks - show status selection */
                    <div className="mb-4">
                      <label className="block text-sm font-medium text-default-700 mb-2">
                        Set task status to
                      </label>
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          { value: 'todo', label: 'To Do', color: 'default' },
                          { value: 'in-progress', label: 'In Progress', color: 'primary' },
                          { value: 'on-hold', label: 'On Hold', color: 'warning' }
                        ].map(status => (
                          <Button
                            key={status.value}
                            variant={newStatus === status.value ? 'flat' : 'bordered'}
                            color={newStatus === status.value ? status.color : 'default'}
                            onPress={() => setNewStatus(status.value)}
                            className={newStatus === status.value ? 'ring-2 ring-offset-1 ring-primary' : ''}
                          >
                            {status.label}
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-default-200">
                <Button
                  variant="bordered"
                  onPress={() => {
                    setShowRejectModal(false)
                    setSelectedRequest(null)
                    setRejectComment('')
                    setSubtasksToUnmark([])
                    setSubtaskComments({})
                    setNewStatus('in-progress')
                    setTaskDetails(null)
                  }}
                  isDisabled={processingId}
                >
                  Cancel
                </Button>
                <Button
                  color="danger"
                  onPress={handleReject}
                  isDisabled={processingId || loadingTask}
                  isLoading={processingId}
                >
                  {processingId ? 'Rejecting...' : 'Reject Task'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </Portal>
      )}
    </div>
  )
}
