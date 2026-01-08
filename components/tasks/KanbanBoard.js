'use client'

import { useState, useCallback } from 'react'
import { FaClock, FaExclamationTriangle, FaTasks, FaProjectDiagram, FaGripVertical } from 'react-icons/fa'
import { HiOutlineXMark } from 'react-icons/hi2'

// Status columns configuration
const STATUS_COLUMNS = [
  { id: 'todo', label: 'To Do', color: 'bg-gray-100', headerColor: 'text-gray-700' },
  { id: 'in-progress', label: 'In Progress', color: 'bg-blue-50', headerColor: 'text-blue-700' },
  { id: 'review', label: 'Review', color: 'bg-purple-50', headerColor: 'text-purple-700' },
  { id: 'completed', label: 'Completed', color: 'bg-green-50', headerColor: 'text-green-700' }
]

const priorityColors = {
  low: 'bg-gray-100 text-gray-700',
  medium: 'bg-blue-100 text-blue-700',
  high: 'bg-orange-100 text-orange-700',
  critical: 'bg-red-100 text-red-700'
}

// Project colors for visual differentiation (when showing multiple projects)
const projectColors = [
  { bg: 'bg-blue-50', border: 'border-l-blue-500', text: 'text-blue-700', badge: 'bg-blue-100' },
  { bg: 'bg-green-50', border: 'border-l-green-500', text: 'text-green-700', badge: 'bg-green-100' },
  { bg: 'bg-purple-50', border: 'border-l-purple-500', text: 'text-purple-700', badge: 'bg-purple-100' },
  { bg: 'bg-orange-50', border: 'border-l-orange-500', text: 'text-orange-700', badge: 'bg-orange-100' },
  { bg: 'bg-pink-50', border: 'border-l-pink-500', text: 'text-pink-700', badge: 'bg-pink-100' },
  { bg: 'bg-teal-50', border: 'border-l-teal-500', text: 'text-teal-700', badge: 'bg-teal-100' },
  { bg: 'bg-indigo-50', border: 'border-l-indigo-500', text: 'text-indigo-700', badge: 'bg-indigo-100' },
  { bg: 'bg-yellow-50', border: 'border-l-yellow-500', text: 'text-yellow-700', badge: 'bg-yellow-100' },
]

// Get consistent color for a project based on its ID
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

const formatDate = (date) => {
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric'
  })
}

/**
 * Kanban Board Component
 * 
 * @param {Array} tasks - Array of task objects
 * @param {Function} onTaskClick - Callback when task is clicked
 * @param {Function} onStatusChange - Callback when task status changes via drag-drop (taskId, newStatus)
 * @param {boolean} showProject - Whether to show project badges (for multi-project views)
 * @param {boolean} enableDragDrop - Whether drag-drop is enabled (disabled for tasks with subtasks)
 * @param {Function} onProjectClick - Callback when project badge is clicked
 */
