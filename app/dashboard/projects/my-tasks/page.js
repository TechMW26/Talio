'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import toast from '@/utils/toast'
import { Card, CardBody, Button, Chip, Skeleton, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Input, Textarea, Progress, Spinner, Select, SelectItem } from '@heroui/react'
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
  HiOutlineChatBubbleLeftRight,
  HiOutlineViewColumns,
  HiOutlineQueueList
} from 'react-icons/hi2'
import {
  FaTasks, FaCalendarAlt, FaFilter, FaSearch, FaProjectDiagram,
  FaCheck, FaPlay, FaEye, FaClock, FaExclamationTriangle,
  FaChevronDown, FaCheckCircle, FaTimes, FaPlus,
  FaTrash, FaChevronUp, FaComment
} from 'react-icons/fa'
import { playNotificationSound, NotificationSoundTypes } from '@/lib/notificationSounds'
import Portal from '@/components/ui/Portal'
import KanbanBoard from '@/components/tasks/KanbanBoard'

const statusColors = {
  'todo': 'default',
  'in-progress': 'primary',
  'review': 'secondary',
  'completed': 'success',
  'completed-pending-approval': 'warning',
  'rejected': 'danger',
  'blocked': 'warning'
}

const priorityColors = {
  low: 'default',
  medium: 'primary',
  high: 'warning',
  critical: 'danger'
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

  const formatFileSize = useCallback((bytes = 0) => {
    if (!bytes || Number.isNaN(bytes)) return '0 B'
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), sizes.length - 1)
    return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${sizes[i]}`
  }, [])

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
  const [viewMode, setViewMode] = useState('kanban') // 'list' or 'kanban' - kanban is default
  const [modalUpdatingSubtask, setModalUpdatingSubtask] = useState(null) // For modal subtask toggle loading
  const [modalUpdatingStatus, setModalUpdatingStatus] = useState(false) // For modal status change loading
  const [showModalStatusDropdown, setShowModalStatusDropdown] = useState(false) // For status dropdown visibility

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

  const handleUpdateStatus = async (task, newStatus, skipLocalUpdate = false) => {
    // Immediately update local state for instant UI feedback
    if (!skipLocalUpdate) {
      setTasks(prevTasks => prevTasks.map(t => 
        t._id === task._id ? { ...t, status: newStatus } : t
      ))
    }
    
    try {
      setRespondingTo(task._id)
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/projects/${task.project._id || task.project}/tasks/${task._id}`, {
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
        // Silent refresh to sync with server
        fetchTasks(true)
      } else {
        playNotificationSound(NotificationSoundTypes.WARNING)
        toast.error(data.message)
        // Revert local state on error
        fetchTasks(true)
      }
    } catch (error) {
      playNotificationSound(NotificationSoundTypes.WARNING)
      toast.error('Failed to update task')
      // Revert local state on error
      fetchTasks(true)
    } finally {
      setRespondingTo(null)
    }
  }

  // Handler for Kanban drag-drop status changes
  const handleKanbanStatusChange = async (task, newStatus) => {
    // Don't allow status change for tasks with subtasks (they are auto-managed)
    if (task.subtasks && task.subtasks.length > 0) {
      toast.error('Tasks with subtasks are auto-managed. Update subtasks to change status.')
      return
    }
    
    // Don't allow status change for tasks pending acceptance
    const isPendingAcceptance = task.assignmentStatus === 'pending' || 
      task.assignees?.some(a => a.assignmentStatus === 'pending')
    const hasAcceptedAssignee = task.assignees?.some(a => a.assignmentStatus === 'accepted')
    if (isPendingAcceptance && !hasAcceptedAssignee) {
      toast.error('Task must be accepted before changing status.')
      return
    }
    
    // Use the existing handleUpdateStatus function
    await handleUpdateStatus(task, newStatus)
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

  // Get current employee ID for multi-assignee subtask acceptance
  const currentEmployeeId = user?.employeeId?._id || user?.employeeId

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
          <Spinner size="lg" />
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="page-container">
        <div className="flex items-center justify-center h-64">
          <Spinner size="lg" />
        </div>
      </div>
    )
  }

  return (
    <div className="page-container">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-default-800 flex items-center gap-2">
            <HiOutlineClipboardDocumentList className="w-7 h-7 text-indigo-600" />
            My Tasks
          </h1>
          <p className="text-default-600 mt-1">
            View and manage your tasks across all projects
          </p>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        <Card shadow="sm">
          <CardBody className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-default-100 rounded-lg">
                <HiOutlineListBullet className="w-5 h-5 text-default-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-default-800">{stats.total}</p>
                <p className="text-sm text-default-500">Total</p>
              </div>
            </div>
          </CardBody>
        </Card>

        <Card shadow="sm">
          <CardBody className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-warning-100 rounded-lg">
                <HiOutlineClock className="w-5 h-5 text-warning" />
              </div>
              <div>
                <p className="text-2xl font-bold text-default-800">{stats.pendingAcceptance}</p>
                <p className="text-sm text-default-500">Pending Accept</p>
              </div>
            </div>
          </CardBody>
        </Card>

        <Card shadow="sm">
          <CardBody className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-default-100 rounded-lg">
                <HiOutlineClipboardDocumentList className="w-5 h-5 text-default-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-default-800">{stats.todo}</p>
                <p className="text-sm text-default-500">To Do</p>
              </div>
            </div>
          </CardBody>
        </Card>

        <Card shadow="sm">
          <CardBody className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary-100 rounded-lg">
                <HiOutlinePlayCircle className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold text-default-800">{stats.inProgress}</p>
                <p className="text-sm text-default-500">In Progress</p>
              </div>
            </div>
          </CardBody>
        </Card>

        <Card shadow="sm">
          <CardBody className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-success-100 rounded-lg">
                <HiOutlineCheckCircle className="w-5 h-5 text-success" />
              </div>
              <div>
                <p className="text-2xl font-bold text-default-800">{stats.completed}</p>
                <p className="text-sm text-default-500">Completed</p>
              </div>
            </div>
          </CardBody>
        </Card>

        <Card shadow="sm">
          <CardBody className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-danger-100 rounded-lg">
                <HiOutlineExclamationTriangle className="w-5 h-5 text-danger" />
              </div>
              <div>
                <p className="text-2xl font-bold text-default-800">{stats.overdue}</p>
                <p className="text-sm text-default-500">Overdue</p>
              </div>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Filters and Search */}
      <Card shadow="sm" className="mb-6">
        <CardBody className="p-4">
          {/* Search Row */}
          <div className="relative mb-4">
            <HiOutlineMagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-default-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search tasks..."
              className="w-full pl-10 pr-4 py-2.5 border border-default-300 rounded-lg bg-content1 text-default-800 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>

          {/* Filters Row */}
          <div className="flex items-center gap-3 flex-wrap">
            <Select
              selectedKeys={[filters.project]}
              onSelectionChange={(keys) => setFilters(prev => ({ ...prev, project: Array.from(keys)[0] }))}
              className="w-[160px]"
              size="sm"
              aria-label="Filter by Project"
            >
              <SelectItem key="all">All Projects</SelectItem>
              {projects.map(project => (
                <SelectItem key={project._id}>
                  {project.name}
                </SelectItem>
              ))}
            </Select>

            <Select
              selectedKeys={[filters.status]}
              onSelectionChange={(keys) => setFilters(prev => ({ ...prev, status: Array.from(keys)[0] }))}
              className="w-[140px]"
              size="sm"
              aria-label="Filter by Status"
            >
              <SelectItem key="all">All Statuses</SelectItem>
              <SelectItem key="todo">To Do</SelectItem>
              <SelectItem key="in-progress">In Progress</SelectItem>
              <SelectItem key="review">In Review</SelectItem>
              <SelectItem key="completed">Completed</SelectItem>
              <SelectItem key="blocked">Blocked</SelectItem>
            </Select>

            <Select
              selectedKeys={[filters.priority]}
              onSelectionChange={(keys) => setFilters(prev => ({ ...prev, priority: Array.from(keys)[0] }))}
              className="w-[140px]"
              size="sm"
              aria-label="Filter by Priority"
            >
              <SelectItem key="all">All Priorities</SelectItem>
              <SelectItem key="low">Low</SelectItem>
              <SelectItem key="medium">Medium</SelectItem>
              <SelectItem key="high">High</SelectItem>
              <SelectItem key="critical">Critical</SelectItem>
            </Select>

            <Select
              selectedKeys={[filters.period]}
              onSelectionChange={(keys) => setFilters(prev => ({ ...prev, period: Array.from(keys)[0] }))}
              className="w-[130px]"
              size="sm"
              aria-label="Filter by Period"
            >
              <SelectItem key="all">All Time</SelectItem>
              <SelectItem key="today">Today</SelectItem>
              <SelectItem key="week">This Week</SelectItem>
              <SelectItem key="month">This Month</SelectItem>
              <SelectItem key="overdue">Overdue</SelectItem>
            </Select>

            {/* Spacer to push view toggle to the right */}
            <div className="flex-1 hidden md:block" />

            {/* View Toggle */}
            <div className="flex border border-default-300 rounded-lg overflow-hidden">
              <button
                onClick={() => setViewMode('list')}
                className={`px-3 py-2 flex items-center gap-1.5 transition-colors ${
                  viewMode === 'list'
                    ? 'bg-primary text-white'
                    : 'bg-content1 text-default-600 hover:bg-default-100'
                }`}
                title="List View"
              >
                <HiOutlineQueueList className="w-5 h-5" />
              </button>
              <button
                onClick={() => setViewMode('kanban')}
                className={`px-3 py-2 flex items-center gap-1.5 transition-colors border-l border-default-300 ${
                  viewMode === 'kanban'
                    ? 'bg-primary text-white'
                    : 'bg-content1 text-default-600 hover:bg-default-100'
                }`}
                title="Kanban View"
              >
                <HiOutlineViewColumns className="w-5 h-5" />
              </button>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Kanban View */}
      {viewMode === 'kanban' && (
        <div className="mb-6">
          <KanbanBoard
            tasks={filteredTasks.filter(t => t.assignmentStatus !== 'pending')}
            onTaskClick={(task) => setSelectedTask(task)}
            onStatusChange={handleKanbanStatusChange}
            showProject={true}
            enableDragDrop={true}
            onProjectClick={(projectId) => router.push(`/dashboard/projects/${projectId}`)}
          />
          
          {/* Show pending acceptance tasks above kanban for quick action */}
          {pendingAcceptance.length > 0 && (
            <div className="mt-6 p-4 bg-warning-50 border border-warning-200 rounded-lg">
              <h3 className="text-sm font-medium text-warning-700 mb-2 flex items-center gap-2">
                <HiOutlineClock className="w-4 h-4" />
                {pendingAcceptance.length} task(s) pending your acceptance
              </h3>
              <button
                onClick={() => setViewMode('list')}
                className="text-sm text-warning-600 hover:text-warning-800 underline"
              >
                Switch to list view to accept
              </button>
            </div>
          )}
        </div>
      )}

      {/* List View */}
      {viewMode === 'list' && (
        <>
          {/* Pending Acceptance Tasks */}
          {pendingAcceptance.length > 0 && (
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-default-800 mb-3 flex items-center gap-2">
            <HiOutlineClock className="w-5 h-5 text-warning" />
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
                currentEmployeeId={currentEmployeeId}
              />
            ))}
          </div>
        </div>
      )}

      {/* Overdue Tasks */}
      {overdueTasks.length > 0 && (
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-default-800 mb-3 flex items-center gap-2">
            <HiOutlineExclamationTriangle className="w-5 h-5 text-danger" />
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
                currentEmployeeId={currentEmployeeId}
              />
            ))}
          </div>
        </div>
      )}

      {/* Today's Tasks */}
      {todayTasks.length > 0 && (
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-default-800 mb-3 flex items-center gap-2">
            <HiOutlineClock className="w-5 h-5 text-primary" />
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
                currentEmployeeId={currentEmployeeId}
              />
            ))}
          </div>
        </div>
      )}

      {/* Upcoming Tasks */}
      {upcomingTasks.filter(t => t.assignmentStatus !== 'pending').length > 0 && (
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-default-800 mb-3">
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
                currentEmployeeId={currentEmployeeId}
              />
            ))}
          </div>
        </div>
      )}

      {filteredTasks.length === 0 && (
        <Card shadow="sm">
          <CardBody className="text-center py-12">
            <HiOutlineClipboardDocumentList className="w-16 h-16 mx-auto text-default-300 mb-4" />
            <h3 className="text-lg font-medium text-default-800 mb-2">
              No tasks found
            </h3>
            <p className="text-default-500">
              Tasks assigned to you will appear here
            </p>
          </CardBody>
        </Card>
      )}
        </>
      )}

      {/* Reject Modal */}
      {/* Reject Modal */}
      <Modal isOpen={showRejectModal && !!selectedTask} onOpenChange={(open) => { if (!open) { setShowRejectModal(false); setSelectedTask(null); setRejectRemark(''); } }} size="lg">
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>Reject Assignment</ModalHeader>
              <ModalBody>
                <p className="text-default-600 mb-4">
                  Please provide a reason for rejecting this task assignment.
                </p>
                <Textarea
                  value={rejectRemark}
                  onChange={(e) => setRejectRemark(e.target.value)}
                  placeholder="Reason for rejection..."
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
                <Button
                  color="danger"
                  onPress={() => handleRespondToAssignment(selectedTask, 'reject')}
                  isLoading={respondingTo === selectedTask?._id}
                >
                  {respondingTo === selectedTask?._id ? 'Rejecting...' : 'Reject'}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      {/* ETA Modal */}
      <Modal isOpen={showEtaModal && !!taskForEta} onOpenChange={(open) => { if (!open) { setShowEtaModal(false); setTaskForEta(null); setEta({ days: '', hours: '' }); setSubtaskEtas({}); } }} size="2xl">
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>Set Estimated Time</ModalHeader>
              <ModalBody>
                <div className="mb-4">
                  <p className="font-medium text-default-800 mb-1">{taskForEta?.title}</p>
                  {taskForEta?.description && (
                    <p className="text-sm text-default-500">{taskForEta.description}</p>
                  )}
                </div>

                {taskForEta?.subtasks && taskForEta.subtasks.length > 0 ? (
                  <>
                    <p className="text-default-600 mb-4">
                      Please provide an ETA for each subtask. The total task time will be calculated automatically.
                    </p>
                    <div className="space-y-4">
                      {taskForEta.subtasks.map((st, index) => (
                        <div key={st._id} className="p-3 bg-default-50 rounded-lg">
                          <p className="text-sm font-medium text-default-700 mb-2">
                            {index + 1}. {st.title}
                          </p>
                          <div className="flex items-center gap-3">
                            <div className="flex items-center gap-1">
                              <Input
                                type="number"
                                min="0"
                                value={subtaskEtas[st._id]?.days || ''}
                                onChange={(e) => setSubtaskEtas(prev => ({
                                  ...prev,
                                  [st._id]: { ...prev[st._id], days: e.target.value }
                                }))}
                                placeholder="0"
                                className="w-20"
                                size="sm"
                              />
                              <span className="text-xs text-default-500">days</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <Input
                                type="number"
                                min="0"
                                max="23"
                                value={subtaskEtas[st._id]?.hours || ''}
                                onChange={(e) => setSubtaskEtas(prev => ({
                                  ...prev,
                                  [st._id]: { ...prev[st._id], hours: e.target.value }
                                }))}
                                placeholder="0"
                                className="w-20"
                                size="sm"
                              />
                              <span className="text-xs text-default-500">hours</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-4 p-3 bg-primary-50 rounded-lg">
                      <p className="text-sm text-primary-700 font-medium">
                        Total Estimated Time: {(() => {
                          let total = 0
                          taskForEta?.subtasks?.forEach(st => {
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
                    <p className="text-default-600 mb-4">
                      How long do you estimate this task will take to complete?
                    </p>
                    <div className="grid grid-cols-2 gap-4">
                      <Input
                        type="number"
                        min="0"
                        step="1"
                        value={eta.days}
                        onChange={(e) => setEta({ ...eta, days: e.target.value })}
                        placeholder="0"
                        label="Days"
                      />
                      <Input
                        type="number"
                        min="0"
                        max="24"
                        step="0.5"
                        value={eta.hours}
                        onChange={(e) => setEta({ ...eta, hours: e.target.value })}
                        placeholder="0"
                        label="Hours"
                      />
                    </div>
                    <p className="text-xs text-default-500 mt-2">
                      Total: {((parseFloat(eta.days) || 0) * 8 + (parseFloat(eta.hours) || 0)).toFixed(1)} hours
                    </p>
                  </>
                )}
              </ModalBody>
              <ModalFooter>
                <Button
                  color="success"
                  onPress={handleAcceptWithEta}
                  isLoading={respondingTo === taskForEta?._id}
                  startContent={respondingTo !== taskForEta?._id && <FaCheck />}
                >
                  {respondingTo === taskForEta?._id ? 'Accepting...' : 'Accept Task'}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      {/* Delete Task Confirmation Modal */}
      <Modal isOpen={showDeleteModal && !!taskToDelete} onOpenChange={(open) => { if (!open) { setShowDeleteModal(false); setTaskToDelete(null); } }} size="lg">
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>Delete Task</ModalHeader>
              <ModalBody>
                <div className="flex items-center gap-3 mb-4 p-3 bg-danger-50 rounded-lg">
                  <FaExclamationTriangle className="text-danger text-xl flex-shrink-0" />
                  <p className="text-danger-700">
                    This action cannot be undone. The task and all its subtasks will be permanently deleted.
                  </p>
                </div>
                <p className="text-default-600 mb-2">Are you sure you want to delete this task?</p>
                <div className="p-3 bg-default-50 rounded-lg">
                  <p className="font-medium text-default-800">{taskToDelete?.title}</p>
                  <p className="text-sm text-default-500 mt-1">Project: {taskToDelete?.project?.name}</p>
                </div>
              </ModalBody>
              <ModalFooter>
                <Button
                  variant="light"
                  onPress={onClose}
                >
                  Cancel
                </Button>
                <Button
                  color="danger"
                  onPress={handleDeleteTask}
                  isLoading={deleting}
                  startContent={!deleting && <FaTrash />}
                >
                  {deleting ? 'Deleting...' : 'Delete Task'}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      {/* Task Detail Modal - Opens when clicking task in Kanban view */}
      {selectedTask && !showRejectModal && (
        <Portal>
          <div className="fixed inset-0 modal-overlay flex items-center justify-center z-[9999] p-4" onClick={(e) => e.target === e.currentTarget && setSelectedTask(null)}>
            <div className="bg-content1 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col animate-modal-enter">
              <div className="px-6 py-4 bg-default-50 flex items-center justify-between flex-shrink-0">
                <h3 className="text-lg font-semibold text-default-800">Task Details</h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => router.push(`/dashboard/projects/${selectedTask.project?._id || selectedTask.project}`)}
                    className="btn-secondary flex items-center gap-2 text-sm py-1.5 px-3"
                  >
                    <FaProjectDiagram className="w-3 h-3" />
                    View Project
                  </button>
                  <button
                    onClick={() => setSelectedTask(null)}
                    className="p-2 hover:bg-default-100 rounded-lg text-default-500"
                  >
                    <FaTimes />
                  </button>
                </div>
              </div>
              
              <div className="p-6 overflow-y-auto flex-1">
                {/* Task Title & Status */}
                <div className="flex items-start justify-between mb-4">
                  <h2 className="text-xl font-semibold text-default-800">{selectedTask.title}</h2>
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${statusColors[selectedTask.status]}`}>
                    {selectedTask.status.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                  </span>
                </div>

                {/* Project Badge */}
                {selectedTask.project && (
                  <div className="mb-4">
                    <span className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm ${getProjectColor(selectedTask.project?._id).badge} ${getProjectColor(selectedTask.project?._id).text}`}>
                      <FaProjectDiagram className="w-3 h-3" />
                      {selectedTask.project.name || 'Project'}
                    </span>
                  </div>
                )}

                {/* Description */}
                {selectedTask.description && (
                  <div className="mb-6">
                    <h4 className="text-sm font-medium text-default-500 mb-2">Description</h4>
                    <p className="text-default-700 whitespace-pre-wrap">{selectedTask.description}</p>
                  </div>
                )}

                {/* Attachments */}
                {selectedTask.attachments && selectedTask.attachments.length > 0 && (
                  <div className="mb-6">
                    <h4 className="text-sm font-medium text-default-500 mb-2">Attachments</h4>
                    <div className="space-y-2">
                      {selectedTask.attachments.map((file, index) => (
                        <a
                          key={`${file.url}-${index}`}
                          href={file.url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center justify-between p-3 bg-default-50 rounded-lg border border-default-200 hover:bg-default-100"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-default-800 truncate">{file.name || 'Attachment'}</p>
                            <p className="text-xs text-default-500">{formatFileSize(file.size)}</p>
                          </div>
                          <span className="text-xs text-primary">Open</span>
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {/* Details Grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                  <div className="bg-default-50 p-3 rounded-lg">
                    <p className="text-xs text-default-500 mb-1">Priority</p>
                    <span className={`px-2 py-1 rounded text-sm font-medium ${priorityColors[selectedTask.priority]}`}>
                      {selectedTask.priority.charAt(0).toUpperCase() + selectedTask.priority.slice(1)}
                    </span>
                  </div>
                  <div className="bg-default-50 p-3 rounded-lg">
                    <p className="text-xs text-default-500 mb-1">Due Date</p>
                    <p className={`font-medium ${
                      selectedTask.dueDate && new Date(selectedTask.dueDate) < new Date() && selectedTask.status !== 'completed'
                        ? 'text-danger' : 'text-default-800'
                    }`}>
                      {selectedTask.dueDate ? new Date(selectedTask.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Not set'}
                    </p>
                  </div>
                  {selectedTask.estimatedHours && (
                    <div className="bg-default-50 p-3 rounded-lg">
                      <p className="text-xs text-default-500 mb-1">Estimated Time</p>
                      <p className="font-medium text-default-800">
                        {selectedTask.estimatedHours >= 8 
                          ? `${Math.floor(selectedTask.estimatedHours / 8)}d ${selectedTask.estimatedHours % 8}h`
                          : `${selectedTask.estimatedHours}h`}
                      </p>
                    </div>
                  )}
                  <div className="bg-default-50 p-3 rounded-lg">
                    <p className="text-xs text-default-500 mb-1">Progress</p>
                    <p className="font-medium text-default-800">{selectedTask.progressPercentage || 0}%</p>
                  </div>
                </div>

                {/* Progress Bar */}
                {selectedTask.subtasks && selectedTask.subtasks.length > 0 && (
                  <div className="mb-6">
                    <div className="flex items-center justify-start mb-2">
                      <h4 className="text-sm font-medium text-default-500">Progress</h4>
                      <span className="text-sm text-default-600">{selectedTask.progressPercentage || 0}%</span>
                    </div>
                    <div className="w-full bg-default-200 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full transition-all ${
                          selectedTask.progressPercentage === 100 ? 'bg-success' :
                          selectedTask.progressPercentage >= 50 ? 'bg-primary' :
                          'bg-warning'
                        }`}
                        style={{ width: `${selectedTask.progressPercentage || 0}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Subtasks - Interactive */}
                {selectedTask.subtasks && selectedTask.subtasks.length > 0 && (
                  <div className="mb-6">
                    <h4 className="text-sm font-medium text-default-500 mb-3">
                      Subtasks ({selectedTask.subtasks.filter(st => st.completed).length}/{selectedTask.subtasks.length})
                    </h4>
                    <div className="space-y-2 max-h-60 overflow-y-auto">
                      {selectedTask.subtasks.map((subtask, idx) => {
                        const isTaskAccepted = selectedTask.assignmentStatus === 'accepted' || 
                          selectedTask.assignees?.some(a => a.assignmentStatus === 'accepted')
                        // Allow toggle if: task is accepted AND (subtask is completed OR not pending acceptance)
                        const canToggle = isTaskAccepted && (subtask.completed || !subtask.pendingAcceptance)
                        
                        return (
                          <div key={subtask._id || idx} className={`flex items-center gap-3 p-3 rounded-lg transition-all ${
                            subtask.completed ? 'bg-success-50' : 
                            subtask.pendingAcceptance ? 'bg-warning-50' : 'bg-default-50'
                          } ${canToggle ? 'hover:bg-default-100 cursor-pointer' : ''}`}
                          onClick={async () => {
                            if (!canToggle || modalUpdatingSubtask) return
                            const subtaskId = subtask._id
                            const projectId = selectedTask.project?._id || selectedTask.project
                            
                            try {
                              setModalUpdatingSubtask(subtaskId)
                              const token = localStorage.getItem('token')
                              const response = await fetch(`/api/projects/${projectId}/tasks/${selectedTask._id}/subtasks`, {
                                method: 'PUT',
                                headers: {
                                  'Content-Type': 'application/json',
                                  'Authorization': `Bearer ${token}`
                                },
                                body: JSON.stringify({
                                  subtaskId: subtaskId.toString(),
                                  completed: !subtask.completed
                                })
                              })
                              const data = await response.json()
                              if (data.success) {
                                // Update selectedTask subtasks
                                setSelectedTask(prev => ({
                                  ...prev,
                                  subtasks: prev.subtasks.map(st => 
                                    st._id === subtaskId 
                                      ? { ...st, completed: data.data?.subtask?.completed ?? !subtask.completed, pendingAcceptance: data.data?.subtask?.pendingAcceptance || false }
                                      : st
                                  ),
                                  progressPercentage: data.data?.progressPercentage || prev.progressPercentage,
                                  status: data.data?.taskStatus || prev.status
                                }))
                                // Also refresh main task list
                                fetchTasks(true)
                                toast.success(data.message || 'Subtask updated')
                              } else {
                                toast.error(data.message || 'Failed to update subtask')
                              }
                            } catch (error) {
                              toast.error('Failed to update subtask')
                            } finally {
                              setModalUpdatingSubtask(null)
                            }
                          }}
                          >
                            <div className={`w-5 h-5 rounded-full flex items-center justify-center transition-all ${
                              modalUpdatingSubtask === subtask._id ? 'bg-primary animate-pulse' :
                              subtask.completed ? 'bg-success text-white' : 
                              subtask.pendingAcceptance ? 'bg-warning text-white' : 
                              canToggle ? 'bg-default-300 hover:bg-default-400' : 'bg-default-200'
                            }`}>
                              {modalUpdatingSubtask === subtask._id ? (
                                <Spinner size="sm" color="white" />
                              ) : subtask.completed ? (
                                <FaCheck className="w-3 h-3" />
                              ) : subtask.pendingAcceptance ? (
                                <FaClock className="w-3 h-3" />
                              ) : null}
                            </div>
                            <div className="flex-1">
                              <p className={`text-sm ${subtask.completed ? 'text-default-500 line-through' : 'text-default-800'}`}>
                                {subtask.title}
                              </p>
                              {subtask.estimatedHours && (
                                <p className="text-xs text-default-400 mt-0.5">
                                  Est: {subtask.estimatedHours >= 8 ? `${Math.floor(subtask.estimatedHours / 8)}d ${subtask.estimatedHours % 8}h` : `${subtask.estimatedHours}h`}
                                </p>
                              )}
                            </div>
                            {subtask.pendingAcceptance && (
                              <span className="text-xs bg-warning-100 text-warning-700 px-2 py-0.5 rounded">Pending Review</span>
                            )}
                            {!isTaskAccepted && (
                              <span className="text-xs bg-default-100 text-default-500 px-2 py-0.5 rounded">Accept task first</span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Assignees */}
                {selectedTask.assignees && selectedTask.assignees.length > 0 && (
                  <div className="mb-6">
                    <h4 className="text-sm font-medium text-default-500 mb-3">Assignees</h4>
                    <div className="flex flex-wrap gap-2">
                      {selectedTask.assignees.map((assignee, idx) => (
                        <div key={assignee._id || idx} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${
                          assignee.assignmentStatus === 'accepted' ? 'bg-success-50 text-success-700' :
                          assignee.assignmentStatus === 'rejected' ? 'bg-danger-50 text-danger-700' :
                          'bg-warning-50 text-warning-700'
                        }`}>
                          <div className="w-6 h-6 rounded-full bg-primary-500 text-white flex items-center justify-center text-xs">
                            {assignee.user?.profilePicture ? (
                              <img src={assignee.user.profilePicture} alt="" className="w-full h-full rounded-full object-cover" />
                            ) : (
                              assignee.user?.firstName?.[0] || '?'
                            )}
                          </div>
                          <span className="text-sm">{assignee.user?.firstName} {assignee.user?.lastName}</span>
                          <span className="text-xs opacity-75">({assignee.assignmentStatus})</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Status Update - For tasks WITHOUT subtasks */}
                {(!selectedTask.subtasks || selectedTask.subtasks.length === 0) && (
                  (selectedTask.assignmentStatus === 'accepted' || selectedTask.assignees?.some(a => a.assignmentStatus === 'accepted')) && (
                    <div className="mb-6">
                      <h4 className="text-sm font-medium text-gray-500 mb-3">Update Status</h4>
                      <div className="relative">
                        <button
                          onClick={() => setShowModalStatusDropdown(!showModalStatusDropdown)}
                          disabled={modalUpdatingStatus}
                          className={`w-full flex items-center justify-between px-4 py-3 rounded-lg border transition-all ${
                            modalUpdatingStatus ? 'bg-gray-100 cursor-not-allowed' : 'bg-white hover:bg-gray-50 cursor-pointer'
                          }`}
                        >
                          <span className={`flex items-center gap-2 font-medium ${statusColors[selectedTask.status]?.split(' ')[1] || 'text-gray-700'}`}>
                            {modalUpdatingStatus ? (
                              <Loader size="xs" />
                            ) : (
                              selectedTask.status === 'completed' ? <FaCheckCircle /> :
                              selectedTask.status === 'in-progress' ? <FaPlay /> :
                              selectedTask.status === 'review' ? <FaEye /> :
                              selectedTask.status === 'blocked' ? <FaExclamationTriangle /> :
                              <FaClock />
                            )}
                            {selectedTask.status.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                          </span>
                          <FaChevronDown className={`transition-transform ${showModalStatusDropdown ? 'rotate-180' : ''}`} />
                        </button>
                        
                        {showModalStatusDropdown && (
                          <div className="absolute top-full left-0 right-0 mt-1 bg-white border rounded-lg shadow-lg z-10 overflow-hidden">
                            {['todo', 'in-progress', 'review', 'completed', 'blocked'].map(status => (
                              <button
                                key={status}
                                onClick={async () => {
                                  if (status === selectedTask.status) {
                                    setShowModalStatusDropdown(false)
                                    return
                                  }
                                  try {
                                    setModalUpdatingStatus(true)
                                    setShowModalStatusDropdown(false)
                                    const token = localStorage.getItem('token')
                                    const projectId = selectedTask.project?._id || selectedTask.project
                                    const response = await fetch(`/api/projects/${projectId}/tasks/${selectedTask._id}`, {
                                      method: 'PUT',
                                      headers: {
                                        'Content-Type': 'application/json',
                                        'Authorization': `Bearer ${token}`
                                      },
                                      body: JSON.stringify({ status })
                                    })
                                    const data = await response.json()
                                    if (data.success) {
                                      setSelectedTask(prev => ({ ...prev, status }))
                                      fetchTasks(true)
                                      playNotificationSound(status === 'completed' ? NotificationSoundTypes.SUCCESS : NotificationSoundTypes.UPDATE)
                                      toast.success('Status updated')
                                    } else {
                                      toast.error(data.message || 'Failed to update status')
                                    }
                                  } catch (error) {
                                    toast.error('Failed to update status')
                                  } finally {
                                    setModalUpdatingStatus(false)
                                  }
                                }}
                                className={`w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-gray-50 transition-colors ${
                                  status === selectedTask.status ? 'bg-blue-50 text-blue-700' : 'text-gray-700'
                                }`}
                              >
                                {status === 'completed' ? <FaCheckCircle className="text-green-500" /> :
                                 status === 'in-progress' ? <FaPlay className="text-blue-500" /> :
                                 status === 'review' ? <FaEye className="text-purple-500" /> :
                                 status === 'blocked' ? <FaExclamationTriangle className="text-red-500" /> :
                                 <FaClock className="text-gray-400" />}
                                {status.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                                {status === selectedTask.status && <FaCheck className="ml-auto text-blue-500" />}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                )}

                {/* Pending Acceptance Message */}
                {!(selectedTask.assignmentStatus === 'accepted' || selectedTask.assignees?.some(a => a.assignmentStatus === 'accepted')) && (
                  <div className="flex flex-wrap gap-3 pt-4 border-t">
                    <p className="w-full text-sm text-amber-600 mb-2 flex items-center gap-2">
                      <HiOutlineClock className="w-4 h-4" />
                      This task is pending your acceptance.
                    </p>
                    <Button
                      onPress={() => {
                        setSelectedTask(null)
                        setViewMode('list')
                      }}
                      color="primary"
                      startContent={<HiOutlineQueueList className="w-4 h-4" />}
                    >
                      Switch to List View to Accept/Reject
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </Portal>
      )}
    </div>
  )
}
// Task Card Component
function TaskCard({ task, onAccept, onReject, onStatusChange, onViewProject, onDelete, respondingTo, isPendingAcceptance, isOverdue, currentEmployeeId }) {
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
  const isMultiAssignee = task.isMultiAssignee || (task.assignees && task.assignees.length > 1)

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
    
    // Check if task is pending acceptance - don't allow subtask marking
    if (task) {
      const isPendingAcceptance = task.assignmentStatus === 'pending' || 
        task.assignees?.some(a => a.assignmentStatus === 'pending')
      const hasAcceptedAssignee = task.assignees?.some(a => a.assignmentStatus === 'accepted')
      if (isPendingAcceptance && !hasAcceptedAssignee) {
        toast.error('Task must be accepted before marking subtasks.')
        return
      }
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
        // Update subtask with new state including pendingAcceptance
        setSubtasks(prevSubtasks => prevSubtasks.map(st =>
          (st._id?.toString() || st._id) === (subtaskId?.toString() || subtaskId)
            ? { 
                ...st, 
                completed: data.data?.subtask?.completed ?? !currentCompleted, 
                completedAt: !currentCompleted ? new Date() : null,
                pendingAcceptance: data.data?.subtask?.pendingAcceptance || false,
                acceptedBy: data.data?.subtask?.acceptedBy || [],
                completedBy: data.data?.subtask?.completedBy
              }
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
        toast.success(data.message)
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

  // Accept a subtask completion (for multi-assignee tasks)
  const handleAcceptSubtaskCompletion = async (subtaskId) => {
    try {
      setUpdatingSubtaskId(subtaskId)
      const token = localStorage.getItem('token')
      const projectId = task.project?._id || task.project
      const idToSend = subtaskId?.toString() || subtaskId

      const response = await fetch(`/api/projects/${projectId}/tasks/${task._id}/subtasks`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          subtaskId: idToSend,
          action: 'acceptCompletion'
        })
      })

      const data = await response.json()
      if (data.success) {
        setSubtasks(prevSubtasks => prevSubtasks.map(st =>
          (st._id?.toString() || st._id) === idToSend
            ? { 
                ...st, 
                ...data.data.subtask,
                pendingAcceptance: !data.data.allAccepted,
                completed: data.data.allAccepted
              }
            : st
        ))
        if (task && data.data) {
          task.progressPercentage = data.data.progressPercentage
        }
        toast.success(data.message)
      } else {
        toast.error(data.message || 'Failed to accept completion')
      }
    } catch (error) {
      console.error('Accept subtask completion error:', error)
      toast.error('Failed to accept completion')
    } finally {
      setUpdatingSubtaskId(null)
    }
  }

  // Reject a subtask completion (for multi-assignee tasks)
  const handleRejectSubtaskCompletion = async (subtaskId) => {
    const reason = prompt('Why are you rejecting this completion?')
    if (reason === null) return // User cancelled

    try {
      setUpdatingSubtaskId(subtaskId)
      const token = localStorage.getItem('token')
      const projectId = task.project?._id || task.project
      const idToSend = subtaskId?.toString() || subtaskId

      const response = await fetch(`/api/projects/${projectId}/tasks/${task._id}/subtasks`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          subtaskId: idToSend,
          action: 'rejectCompletion',
          reason: reason || 'No reason provided'
        })
      })

      const data = await response.json()
      if (data.success) {
        setSubtasks(prevSubtasks => prevSubtasks.map(st =>
          (st._id?.toString() || st._id) === idToSend
            ? { 
                ...st, 
                ...data.data.subtask,
                completed: false,
                pendingAcceptance: false
              }
            : st
        ))
        if (task && data.data) {
          task.progressPercentage = data.data.progressPercentage
        }
        toast.success(data.message)
      } else {
        toast.error(data.message || 'Failed to reject completion')
      }
    } catch (error) {
      console.error('Reject subtask completion error:', error)
      toast.error('Failed to reject completion')
    } finally {
      setUpdatingSubtaskId(null)
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

              {/* Multi-assignee indicator */}
              {isMultiAssignee && task.assignees && (
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-gray-500">Shared with:</span>
                  <div className="flex -space-x-2">
                    {task.assignees.slice(0, 4).map((assignee, idx) => (
                      <div
                        key={assignee._id || idx}
                        className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium border-2 border-white ${
                          assignee.user?._id?.toString() === currentEmployeeId || assignee.user?.toString() === currentEmployeeId
                            ? 'bg-primary-500 text-white'
                            : 'bg-gray-200 text-gray-600'
                        }`}
                        title={`${assignee.user?.firstName || ''} ${assignee.user?.lastName || ''} (${assignee.assignmentStatus})`}
                      >
                        {assignee.user?.firstName?.[0] || '?'}
                      </div>
                    ))}
                    {task.assignees.length > 4 && (
                      <div className="w-6 h-6 rounded-full bg-gray-300 flex items-center justify-center text-xs font-medium border-2 border-white">
                        +{task.assignees.length - 4}
                      </div>
                    )}
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
                {isUpdating ? <Loader size="xs" /> : 'Reject'}
              </button>
              <button
                onClick={onAccept}
                disabled={isUpdating}
                className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 disabled:opacity-50 flex items-center gap-1"
              >
                {isUpdating ? <Loader size="xs" /> : <><FaCheck /> Accept</>}
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
                  <Loader size="xs" />
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
                    <div key={subtask._id} className={`bg-white rounded-lg p-3 border ${subtask.pendingAcceptance ? 'border-yellow-300 bg-yellow-50' : 'border-gray-200'}`}>
                      <div className="flex items-center gap-3 group">
                        {/* Checkbox - disabled if pending acceptance from others */}
                        <input
                          type="checkbox"
                          checked={subtask.completed || subtask.pendingAcceptance}
                          onChange={() => handleToggleSubtask(subtask._id, subtask.completed || subtask.pendingAcceptance)}
                          disabled={updatingSubtaskId === subtask._id || isPendingAcceptance || subtask.pendingAcceptance}
                          className={`w-4 h-4 border-gray-300 rounded focus:ring-primary-500 cursor-pointer disabled:opacity-50 ${
                            subtask.pendingAcceptance ? 'text-yellow-500' : 'text-primary-600'
                          }`}
                        />
                        <span
                          className={`flex-1 text-sm ${subtask.completed
                              ? 'line-through text-gray-400'
                              : subtask.pendingAcceptance
                              ? 'text-yellow-700'
                              : 'text-gray-700'
                            }`}
                        >
                          {subtask.title}
                        </span>
                        
                        {/* Pending acceptance badge */}
                        {subtask.pendingAcceptance && (
                          <span className="text-xs px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded-full border border-yellow-300 flex items-center gap-1">
                            <FaClock className="text-xs" />
                            Pending ({subtask.acceptedBy?.length || 1}/{task.assignees?.length || 2})
                          </span>
                        )}
                        
                        {/* Show subtask ETA if available */}
                        {(subtask.estimatedDays > 0 || subtask.estimatedHours > 0) && !subtask.pendingAcceptance && (
                          <span className="text-xs text-blue-600 flex items-center gap-1">
                            <FaClock className="text-xs" />
                            {subtask.estimatedDays > 0 && `${subtask.estimatedDays}d`}
                            {subtask.estimatedDays > 0 && subtask.estimatedHours > 0 && ' '}
                            {subtask.estimatedHours > 0 && `${subtask.estimatedHours}h`}
                          </span>
                        )}
                        {!isPendingAcceptance && !subtask.pendingAcceptance && (
                          <button
                            onClick={() => handleDeleteSubtask(subtask._id)}
                            className="opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-700 transition-opacity"
                            title="Delete subtask"
                          >
                            <FaTrash className="text-xs" />
                          </button>
                        )}
                      </div>
                      
                      {/* Multi-assignee accept/reject buttons */}
                      {subtask.pendingAcceptance && isMultiAssignee && (
                        <div className="mt-2 flex items-center gap-2 pl-7">
                          {/* Check if current user has already accepted */}
                          {subtask.acceptedBy?.some(id => id?.toString() === currentEmployeeId || id?._id?.toString() === currentEmployeeId) ? (
                            <span className="text-xs text-green-600 flex items-center gap-1">
                              <FaCheck className="text-xs" />
                              You accepted
                            </span>
                          ) : subtask.completedBy?.toString() === currentEmployeeId || subtask.completedBy?._id?.toString() === currentEmployeeId ? (
                            <span className="text-xs text-blue-600 flex items-center gap-1">
                              <FaClock className="text-xs" />
                              Waiting for others to accept
                            </span>
                          ) : (
                            <>
                              <button
                                onClick={() => handleAcceptSubtaskCompletion(subtask._id)}
                                disabled={updatingSubtaskId === subtask._id}
                                className="px-2 py-1 text-xs bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50 flex items-center gap-1"
                              >
                                {updatingSubtaskId === subtask._id ? <Loader size="xs" color="#ffffff" /> : <FaCheck />}
                                Accept
                              </button>
                              <button
                                onClick={() => handleRejectSubtaskCompletion(subtask._id)}
                                disabled={updatingSubtaskId === subtask._id}
                                className="px-2 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600 disabled:opacity-50 flex items-center gap-1"
                              >
                                {updatingSubtaskId === subtask._id ? <Loader size="xs" color="#ffffff" /> : <FaTimes />}
                                Reject
                              </button>
                              <span className="text-xs text-gray-500">
                                by {subtask.completedBy?.firstName || 'teammate'}
                              </span>
                            </>
                          )}
                        </div>
                      )}

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
                    <Loader size="xs" />
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
