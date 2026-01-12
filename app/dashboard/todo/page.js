'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  HiOutlineListBullet,
  HiOutlinePlus,
  HiOutlineCheck,
  HiOutlineClock,
  HiOutlineCalendarDays,
  HiOutlineFlag,
  HiOutlineMagnifyingGlass,
  HiOutlineChevronDown,
  HiOutlineChevronRight,
  HiOutlineTrash,
  HiOutlinePencil,
  HiOutlineFolderPlus,
  HiOutlineXMark,
  HiOutlineChartBar,
  HiOutlineBell,
  HiOutlineEllipsisVertical,
  HiOutlineArrowPath,
  HiOutlineExclamationTriangle,
  HiOutlineHashtag,
  HiOutlineStar,
  HiOutlineCheckCircle,
  HiOutlineAdjustmentsHorizontal,
  HiOutlineDocumentText
} from 'react-icons/hi2'
import toast from '@/utils/toast'
import CreateTodoModal from './components/CreateTodoModal'
import TodoDetailPanel from './components/TodoDetailPanel'
import CategoryModal from './components/CategoryModal'
import AnalyticsPanel from './components/AnalyticsPanel'

export default function TodoPage() {
  const [todos, setTodos] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('all') // all, today, upcoming, completed, or category id
  const [searchQuery, setSearchQuery] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showCategoryModal, setShowCategoryModal] = useState(false)
  const [showAnalytics, setShowAnalytics] = useState(false)
  const [selectedTodo, setSelectedTodo] = useState(null)
  const [editingCategory, setEditingCategory] = useState(null)
  const [sortBy, setSortBy] = useState('dueDate') // dueDate, priority, createdAt
  const [showCompleted, setShowCompleted] = useState(false)
  const [analytics, setAnalytics] = useState(null)

  // Fetch todos
  const fetchTodos = useCallback(async () => {
    try {
      setLoading(true)
      const token = localStorage.getItem('token')
      
      const params = new URLSearchParams({
        sort: sortBy,
        limit: '100'
      })

      // Filter based on active tab
      if (activeTab === 'today') {
        params.append('dueDate', 'today')
      } else if (activeTab === 'upcoming') {
        params.append('dueDate', 'upcoming')
      } else if (activeTab === 'overdue') {
        params.append('dueDate', 'overdue')
      } else if (activeTab === 'completed') {
        params.append('status', 'completed')
      } else if (activeTab !== 'all' && activeTab !== 'no-date') {
        // Category filter
        params.append('category', activeTab)
      } else if (activeTab === 'no-date') {
        params.append('dueDate', 'no-date')
      }

      // Show pending by default, unless viewing completed
      if (activeTab !== 'completed' && !showCompleted) {
        params.append('status', 'pending')
      }

      if (searchQuery) {
        params.append('search', searchQuery)
      }

      const response = await fetch(`/api/personal-todos?${params}`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      })

      const data = await response.json()
      if (data.success) {
        setTodos(data.data)
      } else {
        toast.error(data.message || 'Failed to fetch to-dos')
      }
    } catch (error) {
      console.error('Error fetching todos:', error)
      toast.error('Failed to load to-dos')
    } finally {
      setLoading(false)
    }
  }, [activeTab, sortBy, showCompleted, searchQuery])

  // Fetch categories
  const fetchCategories = useCallback(async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/personal-todos/categories', {
        headers: {
          Authorization: `Bearer ${token}`
        }
      })

      const data = await response.json()
      if (data.success) {
        setCategories(data.data)
      }
    } catch (error) {
      console.error('Error fetching categories:', error)
    }
  }, [])

  // Fetch analytics
  const fetchAnalytics = useCallback(async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/personal-todos/analytics?period=month', {
        headers: {
          Authorization: `Bearer ${token}`
        }
      })

      const data = await response.json()
      if (data.success) {
        setAnalytics(data.data)
      }
    } catch (error) {
      console.error('Error fetching analytics:', error)
    }
  }, [])

  useEffect(() => {
    fetchTodos()
  }, [fetchTodos])

  useEffect(() => {
    fetchCategories()
    fetchAnalytics()
  }, [fetchCategories, fetchAnalytics])

  // Toggle todo completion
  const toggleComplete = async (todoId, e) => {
    e?.stopPropagation()
    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/personal-todos/${todoId}/complete`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`
        }
      })

      const data = await response.json()
      if (data.success) {
        setTodos(prev => prev.map(t => t._id === todoId ? data.data : t))
        if (selectedTodo?._id === todoId) {
          setSelectedTodo(data.data)
        }
        toast.success(data.message)
        fetchAnalytics() // Refresh analytics
      } else {
        toast.error(data.message || 'Failed to update to-do')
      }
    } catch (error) {
      console.error('Error toggling todo:', error)
      toast.error('Failed to update to-do')
    }
  }

  // Delete todo
  const deleteTodo = async (todoId) => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/personal-todos/${todoId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`
        }
      })

      const data = await response.json()
      if (data.success) {
        setTodos(prev => prev.filter(t => t._id !== todoId))
        if (selectedTodo?._id === todoId) {
          setSelectedTodo(null)
        }
        toast.success('To-do deleted')
        fetchAnalytics()
      } else {
        toast.error(data.message || 'Failed to delete to-do')
      }
    } catch (error) {
      console.error('Error deleting todo:', error)
      toast.error('Failed to delete to-do')
    }
  }

  // Handle todo created from modal
  const handleTodoCreated = (newTodo) => {
    setTodos(prev => [newTodo, ...prev])
    setShowCreateModal(false)
    toast.success('To-do created!')
    fetchAnalytics()
  }

  // Handle todo updated
  const handleTodoUpdated = (updatedTodo) => {
    setTodos(prev => prev.map(t => t._id === updatedTodo._id ? updatedTodo : t))
    setSelectedTodo(updatedTodo)
    fetchAnalytics()
  }

  // Handle category created/updated
  const handleCategoryChange = () => {
    fetchCategories()
    setShowCategoryModal(false)
    setEditingCategory(null)
  }

  // Get priority color
  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'high': return 'text-red-500 bg-red-50'
      case 'medium': return 'text-amber-500 bg-amber-50'
      case 'low': return 'text-green-500 bg-green-50'
      default: return 'text-gray-400 bg-gray-50'
    }
  }

  // Check if todo is overdue
  const isOverdue = (dueDate) => {
    if (!dueDate) return false
    const due = new Date(dueDate)
    due.setHours(23, 59, 59, 999)
    return due < new Date()
  }

  // Format due date
  const formatDueDate = (dueDate, dueTime) => {
    if (!dueDate) return null
    const date = new Date(dueDate)
    const today = new Date()
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    let dateStr
    if (date.toDateString() === today.toDateString()) {
      dateStr = 'Today'
    } else if (date.toDateString() === tomorrow.toDateString()) {
      dateStr = 'Tomorrow'
    } else {
      dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    }

    if (dueTime) {
      dateStr += `, ${dueTime}`
    }

    return dateStr
  }

  // Count todos by filter
  const todoCounts = {
    all: todos.length,
    today: todos.filter(t => {
      if (!t.dueDate) return false
      const today = new Date()
      const dueDate = new Date(t.dueDate)
      return dueDate.toDateString() === today.toDateString()
    }).length,
    upcoming: todos.filter(t => {
      if (!t.dueDate) return false
      const dueDate = new Date(t.dueDate)
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      return dueDate > today
    }).length,
    overdue: todos.filter(t => t.status !== 'completed' && isOverdue(t.dueDate)).length,
    completed: todos.filter(t => t.status === 'completed').length
  }

  return (
    <div className="page-container">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <HiOutlineListBullet className="w-7 h-7 text-indigo-600" />
            To-Do's
          </h1>
          <p className="text-gray-600 mt-1">
            Manage your personal to-dos and stay organized
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAnalytics(!showAnalytics)}
            className={`p-2.5 rounded-lg border transition-colors ${
              showAnalytics 
                ? 'bg-indigo-100 border-indigo-200 text-indigo-600' 
                : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
            title="View Analytics"
          >
            <HiOutlineChartBar className="w-5 h-5" />
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="btn-primary flex items-center gap-2"
          >
            <HiOutlinePlus className="w-5 h-5" />
            Add To-do
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <HiOutlineListBullet className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-800">{analytics?.summary?.total || 0}</p>
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
              <p className="text-2xl font-bold text-gray-800">{analytics?.summary?.pending || 0}</p>
              <p className="text-sm text-gray-500">Pending</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-100 rounded-lg">
              <HiOutlineExclamationTriangle className="w-5 h-5 text-red-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-800">{analytics?.summary?.overdue || 0}</p>
              <p className="text-sm text-gray-500">Overdue</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 rounded-lg">
              <HiOutlineCheckCircle className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-800">{analytics?.summary?.completed || 0}</p>
              <p className="text-sm text-gray-500">Completed</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-100 rounded-lg">
              <HiOutlineStar className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-800">{analytics?.summary?.productivityScore || 0}%</p>
              <p className="text-sm text-gray-500">Score</p>
            </div>
          </div>
        </div>
      </div>

      {/* Analytics Panel */}
      {showAnalytics && analytics && (
        <AnalyticsPanel analytics={analytics} onClose={() => setShowAnalytics(false)} />
      )}

      {/* Main Content */}
      <div className="flex gap-6">
        {/* Sidebar - Categories */}
        <div className="hidden md:block w-64 flex-shrink-0">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 sticky top-4">
            {/* Quick filters */}
            <div className="space-y-1 mb-4">
              <button
                onClick={() => setActiveTab('all')}
                className={`w-full flex items-center justify-start gap-3 px-3 py-2 rounded-lg transition-colors ${
                  activeTab === 'all' 
                    ? 'bg-indigo-50 text-indigo-700' 
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <HiOutlineListBullet className="w-5 h-5 flex-shrink-0" />
                <span className="flex-1 text-left font-medium">All To-dos</span>
                <span className="text-sm text-gray-500">{analytics?.summary?.total || 0}</span>
              </button>

              <button
                onClick={() => setActiveTab('today')}
                className={`w-full flex items-center justify-start gap-3 px-3 py-2 rounded-lg transition-colors ${
                  activeTab === 'today' 
                    ? 'bg-indigo-50 text-indigo-700' 
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <HiOutlineStar className="w-5 h-5 text-amber-500 flex-shrink-0" />
                <span className="flex-1 text-left font-medium">Today</span>
              </button>

              <button
                onClick={() => setActiveTab('upcoming')}
                className={`w-full flex items-center justify-start gap-3 px-3 py-2 rounded-lg transition-colors ${
                  activeTab === 'upcoming' 
                    ? 'bg-indigo-50 text-indigo-700' 
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <HiOutlineCalendarDays className="w-5 h-5 text-blue-500 flex-shrink-0" />
                <span className="flex-1 text-left font-medium">Upcoming</span>
              </button>

              {analytics?.summary?.overdue > 0 && (
                <button
                  onClick={() => setActiveTab('overdue')}
                  className={`w-full flex items-center justify-start gap-3 px-3 py-2 rounded-lg transition-colors ${
                    activeTab === 'overdue' 
                      ? 'bg-red-50 text-red-700' 
                      : 'text-red-600 hover:bg-red-50'
                  }`}
                >
                  <HiOutlineExclamationTriangle className="w-5 h-5 flex-shrink-0" />
                  <span className="flex-1 text-left font-medium">Overdue</span>
                  <span className="text-sm bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
                    {analytics?.summary?.overdue}
                  </span>
                </button>
              )}

              <button
                onClick={() => setActiveTab('completed')}
                className={`w-full flex items-center justify-start gap-3 px-3 py-2 rounded-lg transition-colors ${
                  activeTab === 'completed' 
                    ? 'bg-green-50 text-green-700' 
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <HiOutlineCheckCircle className="w-5 h-5 text-green-500 flex-shrink-0" />
                <span className="flex-1 text-left font-medium">Completed</span>
              </button>
            </div>

            {/* Divider */}
            <div className="border-t border-gray-200 my-4"></div>

            {/* Categories */}
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Categories</h3>
              <button
                onClick={() => {
                  setEditingCategory(null)
                  setShowCategoryModal(true)
                }}
                className="p-1 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded"
                title="Add Category"
              >
                <HiOutlinePlus className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-1">
              {categories.map(category => (
                <button
                  key={category._id}
                  onClick={() => setActiveTab(category._id)}
                  className={`w-full flex items-center justify-start gap-3 px-3 py-2 rounded-lg transition-colors group ${
                    activeTab === category._id 
                      ? 'bg-indigo-50 text-indigo-700' 
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <div 
                    className="w-3 h-3 rounded-full flex-shrink-0" 
                    style={{ backgroundColor: category.color }}
                  ></div>
                  <span className="flex-1 text-left font-medium truncate">{category.name}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setEditingCategory(category)
                      setShowCategoryModal(true)
                    }}
                    className="p-1 text-gray-400 hover:text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <HiOutlinePencil className="w-3.5 h-3.5" />
                  </button>
                </button>
              ))}

              {categories.length === 0 && (
                <p className="text-sm text-gray-400 px-3 py-2">No categories yet</p>
              )}
            </div>

            {/* No date to-dos */}
            <button
              onClick={() => setActiveTab('no-date')}
              className={`w-full flex items-center justify-start gap-3 px-3 py-2 rounded-lg transition-colors mt-4 ${
                activeTab === 'no-date' 
                  ? 'bg-gray-100 text-gray-700' 
                  : 'text-gray-500 hover:bg-gray-50'
              }`}
            >
              <HiOutlineDocumentText className="w-5 h-5 flex-shrink-0" />
              <span className="flex-1 text-left font-medium">No Due Date</span>
            </button>
          </div>
        </div>

        {/* Main Todo List */}
        <div className="flex-1 min-w-0">
          {/* Search and Filters */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-4">
            <div className="flex flex-col sm:flex-row gap-4">
              {/* Search */}
              <div className="relative flex-1">
                <HiOutlineMagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search to-dos..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>

              {/* Sort */}
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="px-4 py-2.5 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              >
                <option value="dueDate">Sort by Due Date</option>
                <option value="priority">Sort by Priority</option>
                <option value="createdAt">Sort by Created</option>
                <option value="title">Sort by Title</option>
              </select>

              {/* Mobile category filter */}
              <select
                value={activeTab}
                onChange={(e) => setActiveTab(e.target.value)}
                className="md:hidden px-4 py-2.5 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              >
                <option value="all">All To-dos</option>
                <option value="today">Today</option>
                <option value="upcoming">Upcoming</option>
                <option value="overdue">Overdue</option>
                <option value="completed">Completed</option>
                {categories.map(cat => (
                  <option key={cat._id} value={cat._id}>{cat.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Todo List */}
          {loading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="bg-white rounded-xl p-4 animate-pulse shadow-sm border border-gray-100">
                  <div className="flex items-center gap-3">
                    <div className="w-5 h-5 bg-gray-200 rounded-full"></div>
                    <div className="flex-1">
                      <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
                      <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : todos.length === 0 ? (
            <div className="text-center py-12 bg-white rounded-xl shadow-sm border border-gray-100">
              <HiOutlineCheckCircle className="w-16 h-16 mx-auto text-gray-300 mb-4" />
              <h3 className="text-lg font-medium text-gray-800 mb-2">
                {activeTab === 'completed' ? 'No completed to-dos' : 'No to-dos yet'}
              </h3>
              <p className="text-gray-500 mb-4">
                {activeTab === 'completed' 
                  ? 'Complete some to-dos to see them here'
                  : 'Add your first to-do to get started'
                }
              </p>
              {activeTab !== 'completed' && (
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="btn-primary inline-flex items-center gap-2"
                >
                  <HiOutlinePlus className="w-5 h-5" />
                  Add To-do
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {todos.map(todo => (
                <div
                  key={todo._id}
                  onClick={() => setSelectedTodo(todo)}
                  className={`bg-white rounded-xl p-4 shadow-sm border border-gray-100 cursor-pointer hover:shadow-md transition-shadow ${
                    selectedTodo?._id === todo._id ? 'ring-2 ring-indigo-500' : ''
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {/* Checkbox */}
                    <button
                      onClick={(e) => toggleComplete(todo._id, e)}
                      className={`w-5 h-5 rounded-full border-2 flex-shrink-0 mt-0.5 flex items-center justify-center transition-colors ${
                        todo.status === 'completed'
                          ? 'bg-green-500 border-green-500 text-white'
                          : 'border-gray-300 hover:border-green-500'
                      }`}
                    >
                      {todo.status === 'completed' && (
                        <HiOutlineCheck className="w-3 h-3" />
                      )}
                    </button>

                    {/* Todo content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className={`font-medium ${
                          todo.status === 'completed' 
                            ? 'text-gray-400 line-through' 
                            : 'text-gray-800'
                        }`}>
                          {todo.title}
                        </h3>
                        {todo.priority && (
                          <span className={`px-2 py-0.5 text-xs font-medium rounded ${getPriorityColor(todo.priority)}`}>
                            {todo.priority}
                          </span>
                        )}
                      </div>

                      {/* Meta info */}
                      <div className="flex flex-wrap items-center gap-3 text-sm">
                        {/* Due date */}
                        {todo.dueDate && (
                          <span className={`flex items-center gap-1 ${
                            todo.status !== 'completed' && isOverdue(todo.dueDate)
                              ? 'text-red-500'
                              : 'text-gray-500'
                          }`}>
                            <HiOutlineCalendarDays className="w-4 h-4" />
                            {formatDueDate(todo.dueDate, todo.dueTime)}
                          </span>
                        )}

                        {/* Category */}
                        {todo.category && (
                          <span className="flex items-center gap-1 text-gray-500">
                            <div 
                              className="w-2.5 h-2.5 rounded-full" 
                              style={{ backgroundColor: todo.category.color }}
                            ></div>
                            {todo.category.name}
                          </span>
                        )}

                        {/* Subtasks */}
                        {todo.subtasks && todo.subtasks.length > 0 && (
                          <span className="flex items-center gap-1 text-gray-500">
                            <HiOutlineCheckCircle className="w-4 h-4" />
                            {todo.subtasks.filter(s => s.completed).length}/{todo.subtasks.length}
                          </span>
                        )}

                        {/* Reminder indicator */}
                        {todo.reminders && todo.reminders.length > 0 && (
                          <span className="flex items-center gap-1 text-gray-400">
                            <HiOutlineBell className="w-4 h-4" />
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        deleteTodo(todo._id)
                      }}
                      className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                    >
                      <HiOutlineTrash className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Todo Detail Panel */}
        {selectedTodo && (
          <TodoDetailPanel
            todo={selectedTodo}
            categories={categories}
            onClose={() => setSelectedTodo(null)}
            onUpdate={handleTodoUpdated}
            onDelete={deleteTodo}
            onToggleComplete={toggleComplete}
          />
        )}
      </div>

      {/* Create Todo Modal */}
      {showCreateModal && (
        <CreateTodoModal
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          onSuccess={handleTodoCreated}
          categories={categories}
          defaultCategory={activeTab !== 'all' && activeTab !== 'today' && activeTab !== 'upcoming' && activeTab !== 'completed' && activeTab !== 'overdue' && activeTab !== 'no-date' ? activeTab : null}
        />
      )}

      {/* Category Modal */}
      {showCategoryModal && (
        <CategoryModal
          isOpen={showCategoryModal}
          onClose={() => {
            setShowCategoryModal(false)
            setEditingCategory(null)
          }}
          onSuccess={handleCategoryChange}
          category={editingCategory}
        />
      )}
    </div>
  )
}
