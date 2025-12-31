'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import toast from '@/utils/toast'
import {
  HiOutlineClipboardDocumentList,
  HiOutlineClock,
  HiOutlineCheckCircle,
  HiOutlineExclamationTriangle,
  HiOutlinePlayCircle,
  HiOutlineListBullet,
  HiOutlineMagnifyingGlass,
  HiOutlineFunnel,
  HiOutlineChevronDown,
  HiOutlineChevronUp,
  HiOutlineXMark,
  HiOutlineTrash,
  HiOutlineChatBubbleLeftRight
} from 'react-icons/hi2'
import {
  FaTasks, FaCalendarAlt, FaFilter, FaSearch, FaProjectDiagram,
  FaCheck, FaPlay, FaEye, FaClock, FaExclamationTriangle,
  FaChevronDown, FaCheckCircle, FaTimes, FaSpinner, FaPlus,
  FaTrash, FaChevronUp, FaComment
} from 'react-icons/fa'
import { playNotificationSound, NotificationSoundTypes } from '@/lib/notificationSounds'
import Portal from '@/components/ui/Portal'

const statusColors = {
  'todo': 'bg-gray-100 text-gray-700 border-gray-200',
  'in-progress': 'bg-blue-100 text-blue-700 border-blue-200',
  'review': 'bg-purple-100 text-purple-700 border-purple-200',
  'completed': 'bg-green-100 text-green-700 border-green-200',
  'completed-pending-approval': 'bg-yellow-100 text-yellow-700 border-yellow-200',
  'rejected': 'bg-red-100 text-red-700 border-red-200',
  'blocked': 'bg-orange-100 text-orange-700 border-orange-200'
}

const priorityColors = {
  low: 'bg-gray-100 text-gray-700',
  medium: 'bg-blue-100 text-blue-700',
  high: 'bg-orange-100 text-orange-700',
  critical: 'bg-red-100 text-red-700'
}

// Project colors for visual differentiation
const projectColors = [
  { bg: 'bg-blue-50', border: 'border-l-blue-500', text: 'text-blue-700', badge: 'bg-blue-100' },
  { bg: 'bg-green-50', border: 'border-l-green-500', text: 'text-green-700', badge: 'bg-green-100' },
  { bg: 'bg-purple-50', border: 'border-l-purple-500', text: 'text-purple-700', badge: 'bg-purple-100' },
  { bg: 'bg-orange-50', border: 'border-l-orange-500', text: 'text-orange-700', badge: 'bg-orange-100' },
  { bg: 'bg-pink-50', border: 'border-l-pink-500', text: 'text-pink-700', badge: 'bg-pink-100' },
  { bg: 'bg-teal-50', border: 'border-l-teal-500', text: 'text-teal-700', badge: 'bg-teal-100' },
  { bg: 'bg-indigo-50', border: 'border-l-indigo-500', text: 'text-indigo-700', badge: 'bg-indigo-100' },
  { bg: 'bg-yellow-50', border: 'border-l-yellow-500', text: 'text-yellow-700', badge: 'bg-yellow-100' },
  { bg: 'bg-red-50', border: 'border-l-red-400', text: 'text-red-700', badge: 'bg-red-100' },
  { bg: 'bg-cyan-50', border: 'border-l-cyan-500', text: 'text-cyan-700', badge: 'bg-cyan-100' },
]

// Get consistent color for a project based on its ID
const getProjectColor = (projectId) => {
  if (!projectId) return projectColors[0]
  // Use simple hash of project ID to get consistent color
  let hash = 0
  const id = projectId.toString()
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash) + id.charCodeAt(i)
    hash = hash & hash
  }
  return projectColors[Math.abs(hash) % projectColors.length]
}

