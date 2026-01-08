'use client'

import { useState, useEffect, Fragment } from 'react'
import {
  HiOutlineXMark,
  HiOutlineFlag,
  HiOutlineCalendarDays,
  HiOutlineClock,
  HiOutlineBell,
  HiOutlineTag,
  HiOutlineListBullet,
  HiOutlinePlus,
  HiOutlineTrash,
  HiOutlineCheck,
  HiOutlinePencil,
  HiOutlineArrowPath,
  HiOutlineDocumentText,
  HiOutlineCheckCircle
} from 'react-icons/hi2'
import Loader from '@/components/ui/Loader'
import toast from '@/utils/toast'

const PRIORITY_OPTIONS = [
  { value: '', label: 'No Priority', color: 'text-gray-400' },
  { value: 'low', label: 'Low', color: 'text-green-500 bg-green-50' },
  { value: 'medium', label: 'Medium', color: 'text-amber-500 bg-amber-50' },
  { value: 'high', label: 'High', color: 'text-red-500 bg-red-50' }
]

export default function TodoDetailPanel({ todo, categories, onClose, onUpdate, onDelete, onToggleComplete }) {
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState({})
  const [newSubtask, setNewSubtask] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setEditForm({
      title: todo.title || '',
      description: todo.description || '',
      priority: todo.priority || '',
      category: todo.category?._id || '',
      dueDate: todo.dueDate ? new Date(todo.dueDate).toISOString().split('T')[0] : '',
      dueTime: todo.dueTime || '',
      notes: todo.notes || ''
    })
  }, [todo])

  const handleSave = async () => {
    if (!editForm.title.trim()) {
      toast.error('To-do title is required')
      return
    }

    try {
      setSaving(true)
      const token = localStorage.getItem('token')

      const payload = {
        title: editForm.title.trim(),
        description: editForm.description.trim(),
        priority: editForm.priority,
        category: editForm.category || null,
        dueDate: editForm.dueDate || null,
        dueTime: editForm.dueTime || null,
        notes: editForm.notes || ''
      }

      const response = await fetch(`/api/personal-todos/${todo._id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      })

      const data = await response.json()

      if (data.success) {
        onUpdate(data.data)
        setEditing(false)
        toast.success('To-do updated')
      } else {
        toast.error(data.message || 'Failed to update to-do')
      }
    } catch (error) {
      console.error('Error updating todo:', error)
      toast.error('Failed to update to-do')
    } finally {
      setSaving(false)
    }
  }

  const addSubtask = async () => {
    if (!newSubtask.trim()) return

    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/personal-todos/${todo._id}/subtasks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ title: newSubtask.trim() })
      })

      const data = await response.json()
      if (data.success) {
        onUpdate(data.data)
        setNewSubtask('')
      } else {
        toast.error(data.message || 'Failed to add subtask')
      }
    } catch (error) {
      console.error('Error adding subtask:', error)
      toast.error('Failed to add subtask')
    }
  }

  const toggleSubtask = async (subtaskId, completed) => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/personal-todos/${todo._id}/subtasks`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ subtaskId, completed: !completed })
      })

      const data = await response.json()
      if (data.success) {
        onUpdate(data.data)
      } else {
        toast.error(data.message || 'Failed to update subtask')
      }
    } catch (error) {
      console.error('Error updating subtask:', error)
      toast.error('Failed to update subtask')
    }
  }

  const deleteSubtask = async (subtaskId) => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/personal-todos/${todo._id}/subtasks?subtaskId=${subtaskId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`
        }
      })

      const data = await response.json()
      if (data.success) {
        onUpdate(data.data)
      } else {
        toast.error(data.message || 'Failed to delete subtask')
      }
    } catch (error) {
      console.error('Error deleting subtask:', error)
      toast.error('Failed to delete subtask')
    }
  }

  const formatDate = (dateStr) => {
    if (!dateStr) return 'No due date'
    const date = new Date(dateStr)
    return date.toLocaleDateString('en-US', { 
      weekday: 'short', 
      month: 'short', 
      day: 'numeric',
      year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined
    })
  }

  const isOverdue = todo.dueDate && todo.status !== 'completed' && new Date(todo.dueDate) < new Date()

  return (
    <div className="hidden lg:block w-96 flex-shrink-0">
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 sticky top-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-800">To-do Details</h3>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setEditing(!editing)}
              className={`p-2 rounded-lg transition-colors ${
                editing ? 'bg-indigo-100 text-indigo-600' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
              }`}
            >
              <HiOutlinePencil className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
            >
              <HiOutlineXMark className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-4 max-h-[calc(100vh-12rem)] overflow-y-auto">
          {/* Completion Toggle */}
          <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray-100">
            <button
              onClick={(e) => onToggleComplete(todo._id, e)}
              className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
                todo.status === 'completed'
                  ? 'bg-green-500 border-green-500 text-white'
                  : 'border-gray-300 hover:border-green-500'
              }`}
            >
              {todo.status === 'completed' && <HiOutlineCheck className="w-4 h-4" />}
            </button>
            <span className={`text-sm font-medium ${
              todo.status === 'completed' ? 'text-green-600' : 'text-gray-600'
            }`}>
              {todo.status === 'completed' ? 'Completed' : 'Mark as Complete'}
            </span>
          </div>

          {/* Title */}
          {editing ? (
            <input
              type="text"
              value={editForm.title}
              onChange={(e) => setEditForm(prev => ({ ...prev, title: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-lg font-medium mb-4 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          ) : (
            <h2 className={`text-lg font-medium mb-4 ${
              todo.status === 'completed' ? 'text-gray-400 line-through' : 'text-gray-800'
            }`}>
              {todo.title}
            </h2>
          )}

          {/* Description */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-500 mb-1">
              <HiOutlineDocumentText className="w-4 h-4 inline mr-1" />
              Description
            </label>
            {editing ? (
              <textarea
                value={editForm.description}
                onChange={(e) => setEditForm(prev => ({ ...prev, description: e.target.value }))}
                rows={3}
                placeholder="Add description..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
              />
            ) : (
              <p className="text-sm text-gray-600">
                {todo.description || <span className="text-gray-400 italic">No description</span>}
              </p>
            )}
          </div>

          {/* Due Date */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-500 mb-1">
              <HiOutlineCalendarDays className="w-4 h-4 inline mr-1" />
              Due Date
            </label>
            {editing ? (
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="date"
                  value={editForm.dueDate}
                  onChange={(e) => setEditForm(prev => ({ ...prev, dueDate: e.target.value }))}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
                <input
                  type="time"
                  value={editForm.dueTime}
                  onChange={(e) => setEditForm(prev => ({ ...prev, dueTime: e.target.value }))}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>
            ) : (
              <p className={`text-sm flex items-center gap-2 ${isOverdue ? 'text-red-500' : 'text-gray-600'}`}>
                {formatDate(todo.dueDate)}
                {todo.dueTime && <span>at {todo.dueTime}</span>}
                {isOverdue && <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded">Overdue</span>}
              </p>
            )}
          </div>

          {/* Priority */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-500 mb-1">
              <HiOutlineFlag className="w-4 h-4 inline mr-1" />
              Priority
            </label>
            {editing ? (
              <select
                value={editForm.priority}
                onChange={(e) => setEditForm(prev => ({ ...prev, priority: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white"
              >
                {PRIORITY_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            ) : (
              <span className={`inline-flex px-2 py-1 text-xs font-medium rounded ${
                PRIORITY_OPTIONS.find(p => p.value === todo.priority)?.color || 'text-gray-400 bg-gray-50'
              }`}>
                {PRIORITY_OPTIONS.find(p => p.value === todo.priority)?.label || 'No Priority'}
              </span>
            )}
          </div>

          {/* Category */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-500 mb-1">
              <HiOutlineTag className="w-4 h-4 inline mr-1" />
              Category
            </label>
            {editing ? (
              <select
                value={editForm.category}
                onChange={(e) => setEditForm(prev => ({ ...prev, category: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white"
              >
                <option value="">No Category</option>
                {categories.map(cat => (
                  <option key={cat._id} value={cat._id}>{cat.name}</option>
                ))}
              </select>
            ) : todo.category ? (
              <span className="inline-flex items-center gap-2 text-sm text-gray-600">
                <div 
                  className="w-3 h-3 rounded-full" 
                  style={{ backgroundColor: todo.category.color }}
                ></div>
                {todo.category.name}
              </span>
            ) : (
              <span className="text-sm text-gray-400 italic">No category</span>
            )}
          </div>

          {/* Subtasks */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-500 mb-2">
              <HiOutlineListBullet className="w-4 h-4 inline mr-1" />
              Subtasks ({todo.subtasks?.filter(s => s.completed).length || 0}/{todo.subtasks?.length || 0})
            </label>
            <div className="space-y-2">
              {todo.subtasks?.map(subtask => (
                <div key={subtask._id} className="flex items-center gap-2 group">
                  <button
                    onClick={() => toggleSubtask(subtask._id, subtask.completed)}
                    className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${
                      subtask.completed
                        ? 'bg-green-500 border-green-500 text-white'
                        : 'border-gray-300 hover:border-green-500'
                    }`}
                  >
                    {subtask.completed && <HiOutlineCheck className="w-3 h-3" />}
                  </button>
                  <span className={`flex-1 text-sm ${subtask.completed ? 'text-gray-400 line-through' : 'text-gray-700'}`}>
                    {subtask.title}
                  </span>
                  <button
                    onClick={() => deleteSubtask(subtask._id)}
                    className="p-1 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <HiOutlineTrash className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              
              {/* Add subtask */}
              <div className="flex items-center gap-2 mt-2">
                <input
                  type="text"
                  placeholder="Add subtask..."
                  value={newSubtask}
                  onChange={(e) => setNewSubtask(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addSubtask()
                    }
                  }}
                  className="flex-1 px-2 py-1.5 border border-gray-200 rounded text-sm focus:ring-1 focus:ring-indigo-500 focus:border-transparent"
                />
                <button
                  onClick={addSubtask}
                  disabled={!newSubtask.trim()}
                  className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <HiOutlinePlus className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Tags */}
          {todo.tags && todo.tags.length > 0 && (
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-500 mb-2">Tags</label>
              <div className="flex flex-wrap gap-1">
                {todo.tags.map((tag, i) => (
                  <span key={i} className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded">
                    #{tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Analytics */}
          {todo.analytics && (todo.analytics.completionTime || todo.analytics.completedOnTime !== undefined) && (
            <div className="mb-4 p-3 bg-gray-50 rounded-lg">
              <label className="block text-sm font-medium text-gray-500 mb-2">To-do Analytics</label>
              <div className="text-xs text-gray-600 space-y-1">
                {todo.analytics.completionTime !== undefined && (
                  <p>⏱️ Completed in {todo.analytics.completionTime.toFixed(1)} hours</p>
                )}
                {todo.analytics.completedOnTime !== undefined && (
                  <p>{todo.analytics.completedOnTime ? '✅ Completed on time' : '⚠️ Completed late'}</p>
                )}
                {todo.analytics.dueDateExtensions > 0 && (
                  <p>📅 Due date extended {todo.analytics.dueDateExtensions} time(s)</p>
                )}
              </div>
            </div>
          )}

          {/* Timestamps */}
          <div className="text-xs text-gray-400 border-t border-gray-100 pt-4">
            <p>Created: {new Date(todo.createdAt).toLocaleString()}</p>
            {todo.completedAt && (
              <p>Completed: {new Date(todo.completedAt).toLocaleString()}</p>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        {editing ? (
          <div className="flex items-center justify-between p-4 border-t border-gray-100">
            <button
              onClick={() => setEditing(false)}
              className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2"
            >
              {saving ? (
                <>
                  <Loader size="xs" />
                  Saving...
                </>
              ) : (
                'Save Changes'
              )}
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between p-4 border-t border-gray-100">
            <button
              onClick={() => onDelete(todo._id)}
              className="px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg text-sm flex items-center gap-2"
            >
              <HiOutlineTrash className="w-4 h-4" />
              Delete
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
