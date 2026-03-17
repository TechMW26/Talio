'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import toast from '@/utils/toast'
import { Card, CardBody, Button, Chip, Skeleton, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Input, Textarea, Progress, Spinner, Select, SelectItem } from '@heroui/react'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import useApiMutation from '@/hooks/useApiMutation'
import LoadingButton from '@/components/ui/LoadingButton'
import {
  FaTasks, FaCalendarAlt, FaFilter, FaSearch, FaProjectDiagram,
  FaCheck, FaPlay, FaEye, FaClock, FaExclamationTriangle,
  FaChevronDown, FaCheckCircle, FaTimes, FaPlus,
  FaTrash, FaChevronUp, FaEdit, FaUserPlus, FaExchangeAlt,
  FaArrowLeft, FaTh, FaList
} from 'react-icons/fa'
import { playNotificationSound, NotificationSoundTypes } from '@/lib/notificationSounds'
import Portal from '@/components/ui/Portal'
import ModalPortal from '@/components/ui/ModalPortal'
import KanbanBoard from '@/components/tasks/KanbanBoard'
import CreateTaskModal from '@/components/tasks/CreateTaskModal'

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

// Skeleton for loading state
function AssignedTasksSkeleton() {
  return (
    <div className="page-container">
      <div className="flex items-center gap-4 mb-6">
        <Skeleton className="h-10 w-10 rounded-lg" />
        <div>
          <Skeleton className="h-8 w-48 rounded-lg mb-2" />
          <Skeleton className="h-4 w-64 rounded-lg" />
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-6">
        {[...Array(6)].map((_, i) => (
          <Card key={i} shadow="sm"><CardBody className="p-4"><Skeleton className="h-12 rounded-lg" /></CardBody></Card>
        ))}
      </div>
      <Card shadow="sm" className="mb-6"><CardBody className="p-4"><Skeleton className="h-10 rounded-lg" /></CardBody></Card>
      <div className="grid gap-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i} shadow="sm"><CardBody className="p-4"><Skeleton className="h-24 rounded-lg" /></CardBody></Card>
        ))}
      </div>
    </div>
  )
}

