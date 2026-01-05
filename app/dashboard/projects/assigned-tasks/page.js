'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import toast from '@/utils/toast'
import { 
  FaTasks, FaCalendarAlt, FaFilter, FaSearch, FaProjectDiagram,
  FaCheck, FaPlay, FaEye, FaClock, FaExclamationTriangle,
  FaChevronDown, FaCheckCircle, FaTimes, FaSpinner, FaPlus,
  FaTrash, FaChevronUp, FaEdit, FaUserPlus, FaExchangeAlt,
  FaArrowLeft
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

const getProjectColor = (projectId) => {
  if (!projectId) return projectColors[0]
  let hash = 0
  const id = projectId.toString()
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash) + id.charCodeAt(i)
    hash = hash & hash
  }
  return projectColors[Math.abs(hash) % projectColors.length]
}

export default function AssignedTasksPage() {
  const router = useRouter()
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState({
    status: 'all',
    project: 'all'
  })
  const [searchQuery, setSearchQuery] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [projects, setProjects] = useState([])
  const [stats, setStats] = useState({})
  const [selectedTask, setSelectedTask] = useState(null)
  
  // Modal states
  const [showEditModal, setShowEditModal] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [showAddUserModal, setShowAddUserModal] = useState(false)
  const [showReassignModal, setShowReassignModal] = useState(false)
  const [showAddSubtaskModal, setShowAddSubtaskModal] = useState(false)
  const [showDeletionApprovalModal, setShowDeletionApprovalModal] = useState(false)
  
  // Form states
  const [editForm, setEditForm] = useState({ title: '', description: '', priority: 'medium', dueDate: '' })
  const [deleteReason, setDeleteReason] = useState('')
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('')
  const [reassignToId, setReassignToId] = useState('')
  const [addUserIds, setAddUserIds] = useState([])
  const [deletionResponse, setDeletionResponse] = useState({ action: '', reason: '' })
  
  const [submitting, setSubmitting] = useState(false)
  const [projectMembers, setProjectMembers] = useState([])
  
  // Auto-refresh
  const refreshIntervalRef = useRef(null)
  const lastFetchRef = useRef(Date.now())

  const fetchTasks = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true)
      const token = localStorage.getItem('token')
      const params = new URLSearchParams()
      
      if (filters.status !== 'all') params.append('status', filters.status)
      if (filters.project !== 'all') params.append('projectId', filters.project)

      const response = await fetch(`/api/projects/assigned-tasks?${params.toString()}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })

      const data = await response.json()
      if (data.success) {
        setTasks(data.data)
        setProjects(data.projects || [])
        setStats(data.stats || {})
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

  // Auto-refresh every 10 seconds
  useEffect(() => {
    refreshIntervalRef.current = setInterval(() => fetchTasks(true), 10000)
    
    const handleFocus = () => {
      if (Date.now() - lastFetchRef.current > 5000) {
        fetchTasks(true)
      }
    }
    window.addEventListener('focus', handleFocus)
    
    return () => {
      if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current)
      window.removeEventListener('focus', handleFocus)
    }
  }, [fetchTasks])

  // Fetch project members when a task is selected
  const fetchProjectMembers = async (projectId) => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/projects/${projectId}/members`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await response.json()
      if (data.success) {
        setProjectMembers(data.data.filter(m => m.invitationStatus === 'accepted'))
      }
    } catch (error) {
      console.error('Fetch members error:', error)
    }
  }

  // Edit task
  const handleEditTask = async (e) => {
    e.preventDefault()
    if (!selectedTask || !editForm.title.trim()) return
    
    try {
      setSubmitting(true)
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/projects/${selectedTask.project._id}/tasks/${selectedTask._id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(editForm)
      })

      const data = await response.json()
      if (data.success) {
        playNotificationSound(NotificationSoundTypes.SUCCESS)
        toast.success('Task updated successfully')
        setShowEditModal(false)
        setSelectedTask(null)
        fetchTasks()
      } else {
        toast.error(data.message)
      }
    } catch (error) {
      toast.error('Failed to update task')
    } finally {
      setSubmitting(false)
    }
  }

  // Delete task (request deletion)
  const handleDeleteTask = async () => {
    if (!selectedTask) return
    
    try {
      setSubmitting(true)
      const token = localStorage.getItem('token')
      const response = await fetch(
        `/api/projects/${selectedTask.project._id}/tasks/${selectedTask._id}?reason=${encodeURIComponent(deleteReason)}`, 
        {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` }
        }
      )

      const data = await response.json()
      if (data.success) {
        playNotificationSound(NotificationSoundTypes.POP)
        toast.success(data.message)
        setShowDeleteModal(false)
        setSelectedTask(null)
        setDeleteReason('')
        fetchTasks()
      } else {
        toast.error(data.message)
      }
    } catch (error) {
      toast.error('Failed to delete task')
    } finally {
      setSubmitting(false)
    }
  }

  // Add subtask
  const handleAddSubtask = async () => {
    if (!selectedTask || !newSubtaskTitle.trim()) return
    
    // Handle both populated and unpopulated project field
    const projectId = selectedTask.project?._id || selectedTask.project
    if (!projectId) {
      toast.error('Project not found')
      return
    }
    
    try {
      setSubmitting(true)
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/projects/${projectId}/tasks/${selectedTask._id}/subtasks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ title: newSubtaskTitle.trim() })
      })

      const data = await response.json()
      if (data.success) {
        playNotificationSound(NotificationSoundTypes.SUCCESS)
        toast.success('Subtask added successfully')
        setNewSubtaskTitle('')
        setShowAddSubtaskModal(false)
        fetchTasks()
      } else {
        toast.error(data.message || 'Failed to add subtask')
      }
    } catch (error) {
      toast.error('Failed to add subtask')
    } finally {
      setSubmitting(false)
    }
  }

  // Reassign task
  const handleReassignTask = async () => {
    if (!selectedTask || !reassignToId) return
    
    try {
      setSubmitting(true)
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/projects/${selectedTask.project._id}/tasks/${selectedTask._id}/reassign`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ newAssigneeId: reassignToId })
      })

      const data = await response.json()
      if (data.success) {
        playNotificationSound(NotificationSoundTypes.SUCCESS)
        toast.success('Task reassigned successfully')
        setShowReassignModal(false)
        setSelectedTask(null)
        setReassignToId('')
        fetchTasks()
      } else {
        toast.error(data.message)
      }
    } catch (error) {
      toast.error('Failed to reassign task')
    } finally {
      setSubmitting(false)
    }
  }

  // Add user to task
  const handleAddUserToTask = async () => {
    if (!selectedTask || addUserIds.length === 0) return
    
    try {
      setSubmitting(true)
      const token = localStorage.getItem('token')
      
      for (const userId of addUserIds) {
        await fetch(`/api/projects/${selectedTask.project._id}/tasks/${selectedTask._id}/assign`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ assigneeId: userId })
        })
      }

      playNotificationSound(NotificationSoundTypes.SUCCESS)
      toast.success('Users added to task')
      setShowAddUserModal(false)
      setAddUserIds([])
      fetchTasks()
    } catch (error) {
      toast.error('Failed to add users')
    } finally {
      setSubmitting(false)
    }
  }

  // Handle deletion approval response
  const handleDeletionApproval = async () => {
    if (!selectedTask || !deletionResponse.action) return
    
    try {
      setSubmitting(true)
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/projects/${selectedTask.project._id}/tasks/${selectedTask._id}/deletion-response`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(deletionResponse)
      })

      const data = await response.json()
      if (data.success) {
        playNotificationSound(deletionResponse.action === 'approve' ? NotificationSoundTypes.POP : NotificationSoundTypes.UPDATE)
        toast.success(data.message)
        setShowDeletionApprovalModal(false)
        setSelectedTask(null)
        setDeletionResponse({ action: '', reason: '' })
        fetchTasks()
      } else {
        toast.error(data.message)
      }
    } catch (error) {
      toast.error('Failed to process response')
    } finally {
      setSubmitting(false)
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

  // Filter tasks
  const filteredTasks = tasks.filter(task => {
    if (filters.project !== 'all' && task.project?._id !== filters.project) return false
    if (!searchQuery) return true
    const query = searchQuery.toLowerCase()
    return (
      task.title.toLowerCase().includes(query) ||
      task.description?.toLowerCase().includes(query) ||
      task.project?.name?.toLowerCase().includes(query)
    )
  })

  // Separate tasks
  const pendingDeletion = filteredTasks.filter(t => t.deletionRequest?.status === 'pending')
  const pendingAcceptance = filteredTasks.filter(t => 
    t.deletionRequest?.status !== 'pending' && t.assignees?.some(a => a.assignmentStatus === 'pending')
  )
  const activeTasks = filteredTasks.filter(t => 
    t.deletionRequest?.status !== 'pending' && 
    !t.assignees?.some(a => a.assignmentStatus === 'pending') &&
    t.status !== 'completed'
  )
  const completedTasks = filteredTasks.filter(t => 
    t.deletionRequest?.status !== 'pending' && t.status === 'completed'
  )

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
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push('/dashboard/projects')}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <FaArrowLeft className="text-gray-600" />
          </button>
          <div>
            <h1 className="text-3xl font-bold text-gray-800">Assigned Tasks</h1>
            <p className="text-gray-600">Tasks you&apos;ve assigned to team members</p>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-6">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gray-100 dark:bg-gray-700 rounded-lg">
              <FaTasks className="text-gray-600 dark:text-gray-400" />
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Total</p>
              <p className="font-semibold text-gray-800 dark:text-black">{stats.total || 0}</p>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg">
              <FaClock className="text-yellow-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Pending Accept</p>
              <p className="font-semibold text-gray-800 dark:text-black">{stats.pendingAcceptance || 0}</p>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
              <FaPlay className="text-blue-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">In Progress</p>
              <p className="font-semibold text-gray-800 dark:text-black">{stats.inProgress || 0}</p>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
              <FaEye className="text-purple-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">In Review</p>
              <p className="font-semibold text-gray-800 dark:text-black">{stats.review || 0}</p>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-lg">
              <FaCheckCircle className="text-green-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Completed</p>
              <p className="font-semibold text-gray-800 dark:text-black">{stats.completed || 0}</p>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-100 dark:bg-red-900/30 rounded-lg">
              <FaTrash className="text-red-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Pending Delete</p>
              <p className="font-semibold text-gray-800 dark:text-black">{stats.pendingDeletion || 0}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4 mb-6">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="relative flex-1">
            <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search tasks..."
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="btn-secondary flex items-center"
          >
            <FaFilter className="mr-2" />
            Filters
            <FaChevronDown className={`ml-2 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
          </button>
        </div>

        {showFilters && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 pt-4 border-t border-gray-200">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Project</label>
              <select
                value={filters.project}
                onChange={(e) => setFilters(prev => ({ ...prev, project: e.target.value }))}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              >
                <option value="all">All Projects</option>
                {projects.map(project => (
                  <option key={project._id} value={project._id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
              <select
                value={filters.status}
                onChange={(e) => setFilters(prev => ({ ...prev, status: e.target.value }))}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              >
                <option value="all">All Statuses</option>
                <option value="todo">To Do</option>
                <option value="in-progress">In Progress</option>
                <option value="review">In Review</option>
                <option value="completed">Completed</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Pending Deletion Requests */}
      {pendingDeletion.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-4">
            <FaTrash className="text-red-500" />
            <h2 className="text-lg font-semibold text-gray-800">Pending Deletion Approval</h2>
            <span className="px-2 py-1 bg-red-100 text-red-700 text-sm rounded-full">
              {pendingDeletion.length}
            </span>
          </div>
          <div className="grid gap-4">
            {pendingDeletion.map(task => (
              <TaskCard
                key={task._id}
                task={task}
                onEdit={() => {
                  setSelectedTask(task)
                  setEditForm({
                    title: task.title,
                    description: task.description || '',
                    priority: task.priority,
                    dueDate: task.dueDate ? new Date(task.dueDate).toISOString().split('T')[0] : ''
                  })
                  setShowEditModal(true)
                }}
                onDelete={() => {
                  setSelectedTask(task)
                  setShowDeleteModal(true)
                }}
                onAddUser={() => {
                  setSelectedTask(task)
                  fetchProjectMembers(task.project._id)
                  setShowAddUserModal(true)
                }}
                onReassign={() => {
                  setSelectedTask(task)
                  fetchProjectMembers(task.project._id)
                  setShowReassignModal(true)
                }}
                onAddSubtask={() => {
                  setSelectedTask(task)
                  setShowAddSubtaskModal(true)
                }}
                onViewProject={() => router.push(`/dashboard/projects/${task.project._id}`)}
                onRespondToDeletion={() => {
                  setSelectedTask(task)
                  setShowDeletionApprovalModal(true)
                }}
                hasPendingDeletion
              />
            ))}
          </div>
        </div>
      )}

      {/* Pending Acceptance */}
      {pendingAcceptance.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-4">
            <FaClock className="text-yellow-500" />
            <h2 className="text-lg font-semibold text-gray-800">Awaiting Acceptance</h2>
            <span className="px-2 py-1 bg-yellow-100 text-yellow-700 text-sm rounded-full">
              {pendingAcceptance.length}
            </span>
          </div>
          <div className="grid gap-4">
            {pendingAcceptance.map(task => (
              <TaskCard
                key={task._id}
                task={task}
                onEdit={() => {
                  setSelectedTask(task)
                  setEditForm({
                    title: task.title,
                    description: task.description || '',
                    priority: task.priority,
                    dueDate: task.dueDate ? new Date(task.dueDate).toISOString().split('T')[0] : ''
                  })
                  setShowEditModal(true)
                }}
                onDelete={() => {
                  setSelectedTask(task)
                  setShowDeleteModal(true)
                }}
                onAddUser={() => {
                  setSelectedTask(task)
                  fetchProjectMembers(task.project._id)
                  setShowAddUserModal(true)
                }}
                onReassign={() => {
                  setSelectedTask(task)
                  fetchProjectMembers(task.project._id)
                  setShowReassignModal(true)
                }}
                onAddSubtask={() => {
                  setSelectedTask(task)
                  setShowAddSubtaskModal(true)
                }}
                onViewProject={() => router.push(`/dashboard/projects/${task.project._id}`)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Active Tasks */}
      {activeTasks.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-4">
            <FaTasks className="text-blue-500" />
            <h2 className="text-lg font-semibold text-gray-800">Active Tasks</h2>
            <span className="px-2 py-1 bg-blue-100 text-blue-700 text-sm rounded-full">
              {activeTasks.length}
            </span>
          </div>
          <div className="grid gap-4">
            {activeTasks.map(task => (
              <TaskCard
                key={task._id}
                task={task}
                onEdit={() => {
                  setSelectedTask(task)
                  setEditForm({
                    title: task.title,
                    description: task.description || '',
                    priority: task.priority,
                    dueDate: task.dueDate ? new Date(task.dueDate).toISOString().split('T')[0] : ''
                  })
                  setShowEditModal(true)
                }}
                onDelete={() => {
                  setSelectedTask(task)
                  setShowDeleteModal(true)
                }}
                onAddUser={() => {
                  setSelectedTask(task)
                  fetchProjectMembers(task.project._id)
                  setShowAddUserModal(true)
                }}
                onReassign={() => {
                  setSelectedTask(task)
                  fetchProjectMembers(task.project._id)
                  setShowReassignModal(true)
                }}
                onAddSubtask={() => {
                  setSelectedTask(task)
                  setShowAddSubtaskModal(true)
                }}
                onViewProject={() => router.push(`/dashboard/projects/${task.project._id}`)}
                isOverdue={isOverdue(task)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Completed Tasks */}
      {completedTasks.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-4">
            <FaCheckCircle className="text-green-500" />
            <h2 className="text-lg font-semibold text-gray-800">Completed</h2>
            <span className="px-2 py-1 bg-green-100 text-green-700 text-sm rounded-full">
              {completedTasks.length}
            </span>
          </div>
          <div className="grid gap-4">
            {completedTasks.map(task => (
              <TaskCard
                key={task._id}
                task={task}
                onEdit={() => {
                  setSelectedTask(task)
                  setEditForm({
                    title: task.title,
                    description: task.description || '',
                    priority: task.priority,
                    dueDate: task.dueDate ? new Date(task.dueDate).toISOString().split('T')[0] : ''
                  })
                  setShowEditModal(true)
                }}
                onDelete={() => {
                  setSelectedTask(task)
                  setShowDeleteModal(true)
                }}
                onViewProject={() => router.push(`/dashboard/projects/${task.project._id}`)}
                isCompleted
              />
            ))}
          </div>
        </div>
      )}

      {filteredTasks.length === 0 && (
        <div className="bg-white rounded-xl shadow-sm p-12 text-center">
          <FaTasks className="mx-auto text-4xl text-gray-300 mb-4" />
          <h3 className="text-lg font-medium text-gray-600">No assigned tasks found</h3>
          <p className="text-gray-500">Tasks you assign to others will appear here</p>
        </div>
      )}

      {/* Edit Task Modal */}
      {showEditModal && selectedTask && (
      <Portal>
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9999] p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl animate-modal-enter">
            <div className="px-6 py-4 bg-gray-50 flex items-center justify-between">
              <h3 className="text-xl font-bold text-gray-900">Edit Task</h3>
              <button onClick={() => { setShowEditModal(false); setSelectedTask(null) }} className="p-2 hover:bg-gray-100 rounded-lg">
                <FaTimes />
              </button>
            </div>
            <form onSubmit={handleEditTask} className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
                <input
                  type="text"
                  value={editForm.title}
                  onChange={(e) => setEditForm(prev => ({ ...prev, title: e.target.value }))}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  value={editForm.description}
                  onChange={(e) => setEditForm(prev => ({ ...prev, description: e.target.value }))}
                  rows={3}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 resize-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
                  <select
                    value={editForm.priority}
                    onChange={(e) => setEditForm(prev => ({ ...prev, priority: e.target.value }))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Due Date</label>
                  <input
                    type="date"
                    value={editForm.dueDate}
                    onChange={(e) => setEditForm(prev => ({ ...prev, dueDate: e.target.value }))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button type="button" onClick={() => { setShowEditModal(false); setSelectedTask(null) }} className="btn-secondary">
                  Cancel
                </button>
                <button type="submit" disabled={submitting} className="btn-primary">
                  {submitting ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </Portal>
      )}

      {/* Delete Task Modal */}
      {showDeleteModal && selectedTask && (
      <Portal>
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9999] p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg animate-modal-enter">
            <div className="px-6 py-4 bg-gray-50 flex items-center justify-between">
              <h3 className="text-xl font-bold text-gray-900">Delete Task</h3>
              <button onClick={() => { setShowDeleteModal(false); setSelectedTask(null); setDeleteReason('') }} className="text-gray-400 hover:text-gray-600">
                <FaTimes />
              </button>
            </div>
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4 p-3 bg-yellow-50 rounded-lg">
                <FaExclamationTriangle className="text-yellow-500 text-xl flex-shrink-0" />
                <p className="text-yellow-700">
                  This will send a deletion request to the assignee for approval.
                </p>
              </div>
              <p className="text-gray-600 mb-4">Task: <strong>{selectedTask.title}</strong></p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Reason for deletion</label>
                <textarea
                  value={deleteReason}
                  onChange={(e) => setDeleteReason(e.target.value)}
                  placeholder="Why do you want to delete this task?"
                  rows={3}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 resize-none"
                />
              </div>
            </div>
            <div className="p-4 border-t border-gray-200 flex justify-end gap-3">
              <button onClick={() => { setShowDeleteModal(false); setSelectedTask(null); setDeleteReason('') }} className="btn-secondary">
                Cancel
              </button>
              <button onClick={handleDeleteTask} disabled={submitting} className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center gap-2">
                {submitting ? <><FaSpinner className="animate-spin" /> Requesting...</> : <><FaTrash /> Request Deletion</>}
              </button>
            </div>
          </div>
        </div>
      </Portal>
      )}

      {/* Add Subtask Modal */}
      {showAddSubtaskModal && selectedTask && (
      <Portal>
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9999] p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg animate-modal-enter">
            <div className="px-6 py-4 bg-gray-50 flex items-center justify-between">
              <h3 className="text-xl font-bold text-gray-900">Add Subtask</h3>
              <button onClick={() => { setShowAddSubtaskModal(false); setNewSubtaskTitle('') }} className="text-gray-400 hover:text-gray-600">
                <FaTimes />
              </button>
            </div>
            <div className="p-6">
              <p className="text-gray-600 mb-4">Task: <strong>{selectedTask.title}</strong></p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Subtask Title *</label>
                <input
                  type="text"
                  value={newSubtaskTitle}
                  onChange={(e) => setNewSubtaskTitle(e.target.value)}
                  placeholder="Enter subtask title..."
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <p className="text-xs text-gray-500 mt-2">
                The assignee will need to complete this subtask as part of the task.
              </p>
            </div>
            <div className="p-4 border-t border-gray-200 flex justify-end gap-3">
              <button onClick={() => { setShowAddSubtaskModal(false); setNewSubtaskTitle('') }} className="btn-secondary">
                Cancel
              </button>
              <button onClick={handleAddSubtask} disabled={submitting || !newSubtaskTitle.trim()} className="btn-primary flex items-center gap-2">
                {submitting ? <><FaSpinner className="animate-spin" /> Adding...</> : <><FaPlus /> Add Subtask</>}
              </button>
            </div>
          </div>
        </div>
      </Portal>
      )}

      {/* Reassign Modal */}
      {showReassignModal && selectedTask && (
      <Portal>
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9999] p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg animate-modal-enter">
            <div className="px-6 py-4 bg-gray-50 flex items-center justify-between">
              <h3 className="text-xl font-bold text-gray-900">Reassign Task</h3>
              <button onClick={() => { setShowReassignModal(false); setReassignToId('') }} className="text-gray-400 hover:text-gray-600">
                <FaTimes />
              </button>
            </div>
            <div className="p-6">
              <p className="text-gray-600 mb-4">Task: <strong>{selectedTask.title}</strong></p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Select New Assignee</label>
                <select
                  value={reassignToId}
                  onChange={(e) => setReassignToId(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                >
                  <option value="">Select a team member...</option>
                  {projectMembers.filter(m => 
                    !selectedTask.assignees?.some(a => a.user._id === m.user._id)
                  ).map(member => (
                    <option key={member.user._id} value={member.user._id}>
                      {member.user.firstName} {member.user.lastName}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="p-4 border-t border-gray-200 flex justify-end gap-3">
              <button onClick={() => { setShowReassignModal(false); setReassignToId('') }} className="btn-secondary">
                Cancel
              </button>
              <button onClick={handleReassignTask} disabled={submitting || !reassignToId} className="btn-primary flex items-center gap-2">
                {submitting ? <><FaSpinner className="animate-spin" /> Reassigning...</> : <><FaExchangeAlt /> Reassign</>}
              </button>
            </div>
          </div>
        </div>
      </Portal>
      )}

      {/* Add User Modal */}
      {showAddUserModal && selectedTask && (
      <Portal>
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9999] p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg animate-modal-enter">
            <div className="px-6 py-4 bg-gray-50 flex items-center justify-between">
              <h3 className="text-xl font-bold text-gray-900">Add Users to Task</h3>
              <button onClick={() => { setShowAddUserModal(false); setAddUserIds([]) }} className="text-gray-400 hover:text-gray-600">
                <FaTimes />
              </button>
            </div>
            <div className="p-6">
              <p className="text-gray-600 mb-4">Task: <strong>{selectedTask.title}</strong></p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Select Team Members</label>
                <div className="space-y-2 max-h-60 overflow-y-auto border border-gray-200 rounded-lg p-2">
                  {projectMembers.filter(m => 
                    !selectedTask.assignees?.some(a => a.user._id === m.user._id)
                  ).map(member => (
                    <label key={member.user._id} className="flex items-center gap-2 p-2 hover:bg-gray-50 rounded cursor-pointer">
                      <input
                        type="checkbox"
                        checked={addUserIds.includes(member.user._id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setAddUserIds(prev => [...prev, member.user._id])
                          } else {
                            setAddUserIds(prev => prev.filter(id => id !== member.user._id))
                          }
                        }}
                        className="rounded border-gray-300 text-primary-500 focus:ring-primary-500"
                      />
                      <span className="text-sm text-gray-700">
                        {member.user.firstName} {member.user.lastName}
                      </span>
                    </label>
                  ))}
                  {projectMembers.filter(m => !selectedTask.assignees?.some(a => a.user._id === m.user._id)).length === 0 && (
                    <p className="text-sm text-gray-500 text-center py-4">All team members are already assigned</p>
                  )}
                </div>
              </div>
            </div>
            <div className="p-4 border-t border-gray-200 flex justify-end gap-3">
              <button onClick={() => { setShowAddUserModal(false); setAddUserIds([]) }} className="btn-secondary">
                Cancel
              </button>
              <button onClick={handleAddUserToTask} disabled={submitting || addUserIds.length === 0} className="btn-primary flex items-center gap-2">
                {submitting ? <><FaSpinner className="animate-spin" /> Adding...</> : <><FaUserPlus /> Add Users</>}
              </button>
            </div>
          </div>
        </div>
      </Portal>
      )}

      {/* Deletion Approval Modal */}
      {showDeletionApprovalModal && selectedTask && (
      <Portal>
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9999] p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg animate-modal-enter">
            <div className="px-6 py-4 bg-gray-50 flex items-center justify-between">
              <h3 className="text-xl font-bold text-gray-900">Deletion Request</h3>
              <button onClick={() => { setShowDeletionApprovalModal(false); setDeletionResponse({ action: '', reason: '' }) }} className="text-gray-400 hover:text-gray-600">
                <FaTimes />
              </button>
            </div>
            <div className="p-6">
              <div className="p-3 bg-red-50 rounded-lg mb-4">
                <p className="text-red-700 font-medium">Someone has requested to delete this task</p>
                <p className="text-red-600 text-sm mt-1">
                  Reason: {selectedTask.deletionRequest?.reason || 'No reason provided'}
                </p>
              </div>
              <p className="text-gray-600 mb-4">Task: <strong>{selectedTask.title}</strong></p>
              
              <div className="space-y-3">
                <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
                  <input
                    type="radio"
                    name="deletionAction"
                    value="approve"
                    checked={deletionResponse.action === 'approve'}
                    onChange={() => setDeletionResponse({ action: 'approve', reason: '' })}
                    className="text-red-600"
                  />
                  <div>
                    <p className="font-medium text-gray-800">Approve Deletion</p>
                    <p className="text-sm text-gray-500">The task will be permanently deleted</p>
                  </div>
                </label>
                <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
                  <input
                    type="radio"
                    name="deletionAction"
                    value="reject"
                    checked={deletionResponse.action === 'reject'}
                    onChange={() => setDeletionResponse({ action: 'reject', reason: '' })}
                    className="text-green-600"
                  />
                  <div>
                    <p className="font-medium text-gray-800">Reject Deletion</p>
                    <p className="text-sm text-gray-500">Keep the task, reject the deletion request</p>
                  </div>
                </label>
              </div>

              {deletionResponse.action === 'reject' && (
                <div className="mt-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Reason for rejection</label>
                  <textarea
                    value={deletionResponse.reason}
                    onChange={(e) => setDeletionResponse(prev => ({ ...prev, reason: e.target.value }))}
                    placeholder="Why are you rejecting this deletion?"
                    rows={2}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 resize-none"
                  />
                </div>
              )}
            </div>
            <div className="p-4 border-t border-gray-200 flex justify-end gap-3">
              <button onClick={() => { setShowDeletionApprovalModal(false); setDeletionResponse({ action: '', reason: '' }) }} className="btn-secondary">
                Cancel
              </button>
              <button 
                onClick={handleDeletionApproval} 
                disabled={submitting || !deletionResponse.action} 
                className={`px-4 py-2 rounded-lg disabled:opacity-50 flex items-center gap-2 ${
                  deletionResponse.action === 'approve' 
                    ? 'bg-red-600 text-white hover:bg-red-700' 
                    : 'bg-green-600 text-white hover:bg-green-700'
                }`}
              >
                {submitting ? <FaSpinner className="animate-spin" /> : deletionResponse.action === 'approve' ? <FaTrash /> : <FaCheck />}
                {deletionResponse.action === 'approve' ? 'Approve Deletion' : 'Reject Deletion'}
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
function TaskCard({ task, onEdit, onDelete, onAddUser, onReassign, onAddSubtask, onViewProject, onRespondToDeletion, hasPendingDeletion, isOverdue, isCompleted }) {
  const [showActions, setShowActions] = useState(false)
  const projectColor = getProjectColor(task.project?._id)
  const progressPercentage = task.progressPercentage || 0

  return (
    <div className={`rounded-xl shadow-sm border-2 border-l-4 p-4 transition-all bg-white ${projectColor.border} ${
      hasPendingDeletion ? 'border-red-300 bg-red-50/30' :
      isOverdue ? 'border-red-300 bg-red-50/30' :
      isCompleted ? 'border-green-300 bg-green-50/30' :
      'border-gray-200'
    }`}>
      <div className="flex items-start justify-between">
        <div className="flex-1">
          {hasPendingDeletion && (
            <div className="flex items-center gap-2 mb-2 p-2 bg-red-100 rounded-lg">
              <FaExclamationTriangle className="text-red-500" />
              <span className="text-sm text-red-700 font-medium">Deletion requested</span>
              <button
                onClick={onRespondToDeletion}
                className="ml-auto px-3 py-1 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700"
              >
                Respond
              </button>
            </div>
          )}
          
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h3 className="font-medium text-gray-800">{task.title}</h3>
            <span className={`px-2 py-0.5 rounded text-xs border ${statusColors[task.status]}`}>
              {task.status.replace('-', ' ')}
            </span>
            <span className={`px-2 py-0.5 rounded text-xs ${priorityColors[task.priority]}`}>
              {task.priority}
            </span>
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
                {new Date(task.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </div>
            )}
            {task.estimatedHours && (
              <div className="flex items-center gap-1 text-blue-600">
                <FaClock className="text-xs" />
                <span>ETA: {task.estimatedHours >= 8 ? `${Math.floor(task.estimatedHours / 8)}d ${task.estimatedHours % 8}h` : `${task.estimatedHours}h`}</span>
              </div>
            )}
          </div>

          {/* Progress bar */}
          {task.subtasks && task.subtasks.length > 0 && (
            <div className="mt-3">
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-gray-500">
                  Subtasks: {task.subtasks.filter(st => st.completed).length}/{task.subtasks.length}
                </span>
                <span className="font-medium text-gray-700">{progressPercentage}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-1.5">
                <div
                  className={`h-1.5 rounded-full transition-all ${
                    progressPercentage === 100 ? 'bg-green-500' :
                    progressPercentage >= 50 ? 'bg-blue-500' :
                    'bg-orange-500'
                  }`}
                  style={{ width: `${progressPercentage}%` }}
                />
              </div>
            </div>
          )}

          {/* Assignees */}
          {task.assignees && task.assignees.length > 0 && (
            <div className="mt-3 flex items-center gap-2">
              <span className="text-xs text-gray-500">Assigned to:</span>
              <div className="flex flex-wrap gap-2">
                {task.assignees.map(a => (
                  <div
                    key={a._id}
                    className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs ${
                      a.assignmentStatus === 'pending' 
                        ? 'bg-yellow-100 text-yellow-700' 
                        : a.assignmentStatus === 'rejected'
                        ? 'bg-red-100 text-red-700'
                        : 'bg-green-100 text-green-700'
                    }`}
                    title={a.assignmentStatus}
                  >
                    {a.user.firstName} {a.user.lastName}
                    {a.assignmentStatus === 'pending' && <FaClock className="ml-1" />}
                    {a.assignmentStatus === 'accepted' && <FaCheck className="ml-1" />}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Actions Menu */}
        <div className="relative ml-4">
          <button
            onClick={() => setShowActions(!showActions)}
            className="p-2 hover:bg-gray-100 rounded-lg text-gray-500"
          >
            <FaChevronDown className={`transition-transform ${showActions ? 'rotate-180' : ''}`} />
          </button>
          
          {showActions && (
            <div className="absolute right-0 mt-1 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-10">
              <button
                onClick={() => { onEdit(); setShowActions(false) }}
                className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
              >
                <FaEdit className="text-blue-500" /> Edit Task
              </button>
              {!isCompleted && onAddSubtask && (
                <button
                  onClick={() => { onAddSubtask(); setShowActions(false) }}
                  className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                >
                  <FaPlus className="text-purple-500" /> Add Subtask
                </button>
              )}
              {!isCompleted && onAddUser && (
                <button
                  onClick={() => { onAddUser(); setShowActions(false) }}
                  className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                >
                  <FaUserPlus className="text-green-500" /> Add User
                </button>
              )}
              {!isCompleted && onReassign && (
                <button
                  onClick={() => { onReassign(); setShowActions(false) }}
                  className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                >
                  <FaExchangeAlt className="text-orange-500" /> Reassign
                </button>
              )}
              <hr className="my-1" />
              <button
                onClick={() => { onDelete(); setShowActions(false) }}
                className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
              >
                <FaTrash /> Delete Task
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
