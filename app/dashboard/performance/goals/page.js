'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import toast from '@/utils/toast'
import {
  FaPlus, FaEye, FaEdit, FaTrash, FaBullseye, FaSearch, FaFilter,
  FaCalendarAlt, FaClock, FaChartLine, FaCheckCircle, FaExclamationTriangle,
  FaFlag, FaTasks, FaUserClock, FaSync, FaUserFriends
} from 'react-icons/fa'
import { Select, SelectItem, Input, Button, Skeleton } from '@heroui/react'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import useApiMutation from '@/hooks/useApiMutation'
import { DataErrorState } from '@/components/ui/ErrorBoundary'
import BackgroundRefreshIndicator from '@/components/ui/BackgroundRefreshIndicator'

export default function PerformanceGoalsPage() {
  const router = useRouter()
  const [searchTerm, setSearchTerm] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterPriority, setFilterPriority] = useState('all')
  const [viewMode, setViewMode] = useState('all')
  const [selectedDepartment, setSelectedDepartment] = useState('all')
  const [selectedTeam, setSelectedTeam] = useState('all')

  const user = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('user')) } catch { return null }
  }, [])

  const empId = useMemo(() => {
    if (!user) return null
    return typeof user.employeeId === 'object'
      ? user.employeeId._id || user.employeeId
      : user.employeeId
  }, [user])

  const isAdminOrHR = user && ['admin', 'hr'].includes(user.role)

  // Check department head / team leader status
  const { data: headCheckRes } = useAuthedSWR(user ? '/api/team/check-head' : null)
  const isDepartmentHead = headCheckRes?.success && headCheckRes?.isDepartmentHead
  const isTeamLeader = headCheckRes?.success && headCheckRes?.isTeamLeader
  const headedDepartments = headCheckRes?.departments || []
  const teamLeaderTeams = headCheckRes?.teamLeaderTeams || []

  // Fetch all departments for admin/HR
  const { data: deptsRes } = useAuthedSWR(isAdminOrHR ? '/api/departments' : null)
  const allDepartments = deptsRes?.data || []
  const departments = isAdminOrHR ? allDepartments : headedDepartments

  // Fetch teams for selected department (or team leader's teams)
  const teamsFetchKey = (() => {
    if (isTeamLeader && !isDepartmentHead && !isAdminOrHR) return null // Team leaders use teamLeaderTeams directly
    if (selectedDepartment && selectedDepartment !== 'all') return `/api/teams?department=${selectedDepartment}`
    if (!isAdminOrHR && headedDepartments.length === 1) return `/api/teams?department=${headedDepartments[0]?._id}`
    return null
  })()
  const { data: teamsRes } = useAuthedSWR(teamsFetchKey)
  const availableTeams = isTeamLeader && !isDepartmentHead && !isAdminOrHR
    ? teamLeaderTeams
    : (teamsRes?.data || [])

  // Build SWR key with department + team filters
  const goalsSwrKey = useMemo(() => {
    let url = '/api/performance/goals'
    const params = []
    if (isDepartmentHead && headedDepartments.length > 0 && selectedDepartment === 'all') {
      params.push(`departments=${headedDepartments.map(d => d._id).join(',')}`)
    } else if (selectedDepartment && selectedDepartment !== 'all') {
      params.push(`department=${selectedDepartment}`)
    }
    if (selectedTeam && selectedTeam !== 'all') {
      params.push(`team=${selectedTeam}`)
    }
    if (params.length > 0) url += '?' + params.join('&')
    return url
  }, [selectedDepartment, selectedTeam, isDepartmentHead, headedDepartments])

  // SWR: fetch goals
  const { data: goalsRes, error: goalsError, isLoading: goalsLoading, isValidating: goalsValidating, mutate: refreshGoals } = useAuthedSWR(goalsSwrKey)
  const goals = goalsRes?.data || []

  // SWR: fetch projects (tasks)
  const { data: projectsRes, error: projectsError, isLoading: projectsLoading, isValidating: projectsValidating, mutate: refreshProjects } = useAuthedSWR(
    empId ? `/api/tasks?employee=${empId}&limit=100` : null
  )
  const projects = useMemo(() => {
    if (!projectsRes?.data || !user) return []
    return (projectsRes.data || []).map(task => ({
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
        firstName: user.firstName,
        lastName: user.lastName,
        employeeCode: user.employeeCode
      },
      assignedBy: task.assignedBy,
      createdAt: task.createdAt,
      createdBy: task.assignedBy || { firstName: 'System', lastName: '' }
    }))
  }, [projectsRes, user, empId])

  const isLoading = goalsLoading || projectsLoading
  const error = goalsError || projectsError
  const isValidating = goalsValidating || projectsValidating
  const refresh = () => { refreshGoals(); refreshProjects() }

  // Mutation: delete goal
  const deleteMutation = useApiMutation({
    invalidateKeys: ['/api/performance/goals'],
    onSuccess: () => toast.success('Goal deleted successfully'),
    onError: (msg) => toast.error(msg || 'Failed to delete goal'),
  })

  const handleDelete = async (goalId, isProject = false) => {
    if (!confirm('Are you sure you want to delete this goal?')) return

    if (isProject) {
      // Just refresh projects to reflect changes
      refreshProjects()
      toast.success('Project removed from view')
      return
    }

    deleteMutation.execute('/api/performance/goals?goalId=' + goalId, null, { method: 'DELETE' })
  }

  const canManageGoals = () => {
    return user && (['admin', 'hr', 'manager', 'department_head', 'team_leader'].includes(user.role) || isDepartmentHead || isTeamLeader)
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

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 pb-24 md:pb-6 bg-gray-50 min-h-screen">
        <div className="mb-6">
          <Skeleton className="h-8 w-64 rounded-lg mb-2" />
          <Skeleton className="h-4 w-48 rounded-lg" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="bg-white rounded-xl shadow-sm p-4">
              <Skeleton className="h-4 w-16 rounded mb-2" />
              <Skeleton className="h-8 w-12 rounded" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-white rounded-xl shadow-sm p-4">
              <div className="flex items-start gap-3">
                <Skeleton className="w-10 h-10 rounded-full" />
                <div className="flex-1">
                  <Skeleton className="h-5 w-40 rounded mb-2" />
                  <Skeleton className="h-4 w-24 rounded" />
                </div>
              </div>
              <Skeleton className="h-2 w-full rounded-full mt-4" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4 sm:p-6 pb-24 md:pb-6 bg-gray-50 min-h-screen">
        <DataErrorState message="Failed to load performance goals" onRetry={refresh} />
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 pb-24 md:pb-6 bg-gray-50 min-h-screen">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-6 gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Performance Goals</h1>
          <p className="text-gray-600 mt-1">Track and manage employee objectives <BackgroundRefreshIndicator isValidating={isValidating && !isLoading} position="inline" /></p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={refresh}
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
                startContent={<FaSearch className="text-default-400 w-4 h-4" />}
                size="sm"
                variant="bordered"
                classNames={{
                  inputWrapper: "bg-default-50 dark:bg-[#1E293B] shadow-none",
                }}
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

            {/* Department Filter */}
            {departments.length > 1 && (
              <Select
                selectedKeys={[selectedDepartment]}
                onSelectionChange={(keys) => { setSelectedDepartment(Array.from(keys)[0] || 'all'); setSelectedTeam('all') }}
                className="w-44"
                size="sm"
                aria-label="Filter by department"
              >
                <SelectItem key="all">{isDepartmentHead ? 'All My Depts' : 'All Departments'}</SelectItem>
                {departments.map((dept) => (
                  <SelectItem key={dept._id}>{dept.name}</SelectItem>
                ))}
              </Select>
            )}

            {/* Team Filter */}
            {availableTeams.length > 0 && (
              <div className="flex items-center gap-1">
                <FaUserFriends className="text-gray-400 w-4 h-4" />
                <Select
                  selectedKeys={[selectedTeam]}
                  onSelectionChange={(keys) => setSelectedTeam(Array.from(keys)[0] || 'all')}
                  className="w-40"
                  size="sm"
                  aria-label="Filter by team"
                >
                  <SelectItem key="all">All Teams</SelectItem>
                  {availableTeams.map((team) => (
                    <SelectItem key={team._id}>{team.teamName}</SelectItem>
                  ))}
                </Select>
              </div>
            )}
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
