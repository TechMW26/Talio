'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter, useSearchParams, useParams } from 'next/navigation'
import toast from 'react-hot-toast'
import { 
  FaArrowLeft, FaEdit, FaPlus, FaUsers, FaTasks, FaCalendarAlt,
  FaCheckCircle, FaClock, FaExclamationTriangle, FaComments,
  FaChartLine, FaEllipsisV, FaCheck, FaTimes, FaTrash,
  FaUserPlus, FaArchive, FaComment, FaHistory, FaChevronDown,
  FaChevronUp, FaPlay, FaEye, FaStickyNote, FaSpinner, FaArrowRight,
  FaThumbtack, FaLock, FaSync, FaExchangeAlt
} from 'react-icons/fa'
import { playNotificationSound, NotificationSoundTypes } from '@/lib/notificationSounds'
import ProjectOverview from '@/components/projects/ProjectOverview'
import Portal from '@/components/ui/Portal'

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
  
  const [project, setProject] = useState(null)
  const [tasks, setTasks] = useState([])
  const [timeline, setTimeline] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('overview')
  const [user, setUser] = useState(null)
  const [currentEmployeeId, setCurrentEmployeeId] = useState(null)
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
  
  // Auto-refresh refs
  const refreshIntervalRef = useRef(null)
  const lastFetchRef = useRef(Date.now())
  
  // Notes state
  const [notes, setNotes] = useState([])
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
    subtasks: []
  })
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('')
  const [showTaskEtaModal, setShowTaskEtaModal] = useState(false)
  const [taskEta, setTaskEta] = useState({ days: '', hours: '' })
  const [subtaskEtas, setSubtaskEtas] = useState({}) // { subtaskIndex: { days: '', hours: '' } }
  const [pendingTaskData, setPendingTaskData] = useState(null)

  // Fetch functions with silent refresh support
  const fetchProject = useCallback(async (silent = false) => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/projects/${projectId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })

      const data = await response.json()

      if (data.success) {
        setProject(prev => {
          // Only update if data changed to prevent layout shifts
          if (JSON.stringify(prev) !== JSON.stringify(data.data)) {
            return data.data
          }
          return prev
        })
      } else if (!silent) {
        toast.error(data.message || 'Failed to load project')
        router.push('/dashboard/projects')
      }
    } catch (error) {
      console.error('Fetch project error:', error)
      if (!silent) {
        toast.error('An error occurred')
        router.push('/dashboard/projects')
      }
    } finally {
      if (!silent) setLoading(false)
    }
  }, [projectId, router])

  const fetchTasks = useCallback(async (silent = false) => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/projects/${projectId}/tasks`, {
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
        if (data.currentEmployeeId) {
          setCurrentEmployeeId(data.currentEmployeeId)
        }
      }
    } catch (error) {
      console.error('Fetch tasks error:', error)
    }
  }, [projectId])

  const fetchTimeline = useCallback(async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/projects/${projectId}/timeline`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })

      const data = await response.json()
      if (data.success) {
        setTimeline(prev => {
          if (JSON.stringify(prev) !== JSON.stringify(data.data)) {
            return data.data
          }
          return prev
        })
      }
    } catch (error) {
      console.error('Fetch timeline error:', error)
    }
  }, [projectId])

  const fetchNotes = useCallback(async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/projects/${projectId}/notes`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })

      const data = await response.json()
      if (data.success) {
        setNotes(prev => {
          if (JSON.stringify(prev) !== JSON.stringify(data.data)) {
            return data.data
          }
          return prev
        })
      }
    } catch (error) {
      console.error('Fetch notes error:', error)
    }
  }, [projectId])

  // Silent refresh function for auto-sync
  const silentRefresh = useCallback(() => {
    fetchProject(true)
    if (activeTab === 'tasks') fetchTasks(true)
    if (activeTab === 'timeline') fetchTimeline()
    if (activeTab === 'notes') fetchNotes()
    lastFetchRef.current = Date.now()
  }, [activeTab, fetchProject, fetchTasks, fetchTimeline, fetchNotes])

  useEffect(() => {
    const userData = localStorage.getItem('user')
    if (userData) {
      setUser(JSON.parse(userData))
    }
    
    const tab = searchParams.get('tab')
    if (tab) setActiveTab(tab)
    
    fetchProject()
  }, [projectId, fetchProject])

  useEffect(() => {
    if (project && activeTab === 'tasks') {
      fetchTasks()
    }
    if (project && activeTab === 'timeline') {
      fetchTimeline()
    }
    if (project && activeTab === 'notes') {
      fetchNotes()
    }
  }, [project, activeTab, fetchTasks, fetchTimeline, fetchNotes])

  // Auto-refresh every 10 seconds for real-time sync
  useEffect(() => {
    if (project) {
      refreshIntervalRef.current = setInterval(silentRefresh, 10000)
      
      // Also refresh on window focus
      const handleFocus = () => {
        if (Date.now() - lastFetchRef.current > 5000) {
          silentRefresh()
        }
      }
      window.addEventListener('focus', handleFocus)
      
      return () => {
        if (refreshIntervalRef.current) {
          clearInterval(refreshIntervalRef.current)
        }
        window.removeEventListener('focus', handleFocus)
      }
    }
  }, [project, silentRefresh])

  // Set document title with project name
  useEffect(() => {
    if (project?.name) {
      document.title = `${project.name} | Projects | Talio`
    }
    return () => {
      document.title = 'Talio'
    }
  }, [project?.name])

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
        fetchNotes()
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
        fetchNotes()
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
        fetchNotes()
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
        fetchNotes()
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
        fetchProject()
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
      
      // Prepare task data with ETA if provided
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
      
      const response = await fetch(`/api/projects/${projectId}/tasks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(taskData)
      })

      const data = await response.json()
      if (data.success) {
        playNotificationSound(NotificationSoundTypes.SUCCESS)
        toast.success('Task created successfully')
        setShowCreateTask(false)
        setShowTaskEtaModal(false)
        setTaskForm({ title: '', description: '', priority: 'medium', dueDate: '', assigneeIds: [], subtasks: [] })
        setNewSubtaskTitle('')
        setPendingTaskData(null)
        setTaskEta({ days: '', hours: '' })
        setSubtaskEtas({})
        fetchTasks()
        fetchProject() // Refresh completion percentage
      } else {
        playNotificationSound(NotificationSoundTypes.WARNING)
        toast.error(data.message)
      }
    } catch (error) {
      playNotificationSound(NotificationSoundTypes.WARNING)
      toast.error('Failed to create task')
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
        fetchTasks()
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

  const handleToggleSubtask = async (taskId, subtaskId, currentCompleted) => {
    if (!subtaskId) {
      toast.error('Subtask ID is missing')
      return
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
          const updatedSubtasks = prev.subtasks.map(st => 
            (st._id?.toString() || st._id) === (subtaskId?.toString() || subtaskId)
              ? { ...st, completed: !currentCompleted, completedAt: !currentCompleted ? new Date() : null }
              : st
          )
          return {
            ...prev,
            subtasks: updatedSubtasks,
            progressPercentage: data.data.progressPercentage,
            status: data.data.taskStatus || prev.status
          }
        })
        // Refresh tasks to update the list
        fetchTasks(true)
        
        // Show appropriate toast message
        if (data.data.statusChanged) {
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
        fetchTimeline()
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
        fetchTasks()
        fetchProject()
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
          fetchTasks()
          fetchProject()
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
        fetchTasks()
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
        fetchTasks()
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
        fetchTimeline()
      } else {
        toast.error(data.message)
      }
    } catch (error) {
      toast.error('Failed to add comment')
    } finally {
      setSubmitting(false)
    }
  }

  const handleRequestCompletion = async () => {
    try {
      setSubmitting(true)
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/projects/${projectId}/approval`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ remark: 'Project completed and ready for review' })
      })

      const data = await response.json()
      if (data.success) {
        toast.success('Completion approval requested')
        fetchProject()
      } else {
        toast.error(data.message)
      }
    } catch (error) {
      toast.error('Failed to request approval')
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
        fetchProject()
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
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
        </div>
      </div>
    )
  }

  if (!project) {
    return null
  }

  const isProjectHead = project.isProjectHead
  const isCreator = project.isCreator
  const canManage = isProjectHead || isCreator || (user && ['admin', 'god_admin'].includes(user.role))
  const isAcceptedMember = project.currentUserInvitationStatus === 'accepted'
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
            <div className="flex items-center gap-3 mb-2">
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
              <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                isOverdue ? statusColors.overdue : statusColors[project.status]
              }`}>
                {isOverdue ? 'Overdue' : statusLabels[project.status]}
              </span>
              <span className={`px-2 py-1 rounded-full text-xs font-medium ${priorityColors[project.priority]}`}>
                {project.priority}
              </span>
            </div>
            <p className="text-gray-600">{project.description || 'No description'}</p>
          </div>
        </div>

        {/* Only project head can edit/delete project */}
        {isProjectHead && (
          <div className="flex gap-2">
            <button
              onClick={() => router.push(`/dashboard/projects/${projectId}/edit`)}
              className="btn-secondary flex items-center"
            >
              <FaEdit className="mr-2" />
              Edit
            </button>
            {project.status === 'ongoing' && project.completionPercentage >= 80 && (
              <button
                onClick={handleRequestCompletion}
                disabled={submitting}
                className="btn-secondary flex items-center"
              >
                <FaCheckCircle className="mr-2" />
                Request Completion
              </button>
            )}
          </div>
        )}
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
            <button
              onClick={() => handleRespondToInvitation('accept')}
              disabled={submitting}
              className="btn-primary"
            >
              Accept Invitation
            </button>
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
              <button
                onClick={() => handleApprovalResponse(true)}
                disabled={submitting}
                className="btn-primary"
              >
                Approve
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
              <FaCalendarAlt className="text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-xs font-medium text-gray-600 dark:text-black-300">Deadline</p>
              <p className="font-semibold text-gray-900 dark:text-black">{formatDate(project.endDate)}</p>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-lg">
              <FaChartLine className="text-green-600 dark:text-green-400" />
            </div>
            <div>
              <p className="text-xs font-medium text-gray-600 dark:text-black-300">Progress</p>
              <p className="font-semibold text-gray-900 dark:text-black">{project.completionPercentage || 0}%</p>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
              <FaTasks className="text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <p className="text-xs font-medium text-gray-600 dark:text-black-300">Tasks</p>
              <p className="font-semibold text-gray-900 dark:text-black">
                {project.taskStats?.completed || 0}/{project.taskStats?.total || 0}
              </p>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-orange-100 dark:bg-orange-900/30 rounded-lg">
              <FaUsers className="text-orange-600 dark:text-orange-400" />
            </div>
            <div>
              <p className="text-xs font-medium text-gray-600 dark:text-black-300">Members</p>
              <p className="font-semibold text-gray-900 dark:text-black">{project.members?.length || 0}</p>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-100 dark:bg-red-900/30 rounded-lg">
              <FaExclamationTriangle className="text-red-600 dark:text-red-400" />
            </div>
            <div>
              <p className="text-xs font-medium text-gray-600 dark:text-black-300">Overdue Tasks</p>
              <p className="font-semibold text-gray-900 dark:text-black">{project.taskStats?.overdue || 0}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-hidden">
        <div className="">
          <nav className="flex overflow-x-auto">
            {[
              { id: 'overview', label: 'Overview', icon: FaChartLine },
              { id: 'tasks', label: 'Tasks', icon: FaTasks },
              { id: 'members', label: 'Members', icon: FaUsers },
              { id: 'notes', label: 'Notes', icon: FaStickyNote },
              { id: 'timeline', label: 'Activity', icon: FaHistory }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center px-6 py-4 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                    : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                <tab.icon className="mr-2" />
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
              {isAcceptedMember && (
                <div className="flex justify-end mb-4">
                  <button
                    onClick={() => setShowCreateTask(true)}
                    className="btn-primary flex items-center"
                  >
                    <FaPlus className="mr-2" />
                    Add Task
                  </button>
                </div>
              )}

              {/* Kanban-style Board */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                {['todo', 'in-progress', 'review', 'completed'].map(status => (
                  <div key={status} className="bg-gray-50 rounded-lg p-4">
                    <h4 className="font-medium text-gray-700 mb-3 flex items-center justify-between">
                      <span className="capitalize">{status.replace('-', ' ')}</span>
                      <span className="bg-white px-2 py-1 rounded text-sm">
                        {tasksByStatus[status]?.length || 0}
                      </span>
                    </h4>
                    <div className="space-y-3">
                      {tasksByStatus[status]?.map(task => {
                        const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && task.status !== 'completed'
                        const hasRejectedAssignee = task.assignees?.some(a => a.assignmentStatus === 'rejected')
                        const needsReassignment = hasRejectedAssignee && !task.assignees?.some(a => a.assignmentStatus === 'accepted')

                        return (
                          <div
                            key={task._id}
                            onClick={() => setSelectedTask(task)}
                            className={`bg-white rounded-lg shadow-sm border transition-all cursor-pointer p-3 ${
                              needsReassignment 
                                ? 'border-orange-400 border-2 bg-orange-50 hover:shadow-md hover:border-orange-500' 
                                : 'border-gray-100 hover:shadow-md hover:border-primary-200'
                            }`}
                          >
                            {needsReassignment && (
                              <div className="flex items-center gap-1 text-orange-600 text-xs font-medium mb-2">
                                <FaExclamationTriangle className="w-3 h-3" />
                                <span>Needs Reassignment</span>
                              </div>
                            )}
                            <h5 className="font-medium text-gray-800 text-sm">{task.title}</h5>
                            <div className="flex items-center gap-2 mt-2 flex-wrap">
                              <span className={`px-2 py-0.5 rounded text-xs ${priorityColors[task.priority]}`}>
                                {task.priority}
                              </span>
                              {task.dueDate && (
                                <span className={`text-xs ${isOverdue ? 'text-red-500 font-medium' : 'text-gray-500'}`}>
                                  {formatDate(task.dueDate)}
                                </span>
                              )}
                              {isOverdue && (
                                <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded">Overdue</span>
                              )}
                              {task.estimatedHours && (
                                <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded flex items-center gap-1">
                                  <FaClock className="w-2 h-2" />
                                  {task.estimatedHours >= 8 ? `${Math.floor(task.estimatedHours / 8)}d ${task.estimatedHours % 8}h` : `${task.estimatedHours}h`}
                                </span>
                              )}
                              {task.subtasks && task.subtasks.length > 0 && (
                                <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">
                                  {task.subtasks.filter(st => st.completed).length}/{task.subtasks.length} subtasks
                                </span>
                              )}
                            </div>
                            {/* Task Progress Bar - based on subtasks */}
                            {task.subtasks && task.subtasks.length > 0 && (
                              <div className="mt-2">
                                <div className="w-full bg-gray-200 rounded-full h-1.5">
                                  <div
                                    className={`h-1.5 rounded-full transition-all ${
                                      task.progressPercentage === 100 ? 'bg-green-500' :
                                      task.progressPercentage >= 50 ? 'bg-blue-500' :
                                      'bg-orange-500'
                                    }`}
                                    style={{ width: `${task.progressPercentage || 0}%` }}
                                  />
                                </div>
                              </div>
                            )}
                            {task.assignees && task.assignees.length > 0 && (
                              <div className="flex -space-x-2 mt-2">
                                {task.assignees.slice(0, 3).map(a => (
                                  <div
                                    key={a._id}
                                    className={`w-6 h-6 rounded-full border-2 border-white flex items-center justify-center text-xs overflow-hidden ${
                                      a.assignmentStatus === 'pending' 
                                        ? 'bg-yellow-400 text-yellow-900' 
                                        : a.assignmentStatus === 'rejected'
                                        ? 'bg-red-400 text-white'
                                        : 'bg-primary-500 text-white'
                                    }`}
                                    title={`${a.user.firstName} ${a.user.lastName} (${a.assignmentStatus})`}
                                  >
                                    {a.user.profilePicture ? (
                                      <img src={a.user.profilePicture} alt="" className="w-full h-full object-cover" />
                                    ) : (
                                      <span>{a.user.firstName?.[0]}</span>
                                    )}
                                  </div>
                                ))}
                                {task.assignees.length > 3 && (
                                  <div className="w-6 h-6 rounded-full bg-gray-300 border-2 border-white flex items-center justify-center text-gray-600 text-xs">
                                    +{task.assignees.length - 3}
                                  </div>
                                )}
                              </div>
                            )}
                            {task.assignees?.some(a => a.assignmentStatus === 'pending') && (
                              <p className="text-xs text-yellow-600 mt-1 flex items-center">
                                <FaClock className="mr-1 w-3 h-3" />
                                Awaiting acceptance
                              </p>
                            )}
                          </div>
                        )
                      })}
                      {tasksByStatus[status]?.length === 0 && (
                        <p className="text-sm text-gray-400 text-center py-4">No tasks</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Members Tab */}
          {activeTab === 'members' && (
            <div>
              <div className="space-y-3">
                {project.members?.map(member => (
                  <div
                    key={member._id}
                    className={`flex items-center justify-between p-4 rounded-lg ${
                      member.isCurrentUser ? 'bg-primary-50 border border-primary-200' : 'bg-gray-50'
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
                      <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                        member.invitationStatus === 'accepted' ? 'bg-green-100 text-green-700' :
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
              {/* Add Comment Form */}
              {isAcceptedMember && (
                <form onSubmit={handleAddComment} className="mb-6">
                  <div className="flex gap-3">
                    <input
                      type="text"
                      value={newComment}
                      onChange={(e) => setNewComment(e.target.value)}
                      placeholder="Add a comment or update..."
                      className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    />
                    <button
                      type="submit"
                      disabled={submitting || !newComment.trim()}
                      className="btn-primary"
                    >
                      <FaComment className="mr-2" />
                      Post
                    </button>
                  </div>
                </form>
              )}

              {/* Timeline Events */}
              <div className="space-y-4">
                {timeline.map(event => (
                  <div key={event._id} className="flex gap-4">
                    <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
                      {event.createdBy?.profilePicture ? (
                        <img src={event.createdBy.profilePicture} alt="" className="w-full h-full rounded-full object-cover" />
                      ) : (
                        <span className="text-gray-500 text-sm">
                          {event.createdBy?.firstName?.[0]}{event.createdBy?.lastName?.[0]}
                        </span>
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-gray-800">
                          {event.createdBy?.firstName} {event.createdBy?.lastName}
                        </span>
                        <span className="text-xs text-gray-400">{formatDateTime(event.createdAt)}</span>
                      </div>
                      <p className="text-gray-600">{event.description}</p>
                      {/* Show rejection reason if present */}
                      {event.metadata?.rejectionReason && (
                        <div className="mt-2 p-3 bg-red-50 border border-red-100 rounded-lg">
                          <p className="text-sm font-medium text-red-700 mb-1">Rejection Reason:</p>
                          <p className="text-sm text-red-600">{event.metadata.rejectionReason}</p>
                        </div>
                      )}
                      {/* Show remark if present (for project rejection/approval) */}
                      {event.metadata?.remark && !event.metadata?.rejectionReason && (
                        <div className={`mt-2 p-3 rounded-lg ${
                          event.type === 'project_rejected' ? 'bg-red-50 border border-red-100' : 'bg-blue-50 border border-blue-100'
                        }`}>
                          <p className={`text-sm font-medium mb-1 ${
                            event.type === 'project_rejected' ? 'text-red-700' : 'text-blue-700'
                          }`}>Remark:</p>
                          <p className={`text-sm ${
                            event.type === 'project_rejected' ? 'text-red-600' : 'text-blue-600'
                          }`}>{event.metadata.remark}</p>
                        </div>
                      )}
                      {event.commentContent && (
                        <div className="mt-2 p-3 bg-gray-50 rounded-lg">
                          <p className="text-gray-700">{event.commentContent}</p>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {timeline.length === 0 && (
                  <p className="text-center text-gray-500 py-8">No activity yet</p>
                )}
              </div>
            </div>
          )}

          {/* Notes Tab */}
          {activeTab === 'notes' && (
            <div>
              {/* Create Note Button */}
              {isAcceptedMember && !showCreateNote && !editingNote && (
                <button
                  onClick={() => setShowCreateNote(true)}
                  className="btn-primary mb-6"
                >
                  <FaPlus className="mr-2" />
                  Add Note
                </button>
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
                              className={`w-8 h-8 rounded-lg border-2 ${noteColors[color]} ${
                                noteForm.color === color ? 'ring-2 ring-primary-500 ring-offset-2' : ''
                              }`}
                              title={color}
                            />
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Visibility</label>
                        <select
                          value={noteForm.visibility}
                          onChange={(e) => setNoteForm(prev => ({ ...prev, visibility: e.target.value }))}
                          className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                        >
                          <option value="team">Team (All members)</option>
                          <option value="personal">Personal (Only me)</option>
                        </select>
                      </div>
                    </div>
                    <div className="flex justify-end gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setShowCreateNote(false)
                          setNoteForm({ title: '', content: '', color: 'yellow', visibility: 'team' })
                        }}
                        className="btn-secondary"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={submitting}
                        className="btn-primary"
                      >
                        {submitting ? 'Creating...' : 'Create Note'}
                      </button>
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
                                  className={`w-6 h-6 rounded border ${noteColors[color]} ${
                                    noteForm.color === color ? 'ring-2 ring-primary-500' : ''
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
                                className={`w-6 h-6 rounded border ${noteColors[color]} ${
                                  noteForm.color === color ? 'ring-2 ring-primary-500' : ''
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
      {showCreateTask && (
      <Portal>
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9999] p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col animate-modal-enter">
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
                  <select
                    value={taskForm.priority}
                    onChange={(e) => setTaskForm(prev => ({ ...prev, priority: e.target.value }))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
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
                  ))})()}
                </div>
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
                <button
                  type="button"
                  onClick={() => setShowCreateTask(false)}
                  className="btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="btn-primary"
                >
                  {submitting ? 'Creating...' : 'Create Task'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </Portal>
      )}

      {/* Task ETA Modal (for self-assignment) */}
      {showTaskEtaModal && pendingTaskData && (
      <Portal>
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9999] p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col animate-modal-enter">
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
                You're assigning this task to yourself. {pendingTaskData.subtasks?.length > 0 
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
                  <><FaSpinner className="animate-spin" /> Creating...</>
                ) : (
                  <><FaCheck /> Create Task</>
                )}
              </button>
            </div>
          </div>
        </div>
      </Portal>
      )}

      {/* Edit Task Modal */}
      {showEditTaskModal && editTaskForm && (
      <Portal>
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9999] p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col animate-modal-enter">
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
                  <select
                    value={editTaskForm.priority}
                    onChange={(e) => setEditTaskForm(prev => ({ ...prev, priority: e.target.value }))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
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
                          <div className="flex items-start gap-2">
                            <input
                              type="checkbox"
                              checked={subtask.completed || false}
                              onChange={(e) => {
                                const updated = [...editTaskForm.subtasks]
                                updated[index] = { ...updated[index], completed: e.target.checked }
                                setEditTaskForm(prev => ({ ...prev, subtasks: updated }))
                              }}
                              className="mt-1 h-4 w-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                            />
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
                  <button
                    type="button"
                    onClick={() => {
                      setShowEditTaskModal(false)
                      setEditTaskForm(null)
                    }}
                    className="btn-secondary"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="btn-primary"
                  >
                    {submitting ? 'Updating...' : 'Update Task'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      </Portal>
      )}

      {/* Reject Invitation Modal */}
      {showRejectInvitationModal && (
      <Portal>
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9999] p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg animate-modal-enter">
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
      </Portal>
      )}

      {/* Task Detail Modal */}
      {selectedTask && (
      <Portal>
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9999] p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col animate-modal-enter">
            <div className="px-6 py-4 bg-gray-50 flex items-center justify-between flex-shrink-0">
              <h3 className="text-lg font-semibold text-gray-800">Task Details</h3>
              <div className="flex items-center gap-2">
                {(() => {
                  const isAssignedAndAccepted = selectedTask.assignees?.some(
                    a => a.user._id === currentEmployeeId && a.assignmentStatus === 'accepted'
                  )
                  const canEdit = isProjectHead || (user && ['admin', 'god_admin'].includes(user.role)) || isAssignedAndAccepted || selectedTask.createdBy?._id === currentEmployeeId
                  
                  return canEdit && (
                    <button
                      onClick={() => {
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
                      className="p-2 hover:bg-blue-50 rounded-lg text-blue-600"
                      title="Edit Task"
                    >
                      <FaEdit />
                    </button>
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
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                  selectedTask.status === 'completed' ? 'bg-green-100 text-green-700' :
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
                  <p className={`font-medium text-gray-800 ${
                    selectedTask.dueDate && new Date(selectedTask.dueDate) < new Date() && selectedTask.status !== 'completed' 
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

              {/* Assignees */}
              {selectedTask.assignees && selectedTask.assignees.length > 0 && (
                <div className="mb-6">
                  <h4 className="text-sm font-medium text-gray-500 mb-3">Assigned To</h4>
                  <div className="space-y-2">
                    {selectedTask.assignees.map(a => {
                      const canReassign = a.assignmentStatus === 'rejected' && 
                        (selectedTask.createdBy?._id === currentEmployeeId || isProjectHead || (user && ['admin', 'god_admin'].includes(user.role)))
                      const isCurrentUserPending = a.user._id === currentEmployeeId && a.assignmentStatus === 'pending'
                      const isUpdating = updatingTaskId === selectedTask._id
                      
                      return (
                        <div key={a._id} className={`flex items-center justify-between p-3 rounded-lg ${
                          a.assignmentStatus === 'rejected' ? 'bg-orange-50 border border-orange-200' : 
                          isCurrentUserPending ? 'bg-yellow-50 border border-yellow-200' : 'bg-gray-50'
                        }`}>
                          <div className="flex items-center gap-3">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm ${
                              a.assignmentStatus === 'pending' 
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
                                {a.user._id === currentEmployeeId && <span className="text-primary-600 ml-1">(You)</span>}
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
                                  {isUpdating ? <FaSpinner className="animate-spin" /> : <FaCheck />}
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
                                  {isUpdating ? <FaSpinner className="animate-spin" /> : <FaTimes />}
                                  Reject
                                </button>
                              </>
                            ) : (
                              <>
                                <span className={`text-sm px-3 py-1 rounded-full ${
                                  a.assignmentStatus === 'pending' ? 'bg-yellow-100 text-yellow-700' :
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
                          className={`h-2 rounded-full transition-all ${
                            selectedTask.progressPercentage === 100 ? 'bg-green-500' :
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
                      const isAssignedAndAccepted = selectedTask.assignees?.some(
                        a => a.user._id === currentEmployeeId && a.assignmentStatus === 'accepted'
                      )
                      const canToggle = isAssignedAndAccepted || isProjectHead || (user && ['admin', 'god_admin'].includes(user.role))
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
                        <div key={subtask._id || subtask.title} className="bg-white rounded-lg p-3 border border-gray-200">
                          <div 
                            className={`flex items-center gap-3 ${canToggle ? 'cursor-pointer' : ''}`}
                            onClick={() => canToggle && handleToggleSubtask(selectedTask._id, subtask._id, subtask.completed)}
                          >
                            <span className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                              subtask.completed 
                                ? 'bg-green-500 border-green-500' 
                                : 'border-gray-300 bg-white'
                            }`}>
                              {subtask.completed && <FaCheck className="text-white text-xs" />}
                            </span>
                            <span className={`flex-1 text-sm font-medium ${
                              subtask.completed 
                                ? 'line-through text-gray-400' 
                                : 'text-gray-700'
                            }`}>
                              {subtask.title}
                            </span>
                            {subtask.completed && subtask.completedAt && (
                              <span className="text-xs text-gray-400">
                                {new Date(subtask.completedAt).toLocaleDateString()}
                              </span>
                            )}
                          </div>
                          
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
                  a => a.user._id === currentEmployeeId && a.assignmentStatus === 'accepted'
                )
                const canControlTask = isAssignedAndAccepted || isProjectHead || (user && ['admin', 'god_admin'].includes(user.role))
                const canDelete = selectedTask.createdBy?._id === currentEmployeeId || isProjectHead || (user && ['admin', 'god_admin'].includes(user.role))
                const isUpdating = updatingTaskId === selectedTask._id
                const hasSubtasks = selectedTask.subtasks && selectedTask.subtasks.length > 0

                return (
                  <>
                    {/* For tasks WITH subtasks - show info about automatic status */}
                    {hasSubtasks && selectedTask.status !== 'completed' && (
                      <div className="border-t border-gray-200 pt-4 mb-4">
                        <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                          <h4 className="text-sm font-medium text-blue-800 mb-1">Automatic Status Updates</h4>
                          <p className="text-xs text-blue-600">
                            Task status is automatically managed based on subtask progress:
                          </p>
                          <ul className="text-xs text-blue-600 mt-1 ml-4 list-disc">
                            <li>Start a subtask → Task moves to "In Progress"</li>
                            <li>Complete all subtasks (100%) → Task moves to "Review" for approval</li>
                            <li>Uncheck subtasks → Task returns to appropriate status</li>
                          </ul>
                        </div>
                      </div>
                    )}
                    
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
                              {isUpdating ? <FaSpinner className="animate-spin" /> : <FaTasks />}
                              To Do
                            </button>
                          )}
                          {selectedTask.status !== 'in-progress' && (
                            <button
                              onClick={() => handleUpdateTaskStatus(selectedTask._id, 'in-progress')}
                              disabled={isUpdating}
                              className="px-4 py-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 disabled:opacity-50 flex items-center gap-2"
                            >
                              {isUpdating ? <FaSpinner className="animate-spin" /> : <FaPlay />}
                              In Progress
                            </button>
                          )}
                          {selectedTask.status !== 'review' && (
                            <button
                              onClick={() => handleUpdateTaskStatus(selectedTask._id, 'review')}
                              disabled={isUpdating}
                              className="px-4 py-2 bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 disabled:opacity-50 flex items-center gap-2"
                            >
                              {isUpdating ? <FaSpinner className="animate-spin" /> : <FaEye />}
                              Review
                            </button>
                          )}
                          <button
                            onClick={() => handleUpdateTaskStatus(selectedTask._id, 'completed')}
                            disabled={isUpdating}
                            className="px-4 py-2 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 disabled:opacity-50 flex items-center gap-2"
                          >
                            {isUpdating ? <FaSpinner className="animate-spin" /> : <FaCheckCircle />}
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
        </div>
      </Portal>
      )}

      {/* Delete Task Modal */}
      {showDeleteTaskModal && taskToDelete && (
      <Portal>
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9999] p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg animate-modal-enter">
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
                "{taskToDelete.title}"
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
        </div>
      </Portal>
      )}

      {/* Reassign Task Modal */}
      {showReassignModal && reassignTask && (
      <Portal>
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9999] p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg animate-modal-enter">
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
                "{reassignTask.title}"
              </p>
              
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Reassign To
                </label>
                <select
                  value={reassignToId}
                  onChange={(e) => setReassignToId(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                >
                  <option value="">Select a team member</option>
                  {project?.members
                    ?.filter(m => m.status === 'accepted' && !reassignTask.assignees?.some(a => a.user._id === m.employee._id))
                    .map(m => (
                      <option key={m.employee._id} value={m.employee._id}>
                        {m.employee.firstName} {m.employee.lastName}
                      </option>
                    ))
                  }
                </select>
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
        </div>
      </Portal>
      )}
    </div>
  )
}
