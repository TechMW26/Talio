'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import toast from '@/utils/toast'
import { Card, CardBody, Button, Chip, Skeleton, Progress } from '@heroui/react'
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
  FaEye, FaUsers, FaTasks, FaChartLine, FaClipboardCheck, FaTimes, FaCheck
} from 'react-icons/fa'
import { playNotificationSound, NotificationSoundTypes } from '@/lib/notificationSounds'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import useApiMutation from '@/hooks/useApiMutation'
import LoadingButton from '@/components/ui/LoadingButton'
import { DataErrorState } from '@/components/ui/ErrorBoundary'
import BackgroundRefreshIndicator from '@/components/ui/BackgroundRefreshIndicator'

const statusColors = {
  planned: 'primary',
  ongoing: 'success',
  completed: 'success',
  'completed_pending_approval': 'warning',
  approved: 'success',
  rejected: 'danger',
  pending: 'warning',
  overdue: 'danger',
  archived: 'default'
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
  low: 'default',
  medium: 'primary',
  high: 'warning',
  critical: 'danger'
}

export default function ProjectsPage() {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('active')
  const [respondingTo, setRespondingTo] = useState(null)

  // User from localStorage
  const user = useMemo(() => {
    if (typeof window === 'undefined') return null
    try { return JSON.parse(localStorage.getItem('user')) } catch { return null }
  }, [])

  // --- SWR Data Fetching (replaces manual fetch + setInterval) ---
  const swrKey = `/api/projects?status=${statusFilter}`
  const { data: projectsRes, error, isLoading, isValidating, mutate: refreshProjects } = useAuthedSWR(swrKey, {
    refreshInterval: 30000, // Refresh every 30s instead of 10s (reduces load)
    revalidateOnFocus: true,
  })
  const projects = projectsRes?.data || []

  // Calculate stats from fetched data
  const stats = useMemo(() => ({
    total: projects.length,
    active: projects.filter(p => ['planned', 'ongoing', 'pending'].includes(p.status)).length,
    completed: projects.filter(p => ['completed', 'approved'].includes(p.status)).length,
    overdue: projects.filter(p => p.status === 'overdue' || (new Date(p.endDate) < new Date() && !['completed', 'approved', 'archived'].includes(p.status))).length,
  }), [projects])

  // --- Invitation mutation ---
  const invitationMutation = useApiMutation({
    method: 'POST',
    invalidateKeys: [swrKey],
    onSuccess: (data) => {
      const action = respondingTo?.action
      toast.success(action === 'accept' ? 'Project invitation accepted!' : 'Project invitation declined')
      playNotificationSound(NotificationSoundTypes.SUCCESS)
      setRespondingTo(null)
    },
    onError: (msg) => {
      toast.error(msg || 'Failed to respond to invitation')
      setRespondingTo(null)
    },
  })

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

  // Handle accept/reject project invitation (via mutation hook)
  const handleRespondToInvitation = (projectId, action) => {
    setRespondingTo({ projectId, action })
    invitationMutation.execute(`/api/projects/${projectId}/respond`, { action })
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
          <h1 className="text-2xl font-bold text-default-800 flex items-center gap-2">
            <HiOutlineRectangleStack className="w-7 h-7 text-primary" />
            Projects
          </h1>
          <p className="text-default-500 mt-1 flex items-center gap-2">
            Manage and track your projects
            <BackgroundRefreshIndicator isValidating={isValidating && !isLoading} position="inline" />
          </p>
        </div>
        {canCreateProject() && (
          <Button
            color="primary"
            onPress={() => router.push('/dashboard/projects/create')}
            startContent={<HiOutlinePlus className="w-5 h-5" />}
          >
            Create Project
          </Button>
        )}
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card shadow="sm">
          <CardBody className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary-100 rounded-lg">
                <HiOutlineRectangleStack className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold text-default-800">{stats.total}</p>
                <p className="text-sm text-default-500">Total</p>
              </div>
            </div>
          </CardBody>
        </Card>

        <Card shadow="sm">
          <CardBody className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-success-100 rounded-lg">
                <HiOutlineClock className="w-5 h-5 text-success" />
              </div>
              <div>
                <p className="text-2xl font-bold text-default-800">{stats.active}</p>
                <p className="text-sm text-default-500">Active</p>
              </div>
            </div>
          </CardBody>
        </Card>

        <Card shadow="sm">
          <CardBody className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-success-100 rounded-lg">
                <HiOutlineCheckCircle className="w-5 h-5 text-success" />
              </div>
              <div>
                <p className="text-2xl font-bold text-default-800">{stats.completed}</p>
                <p className="text-sm text-default-500">Completed</p>
              </div>
            </div>
          </CardBody>
        </Card>

        <Card shadow="sm">
          <CardBody className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-danger-100 rounded-lg">
                <HiOutlineExclamationTriangle className="w-5 h-5 text-danger" />
              </div>
              <div>
                <p className="text-2xl font-bold text-default-800">{stats.overdue}</p>
                <p className="text-sm text-default-500">Overdue</p>
              </div>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Filters and Search */}
      <Card shadow="sm" className="mb-6">
        <CardBody>
          <div className="flex flex-col md:flex-row gap-4">
            {/* Search */}
            <div className="relative flex-1">
              <HiOutlineMagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-default-400" />
              <input
                type="text"
                placeholder="Search projects..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 border border-default-300 rounded-lg bg-content1 text-default-800 focus:ring-2 focus:ring-primary focus:border-transparent"
              />
            </div>

            {/* Filters */}
            <div className="flex gap-2 flex-wrap">
              <Button
                variant={statusFilter === 'active' ? 'solid' : 'flat'}
                color={statusFilter === 'active' ? 'primary' : 'default'}
                onPress={() => setStatusFilter('active')}
              >
                Active
              </Button>
              <Button
                variant={statusFilter === 'completed' ? 'solid' : 'flat'}
                color={statusFilter === 'completed' ? 'primary' : 'default'}
                onPress={() => setStatusFilter('completed')}
              >
                Completed
              </Button>
              <Button
                variant={statusFilter === 'archived' ? 'solid' : 'flat'}
                color={statusFilter === 'archived' ? 'primary' : 'default'}
                onPress={() => setStatusFilter('archived')}
              >
                Archived
              </Button>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Projects Grid */}
      {error ? (
        <DataErrorState message="Failed to load projects" onRetry={() => refreshProjects()} />
      ) : isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <Card key={i} shadow="sm">
              <CardBody className="p-4 space-y-3">
                <Skeleton className="h-4 w-3/4 rounded-lg" />
                <Skeleton className="h-3 w-1/2 rounded-lg" />
                <Skeleton className="h-3 w-2/3 rounded-lg" />
                <Skeleton className="h-2 w-full rounded-lg mt-4" />
              </CardBody>
            </Card>
          ))}
        </div>
      ) : filteredProjects.length === 0 ? (
        <Card shadow="sm" className="text-center py-12">
          <CardBody className="flex flex-col items-center">
            <HiOutlineRectangleStack className="w-16 h-16 text-default-300 mb-4" />
            <h3 className="text-lg font-medium text-default-800 mb-2">
              No projects found
            </h3>
            <p className="text-default-500 mb-4">
              {search ? 'Try adjusting your search' : 'Create your first project to get started'}
            </p>
            {canCreateProject() && !search && (
              <Button
                color="primary"
                onPress={() => router.push('/dashboard/projects/create')}
                startContent={<HiOutlinePlus className="w-4 h-4" />}
              >
                Create Project
              </Button>
            )}
          </CardBody>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredProjects.map((project) => {
            const daysRemaining = getDaysRemaining(project.endDate)
            const isOverdue = daysRemaining < 0 && !['completed', 'approved', 'archived'].includes(project.status)
            const isPendingInvitation = project.userInvitationStatus === 'invited'

            // Get status-based border color
            const getStatusBorderColor = () => {
              // Pending invitation takes priority
              if (isPendingInvitation) return 'border-warning bg-warning-50/30'
              if (isOverdue) return 'border-danger-300 bg-danger-50/30'

              switch (project.status) {
                case 'planning':
                case 'not-started':
                  return 'border-default-300 bg-default-50/30'
                case 'in-progress':
                  return 'border-primary-300 bg-primary-50/30'
                case 'on-hold':
                  return 'border-warning-300 bg-warning-50/30'
                case 'completed':
                case 'approved':
                  return 'border-success-300 bg-success-50/30'
                case 'archived':
                  return 'border-default-400 bg-default-100/30'
                default:
                  return 'border-default-100'
              }
            }

            return (
              <div
                key={project._id}
                onClick={() => router.push(`/dashboard/projects/${project._id}`)}
                className={`bg-content1 rounded-xl shadow-sm border-2 hover:shadow-md transition-shadow cursor-pointer overflow-hidden flex flex-col ${getStatusBorderColor()}`}
              >
                {/* Project Header */}
                <div className="p-5 flex-1">
                  <div className="flex items-start justify-between mb-3">
                    <h3 className="text-lg font-semibold text-default-800 line-clamp-1">
                      {project.name}
                    </h3>
                    <Chip color={priorityColors[project.priority]} variant="flat" size="sm">
                      {project.priority}
                    </Chip>
                  </div>

                  <p className="text-default-500 text-sm line-clamp-2 mb-4">
                    {project.description || 'No description'}
                  </p>

                  {/* Status and Dates */}
                  <div className="flex items-center justify-between mb-4">
                    <Chip color={isOverdue ? 'danger' : statusColors[project.status]} variant="flat" size="sm">
                      {isOverdue ? 'Overdue' : statusLabels[project.status]}
                    </Chip>
                    <div className="flex items-center text-sm text-default-500">
                      <FaCalendarAlt className="mr-1" />
                      {formatDate(project.endDate)}
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="mb-4">
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="text-default-500">Progress</span>
                      <span className="font-medium text-default-700">{project.completionPercentage || 0}%</span>
                    </div>
                    <Progress
                      value={Math.min(project.completionPercentage || 0, 100)}
                      color={project.completionPercentage >= 100 ? 'success' : project.completionPercentage >= 50 ? 'primary' : 'warning'}
                      size="sm"
                      className="max-w-full"
                    />
                  </div>

                  {/* Task Stats */}
                  {project.taskStats && (
                    <div className="grid grid-cols-3 gap-2 mb-4">
                      <div className="text-center p-2 bg-default-50 rounded-lg">
                        <p className="text-lg font-bold text-default-800">{project.taskStats.total}</p>
                        <p className="text-xs text-default-500">Tasks</p>
                      </div>
                      <div className="text-center p-2 bg-success-50 rounded-lg">
                        <p className="text-lg font-bold text-success">{project.taskStats.completed}</p>
                        <p className="text-xs text-default-500">Done</p>
                      </div>
                      <div className="text-center p-2 bg-primary-50 rounded-lg">
                        <p className="text-lg font-bold text-primary">{project.taskStats.inProgress}</p>
                        <p className="text-xs text-default-500">In Progress</p>
                      </div>
                    </div>
                  )}

                  {/* Project Heads */}
                  <div className="flex items-center justify-between pt-4 border-t border-default-100">
                    <div className="flex items-center">
                      {/* Show stacked avatars for multiple heads */}
                      <div className="flex -space-x-2">
                        {(project.projectHeads?.length ? project.projectHeads : (project.projectHead ? [project.projectHead] : [])).slice(0, 3).map((head, idx) => (
                          <div
                            key={head?._id || idx}
                            className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-white text-sm font-medium overflow-hidden border-2 border-content1"
                            title={`${head?.firstName} ${head?.lastName}`}
                          >
                            {head?.profilePicture ? (
                              <img
                                src={head.profilePicture}
                                alt={`${head.firstName} ${head.lastName}`}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <span>
                                {head?.firstName?.[0]}{head?.lastName?.[0]}
                              </span>
                            )}
                          </div>
                        ))}
                        {project.projectHeads?.length > 3 && (
                          <div className="w-8 h-8 rounded-full bg-default-300 flex items-center justify-center text-default-600 text-xs font-medium border-2 border-content1">
                            +{project.projectHeads.length - 3}
                          </div>
                        )}
                      </div>
                      <div className="ml-2">
                        <p className="text-sm font-medium text-default-700">
                          {project.projectHeads?.length > 1
                            ? `${project.projectHeads[0]?.firstName} +${project.projectHeads.length - 1} more`
                            : `${project.projectHead?.firstName || project.projectHeads?.[0]?.firstName} ${project.projectHead?.lastName || project.projectHeads?.[0]?.lastName}`
                          }
                        </p>
                        <p className="text-xs text-default-500">
                          {project.projectHeads?.length > 1 ? 'Project Heads' : 'Project Head'}
                        </p>
                      </div>
                    </div>
                    {project.userRole && (
                      <Chip color="primary" variant="flat" size="sm">
                        {project.userRole}
                      </Chip>
                    )}
                  </div>
                </div>

                {/* Days Remaining Footer */}
                {!['completed', 'approved', 'archived'].includes(project.status) && project.userInvitationStatus !== 'invited' && (
                  <div className={`px-5 py-3 ${isOverdue ? 'bg-danger-50' : 'bg-default-50'}`}>
                    <p className={`text-sm ${isOverdue ? 'text-danger' : 'text-default-600'}`}>
                      {isOverdue
                        ? `${Math.abs(daysRemaining)} days overdue`
                        : daysRemaining === 0
                          ? 'Due today'
                          : `${daysRemaining} days remaining`
                      }
                    </p>
                  </div>
                )}

                {/* Pending Invitation Banner */}
                {project.userInvitationStatus === 'invited' && (
                  <div className="px-5 py-3 bg-warning-50 border-t border-warning-200" onClick={(e) => e.stopPropagation()}>
                    <p className="text-sm text-warning-700 font-medium mb-2">You've been invited to this project</p>
                    <div className="flex gap-2">
                      <Button
                        color="success"
                        size="sm"
                        className="flex-1"
                        onPress={() => handleRespondToInvitation(project._id, 'accept')}
                        isDisabled={respondingTo?.projectId === project._id}
                        isLoading={respondingTo?.projectId === project._id && respondingTo?.action === 'accept'}
                        startContent={!respondingTo && <FaCheck className="w-3 h-3" />}
                      >
                        {respondingTo?.projectId === project._id && respondingTo?.action === 'accept' ? 'Accepting...' : 'Accept'}
                      </Button>
                      <Button
                        color="danger"
                        size="sm"
                        className="flex-1"
                        onPress={() => handleRespondToInvitation(project._id, 'reject')}
                        isDisabled={respondingTo?.projectId === project._id}
                        isLoading={respondingTo?.projectId === project._id && respondingTo?.action === 'reject'}
                        startContent={!respondingTo && <FaTimes className="w-3 h-3" />}
                      >
                        {respondingTo?.projectId === project._id && respondingTo?.action === 'reject' ? 'Declining...' : 'Decline'}
                      </Button>
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