export default function KanbanBoard({ 
  tasks = [], 
  onTaskClick, 
  onStatusChange, 
  showProject = false,
  enableDragDrop = true,
  onProjectClick
}) {
  const [draggedTask, setDraggedTask] = useState(null)
  const [dragOverColumn, setDragOverColumn] = useState(null)

  // Group tasks by status
  const tasksByStatus = STATUS_COLUMNS.reduce((acc, col) => {
    acc[col.id] = tasks.filter(t => t.status === col.id)
    return acc
  }, {})

  // Drag handlers
  const handleDragStart = useCallback((e, task) => {
    // Only allow drag for tasks WITHOUT subtasks
    if (task.subtasks && task.subtasks.length > 0) {
      e.preventDefault()
      return
    }
    setDraggedTask(task)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', task._id)
    // Add drag styling after a brief delay
    setTimeout(() => {
      e.target.classList.add('opacity-50')
    }, 0)
  }, [])

  const handleDragEnd = useCallback((e) => {
    e.target.classList.remove('opacity-50')
    setDraggedTask(null)
    setDragOverColumn(null)
  }, [])

  const handleDragOver = useCallback((e, status) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverColumn(status)
  }, [])

  const handleDragLeave = useCallback(() => {
    setDragOverColumn(null)
  }, [])

  const handleDrop = useCallback((e, newStatus) => {
    e.preventDefault()
    setDragOverColumn(null)
    
    if (draggedTask && draggedTask.status !== newStatus && onStatusChange) {
      onStatusChange(draggedTask, newStatus)
    }
    setDraggedTask(null)
  }, [draggedTask, onStatusChange])

  // Render a single task card
  const renderTaskCard = (task) => {
    const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && task.status !== 'completed'
    const hasSubtasks = task.subtasks && task.subtasks.length > 0
    const hasRejectedAssignee = task.assignees?.some(a => a.assignmentStatus === 'rejected')
    const needsReassignment = hasRejectedAssignee && !task.assignees?.some(a => a.assignmentStatus === 'accepted')
    const wasRecentlyRejected = task.lastRejectedAt && 
      (new Date() - new Date(task.lastRejectedAt)) < 24 * 60 * 60 * 1000
    const rejectionCount = task.rejectionCount || 0
    const projectColor = showProject ? getProjectColor(task.project?._id) : null
    
    // Check if task is pending acceptance (not yet accepted by any assignee)
    const isPendingAcceptance = task.assignmentStatus === 'pending' || 
      task.assignees?.some(a => a.assignmentStatus === 'pending')
    const hasAcceptedAssignee = task.assignees?.some(a => a.assignmentStatus === 'accepted')
    const isNotAccepted = isPendingAcceptance && !hasAcceptedAssignee
    
    // Can only drag tasks without subtasks AND that have been accepted
    const canDrag = enableDragDrop && !hasSubtasks && !isNotAccepted

    // Card styling based on whether it has subtasks
    const cardBgClass = hasSubtasks 
      ? 'bg-gradient-to-br from-purple-50 to-indigo-50 border-purple-200' // Tasks with subtasks - purple gradient
      : isNotAccepted
        ? 'bg-yellow-50 border-yellow-200' // Pending acceptance - yellow tint
        : 'bg-white border-gray-100' // Tasks without subtasks - plain white

    return (
      <div
        key={task._id}
        draggable={canDrag}
        onDragStart={(e) => handleDragStart(e, task)}
        onDragEnd={handleDragEnd}
        onClick={() => onTaskClick?.(task)}
        className={`rounded-lg shadow-sm border transition-all p-3 ${cardBgClass} ${
          canDrag ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
        } ${
          wasRecentlyRejected
            ? 'border-red-400 border-2 bg-red-50 hover:shadow-md hover:border-red-500'
            : needsReassignment 
              ? 'border-orange-400 border-2 bg-orange-50 hover:shadow-md hover:border-orange-500' 
              : 'hover:shadow-md hover:border-primary-200'
        } ${showProject && projectColor ? `border-l-4 ${projectColor.border}` : ''}`}
      >
        {/* Drag handle indicator for draggable cards */}
        {canDrag && (
          <div className="flex items-center gap-1 text-gray-400 text-xs mb-2">
            <FaGripVertical className="w-3 h-3" />
            <span>Drag to move</span>
          </div>
        )}

        {/* Pending acceptance indicator */}
        {isNotAccepted && !hasSubtasks && (
          <div className="flex items-center gap-1 text-yellow-700 text-xs font-medium mb-2 bg-yellow-100 px-2 py-1 rounded-md">
            <FaClock className="w-3 h-3" />
            <span>Pending acceptance</span>
          </div>
        )}

        {/* Auto-managed indicator for tasks with subtasks */}
        {hasSubtasks && (
          <div className="flex items-center gap-1 text-purple-600 text-xs font-medium mb-2 bg-purple-100 px-2 py-1 rounded-md">
            <FaTasks className="w-3 h-3" />
            <span>Auto-managed ({task.progressPercentage || 0}%)</span>
          </div>
        )}

        {/* Rejection indicator */}
        {wasRecentlyRejected && (
          <div className="flex items-center gap-1 text-red-600 text-xs font-medium mb-2 bg-red-100 px-2 py-1 rounded-md">
            <HiOutlineXMark className="w-3 h-3" />
            <span>Rejected{rejectionCount > 1 ? ` (${rejectionCount}x)` : ''}</span>
            {task.lastRejectionReason && (
              <span className="text-red-500 truncate max-w-[150px]" title={task.lastRejectionReason}>
                : {task.lastRejectionReason}
              </span>
            )}
          </div>
        )}
        
        {needsReassignment && !wasRecentlyRejected && (
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
          {hasSubtasks && (
            <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">
              {task.subtasks.filter(st => st.completed).length}/{task.subtasks.length} subtasks
            </span>
          )}
        </div>

        {/* Project badge */}
        {showProject && task.project && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onProjectClick?.(task.project._id || task.project)
            }}
            className={`mt-2 flex items-center gap-1 px-2 py-0.5 rounded text-xs ${projectColor?.badge} ${projectColor?.text} hover:opacity-80`}
          >
            <FaProjectDiagram className="w-2.5 h-2.5" />
            {task.project?.name || 'Project'}
          </button>
        )}

        {/* Task Progress Bar - based on subtasks */}
        {hasSubtasks && (
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

        {/* Assignees */}
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
                title={`${a.user?.firstName || ''} ${a.user?.lastName || ''} (${a.assignmentStatus})`}
              >
                {a.user?.profilePicture ? (
                  <img src={a.user.profilePicture} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span>{a.user?.firstName?.[0] || '?'}</span>
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
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      {STATUS_COLUMNS.map(column => (
        <div 
          key={column.id} 
          className={`rounded-lg p-4 transition-all ${column.color} ${
            dragOverColumn === column.id ? 'ring-2 ring-primary-400 ring-offset-2' : ''
          }`}
          onDragOver={(e) => handleDragOver(e, column.id)}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, column.id)}
        >
          <h4 className={`font-medium mb-3 flex items-center justify-between ${column.headerColor}`}>
            <span>{column.label}</span>
            <span className="bg-white px-2 py-1 rounded text-sm text-gray-600">
              {tasksByStatus[column.id]?.length || 0}
            </span>
          </h4>
          <div className="space-y-3 min-h-[100px]">
            {tasksByStatus[column.id]?.map(task => renderTaskCard(task))}
            {tasksByStatus[column.id]?.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-4">No tasks</p>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
