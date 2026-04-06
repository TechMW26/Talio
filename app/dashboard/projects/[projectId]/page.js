'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useRouter, useSearchParams, useParams } from 'next/navigation'
import toast from '@/utils/toast'
import { useSocket } from '@/contexts/SocketContext'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import { getCurrentUser, getEmployeeId } from '@/utils/userHelper'
import {
  HiOutlineArrowLeft, HiOutlinePencil, HiOutlinePlus, HiOutlineUsers,
  HiOutlineClipboardDocumentList, HiOutlineCalendarDays, HiOutlineCheckCircle,
  HiOutlineClock, HiOutlineExclamationTriangle, HiOutlineChatBubbleLeftRight,
  HiOutlineChartBar, HiOutlineCheck, HiOutlineXMark,
  HiOutlineTrash, HiOutlineUserPlus, HiOutlineArchiveBox, HiOutlineChatBubbleOvalLeftEllipsis,
  HiOutlineClock as HiOutlineHistory, HiOutlineChevronDown, HiOutlineChevronUp,
  HiOutlineChevronLeft, HiOutlineChevronRight,
  HiOutlinePlay, HiOutlineEye, HiOutlineDocumentText, HiOutlineArrowRight,
  HiOutlineLockClosed, HiOutlineArrowPath, HiOutlineArrowsRightLeft,
  HiOutlineMagnifyingGlass
} from 'react-icons/hi2'
import {
  FaArrowLeft, FaEdit, FaPlus, FaUsers, FaTasks, FaCalendarAlt,
  FaCheckCircle, FaClock, FaExclamationTriangle, FaComments,
  FaChartLine, FaEllipsisV, FaCheck, FaTimes, FaTrash,
  FaUserPlus, FaArchive, FaComment, FaHistory, FaChevronDown,
  FaChevronUp, FaPlay, FaEye, FaStickyNote, FaArrowRight,
  FaThumbtack, FaLock, FaSync, FaExchangeAlt
} from 'react-icons/fa'
import { playNotificationSound, NotificationSoundTypes } from '@/lib/notificationSounds'
import { Button, Select, SelectItem, Skeleton } from '@heroui/react'
import ProjectOverview from '@/components/projects/ProjectOverview'
import KanbanBoard from '@/components/tasks/KanbanBoard'
import Portal from '@/components/ui/Portal'
import ModalPortal from '@/components/ui/ModalPortal'
import Loader from '@/components/ui/Loader'
import SubtaskCompletionButton from '@/components/tasks/SubtaskCompletionButton'

const statusColors = {
  planned: 'bg-blue-100 text-blue-800',
  ongoing: 'bg-green-100 text-green-800',
  completed: 'bg-emerald-100 text-emerald-800',
  'completed_pending_approval': 'bg-yellow-100 text-yellow-800',
  approved: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-red-100 text-red-800',
  pending: 'bg-orange-100 text-orange-800',
  overdue: 'bg-red-100 text-red-800',
  archived: 'bg-gray-100 text-gray-800'
}

const statusLabels = {
  planned: 'Planned',
  ongoing: 'Ongoing',
  completed: 'Completed',
  'completed_pending_approval': 'Pending Approval',
  approved: 'Approved',
  rejected: 'Rejected',
  pending: 'Pending',
  overdue: 'Overdue',
  archived: 'Archived'
}

const priorityColors = {
  low: 'bg-gray-100 text-gray-700',
  medium: 'bg-blue-100 text-blue-700',
  high: 'bg-orange-100 text-orange-700',
  critical: 'bg-red-100 text-red-700'
}

const taskStatusColors = {
  'todo': 'bg-gray-100 text-gray-700 border-gray-200',
  'in-progress': 'bg-blue-100 text-blue-700 border-blue-200',
  'review': 'bg-purple-100 text-purple-700 border-purple-200',
  'completed': 'bg-green-100 text-green-700 border-green-200',
  'rejected': 'bg-red-100 text-red-700 border-red-200',
  'blocked': 'bg-orange-100 text-orange-700 border-orange-200'
}