export default function AssignedTasksPage() {
  const router = useRouter()
  const [filters, setFilters] = useState({
    status: 'all',
    project: 'all'
  })
  const [searchQuery, setSearchQuery] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [selectedTask, setSelectedTask] = useState(null)

  // Modal states
  const [showEditModal, setShowEditModal] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [showAddUserModal, setShowAddUserModal] = useState(false)
  const [showReassignModal, setShowReassignModal] = useState(false)
  const [showAddSubtaskModal, setShowAddSubtaskModal] = useState(false)
  const [showDeletionApprovalModal, setShowDeletionApprovalModal] = useState(false)
  const [viewMode, setViewMode] = useState('kanban') // 'list' or 'kanban' - kanban is default
  const [modalUpdatingSubtask, setModalUpdatingSubtask] = useState(null) // For modal subtask toggle loading
  const [modalUpdatingStatus, setModalUpdatingStatus] = useState(false) // For modal status change loading
  const [showModalStatusDropdown, setShowModalStatusDropdown] = useState(false) // For status dropdown visibility

  const formatFileSize = useCallback((bytes = 0) => {
    if (!bytes || Number.isNaN(bytes)) return '0 B'
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), sizes.length - 1)
    return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${sizes[i]}`
  }, [])

  // Reason modal for status changes
  const [showCreateTask, setShowCreateTask] = useState(false)
  const [showReasonModal, setShowReasonModal] = useState(false)
  const [pendingStatusChange, setPendingStatusChange] = useState(null) // { task, newStatus, source: 'kanban' | 'modal' }
  const [statusChangeReason, setStatusChangeReason] = useState('')

  // Form states
  const [editForm, setEditForm] = useState({ title: '', description: '', priority: 'medium', dueDate: '' })
  const [deleteReason, setDeleteReason] = useState('')
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('')
  const [reassignToId, setReassignToId] = useState('')
  const [addUserIds, setAddUserIds] = useState([])
  const [deletionResponse, setDeletionResponse] = useState({ action: '', reason: '' })

  const [submitting, setSubmitting] = useState(false)
  const [projectMembers, setProjectMembers] = useState([])

  // --- SWR Data Fetching ---
  const tasksQueryString = useMemo(() => {
    const params = new URLSearchParams()
    if (filters.status !== 'all') params.append('status', filters.status)
    if (filters.project !== 'all') params.append('projectId', filters.project)
    return params.toString()
  }, [filters])

  const { data: tasksData, error: tasksError, isLoading: loading, mutate: mutateTasks } = useAuthedSWR(
    `/api/projects/assigned-tasks?${tasksQueryString}`,
    { refreshInterval: 10000 }
  )

  const tasks = tasksData?.data || []
  const projects = tasksData?.projects || []
  const stats = tasksData?.stats || {}

  // Helper: get the correct API base for a task (project-based or standalone)
  const getTaskApiBase = (task) => {
    const projectId = task?.project?._id || task?.project
    if (projectId) return `/api/projects/${projectId}/tasks/${task._id}`
    return `/api/tasks/${task._id}`
  }

  // Fetch project members or all employees when a task is selected
  const fetchProjectMembers = async (projectId) => {
    try {
      const token = localStorage.getItem('token')
      if (projectId) {
        const response = await fetch(`/api/projects/${projectId}/members`, {
          headers: { 'Authorization': `Bearer ${token}` }
        })
        const data = await response.json()
        if (data.success) {
          setProjectMembers(data.data.filter(m => m.invitationStatus === 'accepted'))
        }
      } else {
        // For standalone tasks, fetch all employees
        const response = await fetch(`/api/employees/list?includeAdmins=true`, {
          headers: { 'Authorization': `Bearer ${token}` }
        })
        const data = await response.json()
        if (data.success) {
          setProjectMembers(data.data?.map(emp => ({
            employee: emp,
            invitationStatus: 'accepted'
          })) || [])
        }
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
      const response = await fetch(getTaskApiBase(selectedTask), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          title: editForm.title,
          description: editForm.description,
          priority: editForm.priority,
          dueDate: editForm.dueDate || undefined
        })
      })

      const data = await response.json()
      if (data.success) {
        playNotificationSound(NotificationSoundTypes.POP)
        toast.success('Task updated successfully')
        setShowEditModal(false)
        setSelectedTask(null)
        mutateTasks()
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
        `${getTaskApiBase(selectedTask)}?reason=${encodeURIComponent(deleteReason)}`,
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
        mutateTasks()
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

    try {
      setSubmitting(true)
      const token = localStorage.getItem('token')
      // Subtasks route works with either project-based or standalone task path
      const subtaskUrl = projectId
        ? `/api/projects/${projectId}/tasks/${selectedTask._id}/subtasks`
        : `/api/projects/_/tasks/${selectedTask._id}/subtasks`
      const response = await fetch(subtaskUrl, {
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
        mutateTasks()
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
      const response = await fetch(`${getTaskApiBase(selectedTask)}/reassign`, {
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
        mutateTasks()
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
        await fetch(`${getTaskApiBase(selectedTask)}/assign`, {
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
      mutateTasks()
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
      const response = await fetch(`${getTaskApiBase(selectedTask)}/deletion-response`, {
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
        mutateTasks()
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

    // Show reason modal instead of changing directly
    setPendingStatusChange({ task, newStatus, source: 'kanban' })
    setStatusChangeReason('')
    setShowReasonModal(true)
  }

  // Execute the actual status change after reason is provided
  const executeStatusChange = async (reason) => {
    if (!pendingStatusChange) return

    const { task, newStatus, source } = pendingStatusChange

    // Optimistic update via SWR
    mutateTasks(
      prev => prev ? { ...prev, data: prev.data.map(t => t._id === task._id ? { ...t, status: newStatus } : t) } : prev,
      { revalidate: false }
    )

    // Update selectedTask if it's the same task (for modal source)
    if (source === 'modal' && selectedTask?._id === task._id) {
      setSelectedTask(prev => ({ ...prev, status: newStatus }))
    }

    // Close modals
    setShowReasonModal(false)
    setPendingStatusChange(null)
    setStatusChangeReason('')

    try {
      const token = localStorage.getItem('token')
      const response = await fetch(getTaskApiBase(task), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          status: newStatus,
          reason
        })
      })

      const data = await response.json()
      if (data.success) {
        if (newStatus === 'completed') {
          playNotificationSound(NotificationSoundTypes.SUCCESS)
        } else {
          playNotificationSound(NotificationSoundTypes.UPDATE)
        }
        toast.success('Task updated')
        // Revalidate to sync with server
        mutateTasks()
      } else {
        playNotificationSound(NotificationSoundTypes.WARNING)
        toast.error(data.message)
        // Revert local state on error
        mutateTasks()
      }
    } catch (error) {
      playNotificationSound(NotificationSoundTypes.WARNING)
      toast.error('Failed to update task')
      // Revert local state on error
      mutateTasks()
    }
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

  if (loading) return <AssignedTasksSkeleton />

  return (
    <div className="page-container">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
        <div className="flex items-center gap-4">
          <Button
            isIconOnly
            variant="light"
            onPress={() => router.push('/dashboard/projects')}
          >
            <FaArrowLeft className="text-default-600" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold text-default-800">Assigned Tasks</h1>
            <p className="text-default-600">Tasks you&apos;ve assigned to team members</p>
          </div>
        </div>
        <Button
          color="primary"
          onPress={() => setShowCreateTask(true)}
          startContent={<FaPlus />}
        >
          Assign Task
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-6">
        <Card shadow="sm">
          <CardBody className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-default-100 rounded-lg">
                <FaTasks className="w-5 h-5 text-default-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-default-800">{stats.total || 0}</p>
                <p className="text-sm text-default-500">Total</p>
              </div>
            </div>
          </CardBody>
        </Card>
        <Card shadow="sm">
          <CardBody className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-warning-100 rounded-lg">
                <FaClock className="w-5 h-5 text-warning" />
              </div>
              <div>
                <p className="text-2xl font-bold text-default-800">{stats.pendingAcceptance || 0}</p>
                <p className="text-sm text-default-500">Pending Accept</p>
              </div>
            </div>
          </CardBody>
        </Card>
        <Card shadow="sm">
          <CardBody className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary-100 rounded-lg">
                <FaPlay className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold text-default-800">{stats.inProgress || 0}</p>
                <p className="text-sm text-default-500">In Progress</p>
              </div>
            </div>
          </CardBody>
        </Card>
        <Card shadow="sm">
          <CardBody className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-secondary-100 rounded-lg">
                <FaEye className="w-5 h-5 text-secondary" />
              </div>
              <div>
                <p className="text-2xl font-bold text-default-800">{stats.review || 0}</p>
                <p className="text-sm text-default-500">In Review</p>
              </div>
            </div>
          </CardBody>
        </Card>
        <Card shadow="sm">
          <CardBody className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-success-100 rounded-lg">
                <FaCheckCircle className="w-5 h-5 text-success" />
              </div>
              <div>
                <p className="text-2xl font-bold text-default-800">{stats.completed || 0}</p>
                <p className="text-sm text-default-500">Completed</p>
              </div>
            </div>
          </CardBody>
        </Card>
        <Card shadow="sm">
          <CardBody className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-danger-100 rounded-lg">
                <FaTrash className="w-5 h-5 text-danger" />
              </div>
              <div>
                <p className="text-2xl font-bold text-default-800">{stats.pendingDeletion || 0}</p>
                <p className="text-sm text-default-500">Pending Delete</p>
              </div>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Search & Filters */}
      <Card shadow="sm" className="mb-6">
        <CardBody className="p-4">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="input-with-icon flex-1">
              <FaSearch className="input-icon" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search tasks..."
                className="input input-search"
              />
            </div>
            <Button
              variant="bordered"
              onPress={() => setShowFilters(!showFilters)}
              startContent={<FaFilter />}
              endContent={<FaChevronDown className={`transition-transform ${showFilters ? 'rotate-180' : ''}`} />}
            >
              Filters
            </Button>

            {/* View Toggle */}
            <div className="flex border border-default-300 rounded-lg overflow-hidden">
              <button
                onClick={() => setViewMode('list')}
                className={`px-3 py-2 flex items-center gap-1.5 transition-colors ${viewMode === 'list'
                    ? 'bg-primary-500 text-white'
                    : 'bg-content1 text-default-600 hover:bg-default-50'
                  }`}
                title="List View"
              >
                <FaList className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode('kanban')}
                className={`px-3 py-2 flex items-center gap-1.5 transition-colors border-l border-default-300 ${viewMode === 'kanban'
                    ? 'bg-primary-500 text-white'
                    : 'bg-content1 text-default-600 hover:bg-default-50'
                  }`}
                title="Kanban View"
              >
                <FaTh className="w-4 h-4" />
              </button>
            </div>
          </div>

          {showFilters && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 pt-4 border-t border-default-200">
              <div>
                <label className="block text-sm font-medium text-default-700 mb-1">Project</label>
                <Select
                  selectedKeys={[filters.project]}
                  onChange={(e) => setFilters(prev => ({ ...prev, project: e.target.value }))}
                  aria-label="Project filter"
                  classNames={{ trigger: "bg-white" }}
                >
                  <SelectItem key="all">All Projects</SelectItem>
                  {projects.map(project => (
                    <SelectItem key={project._id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </Select>
              </div>
              <div>
                <label className="block text-sm font-medium text-default-700 mb-1">Status</label>
                <Select
                  selectedKeys={[filters.status]}
                  onChange={(e) => setFilters(prev => ({ ...prev, status: e.target.value }))}
                  aria-label="Status filter"
                  classNames={{ trigger: "bg-white" }}
                >
                  <SelectItem key="all">All Statuses</SelectItem>
                  <SelectItem key="todo">To Do</SelectItem>
                  <SelectItem key="in-progress">In Progress</SelectItem>
                  <SelectItem key="review">In Review</SelectItem>
                  <SelectItem key="completed">Completed</SelectItem>
                </Select>
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Kanban View */}
      {viewMode === 'kanban' && (
        <div className="mb-6">
          <KanbanBoard
            tasks={filteredTasks.filter(t => t.deletionRequest?.status !== 'pending')}
            onTaskClick={(task) => setSelectedTask(task)}
            onStatusChange={handleKanbanStatusChange}
            showProject={true}
            enableDragDrop={true}
            onProjectClick={(projectId) => router.push(`/dashboard/projects/${projectId}`)}
          />

          {/* Show pending deletion in kanban mode */}
          {pendingDeletion.length > 0 && (
            <div className="mt-6 p-4 bg-danger-50 border border-danger-200 rounded-lg">
              <h3 className="text-sm font-medium text-danger-700 mb-2 flex items-center gap-2">
                <FaTrash className="w-4 h-4" />
                {pendingDeletion.length} task(s) pending deletion approval
              </h3>
              <button
                onClick={() => setViewMode('list')}
                className="text-sm text-danger-600 hover:text-danger-800 underline"
              >
                Switch to list view to review
              </button>
            </div>
          )}
        </div>
      )}

      {/* List View */}
      {viewMode === 'list' && (
        <>
          {/* Pending Deletion Requests */}
          {pendingDeletion.length > 0 && (
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-4">
                <FaTrash className="text-danger" />
                <h2 className="text-lg font-semibold text-default-800">Pending Deletion Approval</h2>
                <Chip color="danger" variant="flat" size="sm">
                  {pendingDeletion.length}
                </Chip>
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
                      fetchProjectMembers(task.project?._id)
                      setShowAddUserModal(true)
                    }}
                    onReassign={() => {
                      setSelectedTask(task)
                      fetchProjectMembers(task.project?._id)
                      setShowReassignModal(true)
                    }}
                    onAddSubtask={() => {
                      setSelectedTask(task)
                      setShowAddSubtaskModal(true)
                    }}
                    onViewProject={task.project?._id ? () => router.push(`/dashboard/projects/${task.project._id}`) : undefined}
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
                <FaClock className="text-warning" />
                <h2 className="text-lg font-semibold text-default-800">Awaiting Acceptance</h2>
                <Chip color="warning" variant="flat" size="sm">
                  {pendingAcceptance.length}
                </Chip>
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
                      fetchProjectMembers(task.project?._id)
                      setShowAddUserModal(true)
                    }}
                    onReassign={() => {
                      setSelectedTask(task)
                      fetchProjectMembers(task.project?._id)
                      setShowReassignModal(true)
                    }}
                    onAddSubtask={() => {
                      setSelectedTask(task)
                      setShowAddSubtaskModal(true)
                    }}
                    onViewProject={task.project?._id ? () => router.push(`/dashboard/projects/${task.project._id}`) : undefined}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Active Tasks */}
          {activeTasks.length > 0 && (
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-4">
                <FaTasks className="text-primary" />
                <h2 className="text-lg font-semibold text-default-800">Active Tasks</h2>
                <Chip color="primary" variant="flat" size="sm">
                  {activeTasks.length}
                </Chip>
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
                      fetchProjectMembers(task.project?._id)
                      setShowAddUserModal(true)
                    }}
                    onReassign={() => {
                      setSelectedTask(task)
                      fetchProjectMembers(task.project?._id)
                      setShowReassignModal(true)
                    }}
                    onAddSubtask={() => {
                      setSelectedTask(task)
                      setShowAddSubtaskModal(true)
                    }}
                    onViewProject={task.project?._id ? () => router.push(`/dashboard/projects/${task.project._id}`) : undefined}
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
                <FaCheckCircle className="text-success" />
                <h2 className="text-lg font-semibold text-default-800">Completed</h2>
                <Chip color="success" variant="flat" size="sm">
                  {completedTasks.length}
                </Chip>
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
                    onViewProject={task.project?._id ? () => router.push(`/dashboard/projects/${task.project._id}`) : undefined}
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
        </>
      )}

      {/* Edit Task Modal */}
      <ModalPortal isOpen={showEditModal && !!selectedTask}>
        {selectedTask && <div className="modal-overlay">
          <div className="bg-white rounded-[30px] shadow-2xl w-full max-w-2xl animate-modal-enter">
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
                  <Select
                    selectedKeys={[editForm.priority]}
                    onChange={(e) => setEditForm(prev => ({ ...prev, priority: e.target.value }))}
                    aria-label="Priority"
                    classNames={{ trigger: "bg-white" }}
                  >
                    <SelectItem key="low">Low</SelectItem>
                    <SelectItem key="medium">Medium</SelectItem>
                    <SelectItem key="high">High</SelectItem>
                    <SelectItem key="critical">Critical</SelectItem>
                  </Select>
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
                <Button
                  type="button"
                  onPress={() => { setShowEditModal(false); setSelectedTask(null) }}
                  variant="flat"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  isDisabled={submitting}
                  color="primary"
                >
                  {submitting ? 'Saving...' : 'Save Changes'}
                </Button>
              </div>
            </form>
          </div>
        </div>}
      </ModalPortal>

      {/* Reason for Status Change Modal */}
      <ModalPortal isOpen={showReasonModal && !!pendingStatusChange}>
        {pendingStatusChange && <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && (setShowReasonModal(false), setPendingStatusChange(null), setStatusChangeReason(''))}>
          <div className="bg-white rounded-[30px] shadow-2xl w-full max-w-lg animate-modal-enter">
            <div className="px-6 py-4 bg-gradient-to-r from-blue-500 to-indigo-500 flex items-center justify-between rounded-t-2xl">
              <h3 className="text-xl font-bold text-white">Reason for Status Change</h3>
              <button onClick={() => { setShowReasonModal(false); setPendingStatusChange(null); setStatusChangeReason('') }} className="text-white/80 hover:text-white">
                <FaTimes />
              </button>
            </div>
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4 p-3 bg-blue-50 rounded-lg">
                <div className="flex items-center gap-2 text-blue-700">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusColors[pendingStatusChange.task.status]}`}>
                    {pendingStatusChange.task.status.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                  </span>
                  <FaArrowLeft className="rotate-180" />
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusColors[pendingStatusChange.newStatus]}`}>
                    {pendingStatusChange.newStatus.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                  </span>
                </div>
              </div>
              <p className="text-gray-600 mb-4">Task: <strong>{pendingStatusChange.task.title}</strong></p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Why are you changing this task's status? <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={statusChangeReason}
                  onChange={(e) => setStatusChangeReason(e.target.value)}
                  placeholder="Provide a reason for this status change (this will be logged in the task timeline)..."
                  rows={3}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 resize-none"
                  autoFocus
                />
                <p className="text-xs text-gray-400 mt-1">This reason will be visible in the task timeline</p>
              </div>
            </div>
            <div className="p-4 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={() => { setShowReasonModal(false); setPendingStatusChange(null); setStatusChangeReason('') }}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={() => executeStatusChange(statusChangeReason)}
                disabled={!statusChangeReason.trim() || modalUpdatingStatus}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {modalUpdatingStatus ? (
                  <><Loader size="xs" /> <span className="ml-1">Updating...</span></>
                ) : (
                  <><FaCheck /> Confirm Change</>
                )}
              </button>
            </div>
          </div>
        </div>}
      </ModalPortal>

      {/* Delete Task Modal */}
      <ModalPortal isOpen={showDeleteModal && !!selectedTask}>
        {selectedTask && <div className="modal-overlay">
          <div className="bg-white rounded-[30px] shadow-2xl w-full max-w-lg animate-modal-enter">
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
                {submitting ? <><Loader size="xs" /> <span className="ml-1">Requesting...</span></> : <><FaTrash /> Request Deletion</>}
              </button>
            </div>
          </div>
        </div>}
      </ModalPortal>

      {/* Add Subtask Modal */}
      <ModalPortal isOpen={showAddSubtaskModal && !!selectedTask}>
        {selectedTask && <div className="modal-overlay">
          <div className="bg-white rounded-[30px] shadow-2xl w-full max-w-lg animate-modal-enter">
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
              <Button
                onPress={() => { setShowAddSubtaskModal(false); setNewSubtaskTitle('') }}
                variant="flat"
              >
                Cancel
              </Button>
              <Button
                onPress={handleAddSubtask}
                isDisabled={submitting || !newSubtaskTitle.trim()}
                color="primary"
                startContent={submitting ? <Loader size="xs" /> : <FaPlus />}
              >
                {submitting ? 'Adding...' : 'Add Subtask'}
              </Button>
            </div>
          </div>
        </div>}
      </ModalPortal>

      {/* Reassign Modal */}
      <ModalPortal isOpen={showReassignModal && !!selectedTask}>
        {selectedTask && <div className="modal-overlay">
          <div className="bg-white rounded-[30px] shadow-2xl w-full max-w-lg animate-modal-enter">
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
                <Select
                  selectedKeys={reassignToId ? [reassignToId] : []}
                  onChange={(e) => setReassignToId(e.target.value)}
                  aria-label="Select New Assignee"
                  placeholder="Select a team member..."
                  classNames={{ trigger: "bg-white" }}
                >
                  {projectMembers.filter(m =>
                    !selectedTask.assignees?.some(a => a.user._id === m.user._id)
                  ).map(member => (
                    <SelectItem key={member.user._id}>
                      {member.user.firstName} {member.user.lastName}
                    </SelectItem>
                  ))}
                </Select>
              </div>
            </div>
            <div className="p-4 border-t border-gray-200 flex justify-end gap-3">
              <Button
                onPress={() => { setShowReassignModal(false); setReassignToId('') }}
                variant="flat"
              >
                Cancel
              </Button>
              <Button
                onPress={handleReassignTask}
                isDisabled={submitting || !reassignToId}
                color="primary"
                startContent={submitting ? <Loader size="xs" /> : <FaExchangeAlt />}
              >
                {submitting ? 'Reassigning...' : 'Reassign'}
              </Button>
            </div>
          </div>
        </div>}
      </ModalPortal>

      {/* Add User Modal */}
      <ModalPortal isOpen={showAddUserModal && !!selectedTask}>
        {selectedTask && <div className="modal-overlay">
          <div className="bg-white rounded-[30px] shadow-2xl w-full max-w-lg animate-modal-enter">
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
              <Button
                onPress={() => { setShowAddUserModal(false); setAddUserIds([]) }}
                variant="flat"
              >
                Cancel
              </Button>
              <Button
                onPress={handleAddUserToTask}
                isDisabled={submitting || addUserIds.length === 0}
                color="primary"
                startContent={submitting ? <Loader size="xs" /> : <FaUserPlus />}
              >
                {submitting ? 'Adding...' : 'Add Users'}
              </Button>
            </div>
          </div>
        </div>}
      </ModalPortal>

      {/* Deletion Approval Modal */}
      <ModalPortal isOpen={showDeletionApprovalModal && !!selectedTask}>
        {selectedTask && <div className="modal-overlay">
          <div className="bg-white rounded-[30px] shadow-2xl w-full max-w-lg animate-modal-enter">
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
                className={`px-4 py-2 rounded-lg disabled:opacity-50 flex items-center gap-2 ${deletionResponse.action === 'approve'
                    ? 'bg-red-600 text-white hover:bg-red-700'
                    : 'bg-green-600 text-white hover:bg-green-700'
                  }`}
              >
                {submitting ? <Loader size="xs" /> : deletionResponse.action === 'approve' ? <FaTrash /> : <FaCheck />}
                {deletionResponse.action === 'approve' ? 'Approve Deletion' : 'Reject Deletion'}
              </button>
            </div>
          </div>
        </div>}
      </ModalPortal>

      {/* Task Detail Modal - Opens when clicking task in Kanban view */}
      <ModalPortal isOpen={!!selectedTask && !showEditModal && !showDeleteModal && !showAddUserModal && !showReassignModal && !showAddSubtaskModal && !showDeletionApprovalModal}>
        {selectedTask && <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setSelectedTask(null)}>
          <div className="bg-white rounded-[30px] shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col animate-modal-enter">
            <div className="px-6 py-4 bg-gray-50 flex items-center justify-between flex-shrink-0">
              <h3 className="text-lg font-semibold text-gray-800">Task Details</h3>
              <div className="flex items-center gap-2">
                <Button
                  onPress={() => {
                    setEditForm({
                      title: selectedTask.title,
                      description: selectedTask.description || '',
                      priority: selectedTask.priority,
                      dueDate: selectedTask.dueDate ? new Date(selectedTask.dueDate).toISOString().split('T')[0] : ''
                    })
                    setShowEditModal(true)
                  }}
                  color="primary"
                  size="sm"
                  startContent={<FaEdit className="w-3 h-3" />}
                >
                  Edit Task
                </Button>
                {selectedTask.project && (
                  <Button
                    onPress={() => router.push(`/dashboard/projects/${selectedTask.project?._id || selectedTask.project}`)}
                    variant="flat"
                    size="sm"
                    startContent={<FaProjectDiagram className="w-3 h-3" />}
                  >
                    View Project
                  </Button>
                )}
                <button
                  onClick={() => setSelectedTask(null)}
                  className="p-2 hover:bg-gray-100 rounded-lg text-gray-500"
                >
                  <FaTimes />
                </button>
              </div>
            </div>

            <div className="p-6 overflow-y-auto flex-1">
              {/* Task Title & Status */}
              <div className="flex items-start justify-between mb-4">
                <h2 className="text-xl font-semibold text-gray-800">{selectedTask.title}</h2>
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
                  <h4 className="text-sm font-medium text-gray-500 mb-2">Description</h4>
                  <p className="text-gray-700 whitespace-pre-wrap">{selectedTask.description}</p>
                </div>
              )}

              {/* Attachments */}
              {selectedTask.attachments && selectedTask.attachments.length > 0 && (
                <div className="mb-6">
                  <h4 className="text-sm font-medium text-gray-500 mb-2">Attachments</h4>
                  <div className="space-y-2">
                    {selectedTask.attachments.map((file, index) => (
                      <a
                        key={`${file.url}-${index}`}
                        href={file.url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200 hover:bg-gray-100"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">{file.name || 'Attachment'}</p>
                          <p className="text-xs text-gray-500">{formatFileSize(file.size)}</p>
                        </div>
                        <span className="text-xs text-blue-600">Open</span>
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* Details Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-gray-50 p-3 rounded-lg">
                  <p className="text-xs text-gray-500 mb-1">Priority</p>
                  <span className={`px-2 py-1 rounded text-sm font-medium ${priorityColors[selectedTask.priority]}`}>
                    {selectedTask.priority.charAt(0).toUpperCase() + selectedTask.priority.slice(1)}
                  </span>
                </div>
                <div className="bg-gray-50 p-3 rounded-lg">
                  <p className="text-xs text-gray-500 mb-1">Due Date</p>
                  <p className={`font-medium ${selectedTask.dueDate && new Date(selectedTask.dueDate) < new Date() && selectedTask.status !== 'completed'
                      ? 'text-red-600' : 'text-gray-800'
                    }`}>
                    {selectedTask.dueDate ? new Date(selectedTask.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Not set'}
                  </p>
                </div>
                {selectedTask.estimatedHours && (
                  <div className="bg-gray-50 p-3 rounded-lg">
                    <p className="text-xs text-gray-500 mb-1">Estimated Time</p>
                    <p className="font-medium text-gray-800">
                      {selectedTask.estimatedHours >= 8
                        ? `${Math.floor(selectedTask.estimatedHours / 8)}d ${selectedTask.estimatedHours % 8}h`
                        : `${selectedTask.estimatedHours}h`}
                    </p>
                  </div>
                )}
                <div className="bg-gray-50 p-3 rounded-lg">
                  <p className="text-xs text-gray-500 mb-1">Progress</p>
                  <p className="font-medium text-gray-800">{selectedTask.progressPercentage || 0}%</p>
                </div>
              </div>

              {/* Progress Bar */}
              {selectedTask.subtasks && selectedTask.subtasks.length > 0 && (
                <div className="mb-6">
                  <div className="flex items-center justify-start mb-2">
                    <h4 className="text-sm font-medium text-gray-500">Progress</h4>
                    <span className="text-sm text-gray-600">{selectedTask.progressPercentage || 0}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full transition-all ${selectedTask.progressPercentage === 100 ? 'bg-green-500' :
                          selectedTask.progressPercentage >= 50 ? 'bg-blue-500' :
                            'bg-orange-500'
                        }`}
                      style={{ width: `${selectedTask.progressPercentage || 0}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Subtasks - Interactive for managers */}
              {selectedTask.subtasks && selectedTask.subtasks.length > 0 && (
                <div className="mb-6">
                  <h4 className="text-sm font-medium text-gray-500 mb-3">
                    Subtasks ({selectedTask.subtasks.filter(st => st.completed).length}/{selectedTask.subtasks.length})
                  </h4>
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {selectedTask.subtasks.map((subtask, idx) => {
                      // Allow toggle if: subtask is completed (can unmark) OR not pending acceptance (can mark)
                      const canToggle = subtask.completed || !subtask.pendingAcceptance

                      return (
                        <div key={subtask._id || idx} className={`flex items-center gap-3 p-3 rounded-lg transition-all ${subtask.completed ? 'bg-green-50' :
                            subtask.pendingAcceptance ? 'bg-yellow-50' : 'bg-gray-50'
                          } ${canToggle ? 'hover:bg-gray-100 cursor-pointer' : ''}`}
                          onClick={async () => {
                            if (!canToggle || modalUpdatingSubtask) return
                            const subtaskId = subtask._id
                            const projectId = selectedTask.project?._id || selectedTask.project

                            try {
                              setModalUpdatingSubtask(subtaskId)
                              const token = localStorage.getItem('token')
                              const response = await fetch(`/api/projects/${projectId || '_'}/tasks/${selectedTask._id}/subtasks`, {
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
                                mutateTasks()
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
                          <div className={`w-5 h-5 rounded-full flex items-center justify-center transition-all ${modalUpdatingSubtask === subtask._id ? 'bg-blue-500 animate-pulse' :
                              subtask.completed ? 'bg-green-500 text-white' :
                                subtask.pendingAcceptance ? 'bg-yellow-500 text-white' :
                                  canToggle ? 'bg-gray-300 hover:bg-gray-400' : 'bg-gray-200'
                            }`}>
                            {modalUpdatingSubtask === subtask._id ? (
                              <Loader size="xs" color="#ffffff" />
                            ) : subtask.completed ? (
                              <FaCheck className="w-3 h-3" />
                            ) : subtask.pendingAcceptance ? (
                              <FaClock className="w-3 h-3" />
                            ) : null}
                          </div>
                          <div className="flex-1">
                            <p className={`text-sm ${subtask.completed ? 'text-gray-500 line-through' : 'text-gray-800'}`}>
                              {subtask.title}
                            </p>
                            {subtask.estimatedHours && (
                              <p className="text-xs text-gray-400 mt-0.5">
                                Est: {subtask.estimatedHours >= 8 ? `${Math.floor(subtask.estimatedHours / 8)}d ${subtask.estimatedHours % 8}h` : `${subtask.estimatedHours}h`}
                              </p>
                            )}
                          </div>
                          {subtask.pendingAcceptance && (
                            <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded">Pending Review</span>
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
                  <h4 className="text-sm font-medium text-gray-500 mb-3">Assignees</h4>
                  <div className="flex flex-wrap gap-2">
                    {selectedTask.assignees.map((assignee, idx) => (
                      <div key={assignee._id || idx} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${assignee.assignmentStatus === 'accepted' ? 'bg-green-50 text-green-700' :
                          assignee.assignmentStatus === 'rejected' ? 'bg-red-50 text-red-700' :
                            'bg-yellow-50 text-yellow-700'
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
                <div className="mb-6">
                  <h4 className="text-sm font-medium text-gray-500 mb-3">Update Status</h4>
                  <div className="relative">
                    <button
                      onClick={() => setShowModalStatusDropdown(!showModalStatusDropdown)}
                      disabled={modalUpdatingStatus}
                      className={`w-full flex items-center justify-between px-4 py-3 rounded-lg border transition-all ${modalUpdatingStatus ? 'bg-gray-100 cursor-not-allowed' : 'bg-white hover:bg-gray-50 cursor-pointer'
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
                            onClick={() => {
                              if (status === selectedTask.status) {
                                setShowModalStatusDropdown(false)
                                return
                              }
                              // Show reason modal instead of changing directly
                              setShowModalStatusDropdown(false)
                              setPendingStatusChange({ task: selectedTask, newStatus: status, source: 'modal' })
                              setStatusChangeReason('')
                              setShowReasonModal(true)
                            }}
                            className={`w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-gray-50 transition-colors ${status === selectedTask.status ? 'bg-blue-50 text-blue-700' : 'text-gray-700'
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
              )}

              {/* Action Buttons */}
              <div className="flex flex-wrap gap-3 pt-4 border-t">
                <button
                  onClick={() => {
                    fetchProjectMembers(selectedTask.project?._id)
                    setShowAddUserModal(true)
                  }}
                  className="btn-secondary flex items-center gap-2"
                >
                  <FaUserPlus className="w-4 h-4" />
                  Add User
                </button>
                <button
                  onClick={() => {
                    fetchProjectMembers(selectedTask.project?._id)
                    setShowReassignModal(true)
                  }}
                  className="btn-secondary flex items-center gap-2"
                >
                  <FaExchangeAlt className="w-4 h-4" />
                  Reassign
                </button>
                <button
                  onClick={() => setShowAddSubtaskModal(true)}
                  className="btn-secondary flex items-center gap-2"
                >
                  <FaPlus className="w-4 h-4" />
                  Add Subtask
                </button>
                <button
                  onClick={() => setShowDeleteModal(true)}
                  className="btn-secondary text-red-600 hover:bg-red-50 flex items-center gap-2"
                >
                  <FaTrash className="w-4 h-4" />
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>}
      </ModalPortal>

      {/* Create Task Modal */}
      <CreateTaskModal
        isOpen={showCreateTask}
        onClose={() => setShowCreateTask(false)}
        onTaskCreated={() => mutateTasks()}
      />
    </div>
  )
}

// Task Card Component
function TaskCard({ task, onEdit, onDelete, onAddUser, onReassign, onAddSubtask, onViewProject, onRespondToDeletion, hasPendingDeletion, isOverdue, isCompleted }) {
  const [showActions, setShowActions] = useState(false)
  const projectColor = getProjectColor(task.project?._id)
  const progressPercentage = task.progressPercentage || 0

  return (
    <div className={`rounded-xl shadow-sm border-2 border-l-4 p-4 transition-all bg-white ${projectColor.border} ${hasPendingDeletion ? 'border-red-300 bg-red-50/30' :
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
            {task.project && onViewProject && (
              <button
                onClick={onViewProject}
                className={`flex items-center gap-1 px-2 py-0.5 rounded ${projectColor.badge} ${projectColor.text} hover:opacity-80`}
              >
                <FaProjectDiagram className="text-xs" />
                {task.project?.name}
              </button>
            )}
            {!task.project && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-gray-100 text-gray-600">
                <FaTasks className="text-xs" />
                Standalone Task
              </span>
            )}
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
                  className={`h-1.5 rounded-full transition-all ${progressPercentage === 100 ? 'bg-green-500' :
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
                    className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs ${a.assignmentStatus === 'pending'
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
