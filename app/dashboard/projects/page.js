'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import toast from '@/utils/toast'
import { 
  HiOutlineRectangleStack,
  HiOutlinePlus,
  HiOutlineMagnifyingGlass,
  HiOutlineClock,
  HiOutlineCheckCircle,
  HiOutlineExclamationTriangle
} from 'react-icons/hi2'
import { 
  FaPlus, FaSearch, FaFilter, FaProjectDiagram, FaCalendarAlt,
  FaCheckCircle, FaClock, FaExclamationTriangle, FaArchive,
  FaEye, FaUsers, FaTasks, FaChartLine, FaClipboardCheck
} from 'react-icons/fa'
import { playNotificationSound, NotificationSoundTypes } from '@/lib/notificationSounds'

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

export default function ProjectsPage() {
  const router = useRouter()
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('active')
  const [user, setUser] = useState(null)
  const [stats, setStats] = useState({
    total: 0,
    active: 0,
    completed: 0,
    overdue: 0
  })
  
  // Auto-refresh refs
  const refreshIntervalRef = useRef(null)
  const lastFetchRef = useRef(Date.now())

  useEffect(() => {
    const userData = localStorage.getItem('user')
    if (userData) {
      setUser(JSON.parse(userData))
    }
  }, [])

  const fetchProjects = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true)
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/projects?status=${statusFilter}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      const data = await response.json()

      if (data.success) {
        setProjects(prev => {
          // Only update if data changed to prevent layout shifts
          if (JSON.stringify(prev) !== JSON.stringify(data.data)) {
            return data.data
          }
          return prev
        })
        
        // Calculate stats
        const allProjects = data.data
        setStats({
          total: allProjects.length,
          active: allProjects.filter(p => ['planned', 'ongoing', 'pending'].includes(p.status)).length,
          completed: allProjects.filter(p => ['completed', 'approved'].includes(p.status)).length,
          overdue: allProjects.filter(p => p.status === 'overdue' || (new Date(p.endDate) < new Date() && !['completed', 'approved', 'archived'].includes(p.status))).length
        })
        lastFetchRef.current = Date.now()
      } else if (!silent) {
        toast.error(data.message || 'Failed to fetch projects')
      }
    } catch (error) {
      console.error('Fetch projects error:', error)
      if (!silent) toast.error('An error occurred while fetching projects')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [statusFilter])

  // Silent refresh function for background updates
  const silentRefresh = useCallback(() => {
    fetchProjects(true)
  }, [fetchProjects])

  useEffect(() => {
    fetchProjects()
  }, [statusFilter, fetchProjects])

  // Auto-refresh every 10 seconds
  useEffect(() => {
    refreshIntervalRef.current = setInterval(silentRefresh, 10000)
    
    // Also refresh when window gains focus
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
  }, [silentRefresh])

  const filteredProjects = projects.filter(project => {
    const matchesSearch = search === '' || 
      project.name.toLowerCase().includes(search.toLowerCase()) ||
      project.description?.toLowerCase().includes(search.toLowerCase())
    return matchesSearch
  })

  // All users can create projects
  const canCreateProject = () => {
    return true
  }

  const formatDate = (date) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })
  }

  const getDaysRemaining = (endDate) => {
    const now = new Date()
    const end = new Date(endDate)
    const diff = end - now
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24))
    return days
  }

  return (
    <div className="page-container">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <HiOutlineRectangleStack className="w-7 h-7 text-indigo-600" />
            Projects
          </h1>
          <p className="text-gray-600 mt-1">
            Manage and track your projects
          </p>
        </div>
        {canCreateProject() && (
          <button
            onClick={() => router.push('/dashboard/projects/create')}
            className="btn-primary flex items-center gap-2"
          >
            <HiOutlinePlus className="w-5 h-5" />
            Create Project
          </button>
        )}
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <HiOutlineRectangleStack className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-800">{stats.total}</p>
              <p className="text-sm text-gray-500">Total</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 rounded-lg">
              <HiOutlineClock className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-800">{stats.active}</p>
              <p className="text-sm text-gray-500">Active</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-100 rounded-lg">
              <HiOutlineCheckCircle className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-800">{stats.completed}</p>
              <p className="text-sm text-gray-500">Completed</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-100 rounded-lg">
              <HiOutlineExclamationTriangle className="w-5 h-5 text-red-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-800">{stats.overdue}</p>
              <p className="text-sm text-gray-500">Overdue</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters and Search */}
      <div className="bg-white rounded-lg shadow-md p-4 mb-6">
        <div className="flex flex-col md:flex-row gap-4">
          {/* Search */}
          <div className="relative flex-1">
            <HiOutlineMagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search projects..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>

          {/* Filters */}
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setStatusFilter('active')}
              className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                statusFilter === 'active' 
                  ? 'bg-primary-600 text-white' 
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              Active
            </button>
            <button
              onClick={() => setStatusFilter('completed')}
              className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                statusFilter === 'completed' 
                  ? 'bg-primary-600 text-white' 
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              Completed
            </button>
            <button
              onClick={() => setStatusFilter('archived')}
              className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                statusFilter === 'archived' 
                  ? 'bg-primary-600 text-white' 
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              Archived
            </button>
          </div>
        </div>
      </div>

      {/* Projects Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="bg-white rounded-xl p-4 animate-pulse shadow-sm border border-gray-100">
              <div className="h-4 bg-gray-200 rounded w-3/4 mb-3"></div>
              <div className="h-3 bg-gray-200 rounded w-1/2 mb-2"></div>
              <div className="h-3 bg-gray-200 rounded w-2/3"></div>
            </div>
          ))}
        </div>
      ) : filteredProjects.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl shadow-sm border border-gray-100">
          <HiOutlineRectangleStack className="w-16 h-16 mx-auto text-gray-300 mb-4" />
          <h3 className="text-lg font-medium text-gray-800 mb-2">
            No projects found
          </h3>
          <p className="text-gray-500 mb-4">
            {search ? 'Try adjusting your search' : 'Create your first project to get started'}
          </p>
          {canCreateProject() && !search && (
            <button
              onClick={() => router.push('/dashboard/projects/create')}
              className="btn-primary"
            >
              Create Project
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredProjects.map((project) => {
            const daysRemaining = getDaysRemaining(project.endDate)
            const isOverdue = daysRemaining < 0 && !['completed', 'approved', 'archived'].includes(project.status)
            
            // Get status-based border color
            const getStatusBorderColor = () => {
              if (isOverdue) return 'border-red-300 bg-red-50/30'
              
              switch(project.status) {
                case 'planning':
                case 'not-started':
                  return 'border-gray-300 bg-gray-50/30'
                case 'in-progress':
                  return 'border-blue-300 bg-blue-50/30'
                case 'on-hold':
                  return 'border-orange-300 bg-orange-50/30'
                case 'completed':
                case 'approved':
                  return 'border-green-300 bg-green-50/30'
                case 'archived':
                  return 'border-gray-400 bg-gray-100/30'
                default:
                  return 'border-gray-100'
              }
            }
            
            return (
              <div
                key={project._id}
                onClick={() => router.push(`/dashboard/projects/${project._id}`)}
                className={`bg-white rounded-xl shadow-sm border-2 hover:shadow-md transition-shadow cursor-pointer overflow-hidden ${getStatusBorderColor()}`}
              >
                {/* Project Header */}
                <div className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <h3 className="text-lg font-semibold text-gray-800 line-clamp-1">
                      {project.name}
                    </h3>
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${priorityColors[project.priority]}`}>
                      {project.priority}
                    </span>
                  </div>
                  
                  <p className="text-gray-500 text-sm line-clamp-2 mb-4">
                    {project.description || 'No description'}
                  </p>

                  {/* Status and Dates */}
                  <div className="flex items-center justify-between mb-4">
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                      isOverdue ? statusColors.overdue : statusColors[project.status]
                    }`}>
                      {isOverdue ? 'Overdue' : statusLabels[project.status]}
                    </span>
                    <div className="flex items-center text-sm text-gray-500">
                      <FaCalendarAlt className="mr-1" />
                      {formatDate(project.endDate)}
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="mb-4">
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="text-gray-500">Progress</span>
                      <span className="font-medium text-gray-700">{project.completionPercentage || 0}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full transition-all ${
                          project.completionPercentage >= 100 ? 'bg-green-500' :
                          project.completionPercentage >= 50 ? 'bg-blue-500' :
                          'bg-orange-500'
                        }`}
                        style={{ width: `${Math.min(project.completionPercentage || 0, 100)}%` }}
                      />
                    </div>
                  </div>

                  {/* Task Stats */}
                  {project.taskStats && (
                    <div className="grid grid-cols-3 gap-2 mb-4">
                      <div className="text-center p-2 bg-gray-50 rounded-lg">
                        <p className="text-lg font-bold text-gray-800">{project.taskStats.total}</p>
                        <p className="text-xs text-gray-500">Tasks</p>
                      </div>
                      <div className="text-center p-2 bg-green-50 rounded-lg">
                        <p className="text-lg font-bold text-green-600">{project.taskStats.completed}</p>
                        <p className="text-xs text-gray-500">Done</p>
                      </div>
                      <div className="text-center p-2 bg-blue-50 rounded-lg">
                        <p className="text-lg font-bold text-blue-600">{project.taskStats.inProgress}</p>
                        <p className="text-xs text-gray-500">In Progress</p>
                      </div>
                    </div>
                  )}

                  {/* Project Head */}
                  <div className="flex items-center justify-between pt-4 border-t border-gray-100">
                    <div className="flex items-center">
                      <div className="w-8 h-8 rounded-full bg-primary-500 flex items-center justify-center text-white text-sm font-medium overflow-hidden">
                        {project.projectHead?.profilePicture ? (
                          <img 
                            src={project.projectHead.profilePicture} 
                            alt={`${project.projectHead.firstName} ${project.projectHead.lastName}`}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <span>
                            {project.projectHead?.firstName?.[0]}{project.projectHead?.lastName?.[0]}
                          </span>
                        )}
                      </div>
                      <div className="ml-2">
                        <p className="text-sm font-medium text-gray-700">
                          {project.projectHead?.firstName} {project.projectHead?.lastName}
                        </p>
                        <p className="text-xs text-gray-500">Project Head</p>
                      </div>
                    </div>
                    {project.userRole && (
                      <span className="text-xs bg-primary-100 text-primary-700 px-2 py-1 rounded-full">
                        {project.userRole}
                      </span>
                    )}
                  </div>
                </div>

                {/* Days Remaining Footer */}
                {!['completed', 'approved', 'archived'].includes(project.status) && (
                  <div className={`px-5 py-3 ${isOverdue ? 'bg-red-50' : 'bg-gray-50'}`}>
                    <p className={`text-sm ${isOverdue ? 'text-red-600' : 'text-gray-600'}`}>
                      {isOverdue 
                        ? `${Math.abs(daysRemaining)} days overdue`
                        : daysRemaining === 0 
                          ? 'Due today'
                          : `${daysRemaining} days remaining`
                      }
                    </p>
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