export default function ProjectDetailPage() {
  const { projectId } = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()

  // Socket for real-time updates
  const { joinProject, leaveProject, onTaskUpdated } = useSocket()

  // User from localStorage
  const user = useMemo(() => getCurrentUser(), [])

  // Task month filter state
  const now_date = useMemo(() => new Date(), [])
  const [taskMonth, setTaskMonth] = useState(now_date.getMonth())
  const [taskYear, setTaskYear] = useState(now_date.getFullYear())

  const projectTaskMonthLabel = new Date(taskYear, taskMonth).toLocaleString('default', { month: 'long', year: 'numeric' })
  const isProjectCurrentMonth = taskMonth === now_date.getMonth() && taskYear === now_date.getFullYear()
  const goToPrevProjectMonth = () => {
    if (taskMonth === 0) { setTaskMonth(11); setTaskYear(y => y - 1) }
    else setTaskMonth(m => m - 1)
  }
  const goToNextProjectMonth = () => {
    if (isProjectCurrentMonth) return
    if (taskMonth === 11) { setTaskMonth(0); setTaskYear(y => y + 1) }
    else setTaskMonth(m => m + 1)
  }

  // SWR hooks for data fetching (replaces manual fetch + auto-refresh)
  const { data: projectData, error: projectError, isLoading: loading, mutate: mutateProject } = useAuthedSWR(
    projectId ? `/api/projects/${projectId}` : null,
    { refreshInterval: 10000 }
  )
  const project = projectData?.data || null

  const { data: tasksData, mutate: mutateTasks } = useAuthedSWR(
    projectId ? `/api/projects/${projectId}/tasks?month=${taskMonth}&year=${taskYear}` : null,
    { refreshInterval: 10000 }
  )

  const [tasks, setTasks] = useState([])
  const [activeTab, setActiveTab] = useState('overview')

  const { data: timelineData, error: timelineErrorSWR, isLoading: timelineLoading, mutate: mutateTimeline } = useAuthedSWR(
    activeTab === 'timeline' ? `/api/projects/${projectId}/timeline` : null,
    { refreshInterval: 10000 }
  )
  const timeline = timelineData?.data || []
  const timelineError = timelineErrorSWR ? 'Failed to load activity. Please try again.' : null

  const { data: notesData, mutate: mutateNotes } = useAuthedSWR(
    activeTab === 'notes' ? `/api/projects/${projectId}/notes` : null,
    { refreshInterval: 10000 }
  )
  const notes = notesData?.data || []

  const { data: completionData, mutate: mutateCompletionStatus } = useAuthedSWR(
    projectId ? `/api/projects/${projectId}/complete` : null,
    { refreshInterval: 10000 }
  )
  const completionStatus = completionData?.data || {
    canComplete: false,
    totalTasks: 0,
    completedTasks: 0,
    allTasksCompleted: false
  }

  // Sync tasks from SWR to local state (local state needed for socket + optimistic updates)
  useEffect(() => {
    if (tasksData?.data) {
      setTasks(tasksData.data)
    }
  }, [tasksData])

  // Derive currentEmployeeId from SWR data or user
  const currentEmployeeId = useMemo(() => {
    if (tasksData?.currentEmployeeId) return tasksData.currentEmployeeId
    return getEmployeeId(user)
  }, [tasksData, user])

  // Redirect on project fetch error
  useEffect(() => {
    if (projectError) {
      toast.error('Failed to load project')
      router.push('/dashboard/projects')
    }
  }, [projectError, router])
  const [showCreateTask, setShowCreateTask] = useState(false)
  const [showAddMember, setShowAddMember] = useState(false)
  const [newComment, setNewComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [showRejectInvitationModal, setShowRejectInvitationModal] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [selectedTask, setSelectedTask] = useState(null)
  const [updatingTaskId, setUpdatingTaskId] = useState(null)
  const [showDeleteTaskModal, setShowDeleteTaskModal] = useState(false)
  const [taskToDelete, setTaskToDelete] = useState(null)
  const [deleteReason, setDeleteReason] = useState('')
  const [showReassignModal, setShowReassignModal] = useState(false)
  const [reassignTask, setReassignTask] = useState(null)
  const [reassignToId, setReassignToId] = useState('')
  const [showEditTaskModal, setShowEditTaskModal] = useState(false)
  const [editTaskForm, setEditTaskForm] = useState(null)
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false)

  // Reason modal state for status changes (requires justification)
  const [showReasonModal, setShowReasonModal] = useState(false)
  const [pendingStatusChange, setPendingStatusChange] = useState(null) // { task, newStatus }
  const [statusChangeReason, setStatusChangeReason] = useState('')

  // Notes form state
  const [showCreateNote, setShowCreateNote] = useState(false)
  const [editingNote, setEditingNote] = useState(null)
  const [noteForm, setNoteForm] = useState({
    title: '',
    content: '',
    color: 'yellow',
    visibility: 'team'
  })

  // Task form state
  const [taskForm, setTaskForm] = useState({
    title: '',
    description: '',
    priority: 'medium',
    dueDate: '',
    assigneeIds: [],
    subtasks: [],
    attachments: []
  })
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('')
  const [showTaskEtaModal, setShowTaskEtaModal] = useState(false)
  const [taskEta, setTaskEta] = useState({ days: '', hours: '' })
  const [subtaskEtas, setSubtaskEtas] = useState({}) // { subtaskIndex: { days: '', hours: '' } }
  const [pendingTaskData, setPendingTaskData] = useState(null)
  const [uploadingTaskAttachments, setUploadingTaskAttachments] = useState(false)
  const taskAttachmentInputRef = useRef(null)

  const formatFileSize = useCallback((bytes = 0) => {
    if (!bytes || Number.isNaN(bytes)) return '0 B'
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), sizes.length - 1)
    return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${sizes[i]}`
  }, [])

  const handleTaskAttachmentUpload = async (files) => {
    if (!files || files.length === 0) return
    try {
      setUploadingTaskAttachments(true)
      const token = localStorage.getItem('token')
      const uploads = await Promise.all(Array.from(files).map(async (file) => {
        const formData = new FormData()
        formData.append('file', file)
        formData.append('folder', 'tasks')

        const response = await fetch('/api/upload', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`
          },
          body: formData
        })

        const result = await response.json()
        if (!result.success) {
          throw new Error(result.message || 'Upload failed')
        }

        return {
          name: result.data.fileName || file.name,
          url: result.data.fileUrl,
          type: result.data.fileType || file.type,
          size: result.data.fileSize || file.size
        }
      }))

      setTaskForm(prev => ({
        ...prev,
        attachments: [...(prev.attachments || []), ...uploads]
      }))
    } catch (error) {
      console.error('Task attachment upload error:', error)
      toast.error(error.message || 'Failed to upload attachment')
    } finally {
      setUploadingTaskAttachments(false)
      if (taskAttachmentInputRef.current) taskAttachmentInputRef.current.value = ''
    }
  }

  // Set active tab from URL search params
  useEffect(() => {
    const tab = searchParams.get('tab')
    if (tab) setActiveTab(tab)
  }, [searchParams])

  // Set document title with project name
  useEffect(() => {
    if (project?.name) {
      document.title = `${project.name} | Projects | Talio`
    }
    return () => {
      document.title = 'Talio'
    }
  }, [project?.name])

  // Socket: Join project room and listen for real-time task updates
  useEffect(() => {
    if (projectId) {
      // Join project room for real-time updates
      joinProject(projectId)

      // Listen for task updates (e.g., when project head rejects/unmarks subtasks)
      const unsubscribe = onTaskUpdated((updatedTask) => {
        console.log('🔄 [Socket] Task updated in real-time:', updatedTask._id)
        // Update the task in the local state
        setTasks(prev => prev.map(task =>
          task._id === updatedTask._id ? { ...task, ...updatedTask } : task
        ))
        // If this task is currently selected, update it too
        setSelectedTask(prev =>
          prev && prev._id === updatedTask._id ? { ...prev, ...updatedTask } : prev
        )
        // Also revalidate SWR cache
        mutateTasks()
        // Show a notification
        toast.success('Task updated by project head', { icon: '🔄' })
      })

      return () => {
        leaveProject(projectId)
        if (unsubscribe) unsubscribe()
      }
    }
  }, [projectId, joinProject, leaveProject, onTaskUpdated])

  const handleCreateNote = async (e) => {
    e.preventDefault()
    if (!noteForm.content.trim()) {
      toast.error('Note content is required')
      return
    }

    try {
      setSubmitting(true)
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/projects/${projectId}/notes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(noteForm)
      })

      const data = await response.json()
      if (data.success) {
        toast.success('Note created successfully')
        setShowCreateNote(false)
        setNoteForm({ title: '', content: '', color: 'yellow', visibility: 'team' })
        mutateNotes()
      } else {
        toast.error(data.message)
      }
    } catch (error) {
      toast.error('Failed to create note')
    } finally {
      setSubmitting(false)
    }
  }

  const handleUpdateNote = async (noteId) => {
    if (!noteForm.content.trim()) {
      toast.error('Note content is required')
      return
    }

    try {
      setSubmitting(true)
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/projects/${projectId}/notes/${noteId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(noteForm)
      })

      const data = await response.json()
      if (data.success) {
        toast.success('Note updated successfully')
        setEditingNote(null)
        setNoteForm({ title: '', content: '', color: 'yellow', visibility: 'team' })
        mutateNotes()
      } else {
        toast.error(data.message)
      }
    } catch (error) {
      toast.error('Failed to update note')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDeleteNote = async (noteId) => {
    if (!confirm('Are you sure you want to delete this note?')) return

    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/projects/${projectId}/notes/${noteId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      })

      const data = await response.json()
      if (data.success) {
        toast.success('Note deleted successfully')
        mutateNotes()
      } else {
        toast.error(data.message)
      }
    } catch (error) {
      toast.error('Failed to delete note')
    }
  }

  const handleTogglePinNote = async (note) => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/projects/${projectId}/notes/${note._id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ isPinned: !note.isPinned })
      })

      const data = await response.json()
      if (data.success) {
        toast.success(note.isPinned ? 'Note unpinned' : 'Note pinned')
        mutateNotes()
      } else {
        toast.error(data.message)
      }
    } catch (error) {
      toast.error('Failed to update note')
    }
  }

  const startEditNote = (note) => {
    setEditingNote(note._id)
    setNoteForm({
      title: note.title || '',
      content: note.content,
      color: note.color,
      visibility: note.visibility || 'team'
    })
  }

  const cancelEditNote = () => {
    setEditingNote(null)
    setNoteForm({ title: '', content: '', color: 'yellow', visibility: 'team' })
  }

  const noteColors = {
    yellow: 'bg-yellow-100 border-yellow-300',
    blue: 'bg-blue-100 border-blue-300',
    green: 'bg-green-100 border-green-300',
    pink: 'bg-pink-100 border-pink-300',
    purple: 'bg-purple-100 border-purple-300'
  }

  const handleRespondToInvitation = async (action, reason = '') => {
    try {
      setSubmitting(true)
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/projects/${projectId}/respond`, {
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
        setShowRejectInvitationModal(false)
        setRejectReason('')
        mutateProject()
      } else {
        toast.error(data.message)
      }
    } catch (error) {
      toast.error('Failed to respond to invitation')
    } finally {
      setSubmitting(false)
    }
  }

  const handleCreateTask = async (e) => {
    e.preventDefault()
    if (!taskForm.title.trim()) {
      toast.error('Task title is required')
      return
    }

    // Check if current user is assigned to this task
    const isAssignedToSelf = taskForm.assigneeIds.includes(currentEmployeeId)

    // If assigned to self and no ETA provided yet, show ETA modal
    if (isAssignedToSelf && !pendingTaskData) {
      setPendingTaskData(taskForm)
      setShowTaskEtaModal(true)
      return
    }

    try {
      setSubmitting(true)
      const token = localStorage.getItem('token')

      // Start with current form data
      const taskData = { ...taskForm }

      // Handle subtask-wise ETAs
      if (pendingTaskData && pendingTaskData.subtasks?.length > 0 && Object.keys(subtaskEtas).length > 0) {
        // Add ETAs to each subtask
        taskData.subtasks = pendingTaskData.subtasks.map((subtask, index) => ({
          ...subtask,
          estimatedDays: parseInt(subtaskEtas[index]?.days) || 0,
          estimatedHours: parseInt(subtaskEtas[index]?.hours) || 0
        }))
        // Calculate total estimated hours from subtasks
        let totalHours = 0
        Object.values(subtaskEtas).forEach(eta => {
          totalHours += (parseFloat(eta?.days) || 0) * 8 + (parseFloat(eta?.hours) || 0)
        })
        taskData.estimatedHours = totalHours
      } else if (pendingTaskData && (taskEta.days || taskEta.hours)) {
        // Task without subtasks - use main task ETA
        const days = parseFloat(taskEta.days) || 0
        const hours = parseFloat(taskEta.hours) || 0
        taskData.estimatedHours = (days * 8) + hours
      }

      // Sanitize attachments - ensure it's a clean array of plain objects
      const attachmentsToSend = Array.isArray(taskForm.attachments)
        ? taskForm.attachments
          .filter((file) => file && typeof file === 'object' && file.name && file.url)
          .map((file) => ({
            name: String(file.name),
            url: String(file.url),
            type: file.type ? String(file.type) : undefined,
            size: typeof file.size === 'number' ? file.size : undefined
          }))
        : []

      // Build final payload
      const payload = {
        title: taskData.title,
        description: taskData.description,
        priority: taskData.priority,
        dueDate: taskData.dueDate,
        assigneeIds: taskData.assigneeIds,
        subtasks: taskData.subtasks,
        estimatedHours: taskData.estimatedHours,
        attachments: attachmentsToSend
      }

      console.log('[CreateTask] Sending payload:', JSON.stringify(payload, null, 2))

      const response = await fetch(`/api/projects/${projectId}/tasks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      })

      const data = await response.json()
      if (data.success) {
        // Close modal and reset form FIRST to ensure UI responds immediately
        setShowCreateTask(false)
        setShowTaskEtaModal(false)
        setTaskForm({ title: '', description: '', priority: 'medium', dueDate: '', assigneeIds: [], subtasks: [], attachments: [] })
        setNewSubtaskTitle('')
        setPendingTaskData(null)
        setTaskEta({ days: '', hours: '' })
        setSubtaskEtas({})

        // Show success feedback
        toast.success('Task created successfully')
        try {
          playNotificationSound(NotificationSoundTypes.SUCCESS)
        } catch (soundError) {
          // Ignore sound errors - they shouldn't affect UX
          console.warn('Sound playback failed:', soundError)
        }

        // Refresh data in background
        mutateTasks()
        mutateProject() // Refresh completion percentage
        mutateCompletionStatus() // Check if all tasks completed
      } else {
        toast.error(data.message || 'Failed to create task')
        try {
          playNotificationSound(NotificationSoundTypes.WARNING)
        } catch (soundError) {
          console.warn('Sound playback failed:', soundError)
        }
      }
    } catch (error) {
      console.error('Create task error:', error)
      toast.error('Failed to create task')
      try {
        playNotificationSound(NotificationSoundTypes.WARNING)
      } catch (soundError) {
        console.warn('Sound playback failed:', soundError)
      }
    } finally {
      setSubmitting(false)
    }
  }

  const handleEditTask = async (e) => {
    e.preventDefault()
    if (!editTaskForm.title.trim()) {
      toast.error('Task title is required')
      return
    }

    try {
      setSubmitting(true)
      const token = localStorage.getItem('token')

      // Calculate total estimated hours from subtasks
      let totalEstimatedHours = 0
      if (editTaskForm.subtasks && editTaskForm.subtasks.length > 0) {
        editTaskForm.subtasks.forEach(st => {
          totalEstimatedHours += ((st.estimatedDays || 0) * 8) + (st.estimatedHours || 0)
        })
      }

      const response = await fetch(`/api/projects/${projectId}/tasks/${editTaskForm._id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          title: editTaskForm.title,
          description: editTaskForm.description,
          priority: editTaskForm.priority,
          dueDate: editTaskForm.dueDate,
          subtasks: editTaskForm.subtasks,
          estimatedHours: totalEstimatedHours
        })
      })

      const data = await response.json()
      if (data.success) {
        playNotificationSound(NotificationSoundTypes.SUCCESS)
        toast.success(data.message || 'Task updated successfully')
        setShowEditTaskModal(false)
        setEditTaskForm(null)
        setSelectedTask(null)
        setNewSubtaskTitle('')
        mutateTasks()
      } else {
        playNotificationSound(NotificationSoundTypes.WARNING)
        toast.error(data.message)
      }
    } catch (error) {
      playNotificationSound(NotificationSoundTypes.WARNING)
      toast.error('Failed to update task')
    } finally {
      setSubmitting(false)
    }
  }

  // Handle task status change from Kanban drag-drop (only for tasks without subtasks)
  // This shows a reason modal first to require justification
  const handleKanbanStatusChange = async (task, newStatus) => {
    // Safety check: Don't allow status change for tasks with subtasks
    if (task.subtasks && task.subtasks.length > 0) {
      toast.error('Tasks with subtasks are auto-managed. Complete subtasks to update status.')
      return
    }

    // Safety check: Don't allow status change for tasks pending acceptance
    const isPendingAcceptance = task.assignmentStatus === 'pending' ||
      task.assignees?.some(a => a.assignmentStatus === 'pending')
    const hasAcceptedAssignee = task.assignees?.some(a => a.assignmentStatus === 'accepted')
    if (isPendingAcceptance && !hasAcceptedAssignee) {
      toast.error('Task must be accepted before changing status.')
      return
    }

    // Show reason modal instead of directly changing
    setPendingStatusChange({ task, newStatus })
    setStatusChangeReason('')
    setShowReasonModal(true)
  }

  // Execute status change after reason is provided
  const executeStatusChange = async () => {
    if (!pendingStatusChange) return

    if (!statusChangeReason.trim()) {
      toast.error('Please provide a reason for this status change')
      return
    }

    const { task, newStatus } = pendingStatusChange

    try {
      setUpdatingTaskId(task._id)
      setShowReasonModal(false)
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/projects/${projectId}/tasks/${task._id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          status: newStatus,
          statusChangeReason: statusChangeReason.trim()
        })
      })

      const data = await response.json()
      if (data.success) {
        // Update local state immediately
        setTasks(prevTasks => prevTasks.map(t =>
          t._id === task._id ? { ...t, status: newStatus } : t
        ))
        if (newStatus === 'completed') {
          playNotificationSound(NotificationSoundTypes.SUCCESS)
        } else {
          playNotificationSound(NotificationSoundTypes.UPDATE)
        }
        toast.success(`Task moved to ${newStatus.replace('-', ' ')}`)
        mutateTasks()
        mutateCompletionStatus() // Update completion button state
      } else {
        playNotificationSound(NotificationSoundTypes.WARNING)
        toast.error(data.message || 'Failed to update task status')
      }
    } catch (error) {
      console.error('Update task status error:', error)
      playNotificationSound(NotificationSoundTypes.WARNING)
      toast.error('Failed to update task status')
    } finally {
      setUpdatingTaskId(null)
      setPendingStatusChange(null)
      setStatusChangeReason('')
    }
  }

  const handleToggleSubtask = async (taskId, subtaskId, currentCompleted, task = null) => {
    if (!subtaskId) {
      toast.error('Subtask ID is missing')
      return
    }

    // Check if task is pending acceptance - don't allow subtask marking
    const taskToCheck = task || tasks.find(t => t._id === taskId) || selectedTask
    if (taskToCheck) {
      const isPendingAcceptance = taskToCheck.assignmentStatus === 'pending' ||
        taskToCheck.assignees?.some(a => a.assignmentStatus === 'pending')
      const hasAcceptedAssignee = taskToCheck.assignees?.some(a => a.assignmentStatus === 'accepted')
      if (isPendingAcceptance && !hasAcceptedAssignee) {
        toast.error('Task must be accepted before marking subtasks.')
        return
      }
    }

    try {
      const token = localStorage.getItem('token')
      const idToSend = typeof subtaskId === 'object' && subtaskId._id
        ? subtaskId._id.toString()
        : subtaskId.toString ? subtaskId.toString() : String(subtaskId)

      const response = await fetch(`/api/projects/${projectId}/tasks/${taskId}/subtasks`, {
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
        // Update the selected task's subtasks locally
        setSelectedTask(prev => {
          if (!prev) return prev
          const updatedSubtasks = prev.subtasks.map(st => {
            if ((st._id?.toString() || st._id) === (subtaskId?.toString() || subtaskId)) {
              // Check if API returned pending acceptance (multi-assignee task)
              if (data.data.subtask) {
                return {
                  ...st,
                  ...data.data.subtask,
                  completedAt: data.data.subtask.completedAt || (!currentCompleted ? new Date() : null)
                }
              }
              return {
                ...st,
                completed: !currentCompleted,
                completedAt: !currentCompleted ? new Date() : null,
                pendingAcceptance: false
              }
            }
            return st
          })
          return {
            ...prev,
            subtasks: updatedSubtasks,
            progressPercentage: data.data.progressPercentage,
            status: data.data.taskStatus || prev.status
          }
        })
        // Refresh tasks to update the list
        mutateTasks()

        // Show appropriate toast message based on response
        if (data.data.subtask?.pendingAcceptance) {
          toast.success('Waiting for other assignees to accept completion', { icon: '⏳' })
        } else if (data.data.statusChanged) {
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
    }
  }

  // Accept subtask completion (for multi-assignee tasks)
  const handleAcceptSubtaskCompletion = async (taskId, subtaskId) => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/projects/${projectId}/tasks/${taskId}/subtasks`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          subtaskId,
          action: 'acceptCompletion'
        })
      })

      const data = await response.json()
      if (data.success) {
        // Update subtask locally
        setSelectedTask(prev => {
          if (!prev) return prev
          const updatedSubtasks = prev.subtasks.map(st =>
            (st._id?.toString() || st._id) === subtaskId
              ? { ...st, ...data.data.subtask }
              : st
          )
          return {
            ...prev,
            subtasks: updatedSubtasks,
            progressPercentage: data.data.progressPercentage,
            status: data.data.taskStatus || prev.status
          }
        })
        mutateTasks()

        if (data.data.allAccepted) {
          playNotificationSound(NotificationSoundTypes.SUCCESS)
          toast.success('All assignees accepted! Subtask is now complete.', { icon: '✅' })
        } else {
          toast.success('Your acceptance has been recorded', { icon: '👍' })
        }
      } else {
        toast.error(data.message)
      }
    } catch (error) {
      console.error('Accept subtask error:', error)
      toast.error('Failed to accept completion')
    }
  }

  // Reject subtask completion (for multi-assignee tasks)
  const handleRejectSubtaskCompletion = async (taskId, subtaskId, reason) => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/projects/${projectId}/tasks/${taskId}/subtasks`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          subtaskId,
          action: 'rejectCompletion',
          reason: reason || 'Rejected by team member'
        })
      })

      const data = await response.json()
      if (data.success) {
        // Update subtask locally - reset to incomplete
        setSelectedTask(prev => {
          if (!prev) return prev
          const updatedSubtasks = prev.subtasks.map(st =>
            (st._id?.toString() || st._id) === subtaskId
              ? { ...st, ...data.data.subtask, pendingAcceptance: false, completed: false }
              : st
          )
          return {
            ...prev,
            subtasks: updatedSubtasks,
            progressPercentage: data.data.progressPercentage,
            status: data.data.taskStatus || prev.status
          }
        })
        mutateTasks()
        playNotificationSound(NotificationSoundTypes.WARNING)
        toast.success('Subtask completion rejected and reset', { icon: '↩️' })
      } else {
        toast.error(data.message)
      }
    } catch (error) {
      console.error('Reject subtask error:', error)
      toast.error('Failed to reject completion')
    }
  }

  const handleAddSubtaskComment = async (taskId, subtaskId, commentText) => {
    if (!commentText || !commentText.trim()) {
      toast.error('Comment text is required')
      return
    }

    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/projects/${projectId}/tasks/${taskId}/subtasks/${subtaskId}/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ text: commentText.trim() })
      })

      const data = await response.json()
      if (data.success) {
        // Update the selected task's subtasks locally with new comment
        setSelectedTask(prev => {
          if (!prev) return prev
          const updatedSubtasks = prev.subtasks.map(st => {
            if ((st._id?.toString() || st._id) === (subtaskId?.toString() || subtaskId)) {
              return {
                ...st,
                comments: [...(st.comments || []), data.data]
              }
            }
            return st
          })
          return { ...prev, subtasks: updatedSubtasks }
        })
        // Refresh timeline
        mutateTimeline()
        toast.success('Comment added')
      } else {
        toast.error(data.message || 'Failed to add comment')
      }
    } catch (error) {
      console.error('Add subtask comment error:', error)
      toast.error('Failed to add comment')
    }
  }

  const handleUpdateTaskStatus = async (taskId, newStatus) => {
    try {
      setUpdatingTaskId(taskId)
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/projects/${projectId}/tasks/${taskId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ status: newStatus })
      })

      const data = await response.json()
      if (data.success) {
        // Play appropriate sound based on new status
        if (newStatus === 'completed') {
          playNotificationSound(NotificationSoundTypes.SUCCESS)
        } else {
          playNotificationSound(NotificationSoundTypes.UPDATE)
        }
        toast.success('Task updated')
        setSelectedTask(null)
        mutateTasks()
        mutateProject()
      } else {
        playNotificationSound(NotificationSoundTypes.WARNING)
        toast.error(data.message)
      }
    } catch (error) {
      playNotificationSound(NotificationSoundTypes.WARNING)
      toast.error('Failed to update task')
    } finally {
      setUpdatingTaskId(null)
    }
  }

  const handleDeleteTask = async (taskId) => {
    try {
      setSubmitting(true)
      const token = localStorage.getItem('token')

      // If project head, delete directly. Otherwise, create a deletion request
      if (isProjectHead) {
        const response = await fetch(`/api/projects/${projectId}/tasks/${taskId}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` }
        })

        const data = await response.json()
        if (data.success) {
          playNotificationSound(NotificationSoundTypes.POP)
          toast.success('Task deleted successfully')
          setSelectedTask(null)
          setShowDeleteTaskModal(false)
          setTaskToDelete(null)
          setDeleteReason('')
          mutateTasks()
          mutateProject()
          mutateCompletionStatus() // Update completion button state
        } else {
          playNotificationSound(NotificationSoundTypes.WARNING)
          toast.error(data.message)
        }
      } else {
        // Create deletion request (for non-project heads)
        const response = await fetch(`/api/projects/${projectId}/tasks/${taskId}/delete-request`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ reason: deleteReason })
        })

        const data = await response.json()
        if (data.success) {
          playNotificationSound(NotificationSoundTypes.ALERT)
          toast.success('Deletion request submitted to project head')
          setSelectedTask(null)
          setShowDeleteTaskModal(false)
          setTaskToDelete(null)
          setDeleteReason('')
        } else {
          playNotificationSound(NotificationSoundTypes.WARNING)
          toast.error(data.message)
        }
      }
    } catch (error) {
      playNotificationSound(NotificationSoundTypes.WARNING)
      toast.error('Failed to process deletion')
    } finally {
      setSubmitting(false)
    }
  }

  // Handle task reassignment (for rejected assignments)
  const handleReassignTask = async () => {
    if (!reassignTask || !reassignToId) {
      toast.error('Please select a team member to reassign')
      return
    }

    try {
      setSubmitting(true)
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/projects/${projectId}/tasks/${reassignTask._id}/reassign`, {
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
        setReassignTask(null)
        setReassignToId('')
        mutateTasks()
      } else {
        playNotificationSound(NotificationSoundTypes.WARNING)
        toast.error(data.message)
      }
    } catch (error) {
      toast.error('Failed to reassign task')
    } finally {
      setSubmitting(false)
    }
  }

  // Handle accept/reject task assignment from modal
  const handleRespondToTaskAssignment = async (taskId, action, reason = '') => {
    try {
      setUpdatingTaskId(taskId)
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/projects/${projectId}/tasks/${taskId}/respond`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ action, reason })
      })

      const data = await response.json()
      if (data.success) {
        if (action === 'accept') {
          playNotificationSound(NotificationSoundTypes.SUCCESS)
        } else {
          playNotificationSound(NotificationSoundTypes.UPDATE)
        }
        toast.success(data.message)
        setSelectedTask(null)
        mutateTasks()
      } else {
        playNotificationSound(NotificationSoundTypes.WARNING)
        toast.error(data.message)
      }
    } catch (error) {
      playNotificationSound(NotificationSoundTypes.WARNING)
      toast.error('Failed to respond to assignment')
    } finally {
      setUpdatingTaskId(null)
    }
  }

  const handleAddComment = async (e) => {
    e.preventDefault()
    if (!newComment.trim()) return

    try {
      setSubmitting(true)
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/projects/${projectId}/timeline`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ content: newComment })
      })

      const data = await response.json()
      if (data.success) {
        toast.success('Comment added')
        setNewComment('')
        mutateTimeline()
      } else {
        toast.error(data.message)
      }
    } catch (error) {
      toast.error('Failed to add comment')
    } finally {
      setSubmitting(false)
    }
  }

  // Handle project head marking project as complete
  const handleMarkComplete = async () => {
    if (!completionStatus.canComplete) {
      toast.error(`Cannot complete project. ${completionStatus.totalTasks - completionStatus.completedTasks} task(s) are not completed.`)
      return
    }

    try {
      setSubmitting(true)
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/projects/${projectId}/complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      })

      const data = await response.json()
      if (data.success) {
        playNotificationSound(NotificationSoundTypes.SUCCESS)
        toast.success('Project marked as complete!')
        mutateProject()
        mutateCompletionStatus()
      } else {
        toast.error(data.message)
      }
    } catch (error) {
      toast.error('Failed to mark project as complete')
    } finally {
      setSubmitting(false)
    }
  }

  // Handle member requesting project completion (sends to project head for approval)
  const handleRequestCompletion = async () => {
    if (!completionStatus.allTasksCompleted) {
      toast.error(`Cannot request completion. ${completionStatus.totalTasks - completionStatus.completedTasks} task(s) are not completed.`)
      return
    }

    try {
      setSubmitting(true)
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/projects/${projectId}/approval`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ remark: 'All tasks completed. Project ready for review.' })
      })

      const data = await response.json()
      if (data.success) {
        playNotificationSound(NotificationSoundTypes.SUCCESS)
        toast.success('Completion request sent to project head')
        mutateProject()
      } else {
        toast.error(data.message)
      }
    } catch (error) {
      toast.error('Failed to request completion')
    } finally {
      setSubmitting(false)
    }
  }

  const handleApprovalResponse = async (approve) => {
    if (!project.pendingApproval) return

    try {
      setSubmitting(true)
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/projects/${projectId}/approval`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          approvalId: project.pendingApproval._id,
          action: approve ? 'approve' : 'reject',
          remark: approve ? 'Project approved' : 'More work needed'
        })
      })

      const data = await response.json()
      if (data.success) {
        toast.success(data.message)
        mutateProject()
      } else {
        toast.error(data.message)
      }
    } catch (error) {
      toast.error('Failed to respond to approval')
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

  const formatDateTime = (date) => {
    return new Date(date).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    })
  }

  if (loading) {
    return (
      <div className="page-container">
        <div className="space-y-6">
          {/* Header skeleton */}
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-4">
              <Skeleton className="w-10 h-10 rounded-lg" />
              <div className="space-y-2">
                <Skeleton className="w-64 h-8 rounded-lg" />
                <Skeleton className="w-96 h-4 rounded-lg" />
              </div>
            </div>
            <div className="flex gap-2">
              <Skeleton className="w-20 h-10 rounded-lg" />
              <Skeleton className="w-32 h-10 rounded-lg" />
            </div>
          </div>
          {/* Tabs skeleton */}
          <div className="flex gap-4">
            {[1, 2, 3, 4, 5].map(i => (
              <Skeleton key={i} className="w-24 h-10 rounded-lg" />
            ))}
          </div>
          {/* Content skeleton */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Skeleton className="w-full h-48 rounded-lg" />
            <Skeleton className="w-full h-48 rounded-lg" />
          </div>
          <Skeleton className="w-full h-64 rounded-lg" />
        </div>
      </div>
    )
  }

  if (!project) {
    return null
  }

  const isProjectHead = project.isProjectHead
  const isCreator = project.isCreator
  const canManage = isProjectHead || isCreator || (user && ['admin'].includes(user.role))
  const isAcceptedMember = project.currentUserInvitationStatus === 'accepted' || isProjectHead || isCreator || (user && ['admin'].includes(user.role))
  const isPendingInvitation = project.currentUserInvitationStatus === 'invited'
  const isOverdue = new Date(project.endDate) < new Date() && !['completed', 'approved', 'archived'].includes(project.status)

  // Task grouping by status
  const tasksByStatus = {
    'todo': tasks.filter(t => t.status === 'todo'),
    'in-progress': tasks.filter(t => t.status === 'in-progress'),
    'review': tasks.filter(t => t.status === 'review'),
    'completed': tasks.filter(t => t.status === 'completed')
  }

  return (
    <div className="page-container">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-start">
          <button
            onClick={() => router.push('/dashboard/projects')}
            className="mr-4 p-2 hover:bg-gray-100 rounded-lg transition-colors mt-1"
          >
            <FaArrowLeft className="text-gray-600" />
          </button>
          <div>
            <div className="flex items-center gap-3 mb-2 flex-wrap">
              <h1 className="text-3xl font-bold text-gray-800">{project.name}</h1>
              {project.chatGroup && (
                <button
                  onClick={() => router.push(`/dashboard/chat?id=${project.chatGroup._id || project.chatGroup}`)}
                  className="p-2 bg-primary-100 text-primary-600 hover:bg-primary-200 rounded-lg transition-colors"
                  title="Open Project Chat"
                >
                  <FaComments className="w-5 h-5" />
                </button>
              )}
              <span className={`px-3 py-1 rounded-full text-sm font-medium ${isOverdue ? statusColors.overdue : statusColors[project.status]
                }`}>
                {isOverdue ? 'Overdue' : statusLabels[project.status]}
              </span>
              <span className={`px-2 py-1 rounded-full text-xs font-medium ${priorityColors[project.priority]}`}>
                {project.priority}
              </span>
            </div>
            {/* Description Section */}
            {project.description ? (
              <div className="mt-3 bg-gray-50 rounded-lg p-4 border border-gray-100 max-w-4xl">
                <p className={`text-gray-600 text-sm leading-relaxed whitespace-pre-wrap ${!isDescriptionExpanded && project.description.length > 200 ? 'line-clamp-3' : ''
                  }`}>
                  {project.description}
                </p>
                {project.description.length > 200 && (
                  <button
                    onClick={() => setIsDescriptionExpanded(!isDescriptionExpanded)}
                    className="mt-2 text-primary-600 hover:text-primary-700 text-sm font-medium flex items-center gap-1"
                  >
                    {isDescriptionExpanded ? (
                      <>
                        <FaChevronUp className="w-3 h-3" />
                        Show Less
                      </>
                    ) : (
                      <>
                        <FaChevronDown className="w-3 h-3" />
                        Read More
                      </>
                    )}
                  </button>
                )}
              </div>
            ) : (
              <p className="text-gray-400 text-sm italic mt-2">No description provided</p>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2 flex-wrap">
          {/* Edit button - for project head, creator, or admin */}
          {canManage && (
            <button
              onClick={() => router.push(`/dashboard/projects/${projectId}/edit`)}
              className="btn-secondary flex items-center"
            >
              <FaEdit className="mr-2" />
              Edit
            </button>
          )}

          {/* Mark Complete button - ONLY visible for Project Head */}
          {isProjectHead && project.status !== 'completed' && (
            <button
              onClick={handleMarkComplete}
              disabled={submitting || !completionStatus.canComplete}
              className={`flex items-center px-4 py-2 rounded-lg font-medium transition-all ${completionStatus.canComplete
                  ? 'bg-green-600 hover:bg-green-700 text-white'
                  : 'bg-gray-200 text-gray-500 cursor-not-allowed'
                }`}
              title={completionStatus.canComplete
                ? 'Mark project as complete'
                : `${completionStatus.totalTasks - completionStatus.completedTasks} task(s) not completed`}
            >
              <FaCheckCircle className="mr-2" />
              Mark Complete
              {!completionStatus.canComplete && completionStatus.totalTasks > 0 && (
                <span className="ml-2 text-xs bg-gray-300 px-2 py-0.5 rounded-full">
                  {completionStatus.completedTasks}/{completionStatus.totalTasks}
                </span>
              )}
            </button>
          )}

          {/* Request Completion button - for project MEMBERS (not heads), green, permanent */}
          {!isProjectHead && isAcceptedMember && project.status === 'ongoing' && (
            <button
              onClick={handleRequestCompletion}
              disabled={submitting || !completionStatus.allTasksCompleted}
              className={`flex items-center px-4 py-2 rounded-lg font-medium transition-all ${completionStatus.allTasksCompleted
                  ? 'bg-green-600 hover:bg-green-700 text-white'
                  : 'bg-gray-200 text-gray-500 cursor-not-allowed'
                }`}
              title={completionStatus.allTasksCompleted
                ? 'Request project completion approval from project head'
                : `${completionStatus.totalTasks - completionStatus.completedTasks} task(s) not completed`}
            >
              <FaCheckCircle className="mr-2" />
              Request Completion
              {!completionStatus.allTasksCompleted && completionStatus.totalTasks > 0 && (
                <span className="ml-2 text-xs bg-gray-300 px-2 py-0.5 rounded-full">
                  {completionStatus.completedTasks}/{completionStatus.totalTasks}
                </span>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Pending Invitation Banner */}
      {isPendingInvitation && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6 flex items-center justify-between">
          <div>
            <p className="font-medium text-yellow-800">You have been invited to this project</p>
            <p className="text-sm text-yellow-700">Accept to participate or reject to decline</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowRejectInvitationModal(true)}
              disabled={submitting}
              className="px-4 py-2 border border-red-300 text-red-600 rounded-lg hover:bg-red-50"
            >
              Reject
            </button>
            <Button
              onPress={() => handleRespondToInvitation('accept')}
              isDisabled={submitting}
              color="primary"
            >
              Accept Invitation
            </Button>
          </div>
        </div>
      )}

      {/* Pending Approval Banner for Project Head */}
      {project.pendingApproval && isProjectHead && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-blue-800">Completion Approval Required</p>
              <p className="text-sm text-blue-700">
                {project.pendingApproval.requestedBy?.firstName} {project.pendingApproval.requestedBy?.lastName} has marked this project as complete
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => handleApprovalResponse(false)}
                disabled={submitting}
                className="px-4 py-2 border border-red-300 text-red-600 rounded-lg hover:bg-red-50"
              >
                Reject
              </button>
              <Button
                onPress={() => handleApprovalResponse(true)}
                isDisabled={submitting}
                color="primary"
              >
                Approve
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <HiOutlineCalendarDays className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-800">{formatDate(project.endDate)}</p>
              <p className="text-sm text-gray-500">Deadline</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 rounded-lg">
              <HiOutlineChartBar className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-800">{project.completionPercentage || 0}%</p>
              <p className="text-sm text-gray-500">Progress</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-100 rounded-lg">
              <HiOutlineClipboardDocumentList className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-800">
                {project.taskStats?.completed || 0}/{project.taskStats?.total || 0}
              </p>
              <p className="text-sm text-gray-500">Tasks</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-orange-100 rounded-lg">
              <HiOutlineUsers className="w-5 h-5 text-orange-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-800">{project.members?.length || 0}</p>
              <p className="text-sm text-gray-500">Members</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-100 rounded-lg">
              <HiOutlineExclamationTriangle className="w-5 h-5 text-red-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-800">{project.taskStats?.overdue || 0}</p>
              <p className="text-sm text-gray-500">Overdue Tasks</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden border border-gray-100">
        <div className="">
          <nav className="flex overflow-x-auto">
            {[
              { id: 'overview', label: 'Overview', icon: HiOutlineChartBar },
              { id: 'tasks', label: 'Tasks', icon: HiOutlineClipboardDocumentList },
              { id: 'members', label: 'Members', icon: HiOutlineUsers },
              { id: 'notes', label: 'Notes', icon: HiOutlineDocumentText },
              { id: 'timeline', label: 'Activity', icon: HiOutlineChatBubbleLeftRight }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-6 py-4 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === tab.id
                    ? 'border-primary-500 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
              >
                <tab.icon className="w-5 h-5" />
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="p-6">
          {/* Overview Tab - Advanced Analytics */}
          {activeTab === 'overview' && (
            <ProjectOverview projectId={projectId} />
          )}

          {/* Tasks Tab */}
          {activeTab === 'tasks' && (
            <div>
              <div className="flex items-center justify-between mb-4">
                {/* Month Navigator */}
                <div className="flex items-center gap-1 border border-default-300 rounded-lg px-2 py-1.5">
                  <button
                    onClick={goToPrevProjectMonth}
                    className="p-1 rounded hover:bg-default-100 text-default-600 transition-colors"
                    title="Previous month"
                  >
                    <HiOutlineChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-sm font-medium text-default-700 min-w-[120px] text-center">{projectTaskMonthLabel}</span>
                  <button
                    onClick={goToNextProjectMonth}
                    disabled={isProjectCurrentMonth}
                    className={`p-1 rounded transition-colors ${isProjectCurrentMonth ? 'text-default-300 cursor-not-allowed' : 'hover:bg-default-100 text-default-600'}`}
                    title="Next month"
                  >
                    <HiOutlineChevronRight className="w-4 h-4" />
                  </button>
                </div>

                {isAcceptedMember && (
                  <Button
                    onPress={() => setShowCreateTask(true)}
                    color="primary"
                    startContent={<FaPlus className="mr-2" />}
                  >
                    Add Task
                  </Button>
                )}
              </div>

              {/* Kanban-style Board */}
              <KanbanBoard
                tasks={tasks}
                onTaskClick={setSelectedTask}
                onStatusChange={handleKanbanStatusChange}
                enableDragDrop={true}
              />
            </div>
          )}

          {/* Members Tab */}
          {activeTab === 'members' && (
            <div>
              <div className="space-y-3">
                {project.members?.map(member => (
                  <div
                    key={member._id}
                    className={`flex items-center justify-between p-4 rounded-lg ${member.isCurrentUser ? 'bg-primary-50 border border-primary-200' : 'bg-gray-50'
                      }`}
                  >
                    <div className="flex items-center">
                      <div className="w-10 h-10 rounded-full bg-primary-500 flex items-center justify-center text-white text-sm overflow-hidden">
                        {member.user?.profilePicture ? (
                          <img src={member.user.profilePicture} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <span>{member.user?.firstName?.[0]}{member.user?.lastName?.[0]}</span>
                        )}
                      </div>
                      <div className="ml-3">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-gray-800">
                            {member.user?.firstName} {member.user?.lastName}
                          </p>
                          {member.role === 'head' && (
                            <span className="px-2 py-0.5 bg-primary-100 text-primary-700 text-xs rounded-full">
                              Project Head
                            </span>
                          )}
                          {member.isCurrentUser && (
                            <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full">
                              You
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-500">{member.user?.email}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`px-3 py-1 rounded-full text-xs font-medium ${member.invitationStatus === 'accepted' ? 'bg-green-100 text-green-700' :
                          member.invitationStatus === 'invited' ? 'bg-yellow-100 text-yellow-700' :
                            'bg-red-100 text-red-700'
                        }`}>
                        {member.invitationStatus}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Timeline/Activity Tab */}
          {activeTab === 'timeline' && (
            <div>
              {/* Search Bar with Refresh Button */}
              <div className="mb-4 flex gap-3">
                  <div className="input-with-icon flex-1">
                  <HiOutlineMagnifyingGlass className="input-icon w-5 h-5" />
                  <input
                    type="text"
                    placeholder="Search activity..."
                    className="input input-search"
                  />
                </div>
                <Button
                  isIconOnly
                  variant="flat"
                  onPress={() => mutateTimeline()}
                  isDisabled={timelineLoading}
                  className="h-[42px] w-[42px]"
                  title="Refresh activity"
                >
                  <HiOutlineArrowPath className={`w-5 h-5 ${timelineLoading ? 'animate-spin' : ''}`} />
                </Button>
              </div>

              {/* Add Comment Form */}
              {isAcceptedMember && (
                <form onSubmit={handleAddComment} className="mb-6">
                  <div className="flex gap-3">
                    <input
                      type="text"
                      value={newComment}
                      onChange={(e) => setNewComment(e.target.value)}
                      placeholder="Add a comment or update..."
                      className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
                    />
                    <Button
                      type="submit"
                      isDisabled={submitting || !newComment.trim()}
                      color="primary"
                      startContent={<HiOutlineChatBubbleOvalLeftEllipsis className="w-5 h-5" />}
                    >
                      Post
                    </Button>
                  </div>
                </form>
              )}

              {/* GitHub-style Timeline with Branch Visualization */}
              <div className="relative">
                {/* Loading State */}
                {timelineLoading && !timelineError && (
                  <div className="flex items-center justify-center py-12">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
                      <p className="text-gray-500 text-sm">Loading activity...</p>
                    </div>
                  </div>
                )}

                {/* Error State */}
                {timelineError && !timelineLoading && (
                  <div className="text-center py-12">
                    <HiOutlineExclamationTriangle className="w-12 h-12 text-red-300 mx-auto mb-3" />
                    <p className="text-red-500 mb-3">{timelineError}</p>
                    <Button
                      onPress={() => mutateTimeline()}
                      color="primary"
                      size="sm"
                      startContent={<HiOutlineArrowPath className="w-4 h-4" />}
                    >
                      Retry
                    </Button>
                  </div>
                )}

                {/* Main vertical line - only show when we have timeline data */}
                {!timelineLoading && !timelineError && timeline.length > 0 && (
                  <div className="absolute left-5 top-0 bottom-0 w-0.5 bg-indigo-200 dark:bg-indigo-800" />
                )}

                {!timelineLoading && !timelineError && (
                  <div className="space-y-0">
                    {timeline.map((event, index) => {
                      // Get event type icon and color
                      const getEventStyle = (type) => {
                        switch (type) {
                          case 'task_created':
                            return { icon: HiOutlinePlus, bg: 'bg-blue-500', color: 'text-white', branch: 'blue' }
                          case 'task_completed':
                            return { icon: HiOutlineCheckCircle, bg: 'bg-green-500', color: 'text-white', branch: 'green' }
                          case 'task_rejected':
                          case 'task_review_rejected':
                            return { icon: HiOutlineXMark, bg: 'bg-red-500', color: 'text-white', branch: 'red' }
                          case 'task_assigned':
                            return { icon: HiOutlineUserPlus, bg: 'bg-purple-500', color: 'text-white', branch: 'purple' }
                          case 'subtask_completed':
                          case 'subtask_updated':
                            return { icon: HiOutlineCheck, bg: 'bg-teal-400', color: 'text-white', branch: 'teal', isSubLevel: true }
                          case 'comment_added':
                            return { icon: HiOutlineChatBubbleOvalLeftEllipsis, bg: 'bg-gray-400', color: 'text-white', branch: 'gray' }
                          case 'project_approved':
                            return { icon: HiOutlineCheckCircle, bg: 'bg-emerald-500', color: 'text-white', branch: 'emerald' }
                          case 'project_rejected':
                            return { icon: HiOutlineXMark, bg: 'bg-red-500', color: 'text-white', branch: 'red' }
                          case 'member_joined':
                            return { icon: HiOutlineUsers, bg: 'bg-indigo-500', color: 'text-white', branch: 'indigo' }
                          case 'status_changed':
                            return { icon: HiOutlineArrowPath, bg: 'bg-amber-500', color: 'text-white', branch: 'amber' }
                          default:
                            return { icon: HiOutlineHistory, bg: 'bg-gray-400', color: 'text-white', branch: 'gray' }
                        }
                      }
                      const style = getEventStyle(event.type)
                      const EventIcon = style.icon
                      const isSubLevel = style.isSubLevel || event.type.includes('subtask') || event.metadata?.isSubtask
                      const isLast = index === timeline.length - 1

                      return (
                        <div key={event._id} className="relative flex items-start group">
                          {/* Branch connector for sub-level items */}
                          {isSubLevel && (
                            <div className="absolute left-5 top-5 w-6 h-0.5 bg-gray-300" />
                          )}

                          {/* Node/Dot on the timeline */}
                          <div className={`relative z-10 flex-shrink-0 ${isSubLevel ? 'ml-6' : ''}`}>
                            <div className={`w-10 h-10 rounded-full ${style.bg} flex items-center justify-center shadow-md ring-4 ring-white`}>
                              <EventIcon className={`w-5 h-5 ${style.color}`} />
                            </div>
                            {/* Connector line to next item */}
                            {!isLast && (
                              <div className={`absolute top-10 left-1/2 -translate-x-1/2 w-0.5 h-6 ${isSubLevel ? 'bg-gray-200' : 'bg-transparent'
                                }`} />
                            )}
                          </div>

                          {/* Event Content */}
                          <div className={`flex-1 ml-4 pb-6 ${isSubLevel ? 'ml-4' : 'ml-4'}`}>
                            <div className={`p-4 rounded-xl border transition-all hover:shadow-md ${isSubLevel
                                ? 'bg-gray-50 border-gray-200 ml-2'
                                : 'bg-white border-gray-100 hover:border-gray-200'
                              }`}>
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                                <div className="flex items-center gap-2">
                                  {event.createdBy?.profilePicture ? (
                                    <img src={event.createdBy.profilePicture} alt="" className="w-6 h-6 rounded-full object-cover" />
                                  ) : (
                                    <div className="w-6 h-6 rounded-full bg-primary-100 flex items-center justify-center text-xs font-medium text-primary-700">
                                      {event.createdBy?.firstName?.[0]}{event.createdBy?.lastName?.[0]}
                                    </div>
                                  )}
                                  <span className="font-medium text-gray-800 text-sm">
                                    {event.createdBy?.firstName} {event.createdBy?.lastName}
                                  </span>
                                </div>
                                <span className={`text-xs px-2 py-0.5 rounded-full ${style.bg.replace('500', '100').replace('400', '100')
                                  } ${style.bg.replace('bg-', 'text-').replace('500', '700').replace('400', '700')}`}>
                                  {event.type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                                </span>
                                <span className="text-xs text-gray-400 ml-auto">{formatDateTime(event.createdAt)}</span>
                              </div>
                              <p className="text-gray-600 text-sm mt-1">{event.description}</p>

                              {/* Task link if present */}
                              {event.relatedTask && (
                                <div className="mt-2 inline-flex items-center gap-1 text-xs text-primary-600 bg-primary-50 px-2 py-1 rounded-md">
                                  <HiOutlineClipboardDocumentList className="w-3 h-3" />
                                  {event.relatedTask.title || 'Related Task'}
                                </div>
                              )}

                              {/* Show rejection details */}
                              {(event.metadata?.rejectionReason || event.metadata?.rejectionComment) && (
                                <div className="mt-3 p-3 bg-red-50 border border-red-100 rounded-lg">
                                  <p className="text-sm font-medium text-red-700 mb-1 flex items-center gap-1">
                                    <HiOutlineXMark className="w-4 h-4" />
                                    Rejection Details
                                  </p>
                                  <p className="text-sm text-red-600">{event.metadata.rejectionReason || event.metadata.rejectionComment}</p>
                                  {event.metadata.subtasksUnmarked && event.metadata.subtasksUnmarked.length > 0 && (
                                    <div className="mt-2 pt-2 border-t border-red-100">
                                      <p className="text-xs font-medium text-red-700 mb-1">Subtasks marked incomplete:</p>
                                      <ul className="text-xs text-red-600 list-disc list-inside">
                                        {event.metadata.subtasksUnmarked.map((st, idx) => (
                                          <li key={idx}>{st}</li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Show remark if present */}
                              {event.metadata?.remark && !event.metadata?.rejectionReason && !event.metadata?.rejectionComment && (
                                <div className={`mt-3 p-3 rounded-lg ${event.type === 'project_rejected' ? 'bg-red-50 border border-red-100' : 'bg-blue-50 border border-blue-100'
                                  }`}>
                                  <p className={`text-sm font-medium mb-1 ${event.type === 'project_rejected' ? 'text-red-700' : 'text-blue-700'
                                    }`}>Remark:</p>
                                  <p className={`text-sm ${event.type === 'project_rejected' ? 'text-red-600' : 'text-blue-600'
                                    }`}>{event.metadata.remark}</p>
                                </div>
                              )}

                              {event.commentContent && (
                                <div className="mt-3 p-3 bg-gray-50 rounded-lg border border-gray-100">
                                  <p className="text-gray-700 text-sm">{event.commentContent}</p>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {!timelineLoading && !timelineError && timeline.length === 0 && (
                  <div className="text-center py-12">
                    <HiOutlineHistory className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                    <p className="text-gray-500">No activity yet</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Notes Tab */}
          {activeTab === 'notes' && (
            <div>
              {/* Create Note Button */}
              {isAcceptedMember && !showCreateNote && !editingNote && (
                <Button
                  onPress={() => setShowCreateNote(true)}
                  color="primary"
                  startContent={<FaPlus />}
                  className="mb-6"
                >
                  Add Note
                </Button>
              )}

              {/* Create Note Form */}
              {showCreateNote && (
                <div className="mb-6 p-4 bg-gray-50 rounded-xl border border-gray-200">
                  <h4 className="font-semibold mb-4">Create New Note</h4>
                  <form onSubmit={handleCreateNote} className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Title (optional)
                      </label>
                      <input
                        type="text"
                        value={noteForm.title}
                        onChange={(e) => setNoteForm(prev => ({ ...prev, title: e.target.value }))}
                        placeholder="Note title..."
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Content <span className="text-red-500">*</span>
                      </label>
                      <textarea
                        value={noteForm.content}
                        onChange={(e) => setNoteForm(prev => ({ ...prev, content: e.target.value }))}
                        placeholder="Write your note..."
                        rows={4}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
                        required
                      />
                    </div>
                    <div className="flex items-center gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Color</label>
                        <div className="flex gap-2">
                          {Object.keys(noteColors).map(color => (
                            <button
                              key={color}
                              type="button"
                              onClick={() => setNoteForm(prev => ({ ...prev, color }))}
                              className={`w-8 h-8 rounded-lg border-2 ${noteColors[color]} ${noteForm.color === color ? 'ring-2 ring-primary-500 ring-offset-2' : ''
                                }`}
                              title={color}
                            />
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Visibility</label>
                        <Select
                          selectedKeys={[noteForm.visibility]}
                          onChange={(e) => setNoteForm(prev => ({ ...prev, visibility: e.target.value }))}
                          aria-label="Visibility"
                          classNames={{ trigger: "bg-white" }}
                        >
                          <SelectItem key="team">Team (All members)</SelectItem>
                          <SelectItem key="personal">Personal (Only me)</SelectItem>
                        </Select>
                      </div>
                    </div>
                    <div className="flex justify-end gap-3">
                      <Button
                        type="button"
                        onPress={() => {
                          setShowCreateNote(false)
                          setNoteForm({ title: '', content: '', color: 'yellow', visibility: 'team' })
                        }}
                        variant="flat"
                      >
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        isDisabled={submitting}
                        color="primary"
                      >
                        {submitting ? 'Creating...' : 'Create Note'}
                      </Button>
                    </div>
                  </form>
                </div>
              )}

              {/* Pinned Notes */}
              {notes.filter(n => n.isPinned).length > 0 && (
                <div className="mb-6">
                  <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-2">
                    <FaThumbtack className="text-primary-500" />
                    Pinned Notes
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {notes.filter(n => n.isPinned).map(note => (
                      <div
                        key={note._id}
                        className={`p-4 rounded-xl border-2 shadow-sm ${noteColors[note.color]} relative`}
                      >
                        {editingNote === note._id ? (
                          <div className="space-y-3">
                            <input
                              type="text"
                              value={noteForm.title}
                              onChange={(e) => setNoteForm(prev => ({ ...prev, title: e.target.value }))}
                              placeholder="Note title..."
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white"
                            />
                            <textarea
                              value={noteForm.content}
                              onChange={(e) => setNoteForm(prev => ({ ...prev, content: e.target.value }))}
                              placeholder="Write your note..."
                              rows={3}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none bg-white"
                            />
                            <div className="flex gap-2">
                              {Object.keys(noteColors).map(color => (
                                <button
                                  key={color}
                                  type="button"
                                  onClick={() => setNoteForm(prev => ({ ...prev, color }))}
                                  className={`w-6 h-6 rounded border ${noteColors[color]} ${noteForm.color === color ? 'ring-2 ring-primary-500' : ''
                                    }`}
                                />
                              ))}
                            </div>
                            <div className="flex justify-end gap-2">
                              <button
                                onClick={cancelEditNote}
                                className="px-3 py-1 text-sm text-gray-600 hover:bg-white/50 rounded"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={() => handleUpdateNote(note._id)}
                                disabled={submitting}
                                className="px-3 py-1 text-sm bg-primary-500 text-white rounded hover:bg-primary-600"
                              >
                                Save
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="absolute top-2 right-2 flex items-center gap-1">
                              {note.visibility === 'personal' && (
                                <FaLock className="text-gray-400 text-xs" title="Personal note" />
                              )}
                              <button
                                onClick={() => handleTogglePinNote(note)}
                                className="p-1 hover:bg-white/50 rounded text-primary-500"
                                title="Unpin"
                              >
                                <FaThumbtack />
                              </button>
                              {(note.createdBy?._id === user?.employeeId || note.createdBy?._id === currentEmployeeId) && (
                                <button
                                  onClick={() => startEditNote(note)}
                                  className="p-1 hover:bg-white/50 rounded text-gray-500"
                                  title="Edit"
                                >
                                  <FaEdit />
                                </button>
                              )}
                              {(note.createdBy?._id === user?.employeeId || note.createdBy?._id === currentEmployeeId || isProjectHead) && (
                                <button
                                  onClick={() => handleDeleteNote(note._id)}
                                  className="p-1 hover:bg-white/50 rounded text-red-500"
                                  title="Delete"
                                >
                                  <FaTrash />
                                </button>
                              )}
                            </div>
                            {note.title && (
                              <h5 className="font-semibold text-gray-800 mb-2 pr-20">{note.title}</h5>
                            )}
                            <p className="text-gray-700 whitespace-pre-wrap pr-8">{note.content}</p>
                            <div className="mt-3 pt-2 border-t border-gray-200/50 flex items-center gap-2 text-xs text-gray-500">
                              <span>{note.createdBy?.firstName} {note.createdBy?.lastName}</span>
                              <span>•</span>
                              <span>{formatDateTime(note.createdAt)}</span>
                            </div>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* All Notes */}
              <div>
                {notes.filter(n => !n.isPinned).length > 0 && (
                  <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
                    Notes
                  </h4>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {notes.filter(n => !n.isPinned).map(note => (
                    <div
                      key={note._id}
                      className={`p-4 rounded-xl border-2 shadow-sm ${noteColors[note.color]} relative`}
                    >
                      {editingNote === note._id ? (
                        <div className="space-y-3">
                          <input
                            type="text"
                            value={noteForm.title}
                            onChange={(e) => setNoteForm(prev => ({ ...prev, title: e.target.value }))}
                            placeholder="Note title..."
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white"
                          />
                          <textarea
                            value={noteForm.content}
                            onChange={(e) => setNoteForm(prev => ({ ...prev, content: e.target.value }))}
                            placeholder="Write your note..."
                            rows={3}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none bg-white"
                          />
                          <div className="flex gap-2">
                            {Object.keys(noteColors).map(color => (
                              <button
                                key={color}
                                type="button"
                                onClick={() => setNoteForm(prev => ({ ...prev, color }))}
                                className={`w-6 h-6 rounded border ${noteColors[color]} ${noteForm.color === color ? 'ring-2 ring-primary-500' : ''
                                  }`}
                              />
                            ))}
                          </div>
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={cancelEditNote}
                              className="px-3 py-1 text-sm text-gray-600 hover:bg-white/50 rounded"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => handleUpdateNote(note._id)}
                              disabled={submitting}
                              className="px-3 py-1 text-sm bg-primary-500 text-white rounded hover:bg-primary-600"
                            >
                              Save
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="absolute top-2 right-2 flex items-center gap-1">
                            {note.visibility === 'personal' && (
                              <FaLock className="text-gray-400 text-xs" title="Personal note" />
                            )}
                            <button
                              onClick={() => handleTogglePinNote(note)}
                              className="p-1 hover:bg-white/50 rounded text-gray-400 hover:text-primary-500"
                              title="Pin"
                            >
                              <FaThumbtack />
                            </button>
                            {(note.createdBy?._id === user?.employeeId || note.createdBy?._id === currentEmployeeId) && (
                              <button
                                onClick={() => startEditNote(note)}
                                className="p-1 hover:bg-white/50 rounded text-gray-500"
                                title="Edit"
                              >
                                <FaEdit />
                              </button>
                            )}
                            {(note.createdBy?._id === user?.employeeId || note.createdBy?._id === currentEmployeeId || isProjectHead) && (
                              <button
                                onClick={() => handleDeleteNote(note._id)}
                                className="p-1 hover:bg-white/50 rounded text-red-500"
                                title="Delete"
                              >
                                <FaTrash />
                              </button>
                            )}
                          </div>
                          {note.title && (
                            <h5 className="font-semibold text-gray-800 mb-2 pr-20">{note.title}</h5>
                          )}
                          <p className="text-gray-700 whitespace-pre-wrap pr-8">{note.content}</p>
                          <div className="mt-3 pt-2 border-t border-gray-200/50 flex items-center gap-2 text-xs text-gray-500">
                            <span>{note.createdBy?.firstName} {note.createdBy?.lastName}</span>
                            <span>•</span>
                            <span>{formatDateTime(note.createdAt)}</span>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>

                {notes.length === 0 && !showCreateNote && (
                  <div className="text-center py-12">
                    <FaStickyNote className="text-4xl text-gray-300 mx-auto mb-3" />
                    <p className="text-gray-500">No notes yet</p>
                    {isAcceptedMember && (
                      <button
                        onClick={() => setShowCreateNote(true)}
                        className="mt-4 text-primary-500 hover:text-primary-600 font-medium"
                      >
                        Create the first note
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Create Task Modal */}
      <ModalPortal isOpen={showCreateTask}>
        <div className="modal-overlay">
          <div className="bg-white rounded-[30px] shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col animate-modal-enter">
            <div className="px-6 py-4 bg-gray-50 flex items-center justify-between flex-shrink-0">
              <h3 className="text-xl font-bold text-gray-900">Create New Task</h3>
              <button
                onClick={() => setShowCreateTask(false)}
                className="p-2 hover:bg-gray-100 rounded-lg"
              >
                <FaTimes />
              </button>
            </div>

            <form onSubmit={handleCreateTask} className="p-4 space-y-4 overflow-y-auto flex-1">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Task Title <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={taskForm.title}
                  onChange={(e) => setTaskForm(prev => ({ ...prev, title: e.target.value }))}
                  placeholder="Enter task title"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  value={taskForm.description}
                  onChange={(e) => setTaskForm(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Describe the task..."
                  rows={3}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
                  <Select
                    selectedKeys={[taskForm.priority]}
                    onChange={(e) => setTaskForm(prev => ({ ...prev, priority: e.target.value }))}
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
                    value={taskForm.dueDate}
                    onChange={(e) => setTaskForm(prev => ({ ...prev, dueDate: e.target.value }))}
                    min={new Date().toISOString().split('T')[0]}
                    max={project?.endDate ? new Date(project.endDate).toISOString().split('T')[0] : undefined}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                  {project?.endDate && (
                    <p className="text-xs text-gray-500 mt-1">
                      Project deadline: {new Date(project.endDate).toLocaleDateString()}
                    </p>
                  )}
                </div>
              </div>

              {/* Assignees */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Assign To</label>
                <div className="space-y-2 max-h-40 overflow-y-auto border border-gray-200 rounded-lg p-2">
                  {/* Deduplicate members by user._id */}
                  {(() => {
                    const seenIds = new Set()
                    return project.members?.filter(m => {
                      if (m.invitationStatus !== 'accepted') return false
                      if (!m.user?._id) return false
                      const memberId = m.user._id.toString()
                      if (seenIds.has(memberId)) return false
                      seenIds.add(memberId)
                      return true
                    }).map(member => (
                      <label key={member.user._id} className="flex items-center gap-2 p-2 hover:bg-gray-50 rounded cursor-pointer">
                        <input
                          type="checkbox"
                          checked={taskForm.assigneeIds.includes(member.user._id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setTaskForm(prev => ({
                                ...prev,
                                assigneeIds: [...prev.assigneeIds, member.user._id]
                              }))
                            } else {
                              setTaskForm(prev => ({
                                ...prev,
                                assigneeIds: prev.assigneeIds.filter(id => id !== member.user._id)
                              }))
                            }
                          }}
                          className="rounded border-gray-300 text-primary-500 focus:ring-primary-500"
                        />
                        <span className="text-sm text-gray-700">
                          {member.user.firstName} {member.user.lastName}
                        </span>
                      </label>
                    ))
                  })()}
                </div>
              </div>

              {/* Attachments */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Attachments</label>
                <div className="flex items-center gap-3">
                  <input
                    ref={taskAttachmentInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => handleTaskAttachmentUpload(e.target.files)}
                  />
                  <button
                    type="button"
                    onClick={() => taskAttachmentInputRef.current?.click()}
                    disabled={uploadingTaskAttachments}
                    className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm disabled:opacity-50"
                  >
                    {uploadingTaskAttachments ? 'Uploading...' : 'Add Attachments'}
                  </button>
                  <span className="text-xs text-gray-500">Any file type • Max 10MB each</span>
                </div>

                {taskForm.attachments?.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {taskForm.attachments.map((file, index) => (
                      <div key={`${file.url}-${index}`} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg border border-gray-200">
                        <div className="min-w-0">
                          <p className="text-sm text-gray-700 truncate">{file.name}</p>
                          <p className="text-xs text-gray-500">{formatFileSize(file.size)}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setTaskForm(prev => ({
                            ...prev,
                            attachments: prev.attachments.filter((_, i) => i !== index)
                          }))}
                          className="p-1.5 text-red-500 hover:text-red-700"
                        >
                          <FaTimes className="text-sm" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Subtasks */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Subtasks {taskForm.subtasks.length > 0 && `(${taskForm.subtasks.length})`}
                </label>
                <div className="space-y-2 mb-3">
                  {taskForm.subtasks.map((subtask, index) => (
                    <div key={index} className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg group">
                      <span className="text-sm text-gray-700 flex-1">{subtask.title}</span>
                      <button
                        type="button"
                        onClick={() => {
                          setTaskForm(prev => ({
                            ...prev,
                            subtasks: prev.subtasks.filter((_, i) => i !== index)
                          }))
                        }}
                        className="opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-700 transition-opacity"
                      >
                        <FaTimes className="text-sm" />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newSubtaskTitle}
                    onChange={(e) => setNewSubtaskTitle(e.target.value)}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        if (newSubtaskTitle.trim()) {
                          setTaskForm(prev => ({
                            ...prev,
                            subtasks: [...prev.subtasks, { title: newSubtaskTitle.trim(), completed: false }]
                          }))
                          setNewSubtaskTitle('')
                        }
                      }
                    }}
                    placeholder="Add a subtask..."
                    className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (newSubtaskTitle.trim()) {
                        setTaskForm(prev => ({
                          ...prev,
                          subtasks: [...prev.subtasks, { title: newSubtaskTitle.trim(), completed: false }]
                        }))
                        setNewSubtaskTitle('')
                      }
                    }}
                    className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 text-sm"
                  >
                    <FaPlus />
                  </button>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <Button
                  type="button"
                  onPress={() => setShowCreateTask(false)}
                  variant="flat"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  isDisabled={submitting || uploadingTaskAttachments}
                  color="primary"
                >
                  {uploadingTaskAttachments
                    ? 'Uploading attachments...'
                    : (submitting ? 'Creating...' : 'Create Task')}
                </Button>
              </div>
            </form>
          </div>
        </div>
      </ModalPortal>

      {/* Task ETA Modal (for self-assignment) */}
      <ModalPortal isOpen={showTaskEtaModal && !!pendingTaskData}>
        {pendingTaskData && <div className="modal-overlay">
          <div className="bg-white rounded-[30px] shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col animate-modal-enter">
            <div className="px-6 py-4 bg-gray-50 flex items-center justify-between">
              <h3 className="text-xl font-bold text-gray-900">Set Your ETA</h3>
              <button
                onClick={() => {
                  setShowTaskEtaModal(false)
                  setPendingTaskData(null)
                  setTaskEta({ days: '', hours: '' })
                  setSubtaskEtas({})
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <FaTimes />
              </button>
            </div>
            <div className="p-6 overflow-y-auto flex-1">
              <p className="text-gray-600 mb-4">
                You&apos;re assigning this task to yourself. {pendingTaskData.subtasks?.length > 0
                  ? 'Please provide an ETA for each subtask:'
                  : 'How long do you estimate it will take?'}
              </p>
              <div className="mb-4">
                <p className="font-medium text-gray-800 mb-2">{pendingTaskData.title}</p>
                {pendingTaskData.description && (
                  <p className="text-sm text-gray-500">{pendingTaskData.description}</p>
                )}
              </div>

              {/* Subtask-wise ETAs */}
              {pendingTaskData.subtasks?.length > 0 ? (
                <div className="space-y-4">
                  {pendingTaskData.subtasks.map((subtask, index) => (
                    <div key={index} className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                      <p className="font-medium text-gray-700 mb-2 text-sm">{subtask.title}</p>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Days</label>
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={subtaskEtas[index]?.days || ''}
                            onChange={(e) => setSubtaskEtas(prev => ({
                              ...prev,
                              [index]: { ...prev[index], days: e.target.value }
                            }))}
                            placeholder="0"
                            className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Hours</label>
                          <input
                            type="number"
                            min="0"
                            max="23"
                            step="1"
                            value={subtaskEtas[index]?.hours || ''}
                            onChange={(e) => setSubtaskEtas(prev => ({
                              ...prev,
                              [index]: { ...prev[index], hours: e.target.value }
                            }))}
                            placeholder="0"
                            className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                  <p className="text-xs text-gray-500 mt-2">
                    Total: {(() => {
                      let total = 0
                      Object.values(subtaskEtas).forEach(eta => {
                        total += (parseFloat(eta?.days) || 0) * 8 + (parseFloat(eta?.hours) || 0)
                      })
                      return total.toFixed(1)
                    })()} hours
                  </p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Days</label>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={taskEta.days}
                        onChange={(e) => setTaskEta({ ...taskEta, days: e.target.value })}
                        placeholder="0"
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Hours</label>
                      <input
                        type="number"
                        min="0"
                        max="24"
                        step="0.5"
                        value={taskEta.hours}
                        onChange={(e) => setTaskEta({ ...taskEta, hours: e.target.value })}
                        placeholder="0"
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      />
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 mt-2">
                    Total: {((parseFloat(taskEta.days) || 0) * 8 + (parseFloat(taskEta.hours) || 0)).toFixed(1)} hours
                  </p>
                </>
              )}
            </div>
            <div className="p-4 border-t border-gray-200 flex justify-end">
              <button
                onClick={(e) => {
                  // Validate ETAs
                  if (pendingTaskData.subtasks?.length > 0) {
                    // Check if all subtasks have ETAs
                    const allHaveEta = pendingTaskData.subtasks.every((_, index) => {
                      const eta = subtaskEtas[index]
                      return (parseFloat(eta?.days) || 0) > 0 || (parseFloat(eta?.hours) || 0) > 0
                    })
                    if (!allHaveEta) {
                      toast.error('Please provide an ETA for each subtask')
                      return
                    }
                  } else {
                    if (!taskEta.days && !taskEta.hours) {
                      toast.error('Please provide an ETA for the task')
                      return
                    }
                  }
                  setShowTaskEtaModal(false)
                  handleCreateTask(e)
                }}
                disabled={submitting}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 flex items-center gap-2"
              >
                {submitting ? (
                  <><Loader size="xs" /> <span className="ml-1">Creating...</span></>
                ) : (
                  <><FaCheck /> Create Task</>
                )}
              </button>
            </div>
          </div>
        </div>}
      </ModalPortal>

      {/* Edit Task Modal */}
      <ModalPortal isOpen={showEditTaskModal && !!editTaskForm}>
        {editTaskForm && <div className="modal-overlay">
          <div className="bg-white rounded-[30px] shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col animate-modal-enter">
            <div className="px-6 py-4 bg-gray-50 flex items-center justify-between">
              <h3 className="text-xl font-bold text-gray-900">Edit Task</h3>
              <button
                onClick={() => {
                  setShowEditTaskModal(false)
                  setEditTaskForm(null)
                }}
                className="p-2 hover:bg-gray-200 rounded-full transition-colors"
              >
                <FaTimes />
              </button>
            </div>

            <form onSubmit={handleEditTask} className="flex-1 overflow-y-auto">
              <div className="p-6 space-y-4">
                {/* Title and Description Row */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">Task Title *</label>
                    <input
                      type="text"
                      value={editTaskForm.title}
                      onChange={(e) => setEditTaskForm(prev => ({ ...prev, title: e.target.value }))}
                      placeholder="Enter task title..."
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">Due Date</label>
                    <input
                      type="date"
                      value={editTaskForm.dueDate}
                      onChange={(e) => setEditTaskForm(prev => ({ ...prev, dueDate: e.target.value }))}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">Description</label>
                  <textarea
                    value={editTaskForm.description}
                    onChange={(e) => setEditTaskForm(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="Describe the task..."
                    rows={3}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">Priority</label>
                  <Select
                    selectedKeys={[editTaskForm.priority]}
                    onChange={(e) => setEditTaskForm(prev => ({ ...prev, priority: e.target.value }))}
                    aria-label="Priority"
                    classNames={{ trigger: "bg-white" }}
                  >
                    <SelectItem key="low">Low</SelectItem>
                    <SelectItem key="medium">Medium</SelectItem>
                    <SelectItem key="high">High</SelectItem>
                    <SelectItem key="critical">Critical</SelectItem>
                  </Select>
                </div>

                {/* Subtasks Section */}
                <div>
                  <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
                    Subtasks {editTaskForm.subtasks?.length > 0 && `(${editTaskForm.subtasks.length})`}
                  </label>

                  {editTaskForm.subtasks && editTaskForm.subtasks.length > 0 ? (
                    <div className="space-y-2 mb-3">
                      {editTaskForm.subtasks.map((subtask, index) => (
                        <div key={subtask._id || index} className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                          <div className="flex items-start gap-3">
                            <div className="flex-1">
                              <input
                                type="text"
                                value={subtask.title}
                                onChange={(e) => {
                                  const updated = [...editTaskForm.subtasks]
                                  updated[index] = { ...updated[index], title: e.target.value }
                                  setEditTaskForm(prev => ({ ...prev, subtasks: updated }))
                                }}
                                className={`w-full px-2 py-1 text-sm border border-gray-200 rounded focus:ring-1 focus:ring-primary-500 ${subtask.completed ? 'line-through text-gray-400' : ''}`}
                                placeholder="Subtask title..."
                              />
                              <div className="flex items-center gap-2 mt-2">
                                <div className="flex items-center gap-1">
                                  <input
                                    type="number"
                                    min="0"
                                    value={subtask.estimatedDays || ''}
                                    onChange={(e) => {
                                      const updated = [...editTaskForm.subtasks]
                                      updated[index] = { ...updated[index], estimatedDays: parseInt(e.target.value) || 0 }
                                      setEditTaskForm(prev => ({ ...prev, subtasks: updated }))
                                    }}
                                    placeholder="0"
                                    className="w-14 px-2 py-1 text-xs border border-gray-200 rounded focus:ring-1 focus:ring-primary-500"
                                  />
                                  <span className="text-xs text-gray-500">days</span>
                                </div>
                                <div className="flex items-center gap-1">
                                  <input
                                    type="number"
                                    min="0"
                                    max="23"
                                    value={subtask.estimatedHours || ''}
                                    onChange={(e) => {
                                      const updated = [...editTaskForm.subtasks]
                                      updated[index] = { ...updated[index], estimatedHours: parseInt(e.target.value) || 0 }
                                      setEditTaskForm(prev => ({ ...prev, subtasks: updated }))
                                    }}
                                    placeholder="0"
                                    className="w-14 px-2 py-1 text-xs border border-gray-200 rounded focus:ring-1 focus:ring-primary-500"
                                  />
                                  <span className="text-xs text-gray-500">hrs</span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const updated = editTaskForm.subtasks.filter((_, i) => i !== index)
                                    setEditTaskForm(prev => ({ ...prev, subtasks: updated }))
                                  }}
                                  className="ml-auto p-1 text-red-500 hover:bg-red-50 rounded"
                                >
                                  <FaTrash className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                            <SubtaskCompletionButton
                              completed={subtask.completed || false}
                              onClick={() => {
                                const updated = [...editTaskForm.subtasks]
                                updated[index] = { ...updated[index], completed: !subtask.completed }
                                setEditTaskForm(prev => ({ ...prev, subtasks: updated }))
                              }}
                              size="xs"
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500 mb-3">No subtasks added yet</p>
                  )}

                  {/* Add new subtask */}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newSubtaskTitle}
                      onChange={(e) => setNewSubtaskTitle(e.target.value)}
                      placeholder="Add a subtask..."
                      className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && newSubtaskTitle.trim()) {
                          e.preventDefault()
                          setEditTaskForm(prev => ({
                            ...prev,
                            subtasks: [...(prev.subtasks || []), {
                              _id: `new-${Date.now()}`,
                              title: newSubtaskTitle.trim(),
                              completed: false,
                              estimatedDays: 0,
                              estimatedHours: 0,
                              isNew: true
                            }]
                          }))
                          setNewSubtaskTitle('')
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (newSubtaskTitle.trim()) {
                          setEditTaskForm(prev => ({
                            ...prev,
                            subtasks: [...(prev.subtasks || []), {
                              _id: `new-${Date.now()}`,
                              title: newSubtaskTitle.trim(),
                              completed: false,
                              estimatedDays: 0,
                              estimatedHours: 0,
                              isNew: true
                            }]
                          }))
                          setNewSubtaskTitle('')
                        }
                      }}
                      className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg"
                    >
                      <FaPlus className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Total ETA display */}
                  {editTaskForm.subtasks && editTaskForm.subtasks.length > 0 && (
                    <div className="mt-3 p-2 bg-blue-50 rounded-lg">
                      <p className="text-xs text-blue-700">
                        Total ETA: {(() => {
                          let total = 0
                          editTaskForm.subtasks.forEach(st => {
                            total += ((st.estimatedDays || 0) * 8) + (st.estimatedHours || 0)
                          })
                          const days = Math.floor(total / 8)
                          const hours = total % 8
                          return `${days > 0 ? `${days}d ` : ''}${hours}h (${total} hours)`
                        })()}
                      </p>
                    </div>
                  )}
                </div>

                <div className="flex justify-end gap-3 pt-4">
                  <Button
                    type="button"
                    onPress={() => {
                      setShowEditTaskModal(false)
                      setEditTaskForm(null)
                    }}
                    variant="flat"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    isDisabled={submitting}
                    color="primary"
                  >
                    {submitting ? 'Updating...' : 'Update Task'}
                  </Button>
                </div>
              </div>
            </form>
          </div>
        </div>}
      </ModalPortal>

      {/* Reject Invitation Modal */}
      <ModalPortal isOpen={showRejectInvitationModal}>
        <div className="modal-overlay">
          <div className="bg-white rounded-[30px] shadow-2xl w-full max-w-lg animate-modal-enter">
            <div className="p-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">Reject Project Invitation</h3>
              <p className="text-gray-600 text-sm mb-4">
                Please provide a reason for rejecting this project invitation. This will be shared with the project creator.
              </p>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Reason for rejection (required)..."
                rows={3}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
              />
              <div className="flex justify-end gap-3 mt-4">
                <button
                  onClick={() => {
                    setShowRejectInvitationModal(false)
                    setRejectReason('')
                  }}
                  className="btn-secondary"
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleRespondToInvitation('reject', rejectReason)}
                  disabled={submitting || !rejectReason.trim()}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
                >
                  {submitting ? 'Rejecting...' : 'Reject Invitation'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </ModalPortal>

      {/* Task Detail Modal */}
      <ModalPortal isOpen={!!selectedTask}>
        {selectedTask && <div className="modal-overlay">
          <div className="bg-white rounded-[30px] shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col animate-modal-enter">
            <div className="px-6 py-4 bg-gray-50 flex items-center justify-between flex-shrink-0">
              <h3 className="text-lg font-semibold text-gray-800">Task Details</h3>
              <div className="flex items-center gap-2">
                {(() => {
                  const isAssignedAndAccepted = selectedTask.assignees?.some(
                    a => (a.user?._id?.toString() || a.user?.toString()) === currentEmployeeId?.toString() && a.assignmentStatus === 'accepted'
                  )
                  const canEdit = isProjectHead || (user && ['admin'].includes(user.role)) || isAssignedAndAccepted || selectedTask.createdBy?._id?.toString() === currentEmployeeId?.toString()

                  return canEdit && (
                    <Button
                      onPress={() => {
                        setEditTaskForm({
                          _id: selectedTask._id,
                          title: selectedTask.title,
                          description: selectedTask.description || '',
                          priority: selectedTask.priority,
                          dueDate: selectedTask.dueDate ? new Date(selectedTask.dueDate).toISOString().split('T')[0] : '',
                          subtasks: selectedTask.subtasks || [],
                          estimatedHours: selectedTask.estimatedHours || 0
                        })
                        setShowEditTaskModal(true)
                        setSelectedTask(null)
                      }}
                      color="primary"
                      size="sm"
                      startContent={<FaEdit />}
                    >
                      Edit Task
                    </Button>
                  )
                })()}
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
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${selectedTask.status === 'completed' ? 'bg-green-100 text-green-700' :
                    selectedTask.status === 'in-progress' ? 'bg-blue-100 text-blue-700' :
                      selectedTask.status === 'review' ? 'bg-purple-100 text-purple-700' :
                        'bg-gray-100 text-gray-700'
                  }`}>
                  {selectedTask.status.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                </span>
              </div>

              {/* Description */}
              {selectedTask.description && (
                <div className="mb-6">
                  <h4 className="text-sm font-medium text-gray-500 mb-2">Description</h4>
                  <p className="text-gray-700">{selectedTask.description}</p>
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
                  <p className={`font-medium text-gray-800 ${selectedTask.dueDate && new Date(selectedTask.dueDate) < new Date() && selectedTask.status !== 'completed'
                      ? 'text-red-600' : ''
                    }`}>
                    {selectedTask.dueDate ? formatDate(selectedTask.dueDate) : 'Not set'}
                  </p>
                </div>
                <div className="bg-gray-50 p-3 rounded-lg">
                  <p className="text-xs text-gray-500 mb-1">Created</p>
                  <p className="font-medium text-gray-800">{formatDate(selectedTask.createdAt)}</p>
                </div>
                <div className="bg-gray-50 p-3 rounded-lg">
                  <p className="text-xs text-gray-500 mb-1">Created By</p>
                  <p className="font-medium text-gray-800">
                    {selectedTask.createdBy?.firstName} {selectedTask.createdBy?.lastName}
                  </p>
                </div>
                {selectedTask.estimatedHours && (
                  <div className="bg-blue-50 p-3 rounded-lg">
                    <p className="text-xs text-gray-500 mb-1">Estimated Time</p>
                    <p className="font-medium text-blue-700">
                      {selectedTask.estimatedHours >= 8
                        ? `${Math.floor(selectedTask.estimatedHours / 8)}d ${selectedTask.estimatedHours % 8}h`
                        : `${selectedTask.estimatedHours}h`}
                    </p>
                  </div>
                )}
              </div>

              {/* Rejection History */}
              {selectedTask.lastRejectedAt && (
                <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <HiOutlineXMark className="w-5 h-5 text-red-600" />
                    <h4 className="text-sm font-medium text-red-700">Review Rejected</h4>
                    {selectedTask.rejectionCount > 1 && (
                      <span className="text-xs bg-red-200 text-red-700 px-2 py-0.5 rounded-full">
                        {selectedTask.rejectionCount} times
                      </span>
                    )}
                  </div>
                  <div className="space-y-2 text-sm">
                    <p className="text-red-600">
                      <span className="font-medium">Last Rejected:</span>{' '}
                      {new Date(selectedTask.lastRejectedAt).toLocaleString()}
                    </p>
                    {selectedTask.lastRejectedBy && (
                      <p className="text-red-600">
                        <span className="font-medium">Rejected By:</span>{' '}
                        {selectedTask.lastRejectedBy.firstName} {selectedTask.lastRejectedBy.lastName}
                      </p>
                    )}
                    {selectedTask.lastRejectionReason && (
                      <div className="mt-2 bg-white p-3 rounded border border-red-200">
                        <p className="text-xs text-red-500 mb-1">Reason:</p>
                        <p className="text-gray-700">{selectedTask.lastRejectionReason}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Assignees */}
              {selectedTask.assignees && selectedTask.assignees.length > 0 && (
                <div className="mb-6">
                  <h4 className="text-sm font-medium text-gray-500 mb-3">Assigned To</h4>
                  <div className="space-y-2">
                    {selectedTask.assignees.map(a => {
                      const canReassign = a.assignmentStatus === 'rejected' &&
                        (selectedTask.createdBy?._id?.toString() === currentEmployeeId?.toString() || isProjectHead || (user && ['admin'].includes(user.role)))
                      const isCurrentUserPending = (a.user?._id?.toString() || a.user?.toString()) === currentEmployeeId?.toString() && a.assignmentStatus === 'pending'
                      const isUpdating = updatingTaskId === selectedTask._id

                      return (
                        <div key={a._id} className={`flex items-center justify-between p-3 rounded-lg ${a.assignmentStatus === 'rejected' ? 'bg-orange-50 border border-orange-200' :
                            isCurrentUserPending ? 'bg-yellow-50 border border-yellow-200' : 'bg-gray-50'
                          }`}>
                          <div className="flex items-center gap-3">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm ${a.assignmentStatus === 'pending'
                                ? 'bg-yellow-400 text-yellow-900'
                                : a.assignmentStatus === 'rejected'
                                  ? 'bg-orange-500 text-white'
                                  : 'bg-primary-500 text-white'
                              }`}>
                              {a.user.profilePicture ? (
                                <img src={a.user.profilePicture} alt="" className="w-full h-full rounded-full object-cover" />
                              ) : (
                                <span>{a.user.firstName?.[0]}</span>
                              )}
                            </div>
                            <div>
                              <span className="font-medium text-gray-800">
                                {a.user.firstName} {a.user.lastName}
                                {(a.user?._id?.toString() || a.user?.toString()) === currentEmployeeId?.toString() && <span className="text-primary-600 ml-1">(You)</span>}
                              </span>
                              {a.assignmentStatus === 'rejected' && a.rejectionReason && (
                                <p className="text-xs text-orange-600 mt-0.5">Reason: {a.rejectionReason}</p>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {/* Show Accept/Reject buttons for current user's pending assignment */}
                            {isCurrentUserPending ? (
                              <>
                                <button
                                  onClick={() => handleRespondToTaskAssignment(selectedTask._id, 'accept')}
                                  disabled={isUpdating}
                                  className="px-3 py-1.5 text-sm bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50 flex items-center gap-1"
                                >
                                  {isUpdating ? <Loader size="xs" /> : <FaCheck />}
                                  Accept
                                </button>
                                <button
                                  onClick={() => {
                                    const reason = prompt('Please provide a reason for rejecting this task:')
                                    if (reason !== null) {
                                      handleRespondToTaskAssignment(selectedTask._id, 'reject', reason)
                                    }
                                  }}
                                  disabled={isUpdating}
                                  className="px-3 py-1.5 text-sm bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50 flex items-center gap-1"
                                >
                                  {isUpdating ? <Loader size="xs" /> : <FaTimes />}
                                  Reject
                                </button>
                              </>
                            ) : (
                              <>
                                <span className={`text-sm px-3 py-1 rounded-full ${a.assignmentStatus === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                                    a.assignmentStatus === 'rejected' ? 'bg-orange-100 text-orange-700' :
                                      'bg-green-100 text-green-700'
                                  }`}>
                                  {a.assignmentStatus}
                                </span>
                                {canReassign && (
                                  <button
                                    onClick={() => {
                                      setReassignTask(selectedTask)
                                      setShowReassignModal(true)
                                      setSelectedTask(null)
                                    }}
                                    className="px-3 py-1 text-sm bg-orange-500 text-white rounded-lg hover:bg-orange-600"
                                  >
                                    Reassign
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Subtasks */}
              {selectedTask.subtasks && selectedTask.subtasks.length > 0 && (
                <div className="mb-6 border-t border-gray-200 pt-4">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-medium text-gray-500">
                      Subtasks ({selectedTask.subtasks.filter(st => st.completed).length}/{selectedTask.subtasks.length})
                    </h4>
                    {selectedTask.progressPercentage !== undefined && (
                      <span className="text-sm font-medium text-gray-700">
                        {selectedTask.progressPercentage}% complete
                      </span>
                    )}
                  </div>

                  {selectedTask.progressPercentage !== undefined && (
                    <div className="mb-4">
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full transition-all ${selectedTask.progressPercentage === 100 ? 'bg-green-500' :
                              selectedTask.progressPercentage >= 50 ? 'bg-blue-500' :
                                'bg-orange-500'
                            }`}
                          style={{ width: `${selectedTask.progressPercentage}%` }}
                        />
                      </div>
                    </div>
                  )}

                  <div className="space-y-3 bg-gray-50 rounded-lg p-3">
                    {selectedTask.subtasks.sort((a, b) => a.order - b.order).map((subtask) => {
                      // Use string comparison for ObjectIds - check multiple ways to match
                      const currentEmpId = currentEmployeeId?.toString()
                      const isAssignedAndAccepted = selectedTask.assignees?.some(a => {
                        const assigneeId = a.user?._id?.toString() || a.user?._id || a.user?.toString()
                        return assigneeId === currentEmpId && a.assignmentStatus === 'accepted'
                      })

                      // Also check if user is the task creator
                      const isTaskCreator = selectedTask.createdBy?._id?.toString() === currentEmpId ||
                        selectedTask.createdBy?.toString() === currentEmpId

                      // Check if user is task assignor
                      const isTaskAssignor = selectedTask.assignedBy?._id?.toString() === currentEmpId ||
                        selectedTask.assignedBy?.toString() === currentEmpId

                      // Allow toggle if: assigned & accepted, project head, admin, task creator, task assignor, or accepted project member
                      const canToggle = isAssignedAndAccepted || isProjectHead || (user && ['admin'].includes(user.role)) || isTaskCreator || isTaskAssignor || isAcceptedMember
                      const canComment = canToggle // Same permissions for commenting

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
                            return <span className="text-xs px-1.5 py-0.5 bg-purple-200 text-purple-700 rounded">Project Head</span>
                          case 'admin':
                            return <span className="text-xs px-1.5 py-0.5 bg-red-200 text-red-700 rounded">Admin</span>
                          case 'assignee':
                            return <span className="text-xs px-1.5 py-0.5 bg-blue-200 text-blue-700 rounded">Assignee</span>
                          case 'creator':
                            return <span className="text-xs px-1.5 py-0.5 bg-green-200 text-green-700 rounded">Creator</span>
                          default:
                            return null
                        }
                      }

                      return (
                        <div key={subtask._id || subtask.title} className={`rounded-lg p-3 border ${subtask.pendingAcceptance
                            ? 'bg-yellow-50 border-yellow-300'
                            : 'bg-white border-gray-200'
                          }`}>
                          {/* Pending Acceptance Banner */}
                          {subtask.pendingAcceptance && (
                            <div className="mb-2 pb-2 border-b border-yellow-200">
                              <div className="flex items-center gap-2 text-yellow-700">
                                <HiOutlineClock className="w-4 h-4" />
                                <span className="text-xs font-medium">
                                  Pending acceptance from other assignees
                                </span>
                              </div>
                              {subtask.acceptedBy && subtask.acceptedBy.length > 0 && (
                                <p className="text-xs text-yellow-600 mt-1">
                                  {subtask.acceptedBy.length} of {selectedTask.assignees?.filter(a => a.assignmentStatus === 'accepted').length || '?'} accepted
                                </p>
                              )}
                            </div>
                          )}

                          <div className="flex items-center gap-3">
                            <div className="flex-1 min-w-0">
                              <span className={`block text-sm font-medium ${subtask.completed
                                  ? 'line-through text-gray-400'
                                  : subtask.pendingAcceptance
                                    ? 'text-yellow-700'
                                    : 'text-gray-700'
                                }`}>
                                {subtask.title}
                              </span>
                              {subtask.completed && subtask.completedAt && (
                                <span className="mt-1 block text-xs text-gray-400">
                                  {new Date(subtask.completedAt).toLocaleDateString()}
                                </span>
                              )}
                            </div>
                            <SubtaskCompletionButton
                              completed={subtask.completed}
                              pendingAcceptance={subtask.pendingAcceptance}
                              disabled={!canToggle}
                              onClick={() => canToggle && !subtask.pendingAcceptance && handleToggleSubtask(selectedTask._id, subtask._id, subtask.completed)}
                            />
                          </div>

                          {/* Accept/Reject buttons for pending acceptance (only show to other assignees who haven't accepted) */}
                          {subtask.pendingAcceptance && isAssignedAndAccepted && (
                            (() => {
                              const hasAlreadyAccepted = subtask.acceptedBy?.some(
                                id => id.toString() === currentEmployeeId
                              )
                              if (hasAlreadyAccepted) {
                                return (
                                  <div className="mt-2 pl-8">
                                    <span className="text-xs text-green-600 flex items-center gap-1">
                                      <FaCheck className="w-3 h-3" /> You&apos;ve accepted this completion
                                    </span>
                                  </div>
                                )
                              }
                              return (
                                <div className="mt-2 pl-8 flex gap-2">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      handleAcceptSubtaskCompletion(selectedTask._id, subtask._id)
                                    }}
                                    className="px-3 py-1.5 text-xs bg-green-500 text-white rounded-lg hover:bg-green-600 flex items-center gap-1"
                                  >
                                    <FaCheck className="w-3 h-3" /> Accept
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      const reason = prompt('Reason for rejection (optional):')
                                      handleRejectSubtaskCompletion(selectedTask._id, subtask._id, reason)
                                    }}
                                    className="px-3 py-1.5 text-xs bg-red-500 text-white rounded-lg hover:bg-red-600 flex items-center gap-1"
                                  >
                                    <FaTimes className="w-3 h-3" /> Reject
                                  </button>
                                </div>
                              )
                            })()
                          )}

                          {/* Subtask Comments */}
                          {subtask.comments && subtask.comments.length > 0 && (
                            <div className="mt-3 space-y-2 pl-8">
                              {subtask.comments.map((comment) => (
                                <div key={comment._id} className={`p-2 rounded text-sm ${getCommentColor(comment.authorRole)}`}>
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="font-medium text-xs">
                                      {comment.author?.firstName || 'User'} {comment.author?.lastName || ''}
                                    </span>
                                    {getRoleBadge(comment.authorRole)}
                                    <span className="text-xs opacity-60">
                                      {new Date(comment.createdAt).toLocaleDateString()}
                                    </span>
                                  </div>
                                  <p className="text-sm">{comment.text}</p>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Add Comment Button */}
                          {canComment && (
                            <div className="mt-2 pl-8">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  const comment = prompt('Add a comment to this subtask:')
                                  if (comment && comment.trim()) {
                                    handleAddSubtaskComment(selectedTask._id, subtask._id, comment.trim())
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
                    })}
                  </div>
                </div>
              )}

              {/* Status Control Buttons - Only show for tasks WITHOUT subtasks */}
              {(() => {
                const isAssignedAndAccepted = selectedTask.assignees?.some(
                  a => (a.user?._id?.toString() || a.user?.toString()) === currentEmployeeId?.toString() && a.assignmentStatus === 'accepted'
                )
                const canControlTask = isAssignedAndAccepted || isProjectHead || (user && ['admin'].includes(user.role))
                const canDelete = selectedTask.createdBy?._id?.toString() === currentEmployeeId?.toString() || isProjectHead || (user && ['admin'].includes(user.role))
                const isUpdating = updatingTaskId === selectedTask._id
                const hasSubtasks = selectedTask.subtasks && selectedTask.subtasks.length > 0

                return (
                  <>
                    {/* For tasks WITHOUT subtasks - show manual status controls */}
                    {!hasSubtasks && canControlTask && selectedTask.status !== 'completed' && (
                      <div className="border-t border-gray-200 pt-4 mb-4">
                        <h4 className="text-sm font-medium text-gray-500 mb-3">Move Task To</h4>
                        <div className="flex flex-wrap gap-2">
                          {selectedTask.status !== 'todo' && (
                            <button
                              onClick={() => handleUpdateTaskStatus(selectedTask._id, 'todo')}
                              disabled={isUpdating}
                              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-50 flex items-center gap-2"
                            >
                              {isUpdating ? <Loader size="xs" /> : <FaTasks />}
                              To Do
                            </button>
                          )}
                          {selectedTask.status !== 'in-progress' && (
                            <button
                              onClick={() => handleUpdateTaskStatus(selectedTask._id, 'in-progress')}
                              disabled={isUpdating}
                              className="px-4 py-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 disabled:opacity-50 flex items-center gap-2"
                            >
                              {isUpdating ? <Loader size="xs" /> : <FaPlay />}
                              In Progress
                            </button>
                          )}
                          {selectedTask.status !== 'review' && (
                            <button
                              onClick={() => handleUpdateTaskStatus(selectedTask._id, 'review')}
                              disabled={isUpdating}
                              className="px-4 py-2 bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 disabled:opacity-50 flex items-center gap-2"
                            >
                              {isUpdating ? <Loader size="xs" /> : <FaEye />}
                              Review
                            </button>
                          )}
                          <button
                            onClick={() => handleUpdateTaskStatus(selectedTask._id, 'completed')}
                            disabled={isUpdating}
                            className="px-4 py-2 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 disabled:opacity-50 flex items-center gap-2"
                          >
                            {isUpdating ? <Loader size="xs" /> : <FaCheckCircle />}
                            Complete
                          </button>
                        </div>
                      </div>
                    )}

                    {selectedTask.status === 'completed' && (
                      <div className="border-t border-gray-200 pt-4 mb-4">
                        <div className="flex items-center gap-2 text-green-600">
                          <FaCheckCircle className="text-xl" />
                          <span className="font-medium">Task Completed</span>
                        </div>
                        {selectedTask.completedAt && (
                          <p className="text-sm text-gray-500 mt-1 ml-7">
                            Completed on {formatDate(selectedTask.completedAt)}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Delete Button */}
                    {canDelete && (
                      <div className="border-t border-gray-200 pt-4">
                        <button
                          onClick={() => {
                            setTaskToDelete(selectedTask)
                            setShowDeleteTaskModal(true)
                          }}
                          className="px-4 py-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 flex items-center gap-2"
                        >
                          <FaTrash />
                          {isProjectHead ? 'Delete Task' : 'Request Deletion'}
                        </button>
                        {!isProjectHead && (
                          <p className="text-xs text-gray-500 mt-2">
                            Task deletion requires approval from the project head.
                          </p>
                        )}
                      </div>
                    )}
                  </>
                )
              })()}
            </div>
          </div>
        </div>}
      </ModalPortal>

      {/* Delete Task Modal */}
      <ModalPortal isOpen={showDeleteTaskModal && !!taskToDelete}>
        {taskToDelete && <div className="modal-overlay">
          <div className="bg-white rounded-[30px] shadow-2xl w-full max-w-lg animate-modal-enter">
            <div className="p-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">
                {isProjectHead ? 'Delete Task' : 'Request Task Deletion'}
              </h3>
              <p className="text-gray-600 text-sm mb-4">
                {isProjectHead
                  ? 'Are you sure you want to delete this task? This action cannot be undone.'
                  : 'Please provide a reason for requesting task deletion. The project head will review your request.'
                }
              </p>
              <p className="font-medium text-gray-800 mb-4 p-3 bg-gray-50 rounded-lg">
                &quot;{taskToDelete.title}&quot;
              </p>
              {!isProjectHead && (
                <textarea
                  value={deleteReason}
                  onChange={(e) => setDeleteReason(e.target.value)}
                  placeholder="Reason for deletion request..."
                  rows={3}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none mb-4"
                />
              )}
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => {
                    setShowDeleteTaskModal(false)
                    setTaskToDelete(null)
                    setDeleteReason('')
                  }}
                  className="btn-secondary"
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleDeleteTask(taskToDelete._id)}
                  disabled={submitting || (!isProjectHead && !deleteReason.trim())}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
                >
                  {submitting ? 'Processing...' : (isProjectHead ? 'Delete Task' : 'Submit Request')}
                </button>
              </div>
            </div>
          </div>
        </div>}
      </ModalPortal>

      {/* Reassign Task Modal */}
      <ModalPortal isOpen={showReassignModal && !!reassignTask}>
        {reassignTask && <div className="modal-overlay">
          <div className="bg-white rounded-[30px] shadow-2xl w-full max-w-lg animate-modal-enter">
            <div className="px-6 py-4 bg-gray-50 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-800">Reassign Task</h3>
              <button
                onClick={() => {
                  setShowReassignModal(false)
                  setReassignTask(null)
                  setReassignToId('')
                }}
                className="p-2 hover:bg-gray-100 rounded-lg text-gray-500"
              >
                <FaTimes />
              </button>
            </div>
            <div className="p-6">
              <p className="text-gray-600 text-sm mb-4">
                The assignee rejected this task. Select a new team member to reassign it to.
              </p>
              <p className="font-medium text-gray-800 mb-4 p-3 bg-orange-50 border border-orange-200 rounded-lg">
                &quot;{reassignTask.title}&quot;
              </p>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Reassign To
                </label>
                <Select
                  selectedKeys={reassignToId ? [reassignToId] : []}
                  onChange={(e) => setReassignToId(e.target.value)}
                  aria-label="Reassign To"
                  placeholder="Select a team member"
                  classNames={{ trigger: "bg-white" }}
                >
                  {project?.members
                    ?.filter(m => m.status === 'accepted' && !reassignTask.assignees?.some(a => a.user._id === m.employee._id))
                    .map(m => (
                      <SelectItem key={m.employee._id}>
                        {m.employee.firstName} {m.employee.lastName}
                      </SelectItem>
                    ))
                  }
                </Select>
              </div>

              <div className="flex justify-end gap-3">
                <button
                  onClick={() => {
                    setShowReassignModal(false)
                    setReassignTask(null)
                    setReassignToId('')
                  }}
                  className="btn-secondary"
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button
                  onClick={handleReassignTask}
                  disabled={submitting || !reassignToId}
                  className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50"
                >
                  {submitting ? 'Reassigning...' : 'Reassign Task'}
                </button>
              </div>
            </div>
          </div>
        </div>}
      </ModalPortal>

      {/* Reason Modal for Status Changes */}
      <ModalPortal isOpen={showReasonModal && !!pendingStatusChange}>
        {pendingStatusChange && <div className="modal-overlay">
          <div className="bg-white rounded-[30px] shadow-2xl w-full max-w-md transform transition-all">
            <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-amber-500 to-orange-500 rounded-t-xl">
              <h3 className="text-lg font-semibold text-white">Reason Required</h3>
              <p className="text-amber-100 text-sm">Please provide a reason for this status change</p>
            </div>
            <div className="p-6">
              <div className="mb-4 p-3 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-600 mb-1">Task: <span className="font-medium text-gray-800">{pendingStatusChange.task?.title}</span></p>
                <p className="text-sm text-gray-600">
                  Status: <span className="font-medium text-gray-500">{pendingStatusChange.task?.status}</span>
                  <span className="mx-2">→</span>
                  <span className="font-medium text-primary-600">{pendingStatusChange.newStatus}</span>
                </p>
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Reason for change <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={statusChangeReason}
                  onChange={(e) => setStatusChangeReason(e.target.value)}
                  placeholder="Enter the reason for this status change..."
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent resize-none"
                  rows={3}
                  autoFocus
                />
              </div>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => {
                    setShowReasonModal(false)
                    setPendingStatusChange(null)
                    setStatusChangeReason('')
                  }}
                  className="px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={executeStatusChange}
                  disabled={!statusChangeReason.trim()}
                  className="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Confirm Change
                </button>
              </div>
            </div>
          </div>
        </div>}
      </ModalPortal>
    </div>
  )
}
