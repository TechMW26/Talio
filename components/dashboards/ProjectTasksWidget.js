'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import toast from '@/utils/toast'
import {
  FaProjectDiagram, FaTasks, FaCalendarAlt, FaChevronRight,
  FaExclamationTriangle, FaCheckCircle, FaPlay, FaClock,
  FaEye, FaCheck, FaTimes
} from 'react-icons/fa'

const priorityColors = {
  low: 'bg-gray-100 text-gray-700',
  medium: 'bg-blue-100 text-blue-700',
  high: 'bg-orange-100 text-orange-700',
  critical: 'bg-red-100 text-red-700'
}

const statusIcons = {
  'todo': FaTasks,
  'in-progress': FaPlay,
  'review': FaEye,
  'completed': FaCheckCircle
}

const statusColors = {
  'todo': 'text-gray-500',
  'in-progress': 'text-blue-500',
  'review': 'text-purple-500',
  'completed': 'text-green-500'
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
        const allTasks = data.data || []
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
      <div className="animate-pulse">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-5 h-5 bg-gray-200 rounded"></div>
          <div className="h-5 bg-gray-200 rounded w-1/3"></div>
        </div>
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-16 bg-gray-200 rounded"></div>
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
          <h3 className="text-base sm:text-lg font-bold text-gray-800">Project Tasks</h3>
          {allTasks.length > 0 && (
            <span className="px-2 py-0.5 bg-primary-100 text-primary-700 text-xs rounded-full">
              {allTasks.length}
            </span>
          )}
        </div>
        <button
          onClick={() => router.push('/dashboard/projects/my-tasks')}
          className="text-primary-600 hover:text-primary-800 text-sm font-medium"
        >
          View All
        </button>
      </div>

      {allTasks.length === 0 ? (
        <div className="text-center py-6 text-gray-500">
          <FaProjectDiagram className="w-8 h-8 mx-auto mb-2 text-gray-400" />
          <p className="text-sm">No project tasks due today</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {/* Pending Acceptance Tasks */}
          {showPendingAcceptance && pendingTasks.map(task => (
            <div
              key={task._id}
              className="p-3 bg-yellow-50 rounded-lg border border-yellow-200"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <FaClock className="w-3 h-3 text-yellow-600" />
                    <span className="text-xs text-yellow-700 font-medium">Pending Acceptance</span>
                  </div>
                  <h4 className="text-sm font-medium text-gray-800 truncate">{task.title}</h4>
                  <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                    <span className="truncate">{task.project?.name}</span>
                    {task.dueDate && (
                      <>
                        <span>•</span>
                        <span className={isOverdue(task) ? 'text-red-500' : ''}>
                          Due {formatDate(task.dueDate)}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex gap-1 ml-2">
                  <button
                    onClick={() => openRejectModal(task)}
                    disabled={respondingTo === task._id}
                    className="p-1.5 text-red-600 hover:bg-red-100 rounded disabled:opacity-50"
                    title="Reject"
                  >
                    <FaTimes className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => handleRespondToAssignment(task, 'accept')}
                    disabled={respondingTo === task._id}
                    className="p-1.5 text-green-600 hover:bg-green-100 rounded disabled:opacity-50"
                    title="Accept"
                  >
                    <FaCheck className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
          ))}

          {/* Regular Tasks */}
          {tasks.map(task => {
            const StatusIcon = statusIcons[task.status] || FaTasks
            const taskOverdue = isOverdue(task)

            return (
              <div
                key={task._id}
                className={`p-3 rounded-lg ${taskOverdue ? 'bg-red-50' : 'bg-gray-50'} hover:bg-gray-100 transition-colors`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className={`p-1.5 rounded ${statusColors[task.status]}`}>
                      <StatusIcon className="w-3 h-3" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="text-sm font-medium text-gray-800 truncate">{task.title}</h4>
                        <span className={`px-1.5 py-0.5 rounded text-xs ${priorityColors[task.priority]}`}>
                          {task.priority}
                        </span>
                        {taskOverdue && (
                          <span className="flex items-center gap-1 text-xs text-red-600">
                            <FaExclamationTriangle className="w-3 h-3" />
                            Overdue
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                        <span className="truncate">{task.project?.name}</span>
                        {task.dueDate && (
                          <>
                            <span>•</span>
                            <span className={taskOverdue ? 'text-red-500' : ''}>
                              {formatDate(task.dueDate)}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Status indicator - no action buttons, status updates only from projects/tasks pages */}
                  {task.status !== 'completed' && (
                    <span className={`px-2 py-1 text-xs rounded-lg flex-shrink-0 ml-2 ${
                      task.status === 'todo' ? 'bg-gray-100 text-gray-600' :
                      task.status === 'in-progress' ? 'bg-blue-100 text-blue-600' :
                      task.status === 'review' ? 'bg-purple-100 text-purple-600' : 'bg-gray-100 text-gray-600'
                    }`}>
                      {task.status === 'todo' ? 'To Do' :
                        task.status === 'in-progress' ? 'In Progress' :
                          task.status === 'review' ? 'In Review' : task.status}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Reject Task Modal */}
      {showRejectModal && selectedTask && (
        <div className="fixed inset-0 z-[9100] flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(255,255,255,0.6)' }}>
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Reject Task Assignment</h3>
            <p className="text-sm text-gray-600 mb-4">
              Please provide a reason for rejecting "{selectedTask.title}"
            </p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Enter reason for rejection..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
              rows={3}
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => {
                  setShowRejectModal(false)
                  setRejectReason('')
                  setSelectedTask(null)
                }}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={() => handleRespondToAssignment(selectedTask, 'reject', rejectReason)}
                disabled={respondingTo === selectedTask._id}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {respondingTo === selectedTask._id ? 'Rejecting...' : 'Reject Task'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
