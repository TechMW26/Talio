'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import toast from '@/utils/toast'
import {
  FaProjectDiagram, FaTasks, FaCalendarAlt, FaChevronRight,
  FaExclamationTriangle, FaCheckCircle, FaPlay, FaClock,
  FaEye, FaCheck, FaTimes
} from 'react-icons/fa'
import { Card, CardBody, Button, Chip, Skeleton, ScrollShadow, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Textarea } from '@heroui/react'

const priorityColors = {
  low: 'default',
  medium: 'primary',
  high: 'warning',
  critical: 'danger'
}

const statusIcons = {
  'todo': FaTasks,
  'in-progress': FaPlay,
  'review': FaEye,
  'completed': FaCheckCircle
}

const statusColors = {
  'todo': 'text-default-500',
  'in-progress': 'text-primary-500',
  'review': 'text-secondary-500',
  'completed': 'text-success-500'
}

export default function ProjectTasksWidget({ limit = 5, showPendingAcceptance = true }) {
  const router = useRouter()
  const [tasks, setTasks] = useState([])
  const [pendingTasks, setPendingTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [respondingTo, setRespondingTo] = useState(null)
  const [showRejectModal, setShowRejectModal] = useState(false)
  const [selectedTask, setSelectedTask] = useState(null)
  const [rejectReason, setRejectReason] = useState('')

  useEffect(() => {
    fetchTodayTasks()
  }, [])

  const fetchTodayTasks = async () => {
    try {
      const token = localStorage.getItem('token')

      // Fetch today's tasks
      const response = await fetch(`/api/projects/my-tasks?period=today&limit=${limit}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })

      const data = await response.json()
      if (data.success) {
        const allTasks = (data.data || []).filter(t => t && t._id)
        setPendingTasks(allTasks.filter(t => t.assignmentStatus === 'pending'))
        setTasks(allTasks.filter(t => t.assignmentStatus !== 'pending'))
      }
    } catch (error) {
      console.error('Fetch today project tasks error:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleRespondToAssignment = async (task, action, reason = '') => {
    try {
      setRespondingTo(task._id)
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/projects/${task.project._id}/tasks/${task._id}/respond`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ action, reason: action === 'reject' ? reason : undefined })
      })

      const data = await response.json()
      if (data.success) {
        toast.success(data.message)
        fetchTodayTasks()
        setShowRejectModal(false)
        setRejectReason('')
        setSelectedTask(null)
      } else {
        toast.error(data.message)
      }
    } catch (error) {
      toast.error('Failed to respond to assignment')
    } finally {
      setRespondingTo(null)
    }
  }

  const openRejectModal = (task) => {
    setSelectedTask(task)
    setRejectReason('')
    setShowRejectModal(true)
  }

  const handleUpdateStatus = async (task, newStatus) => {
    try {
      setRespondingTo(task._id)
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/projects/${task.project._id}/tasks/${task._id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ status: newStatus })
      })

      const data = await response.json()
      if (data.success) {
        toast.success('Task updated')
        fetchTodayTasks()
      } else {
        toast.error(data.message)
      }
    } catch (error) {
      toast.error('Failed to update task')
    } finally {
      setRespondingTo(null)
    }
  }

  const formatDate = (date) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric'
    })
  }

  const isOverdue = (task) => {
    return task.dueDate && new Date(task.dueDate) < new Date() && task.status !== 'completed'
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-4">
          <Skeleton className="w-5 h-5 rounded" />
          <Skeleton className="h-5 w-1/3 rounded-lg" />
        </div>
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <Skeleton key={i} className="h-16 rounded-lg" />
          ))}
        </div>
      </div>
    )
  }

  const allTasks = showPendingAcceptance ? [...pendingTasks, ...tasks] : tasks

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <FaProjectDiagram className="w-5 h-5 text-primary-500" />
          <h3 className="text-base sm:text-lg font-bold text-default-900">Project Tasks</h3>
          {allTasks.length > 0 && (
            <Chip size="sm" color="primary" variant="flat">
              {allTasks.length}
            </Chip>
          )}
        </div>
        <Button
          variant="light"
          color="primary"
          size="sm"
          onPress={() => router.push('/dashboard/projects/my-tasks')}
        >
          View All
        </Button>
      </div>

      {allTasks.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center py-4 text-default-500">
          <img
            src="/assets/Project.png"
            alt="No project tasks"
            className="w-28 h-28 object-contain mb-2"
          />
          <p className="text-sm">No project tasks due today</p>
        </div>
      ) : (
        <ScrollShadow className="space-y-2 max-h-48">
          {/* Pending Acceptance Tasks */}
          {showPendingAcceptance && pendingTasks.map(task => (
            <Card
              key={task._id}
              className="bg-warning-50 border border-warning-200"
            >
              <CardBody className="p-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <FaClock className="w-3 h-3 text-warning-600" />
                      <span className="text-xs text-warning-700 font-medium">Pending Acceptance</span>
                    </div>
                    <h4 className="text-sm font-medium text-default-900 truncate">{task.title || 'Untitled Task'}</h4>
                    <div className="flex items-center gap-2 mt-1 text-xs text-default-500">
                      <span className="truncate">{task.project?.name}</span>
                      {task.dueDate && (
                        <>
                          <span>•</span>
                          <span className={isOverdue(task) ? 'text-danger-500' : ''}>
                            Due {formatDate(task.dueDate)}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1 ml-2">
                    <Button
                      isIconOnly
                      size="sm"
                      variant="light"
                      color="danger"
                      onPress={() => openRejectModal(task)}
                      isDisabled={respondingTo === task._id}
                    >
                      <FaTimes className="w-3 h-3" />
                    </Button>
                    <Button
                      isIconOnly
                      size="sm"
                      variant="light"
                      color="success"
                      onPress={() => handleRespondToAssignment(task, 'accept')}
                      isDisabled={respondingTo === task._id}
                    >
                      <FaCheck className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              </CardBody>
            </Card>
          ))}

          {/* Regular Tasks */}
          {tasks.map(task => {
            const StatusIcon = statusIcons[task.status] || FaTasks
            const taskOverdue = isOverdue(task)

            return (
              <Card
                key={task._id}
                className={taskOverdue ? 'bg-danger-50' : ''}
              >
                <CardBody className="p-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div className={`p-1.5 rounded ${statusColors[task.status]}`}>
                        <StatusIcon className="w-3 h-3" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="text-sm font-medium text-default-900 truncate">{task.title || 'Untitled Task'}</h4>
                          <Chip size="sm" color={priorityColors[task.priority]} variant="flat">
                            {task.priority}
                          </Chip>
                          {taskOverdue && (
                            <span className="flex items-center gap-1 text-xs text-danger-600">
                              <FaExclamationTriangle className="w-3 h-3" />
                              Overdue
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-1 text-xs text-default-500">
                          <span className="truncate">{task.project?.name}</span>
                          {task.dueDate && (
                            <>
                              <span>•</span>
                              <span className={taskOverdue ? 'text-danger-500' : ''}>
                                {formatDate(task.dueDate)}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Status indicator */}
                    {task.status !== 'completed' && (
                      <Chip
                        size="sm"
                        variant="flat"
                        color={
                          task.status === 'todo' ? 'default' :
                            task.status === 'in-progress' ? 'primary' :
                              task.status === 'review' ? 'secondary' : 'default'
                        }
                        className="flex-shrink-0 ml-2"
                      >
                        {task.status === 'todo' ? 'To Do' :
                          task.status === 'in-progress' ? 'In Progress' :
                            task.status === 'review' ? 'In Review' : task.status}
                      </Chip>
                    )}
                  </div>
                </CardBody>
              </Card>
            )
          })}
        </ScrollShadow>
      )}

      {/* Reject Task Modal */}
      <Modal isOpen={showRejectModal && selectedTask} onOpenChange={(open) => {
        if (!open) {
          setShowRejectModal(false)
          setRejectReason('')
          setSelectedTask(null)
        }
      }}>
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>Reject Task Assignment</ModalHeader>
              <ModalBody>
                <p className="text-sm text-default-600 mb-4">
                  Please provide a reason for rejecting "{selectedTask?.title}"
                </p>
                <Textarea
                  value={rejectReason}
                  onValueChange={setRejectReason}
                  placeholder="Enter reason for rejection..."
                  minRows={3}
                />
              </ModalBody>
              <ModalFooter>
                <Button variant="light" onPress={onClose}>
                  Cancel
                </Button>
                <Button
                  color="danger"
                  onPress={() => handleRespondToAssignment(selectedTask, 'reject', rejectReason)}
                  isDisabled={respondingTo === selectedTask?._id}
                  isLoading={respondingTo === selectedTask?._id}
                >
                  Reject Task
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  )
}
