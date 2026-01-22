'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import toast from '@/utils/toast'
import { 
  FaPlus, FaEye, FaEdit, FaTrash, FaBullseye, FaSearch, FaFilter, 
  FaCalendarAlt, FaClock, FaChartLine, FaCheckCircle, FaExclamationTriangle,
  FaFlag, FaTasks, FaUserClock, FaSync
} from 'react-icons/fa'
import Loader from '@/components/ui/Loader'
import { Select, SelectItem, Input, Button } from '@heroui/react'

export default function PerformanceGoalsPage() {
  const router = useRouter()
  const [goals, setGoals] = useState([])
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterPriority, setFilterPriority] = useState('all')
  const [viewMode, setViewMode] = useState('all')

  useEffect(() => {
    const userData = localStorage.getItem('user')
    if (userData) {
      const parsedUser = JSON.parse(userData)
      setUser(parsedUser)
      fetchGoals()
      fetchProjects()
    }
  }, [])

  const fetchGoals = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/performance/goals', {
        headers: { 'Authorization': 'Bearer ' + token }
      })

      const data = await response.json()
      if (data.success) {
        setGoals(data.data || [])
      } else {
        toast.error(data.message || 'Failed to fetch goals')
      }
    } catch (error) {
      console.error('Fetch goals error:', error)
      toast.error('Failed to fetch performance goals')
    } finally {
      setLoading(false)
    }
  }

  const fetchProjects = async () => {
    try {
      const token = localStorage.getItem('token')
      const userData = JSON.parse(localStorage.getItem('user'))
      const empId = typeof userData.employeeId === 'object'
        ? userData.employeeId._id || userData.employeeId
        : userData.employeeId

      const response = await fetch('/api/tasks?employee=' + empId + '&limit=100', {
        headers: { 'Authorization': 'Bearer ' + token }
      })

      const data = await response.json()
      if (data.success) {
        const projectGoals = (data.data || []).map(task => ({
          _id: task._id,
          title: task.title,
          description: task.description,
          type: 'project',
          status: task.status,
          progress: task.progress || 0,
          priority: task.priority,
          dueDate: task.dueDate,
          startDate: task.startDate,
          completedAt: task.completedAt,
          employee: {
            _id: empId,
            firstName: userData.firstName,
            lastName: userData.lastName,
            employeeCode: userData.employeeCode
          },
          assignedBy: task.assignedBy,
          createdAt: task.createdAt,
          createdBy: task.assignedBy || { firstName: 'System', lastName: '' }
        }))
        setProjects(projectGoals)
      }
    } catch (error) {
      console.error('Fetch projects error:', error)
    }
  }

  const handleDelete = async (goalId, isProject = false) => {
    if (!confirm('Are you sure you want to delete this goal?')) return

    if (isProject) {
      setProjects(projects.filter(g => g._id !== goalId))
      toast.success('Project removed from view')
      return
    }

    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/performance/goals?goalId=' + goalId, {
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer ' + token }
      })

      const data = await response.json()
      if (data.success) {
        setGoals(goals.filter(g => g._id !== goalId))
        toast.success('Goal deleted successfully')
      } else {
        toast.error(data.message || 'Failed to delete goal')
      }
    } catch (error) {
      console.error('Delete goal error:', error)
      toast.error('Failed to delete goal')
    }
  }

  const canManageGoals = () => {
    return user && ['admin', 'hr', 'manager', 'department_head'].includes(user.role)
  }

  const getStatusConfig = (status) => {
    const configs = {
      'completed': { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', icon: FaCheckCircle, label: 'Completed' },
      'in-progress': { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', icon: FaChartLine, label: 'In Progress' },
      'in_progress': { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', icon: FaChartLine, label: 'In Progress' },
      'not-started': { bg: 'bg-gray-50', border: 'border-gray-200', text: 'text-gray-700', icon: FaClock, label: 'Not Started' },
      'pending': { bg: 'bg-gray-50', border: 'border-gray-200', text: 'text-gray-700', icon: FaClock, label: 'Pending' },
      'on-hold': { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', icon: FaExclamationTriangle, label: 'On Hold' },
      'cancelled': { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', icon: FaExclamationTriangle, label: 'Cancelled' }
    }
    return configs[status] || configs['not-started']
  }

  const getPriorityConfig = (priority) => {
    const configs = {
      'critical': { bg: 'bg-red-100', text: 'text-red-800', dot: 'bg-red-500' },
      'high': { bg: 'bg-orange-100', text: 'text-orange-800', dot: 'bg-orange-500' },
      'medium': { bg: 'bg-yellow-100', text: 'text-yellow-800', dot: 'bg-yellow-500' },
      'low': { bg: 'bg-green-100', text: 'text-green-800', dot: 'bg-green-500' }
    }
    return configs[priority] || configs['medium']
  }

  const isOverdue = (dueDate, status) => {
    return status !== 'completed' && status !== 'cancelled' && new Date(dueDate) < new Date()
  }

  const getDaysRemaining = (dueDate) => {
    const now = new Date()
    const due = new Date(dueDate)
    const diffTime = due - now
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
    return diffDays
  }

  const getProgressColor = (progress) => {
    if (progress >= 80) return 'bg-emerald-500'
    if (progress >= 50) return 'bg-blue-500'
    if (progress >= 25) return 'bg-yellow-500'
    return 'bg-gray-400'
  }

  const allItems = viewMode === 'goals' ? goals :
                   viewMode === 'projects' ? projects :
                   [...goals, ...projects]

  const filteredGoals = allItems.filter(goal => {
    const matchesSearch = searchTerm === '' ||
      ((goal.employee?.firstName || '') + ' ' + (goal.employee?.lastName || '')).toLowerCase().includes(searchTerm.toLowerCase()) ||
      (goal.employee?.employeeCode || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      goal.title.toLowerCase().includes(searchTerm.toLowerCase())

    const matchesStatus = filterStatus === 'all' || goal.status === filterStatus
    const matchesPriority = filterPriority === 'all' || goal.priority === filterPriority

    return matchesSearch && matchesStatus && matchesPriority
  })

  // Stats calculations
  const stats = {
    total: allItems.length,
    completed: allItems.filter(g => g.status === 'completed').length,
    inProgress: allItems.filter(g => g.status === 'in-progress' || g.status === 'in_progress').length,
    overdue: allItems.filter(g => isOverdue(g.dueDate, g.status)).length,
    avgProgress: allItems.length > 0 ? Math.round(allItems.reduce((acc, g) => acc + (g.progress || 0), 0) / allItems.length) : 0
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <Loader size="lg" />
          <p className="mt-4 text-gray-600">Loading goals...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 pb-24 md:pb-6 bg-gray-50 min-h-screen">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-6 gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Performance Goals</h1>
          <p className="text-gray-600 mt-1">Track and manage employee objectives</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => { fetchGoals(); fetchProjects(); }}
            className="p-2 text-gray-600 hover:text-primary-600 hover:bg-gray-100 rounded-lg transition-colors"
            title="Refresh"
          >
            <FaSync className="w-4 h-4" />
          </button>
          {canManageGoals() && (
            <button
              onClick={() => router.push('/dashboard/performance/goals/create')}
              className="px-4 py-2.5 bg-gradient-to-r from-primary-500 to-primary-600 text-white rounded-lg hover:from-primary-600 hover:to-primary-700 transition-all shadow-md hover:shadow-lg flex items-center gap-2 font-medium"
            >
              <FaPlus className="w-4 h-4" />
              <span>New Goal</span>
            </button>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow-sm p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-900 uppercase tracking-wide">Total</p>
              <h3 className="text-2xl font-bold text-gray-900 mt-1">{stats.total}</h3>
            </div>
            <FaBullseye className="w-6 h-6 text-blue-600" />
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-900 uppercase tracking-wide">Completed</p>
              <h3 className="text-2xl font-bold text-emerald-600 mt-1">{stats.completed}</h3>
            </div>
            <FaCheckCircle className="w-6 h-6 text-emerald-600" />
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-900 uppercase tracking-wide">In Progress</p>
              <h3 className="text-2xl font-bold text-blue-600 mt-1">{stats.inProgress}</h3>
            </div>
            <FaChartLine className="w-6 h-6 text-blue-600" />
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-900 uppercase tracking-wide">Overdue</p>
              <h3 className="text-2xl font-bold text-red-600 mt-1">{stats.overdue}</h3>
            </div>
            <FaExclamationTriangle className="w-6 h-6 text-red-600" />
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-900 uppercase tracking-wide">Avg Progress</p>
              <h3 className="text-2xl font-bold text-purple-600 mt-1">{stats.avgProgress}%</h3>
            </div>
            <FaTasks className="w-6 h-6 text-purple-600" />
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm p-4 mb-6 border border-gray-100">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            {/* View Mode Toggle */}
            <div className="flex items-center bg-gray-100 rounded-lg p-1">
              {['all', 'goals', 'projects'].map((mode) => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={'px-3 py-1.5 rounded-md text-sm font-medium transition-all ' +
                    (viewMode === mode 
                      ? 'bg-white text-primary-600 shadow-sm' 
                      : 'text-gray-600 hover:text-gray-900')}
                >
                  {mode === 'all' ? 'All (' + allItems.length + ')' :
                   mode === 'goals' ? 'Goals (' + goals.length + ')' :
                   'Projects (' + projects.length + ')'}
                </button>
              ))}
            </div>

            {/* Search */}
            <div className="w-48">
              <Input
                type="text"
                placeholder="Search..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                startContent={<FaSearch className="text-gray-400 w-4 h-4" />}
                size="sm"
              />
            </div>

            {/* Status Filter */}
            <Select
              selectedKeys={[filterStatus]}
              onSelectionChange={(keys) => setFilterStatus(Array.from(keys)[0] || 'all')}
              className="w-40"
              size="sm"
              aria-label="Filter by status"
            >
              <SelectItem key="all">All Status</SelectItem>
              <SelectItem key="completed">Completed</SelectItem>
              <SelectItem key="in-progress">In Progress</SelectItem>
              <SelectItem key="not-started">Not Started</SelectItem>
              <SelectItem key="on-hold">On Hold</SelectItem>
            </Select>

            {/* Priority Filter */}
            <Select
              selectedKeys={[filterPriority]}
              onSelectionChange={(keys) => setFilterPriority(Array.from(keys)[0] || 'all')}
              className="w-40"
              size="sm"
              aria-label="Filter by priority"
            >
              <SelectItem key="all">All Priority</SelectItem>
              <SelectItem key="critical">Critical</SelectItem>
              <SelectItem key="high">High</SelectItem>
              <SelectItem key="medium">Medium</SelectItem>
              <SelectItem key="low">Low</SelectItem>
            </Select>
          </div>

          <div className="text-sm text-gray-500">
            Showing {filteredGoals.length} of {allItems.length}
          </div>
        </div>
      </div>

      {/* Goals Grid */}
      {filteredGoals.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm p-12 text-center border border-gray-100">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-100 flex items-center justify-center">
            <FaBullseye className="w-8 h-8 text-gray-400" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No goals found</h3>
          <p className="text-gray-500 mb-6">
            {canManageGoals() 
              ? 'Create your first performance goal to track employee objectives.' 
              : 'No performance goals have been assigned yet.'}
          </p>
          {canManageGoals() && (
            <button
              onClick={() => router.push('/dashboard/performance/goals/create')}
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors"
            >
              <FaPlus className="w-4 h-4" />
              Create Goal
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filteredGoals.map((goal) => {
            const statusConfig = getStatusConfig(goal.status)
            const priorityConfig = getPriorityConfig(goal.priority)
            const daysLeft = getDaysRemaining(goal.dueDate)
            const overdue = isOverdue(goal.dueDate, goal.status)
            const StatusIcon = statusConfig.icon

            return (
              <div 
                key={goal._id} 
                className={'bg-white rounded-xl shadow-sm border-l-4 hover:shadow-md transition-all duration-200 overflow-hidden ' + statusConfig.border}
              >
                {/* Card Header */}
                <div className="p-4 pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      {/* Avatar */}
                      <div className={'w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold text-sm flex-shrink-0 ' + 
                        (goal.type === 'project' ? 'bg-purple-500' : 'bg-primary-500')}>
                        {(goal.employee?.firstName?.charAt(0) || 'U')}{(goal.employee?.lastName?.charAt(0) || '')}
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold text-gray-900 truncate">{goal.title}</h3>
                          {goal.type === 'project' && (
                            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-purple-100 text-purple-700">
                              Project
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-600 mt-0.5">
                          {goal.employee?.firstName} {goal.employee?.lastName}
                          {goal.employee?.employeeCode && <span className="text-gray-400 ml-1">({goal.employee.employeeCode})</span>}
                        </p>
                      </div>
                    </div>

                    {/* Actions */}
                    {canManageGoals() && (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => router.push('/dashboard/performance/goals/' + goal._id)}
                          className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          title="View"
                        >
                          <FaEye className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => router.push('/dashboard/performance/goals/edit/' + goal._id)}
                          className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                          title="Edit"
                        >
                          <FaEdit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(goal._id, goal.type === 'project')}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Delete"
                        >
                          <FaTrash className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Description */}
                  {goal.description && (
                    <p className="text-sm text-gray-600 mt-3 line-clamp-2">{goal.description}</p>
                  )}
                </div>

                {/* Progress Section */}
                <div className="px-4 py-3 bg-gray-50 border-t border-gray-100">
                  <div className="flex items-center justify-start mb-2">
                    <span className="text-xs font-medium text-gray-600">Progress</span>
                    <span className={'text-sm font-semibold ' + (goal.progress >= 80 ? 'text-emerald-600' : goal.progress >= 50 ? 'text-blue-600' : 'text-gray-600')}>
                      {goal.progress || 0}%
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className={'h-2 rounded-full transition-all duration-500 ' + getProgressColor(goal.progress || 0)}
                      style={{ width: (goal.progress || 0) + '%' }}
                    ></div>
                  </div>
                </div>

                {/* Card Footer */}
                <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    {/* Status Badge */}
                    <span className={'inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full ' + statusConfig.bg + ' ' + statusConfig.text}>
                      <StatusIcon className="w-3 h-3" />
                      {statusConfig.label}
                    </span>

                    {/* Priority Badge */}
                    <span className={'inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full ' + priorityConfig.bg + ' ' + priorityConfig.text}>
                      <span className={'w-1.5 h-1.5 rounded-full ' + priorityConfig.dot}></span>
                      {(goal.priority || 'medium').charAt(0).toUpperCase() + (goal.priority || 'medium').slice(1)}
                    </span>
                  </div>

                  {/* Due Date */}
                  <div className={'flex items-center gap-1.5 text-xs ' + (overdue ? 'text-red-600 font-medium' : 'text-gray-500')}>
                    <FaCalendarAlt className="w-3 h-3" />
                    <span>
                      {overdue ? 'Overdue by ' + Math.abs(daysLeft) + ' days' :
                       daysLeft === 0 ? 'Due today' :
                       daysLeft === 1 ? 'Due tomorrow' :
                       daysLeft < 7 ? daysLeft + ' days left' :
                       new Date(goal.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                </div>

                {/* Milestones Preview (if any) */}
                {goal.milestones && goal.milestones.length > 0 && (
                  <div className="px-4 py-2 border-t border-gray-100 bg-gray-50">
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <FaTasks className="w-3 h-3" />
                      <span>
                        {goal.milestones.filter(m => m.completed).length}/{goal.milestones.length} milestones
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