export default function MyTasksPage() {
  const router = useRouter()
  const [mounted, setMounted] = useState(false)
  const [user, setUser] = useState(null)

  useEffect(() => {
    setMounted(true)
  }, [])
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState({
    status: 'all',
    priority: 'all',
    period: 'all',
    project: 'all'
  })
  const [searchQuery, setSearchQuery] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [respondingTo, setRespondingTo] = useState(null)
  const [rejectRemark, setRejectRemark] = useState('')
  const [showRejectModal, setShowRejectModal] = useState(false)
  const [selectedTask, setSelectedTask] = useState(null)
  const [showEtaModal, setShowEtaModal] = useState(false)
  const [taskForEta, setTaskForEta] = useState(null)
  const [eta, setEta] = useState({ days: '', hours: '' })
  const [subtaskEtas, setSubtaskEtas] = useState({}) // For subtask-wise ETAs: { subtaskId: { days, hours } }
  const [projects, setProjects] = useState([]) // Store unique projects for filter
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [taskToDelete, setTaskToDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  // Auto-refresh refs
  const refreshIntervalRef = useRef(null)
  const lastFetchRef = useRef(Date.now())

  const fetchTasks = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true)
      const token = localStorage.getItem('token')
      const params = new URLSearchParams()

      if (filters.status !== 'all') params.append('status', filters.status)
      if (filters.priority !== 'all') params.append('priority', filters.priority)
      if (filters.period !== 'all') params.append('period', filters.period)

      const response = await fetch(`/api/projects/my-tasks?${params.toString()}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })

      const data = await response.json()
      if (data.success) {
        setTasks(prev => {
          // Only update if data changed to prevent layout shifts
          if (JSON.stringify(prev) !== JSON.stringify(data.data)) {
            return data.data
          }
          return prev
        })

        // Extract unique projects for filter dropdown
        const uniqueProjects = []
        const projectIds = new Set()
        data.data.forEach(task => {
          if (task.project && !projectIds.has(task.project._id)) {
            projectIds.add(task.project._id)
            uniqueProjects.push({
              _id: task.project._id,
              name: task.project.name
            })
          }
        })
        setProjects(uniqueProjects.sort((a, b) => a.name.localeCompare(b.name)))
      } else if (!silent) {
        toast.error(data.message || 'Failed to load tasks')
      }
    } catch (error) {
      console.error('Fetch tasks error:', error)
      if (!silent) toast.error('An error occurred')
    } finally {
      if (!silent) setLoading(false)
      lastFetchRef.current = Date.now()
    }
  }, [filters])

  useEffect(() => {
    fetchTasks()
  }, [fetchTasks])

  // Load user from localStorage
  useEffect(() => {
    const userData = localStorage.getItem('user')
    if (userData) {
      setUser(JSON.parse(userData))
    }
  }, [])

  // Auto-refresh every 10 seconds for real-time sync
  useEffect(() => {
    refreshIntervalRef.current = setInterval(() => fetchTasks(true), 10000)

    // Also refresh on window focus
    const handleFocus = () => {
      if (Date.now() - lastFetchRef.current > 5000) {
        fetchTasks(true)
      }
    }
    window.addEventListener('focus', handleFocus)

    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current)
      }
      window.removeEventListener('focus', handleFocus)
    }
  }, [fetchTasks])

  const handleRespondToAssignment = async (task, action, estimatedDays = null, estimatedHours = null) => {
    try {
      setRespondingTo(task._id)
      const token = localStorage.getItem('token')

      // Calculate total estimated hours from days and hours
      let totalEstimatedHours = null
      if (estimatedDays !== null || estimatedHours !== null) {
        const days = parseFloat(estimatedDays) || 0
        const hours = parseFloat(estimatedHours) || 0
        totalEstimatedHours = (days * 8) + hours // Assuming 8 work hours per day
      }

      const response = await fetch(`/api/projects/${task.project._id}/tasks/${task._id}/respond`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          action,
          reason: action === 'reject' ? rejectRemark : undefined,
          estimatedHours: totalEstimatedHours
        })
      })

      const data = await response.json()
      if (data.success) {
        if (action === 'accept') {
          playNotificationSound(NotificationSoundTypes.SUCCESS)
        } else {
          playNotificationSound(NotificationSoundTypes.UPDATE)
        }
        toast.success(data.message)
        fetchTasks()
        setShowRejectModal(false)
        setRejectRemark('')
        setSelectedTask(null)
      } else {
        playNotificationSound(NotificationSoundTypes.WARNING)
        toast.error(data.message)
      }
    } catch (error) {
      playNotificationSound(NotificationSoundTypes.WARNING)
      toast.error('Failed to respond to assignment')
    } finally {
      setRespondingTo(null)
    }
  }

  const handleAcceptWithEta = async () => {
    if (!taskForEta) return

    const hasSubtasks = taskForEta.subtasks && taskForEta.subtasks.length > 0

    if (hasSubtasks) {
      // Validate all subtask ETAs
      let allValid = true
      let totalHours = 0

      for (const st of taskForEta.subtasks) {
        const stEta = subtaskEtas[st._id] || {}
        const days = parseInt(stEta.days) || 0
        const hours = parseInt(stEta.hours) || 0

        if (days === 0 && hours === 0) {
          allValid = false
          break
        }
        totalHours += (days * 8) + hours
      }

      if (!allValid) {
        toast.error('Please provide ETA for all subtasks')
        return
      }

      // First update subtask ETAs, then accept the task
      try {
        setRespondingTo(taskForEta._id)
        const token = localStorage.getItem('token')
        const projectId = taskForEta.project?._id || taskForEta.project

        // Update each subtask with its ETA
        for (const st of taskForEta.subtasks) {
          const stEta = subtaskEtas[st._id] || {}
          await fetch(`/api/projects/${projectId}/tasks/${taskForEta._id}/subtasks`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
              subtaskId: st._id,
              estimatedDays: parseInt(stEta.days) || 0,
              estimatedHours: parseInt(stEta.hours) || 0
            })
          })
        }

        // Now accept the task (total hours will be calculated server-side)
        handleRespondToAssignment(taskForEta, 'accept', 0, totalHours)
      } catch (error) {
        console.error('Error updating subtask ETAs:', error)
        toast.error('Failed to update subtask ETAs')
        setRespondingTo(null)
        return
      }
    } else {
      // No subtasks - use main task ETA
      const days = parseFloat(eta.days) || 0
      const hours = parseFloat(eta.hours) || 0

      if (days === 0 && hours === 0) {
        toast.error('Please provide an estimated time')
        return
      }

      handleRespondToAssignment(taskForEta, 'accept', days, hours)
    }

    setShowEtaModal(false)
    setTaskForEta(null)
    setEta({ days: '', hours: '' })
    setSubtaskEtas({})
  }

  const handleDeleteTask = async () => {
    if (!taskToDelete) return

    try {
      setDeleting(true)
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/projects/${taskToDelete.project._id}/tasks/${taskToDelete._id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      const data = await response.json()
      if (data.success) {
        playNotificationSound(NotificationSoundTypes.POP)
        if (data.deletionPending) {
          toast.success('Deletion request sent for approval')
        } else {
          toast.success('Task deleted successfully')
        }
        setShowDeleteModal(false)
        setTaskToDelete(null)
        fetchTasks()
      } else {
        playNotificationSound(NotificationSoundTypes.WARNING)
        toast.error(data.message || 'Failed to delete task')
      }
    } catch (error) {
      playNotificationSound(NotificationSoundTypes.WARNING)
      toast.error('Failed to delete task')
    } finally {
      setDeleting(false)
    }
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
        if (newStatus === 'completed') {
          playNotificationSound(NotificationSoundTypes.SUCCESS)
        } else {
          playNotificationSound(NotificationSoundTypes.UPDATE)
        }
        toast.success('Task updated')
        fetchTasks()
      } else {
        playNotificationSound(NotificationSoundTypes.WARNING)
        toast.error(data.message)
      }
    } catch (error) {
      playNotificationSound(NotificationSoundTypes.WARNING)
      toast.error('Failed to update task')
    } finally {
      setRespondingTo(null)
    }
  }

  const formatDate = (date) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })
  }

  const isOverdue = (task) => {
    return task.dueDate && new Date(task.dueDate) < new Date() && task.status !== 'completed'
  }

  const isDueToday = (task) => {
    if (!task.dueDate) return false
    const today = new Date()
    const due = new Date(task.dueDate)
    return due.toDateString() === today.toDateString()
  }

  // Filter tasks by search query and project
  const filteredTasks = tasks.filter(task => {
    // Project filter
    if (filters.project !== 'all' && task.project?._id !== filters.project) {
      return false
    }

    // Search filter
    if (!searchQuery) return true
    const query = searchQuery.toLowerCase()
    return (
      task.title.toLowerCase().includes(query) ||
      task.description?.toLowerCase().includes(query) ||
      task.project?.name?.toLowerCase().includes(query)
    )
  })

  // Group tasks by date for today view
  const todayTasks = filteredTasks.filter(isDueToday)
  const overdueTasks = filteredTasks.filter(t => isOverdue(t) && !isDueToday(t))
  const upcomingTasks = filteredTasks.filter(t => !isOverdue(t) && !isDueToday(t))
  const pendingAcceptance = filteredTasks.filter(t => t.assignmentStatus === 'pending')

  const stats = {
    total: tasks.length,
    todo: tasks.filter(t => t.status === 'todo').length,
    inProgress: tasks.filter(t => t.status === 'in-progress').length,
    completed: tasks.filter(t => t.status === 'completed').length,
    overdue: tasks.filter(t => isOverdue(t)).length,
    pendingAcceptance: tasks.filter(t => t.assignmentStatus === 'pending').length,
    pending: tasks.filter(t => t.assignmentStatus === 'pending' || t.status === 'todo').length
  }

  // Prevent hydration mismatch
  if (!mounted) {
    return (
      <div className="page-container">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="page-container">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
        </div>
      </div>
    )
  }

  return (
    <div className="page-container">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <HiOutlineClipboardDocumentList className="w-7 h-7 text-indigo-600" />
            My Tasks
          </h1>
          <p className="text-gray-600 mt-1">
            View and manage your tasks across all projects
          </p>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gray-100 rounded-lg">
              <HiOutlineListBullet className="w-5 h-5 text-gray-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-800">{stats.total}</p>
              <p className="text-sm text-gray-500">Total</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-100 rounded-lg">
              <HiOutlineClock className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-800">{stats.pendingAcceptance}</p>
              <p className="text-sm text-gray-500">Pending Accept</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-slate-100 rounded-lg">
              <HiOutlineClipboardDocumentList className="w-5 h-5 text-slate-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-800">{stats.todo}</p>
              <p className="text-sm text-gray-500">To Do</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <HiOutlinePlayCircle className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-800">{stats.inProgress}</p>
              <p className="text-sm text-gray-500">In Progress</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 rounded-lg">
              <HiOutlineCheckCircle className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-800">{stats.completed}</p>
              <p className="text-sm text-gray-500">Completed</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-100 rounded-lg">
              <HiOutlineExclamationTriangle className="w-5 h-5 text-red-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-800">{stats.overdue}</p>
              <p className="text-sm text-gray-500">Overdue</p>
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
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search tasks..."
              className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-2">
            <select
              value={filters.project}
              onChange={(e) => setFilters(prev => ({ ...prev, project: e.target.value }))}
              className="px-4 py-2.5 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              <option value="all">All Projects</option>
              {projects.map(project => (
                <option key={project._id} value={project._id}>
                  {project.name}
                </option>
              ))}
            </select>

            <select
              value={filters.status}
              onChange={(e) => setFilters(prev => ({ ...prev, status: e.target.value }))}
              className="px-4 py-2.5 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              <option value="all">All Statuses</option>
              <option value="todo">To Do</option>
              <option value="in-progress">In Progress</option>
              <option value="review">In Review</option>
              <option value="completed">Completed</option>
              <option value="blocked">Blocked</option>
            </select>

            <select
              value={filters.priority}
              onChange={(e) => setFilters(prev => ({ ...prev, priority: e.target.value }))}
              className="px-4 py-2.5 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              <option value="all">All Priorities</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>

            <select
              value={filters.period}
              onChange={(e) => setFilters(prev => ({ ...prev, period: e.target.value }))}
              className="px-4 py-2.5 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              <option value="all">All Time</option>
              <option value="today">Today</option>
              <option value="week">This Week</option>
              <option value="month">This Month</option>
              <option value="overdue">Overdue</option>
            </select>
          </div>
        </div>
      </div>

      {/* Pending Acceptance Tasks */}
      {pendingAcceptance.length > 0 && (
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-2">
            <HiOutlineClock className="w-5 h-5 text-amber-500" />
            Pending Acceptance ({pendingAcceptance.length})
          </h2>
          <div className="grid gap-4">
            {pendingAcceptance.map(task => (
              <TaskCard
                key={task._id}
                task={task}
                onAccept={() => {
                  setTaskForEta(task)
                  // Initialize subtask ETAs if task has subtasks
                  if (task.subtasks && task.subtasks.length > 0) {
                    const initialEtas = {}
                    task.subtasks.forEach(st => {
                      initialEtas[st._id] = {
                        days: st.estimatedDays || '',
                        hours: st.estimatedHours || ''
                      }
                    })
                    setSubtaskEtas(initialEtas)
                  } else {
                    setSubtaskEtas({})
                  }
                  setShowEtaModal(true)
                }}
                onReject={() => { setSelectedTask(task); setShowRejectModal(true) }}
                onStatusChange={handleUpdateStatus}
                onViewProject={() => router.push(`/dashboard/projects/${task.project._id}`)}
                onDelete={() => { setTaskToDelete(task); setShowDeleteModal(true) }}
                respondingTo={respondingTo}
                isPendingAcceptance
              />
            ))}
          </div>
        </div>
      )}

      {/* Overdue Tasks */}
      {overdueTasks.length > 0 && (
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-2">
            <HiOutlineExclamationTriangle className="w-5 h-5 text-red-500" />
            Overdue ({overdueTasks.length})
          </h2>
          <div className="grid gap-4">
            {overdueTasks.filter(t => t.assignmentStatus !== 'pending').map(task => (
              <TaskCard
                key={task._id}
                task={task}
                onStatusChange={handleUpdateStatus}
                onViewProject={() => router.push(`/dashboard/projects/${task.project._id}`)}
                onDelete={() => { setTaskToDelete(task); setShowDeleteModal(true) }}
                respondingTo={respondingTo}
                isOverdue
              />
            ))}
          </div>
        </div>
      )}

      {/* Today's Tasks */}
      {todayTasks.length > 0 && (
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-2">
            <HiOutlineClock className="w-5 h-5 text-blue-500" />
            Due Today ({todayTasks.length})
          </h2>
          <div className="grid gap-4">
            {todayTasks.filter(t => t.assignmentStatus !== 'pending').map(task => (
              <TaskCard
                key={task._id}
                task={task}
                onStatusChange={handleUpdateStatus}
                onViewProject={() => router.push(`/dashboard/projects/${task.project._id}`)}
                onDelete={() => { setTaskToDelete(task); setShowDeleteModal(true) }}
                respondingTo={respondingTo}
              />
            ))}
          </div>
        </div>
      )}

      {/* Upcoming Tasks */}
      {upcomingTasks.filter(t => t.assignmentStatus !== 'pending').length > 0 && (
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-3">
            All Tasks
          </h2>
          <div className="grid gap-4">
            {upcomingTasks.filter(t => t.assignmentStatus !== 'pending').map(task => (
              <TaskCard
                key={task._id}
                task={task}
                onStatusChange={handleUpdateStatus}
                onViewProject={() => router.push(`/dashboard/projects/${task.project._id}`)}
                onDelete={() => { setTaskToDelete(task); setShowDeleteModal(true) }}
                respondingTo={respondingTo}
              />
            ))}
          </div>
        </div>
      )}

      {filteredTasks.length === 0 && (
        <div className="text-center py-12 bg-white rounded-xl shadow-sm border border-gray-100">
          <HiOutlineClipboardDocumentList className="w-16 h-16 mx-auto text-gray-300 mb-4" />
          <h3 className="text-lg font-medium text-gray-800 mb-2">
            No tasks found
          </h3>
          <p className="text-gray-500">
            Tasks assigned to you will appear here
          </p>
        </div>
      )}

      {/* Reject Modal */}
      {showRejectModal && selectedTask && (
        <Portal>
          <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && (setShowRejectModal(false), setSelectedTask(null), setRejectRemark(''))}>
            <div className="modal-backdrop" />
            <div className="modal-container modal-lg">
              <div className="modal-header">
                <h3 className="modal-title">Reject Assignment</h3>
                <button
                  onClick={() => { setShowRejectModal(false); setSelectedTask(null); setRejectRemark('') }}
                  className="modal-close-btn"
                >
                  <FaTimes />
                </button>
              </div>
              <div className="modal-body">
                <p className="text-gray-600 mb-4">
                  Please provide a reason for rejecting this task assignment.
                </p>
                <textarea
                  value={rejectRemark}
                  onChange={(e) => setRejectRemark(e.target.value)}
                  placeholder="Reason for rejection..."
                  rows={3}
                  className="modal-textarea"
                />
              </div>
              <div className="modal-footer">
                <button
                  onClick={() => { setShowRejectModal(false); setSelectedTask(null); setRejectRemark('') }}
                  className="modal-btn modal-btn-secondary"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleRespondToAssignment(selectedTask, 'reject')}
                  disabled={respondingTo === selectedTask._id}
                  className="modal-btn modal-btn-danger"
                >
                  {respondingTo === selectedTask._id ? 'Rejecting...' : 'Reject'}
                </button>
              </div>
            </div>
          </div>
        </Portal>
      )}

      {/* ETA Modal */}
      {showEtaModal && taskForEta && (
        <Portal>
          <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && (setShowEtaModal(false), setTaskForEta(null), setEta({ days: '', hours: '' }), setSubtaskEtas({}))}>
            <div className="modal-backdrop" />
            <div className="modal-container modal-2xl">
              <div className="modal-header">
                <h3 className="modal-title">Set Estimated Time</h3>
                <button
                  onClick={() => { setShowEtaModal(false); setTaskForEta(null); setEta({ days: '', hours: '' }); setSubtaskEtas({}) }}
                  className="modal-close-btn"
                >
                  <FaTimes />
                </button>
              </div>
              <div className="modal-body">
                <div className="mb-4">
                  <p className="font-medium text-gray-800 mb-1">{taskForEta.title}</p>
                  {taskForEta.description && (
                    <p className="text-sm text-gray-500">{taskForEta.description}</p>
                  )}
                </div>

                {taskForEta.subtasks && taskForEta.subtasks.length > 0 ? (
                  <>
                    <p className="text-gray-600 mb-4">
                      Please provide an ETA for each subtask. The total task time will be calculated automatically.
                    </p>
                    <div className="space-y-4">
                      {taskForEta.subtasks.map((st, index) => (
                        <div key={st._id} className="p-3 bg-gray-50 rounded-lg">
                          <p className="text-sm font-medium text-gray-700 mb-2">
                            {index + 1}. {st.title}
                          </p>
                          <div className="flex items-center gap-3">
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                min="0"
                                value={subtaskEtas[st._id]?.days || ''}
                                onChange={(e) => setSubtaskEtas(prev => ({
                                  ...prev,
                                  [st._id]: { ...prev[st._id], days: e.target.value }
                                }))}
                                placeholder="0"
                                className="modal-input w-16"
                              />
                              <span className="text-xs text-gray-500">days</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                min="0"
                                max="23"
                                value={subtaskEtas[st._id]?.hours || ''}
                                onChange={(e) => setSubtaskEtas(prev => ({
                                  ...prev,
                                  [st._id]: { ...prev[st._id], hours: e.target.value }
                                }))}
                                placeholder="0"
                                className="modal-input w-16"
                              />
                              <span className="text-xs text-gray-500">hours</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-4 p-3 bg-blue-50 rounded-lg">
                      <p className="text-sm text-blue-700 font-medium">
                        Total Estimated Time: {(() => {
                          let total = 0
                          taskForEta.subtasks.forEach(st => {
                            const stEta = subtaskEtas[st._id] || {}
                            total += ((parseInt(stEta.days) || 0) * 8) + (parseInt(stEta.hours) || 0)
                          })
                          const days = Math.floor(total / 8)
                          const hours = total % 8
                          return `${days > 0 ? `${days}d ` : ''}${hours}h (${total} hours)`
                        })()}
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-gray-600 mb-4">
                      How long do you estimate this task will take to complete?
                    </p>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="modal-label">
                          Days
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={eta.days}
                          onChange={(e) => setEta({ ...eta, days: e.target.value })}
                          placeholder="0"
                          className="modal-input"
                        />
                      </div>
                      <div>
                        <label className="modal-label">
                          Hours
                        </label>
                        <input
                          type="number"
                          min="0"
                          max="24"
                          step="0.5"
                          value={eta.hours}
                          onChange={(e) => setEta({ ...eta, hours: e.target.value })}
                          placeholder="0"
                          className="modal-input"
                        />
                      </div>
                    </div>
                    <p className="text-xs text-gray-500 mt-2">
                      Total: {((parseFloat(eta.days) || 0) * 8 + (parseFloat(eta.hours) || 0)).toFixed(1)} hours
                    </p>
                  </>
                )}
              </div>
              <div className="modal-footer">
                <button
                  onClick={handleAcceptWithEta}
                  disabled={respondingTo === taskForEta._id}
                  className="modal-btn modal-btn-success"
                >
                  {respondingTo === taskForEta._id ? (
                    <><FaSpinner className="animate-spin" /> Accepting...</>
                  ) : (
                    <><FaCheck /> Accept Task</>
                  )}
                </button>
              </div>
            </div>
          </div>
        </Portal>
      )}

      {/* Delete Task Confirmation Modal */}
      {showDeleteModal && taskToDelete && (
        <Portal>
          <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && (setShowDeleteModal(false), setTaskToDelete(null))}>
            <div className="modal-backdrop" />
            <div className="modal-container modal-lg">
              <div className="modal-header">
                <h3 className="modal-title">Delete Task</h3>
                <button
                  onClick={() => { setShowDeleteModal(false); setTaskToDelete(null) }}
                  className="modal-close-btn"
                >
                  <FaTimes />
                </button>
              </div>
              <div className="modal-body">
                <div className="flex items-center gap-3 mb-4 p-3 bg-red-50 rounded-lg">
                  <FaExclamationTriangle className="text-red-500 text-xl flex-shrink-0" />
                  <p className="text-red-700">
                    This action cannot be undone. The task and all its subtasks will be permanently deleted.
                  </p>
                </div>
                <p className="text-gray-600 mb-2">Are you sure you want to delete this task?</p>
                <div className="p-3 bg-gray-50 rounded-lg">
                  <p className="font-medium text-gray-800">{taskToDelete.title}</p>
                  <p className="text-sm text-gray-500 mt-1">Project: {taskToDelete.project?.name}</p>
                </div>
              </div>
              <div className="modal-footer">
                <button
                  onClick={() => { setShowDeleteModal(false); setTaskToDelete(null) }}
                  className="modal-btn modal-btn-secondary"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteTask}
                  disabled={deleting}
                  className="modal-btn modal-btn-danger"
                >
                  {deleting ? (
                    <><FaSpinner className="animate-spin" /> Deleting...</>
                  ) : (
                    <><FaTrash /> Delete Task</>
                  )}
                </button>
              </div>
            </div>
          </div>
        </Portal>
      )}
    </div>
  )
}

// Task Card Component
function TaskCard({ task, onAccept, onReject, onStatusChange, onViewProject, onDelete, respondingTo, isPendingAcceptance, isOverdue }) {
  const [showStatusMenu, setShowStatusMenu] = useState(false)
  const [showSubtasks, setShowSubtasks] = useState(false)
  const [subtasks, setSubtasks] = useState(task.subtasks || [])
  const projectColor = getProjectColor(task.project?._id)
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('')
  const [newSubtaskEta, setNewSubtaskEta] = useState({ days: '', hours: '' })
  const [addingSubtask, setAddingSubtask] = useState(false)
  const [updatingSubtaskId, setUpdatingSubtaskId] = useState(null)

  const isUpdating = respondingTo === task._id
  const isCompleted = task.status === 'completed'
  const progressPercentage = task.progressPercentage || 0

  // Sync subtasks when task changes
  useEffect(() => {
    setSubtasks(task.subtasks || [])
  }, [task.subtasks, task._id])

  // Subtask management functions
  const handleAddSubtask = async () => {
    if (!newSubtaskTitle.trim()) {
      toast.error('Subtask title is required')
      return
    }

    // Validate ETA - at least some time should be provided
    const days = parseInt(newSubtaskEta.days) || 0
    const hours = parseInt(newSubtaskEta.hours) || 0
    if (days === 0 && hours === 0) {
      toast.error('Please provide an ETA for this subtask')
      return
    }

    // Handle both populated and unpopulated project field
    const projectId = task.project?._id || task.project
    if (!projectId) {
      toast.error('Project not found')
      return
    }

    try {
      setAddingSubtask(true)
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/projects/${projectId}/tasks/${task._id}/subtasks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          title: newSubtaskTitle.trim(),
          estimatedDays: days,
          estimatedHours: hours
        })
      })

      const data = await response.json()
      if (data.success) {
        if (data.data?.subtask) {
          setSubtasks(prevSubtasks => [...(prevSubtasks || []), data.data.subtask])
        }
        setNewSubtaskTitle('')
        setNewSubtaskEta({ days: '', hours: '' })
        if (task && data.data?.progressPercentage !== undefined) {
          task.progressPercentage = data.data.progressPercentage
        }
        if (task && data.data?.estimatedHours !== undefined) {
          task.estimatedHours = data.data.estimatedHours
        }
        toast.success('Subtask added')
      } else {
        toast.error(data.message || 'Failed to add subtask')
      }
    } catch (error) {
      console.error('Add subtask error:', error)
      toast.error('Failed to add subtask')
    } finally {
      setAddingSubtask(false)
    }
  }

  const handleToggleSubtask = async (subtaskId, currentCompleted) => {
    if (!subtaskId) {
      toast.error('Subtask ID is missing')
      return
    }

    // Handle both populated and unpopulated project field
    const projectId = task.project?._id || task.project

    try {
      setUpdatingSubtaskId(subtaskId)
      const token = localStorage.getItem('token')

      // Convert subtaskId to string if it's an ObjectId
      const idToSend = typeof subtaskId === 'object' && subtaskId._id ? subtaskId._id.toString() :
        subtaskId.toString ? subtaskId.toString() : String(subtaskId)

      const response = await fetch(`/api/projects/${projectId}/tasks/${task._id}/subtasks`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          subtaskId: idToSend,
          completed: !currentCompleted
        })
      })

      const data = await response.json()
      if (data.success) {
        setSubtasks(prevSubtasks => prevSubtasks.map(st =>
          (st._id?.toString() || st._id) === (subtaskId?.toString() || subtaskId)
            ? { ...st, completed: !currentCompleted, completedAt: !currentCompleted ? new Date() : null }
            : st
        ))
        // Update task progress and status
        if (task && data.data) {
          task.progressPercentage = data.data.progressPercentage
          if (data.data.taskStatus) {
            task.status = data.data.taskStatus
          }
        }
        // Show appropriate toast message
        if (data.data?.statusChanged) {
          toast.success(data.message)
        } else {
          toast.success(!currentCompleted ? 'Subtask completed' : 'Subtask reopened')
        }
      } else {
        toast.error(data.message || 'Failed to update subtask')
      }
    } catch (error) {
      console.error('Toggle subtask error:', error)
      toast.error('Failed to update subtask')
    } finally {
      setUpdatingSubtaskId(null)
    }
  }

  const handleDeleteSubtask = async (subtaskId) => {
    if (!subtaskId) {
      toast.error('Subtask ID is missing')
      return
    }

    try {
      const token = localStorage.getItem('token')
      const idToSend = typeof subtaskId === 'object' && subtaskId._id ? subtaskId._id.toString() :
        subtaskId.toString ? subtaskId.toString() : String(subtaskId)

      // Handle both populated and unpopulated project field
      const projectId = task.project?._id || task.project

      const response = await fetch(`/api/projects/${projectId}/tasks/${task._id}/subtasks?subtaskId=${idToSend}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      const data = await response.json()
      if (data.success) {
        setSubtasks(prevSubtasks => (prevSubtasks || []).filter(st =>
          (st._id?.toString() || st._id) !== (subtaskId?.toString() || subtaskId)
        ))
        if (task && data.data) {
          task.progressPercentage = data.data.progressPercentage
        }
        toast.success('Subtask deleted')
      } else {
        toast.error(data.message || 'Failed to delete subtask')
      }
    } catch (error) {
      console.error('Delete subtask error:', error)
      toast.error('Failed to delete subtask')
    }
  }

  // Add comment to subtask
  const handleAddSubtaskComment = async (subtaskId, commentText) => {
    if (!commentText || !commentText.trim()) {
      toast.error('Comment text is required')
      return
    }

    const projectId = task.project?._id || task.project

    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/projects/${projectId}/tasks/${task._id}/subtasks/${subtaskId}/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ text: commentText.trim() })
      })

      const data = await response.json()
      if (data.success) {
        // Update subtasks with new comment
        setSubtasks(prevSubtasks => prevSubtasks.map(st => {
          if ((st._id?.toString() || st._id) === (subtaskId?.toString() || subtaskId)) {
            return {
              ...st,
              comments: [...(st.comments || []), data.data]
            }
          }
          return st
        }))
        toast.success('Comment added')
      } else {
        toast.error(data.message || 'Failed to add comment')
      }
    } catch (error) {
      console.error('Add subtask comment error:', error)
      toast.error('Failed to add comment')
    }
  }

  // Get status-based colors for card
  const getStatusBorderColor = () => {
    if (isOverdue) return 'border-red-300 bg-red-50/30'
    if (isPendingAcceptance) return 'border-yellow-300 bg-yellow-50/30'
    if (isCompleted) return 'border-green-300 bg-green-50/30'

    switch (task.status) {
      case 'todo':
        return 'border-gray-300 bg-gray-50/30'
      case 'in-progress':
        return 'border-blue-300 bg-blue-50/30'
      case 'review':
        return 'border-purple-300 bg-purple-50/30'
      case 'blocked':
        return 'border-orange-300 bg-orange-50/30'
      case 'rejected':
        return 'border-red-300 bg-red-50/30'
      default:
        return 'border-gray-200'
    }
  }

  return (
    <div className={`rounded-xl shadow-sm border-2 border-l-4 p-4 transition-all ${getStatusBorderColor()} ${projectColor.border}`}>
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <h3 className="font-medium text-gray-800">{task.title}</h3>
                <span className={`px-2 py-0.5 rounded text-xs border ${statusColors[task.status]}`}>
                  {task.status.replace('-', ' ')}
                </span>
                <span className={`px-2 py-0.5 rounded text-xs ${priorityColors[task.priority]}`}>
                  {task.priority}
                </span>
                {isPendingAcceptance && (
                  <span className="px-2 py-0.5 rounded text-xs bg-yellow-100 text-yellow-700 border border-yellow-200">
                    Pending Acceptance
                  </span>
                )}
              </div>
              {task.description && (
                <p className="text-sm text-gray-600 mb-2">{task.description}</p>
              )}
              <div className="flex items-center gap-4 text-sm text-gray-500 flex-wrap">
                <button
                  onClick={onViewProject}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded ${projectColor.badge} ${projectColor.text} hover:opacity-80`}
                >
                  <FaProjectDiagram className="text-xs" />
                  {task.project?.name}
                </button>
                {task.dueDate && (
                  <div className={`flex items-center gap-1 ${isOverdue ? 'text-red-500' : ''}`}>
                    <FaCalendarAlt className="text-xs" />
                    {new Date(task.dueDate).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric'
                    })}
                  </div>
                )}
                {task.estimatedHours && (
                  <div className="flex items-center gap-1 text-blue-600">
                    <FaClock className="text-xs" />
                    <span>ETA: {task.estimatedHours >= 8 ? `${Math.floor(task.estimatedHours / 8)}d ${task.estimatedHours % 8}h` : `${task.estimatedHours}h`}</span>
                  </div>
                )}
              </div>

              {/* Progress bar for subtasks */}
              {subtasks.length > 0 && (
                <div className="mt-3">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-gray-500">Progress</span>
                    <span className="font-medium text-gray-700">{progressPercentage}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-1.5">
                    <div
                      className={`h-1.5 rounded-full transition-all ${progressPercentage === 100 ? 'bg-green-500' :
                          progressPercentage >= 50 ? 'bg-blue-500' :
                            'bg-orange-500'
                        }`}
                      style={{ width: `${progressPercentage}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Subtasks toggle button */}
              <button
                onClick={() => setShowSubtasks(!showSubtasks)}
                className="mt-3 flex items-center gap-2 text-sm text-gray-600 hover:text-gray-800"
              >
                <FaTasks className="text-xs" />
                <span>Subtasks ({subtasks.length})</span>
                {showSubtasks ? <FaChevronUp className="text-xs" /> : <FaChevronDown className="text-xs" />}
              </button>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 ml-4">
          {isPendingAcceptance ? (
            <>
              <button
                onClick={onReject}
                disabled={isUpdating}
                className="px-3 py-1.5 border border-red-300 text-red-600 rounded-lg text-sm hover:bg-red-50 disabled:opacity-50"
              >
                {isUpdating ? <FaSpinner className="animate-spin" /> : 'Reject'}
              </button>
              <button
                onClick={onAccept}
                disabled={isUpdating}
                className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 disabled:opacity-50 flex items-center gap-1"
              >
                {isUpdating ? <FaSpinner className="animate-spin" /> : <><FaCheck /> Accept</>}
              </button>
            </>
          ) : isCompleted ? (
            /* Show completed badge instead of dropdown for completed tasks */
            <div className="flex items-center gap-2 px-3 py-1.5 bg-green-100 border border-green-300 rounded-lg">
              <FaCheckCircle className="text-green-600" />
              <span className="text-sm font-medium text-green-700">Completed</span>
            </div>
          ) : subtasks.length > 0 ? (
            /* For tasks WITH subtasks - show automatic status info */
            <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 border border-blue-200 rounded-lg">
              <FaTasks className="text-blue-600" />
              <span className="text-xs font-medium text-blue-700">
                Auto-managed ({progressPercentage}%)
              </span>
            </div>
          ) : (
            <div className="relative">
              <button
                onClick={() => setShowStatusMenu(!showStatusMenu)}
                disabled={isUpdating}
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1"
              >
                {isUpdating ? (
                  <FaSpinner className="animate-spin" />
                ) : (
                  <>
                    Update Status
                    <FaChevronDown className="text-xs" />
                  </>
                )}
              </button>

              {showStatusMenu && (
                <div className="absolute right-0 mt-1 w-40 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-10">
                  {['todo', 'in-progress', 'review', 'completed'].map(status => (
                    <button
                      key={status}
                      onClick={() => {
                        onStatusChange(task, status)
                        setShowStatusMenu(false)
                      }}
                      disabled={task.status === status}
                      className={`w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400 ${task.status === status ? 'font-medium text-gray-900' : ''
                        }`}
                    >
                      {status.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {/* Delete Button */}
          {onDelete && (
            <button
              onClick={onDelete}
              className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
              title="Delete task"
            >
              <FaTrash className="text-sm" />
            </button>
          )}
        </div>
      </div>

      {/* Subtasks Section */}
      {showSubtasks && (
        <div className="mt-4 pt-4 border-t border-gray-200">
          <div className="space-y-3">
            {subtasks.length === 0 ? (
              <p className="text-sm text-gray-500 italic">No subtasks yet. Add one below!</p>
            ) : (
              subtasks
                .sort((a, b) => a.order - b.order)
                .map((subtask) => {
                  // Color coding for comment author roles
                  const getCommentColor = (authorRole) => {
                    switch (authorRole) {
                      case 'project_head':
                        return 'bg-purple-100 border-l-4 border-purple-500 text-purple-800'
                      case 'admin':
                        return 'bg-red-50 border-l-4 border-red-500 text-red-800'
                      case 'assignee':
                        return 'bg-blue-50 border-l-4 border-blue-500 text-blue-800'
                      case 'creator':
                        return 'bg-green-50 border-l-4 border-green-500 text-green-800'
                      default:
                        return 'bg-gray-100 border-l-4 border-gray-400 text-gray-700'
                    }
                  }

                  const getRoleBadge = (authorRole) => {
                    switch (authorRole) {
                      case 'project_head':
                        return <span className="text-xs px-1 py-0.5 bg-purple-200 text-purple-700 rounded">PH</span>
                      case 'admin':
                        return <span className="text-xs px-1 py-0.5 bg-red-200 text-red-700 rounded">Admin</span>
                      case 'assignee':
                        return <span className="text-xs px-1 py-0.5 bg-blue-200 text-blue-700 rounded">You</span>
                      case 'creator':
                        return <span className="text-xs px-1 py-0.5 bg-green-200 text-green-700 rounded">Creator</span>
                      default:
                        return null
                    }
                  }

                  return (
                    <div key={subtask._id} className="bg-white rounded-lg p-3 border border-gray-200">
                      <div className="flex items-center gap-3 group">
                        <input
                          type="checkbox"
                          checked={subtask.completed}
                          onChange={() => handleToggleSubtask(subtask._id, subtask.completed)}
                          disabled={updatingSubtaskId === subtask._id || isPendingAcceptance}
                          className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500 cursor-pointer disabled:opacity-50"
                        />
                        <span
                          className={`flex-1 text-sm ${subtask.completed
                              ? 'line-through text-gray-400'
                              : 'text-gray-700'
                            }`}
                        >
                          {subtask.title}
                        </span>
                        {/* Show subtask ETA if available */}
                        {(subtask.estimatedDays > 0 || subtask.estimatedHours > 0) && (
                          <span className="text-xs text-blue-600 flex items-center gap-1">
                            <FaClock className="text-xs" />
                            {subtask.estimatedDays > 0 && `${subtask.estimatedDays}d`}
                            {subtask.estimatedDays > 0 && subtask.estimatedHours > 0 && ' '}
                            {subtask.estimatedHours > 0 && `${subtask.estimatedHours}h`}
                          </span>
                        )}
                        {!isPendingAcceptance && (
                          <button
                            onClick={() => handleDeleteSubtask(subtask._id)}
                            className="opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-700 transition-opacity"
                            title="Delete subtask"
                          >
                            <FaTrash className="text-xs" />
                          </button>
                        )}
                      </div>

                      {/* Subtask Comments */}
                      {subtask.comments && subtask.comments.length > 0 && (
                        <div className="mt-2 space-y-1.5 pl-7">
                          {subtask.comments.map((comment) => (
                            <div key={comment._id} className={`p-2 rounded text-xs ${getCommentColor(comment.authorRole)}`}>
                              <div className="flex items-center gap-1.5 mb-0.5">
                                <span className="font-medium">
                                  {comment.author?.firstName || 'User'}
                                </span>
                                {getRoleBadge(comment.authorRole)}
                                <span className="opacity-60">
                                  {new Date(comment.createdAt).toLocaleDateString()}
                                </span>
                              </div>
                              <p>{comment.text}</p>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Add Comment Button */}
                      {!isPendingAcceptance && (
                        <div className="mt-2 pl-7">
                          <button
                            onClick={() => {
                              const comment = prompt('Add a comment to this subtask:')
                              if (comment && comment.trim()) {
                                handleAddSubtaskComment(subtask._id, comment.trim())
                              }
                            }}
                            className="text-xs text-gray-500 hover:text-primary-600 flex items-center gap-1"
                          >
                            <FaComment className="w-3 h-3" />
                            Add Comment
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })
            )}
          </div>

          {/* Add new subtask */}
          {!isPendingAcceptance && !isCompleted && (
            <div className="mt-3 space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newSubtaskTitle}
                  onChange={(e) => setNewSubtaskTitle(e.target.value)}
                  placeholder="Add a subtask..."
                  className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  disabled={addingSubtask}
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">ETA:</span>
                <input
                  type="number"
                  min="0"
                  value={newSubtaskEta.days}
                  onChange={(e) => setNewSubtaskEta(prev => ({ ...prev, days: e.target.value }))}
                  placeholder="Days"
                  className="w-16 px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                  disabled={addingSubtask}
                />
                <span className="text-xs text-gray-400">d</span>
                <input
                  type="number"
                  min="0"
                  max="23"
                  value={newSubtaskEta.hours}
                  onChange={(e) => setNewSubtaskEta(prev => ({ ...prev, hours: e.target.value }))}
                  placeholder="Hours"
                  className="w-16 px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                  disabled={addingSubtask}
                />
                <span className="text-xs text-gray-400">h</span>
                <button
                  onClick={handleAddSubtask}
                  disabled={addingSubtask || !newSubtaskTitle.trim()}
                  className="ml-auto px-4 py-1.5 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {addingSubtask ? (
                    <FaSpinner className="animate-spin" />
                  ) : (
                    <><FaPlus className="text-xs" /> Add</>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
