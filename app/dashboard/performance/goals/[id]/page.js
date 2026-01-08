'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import toast from '@/utils/toast'
import { 
  FaArrowLeft, FaEdit, FaTrash, FaBullseye, FaCalendar, FaUser, 
  FaCheckCircle, FaClock, FaChartLine, FaFlag, FaTasks, FaSync,
  FaExclamationTriangle, FaBuilding
} from 'react-icons/fa'
import Loader from '@/components/ui/Loader'

export default function GoalDetailsPage() {
  const router = useRouter()
  const params = useParams()
  const [goal, setGoal] = useState(null)
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)
  const [user, setUser] = useState(null)

  useEffect(() => {
    const userData = localStorage.getItem('user')
    if (userData) {
      setUser(JSON.parse(userData))
    }
    fetchGoal()
  }, [params.id])

  const fetchGoal = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/performance/goals?goalId=' + params.id, {
        headers: { 'Authorization': 'Bearer ' + token }
      })

      const data = await response.json()
      
      if (data.success && data.data) {
        setGoal(data.data)
      } else {
        toast.error(data.message || 'Goal not found')
      }
    } catch (error) {
      console.error('Fetch goal error:', error)
      toast.error('Failed to fetch goal details')
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this goal?')) return

    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/performance/goals?goalId=' + params.id, {
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer ' + token }
      })

      const data = await response.json()
      if (data.success) {
        toast.success('Goal deleted successfully')
        router.push('/dashboard/performance/goals')
      } else {
        toast.error(data.message || 'Failed to delete goal')
      }
    } catch (error) {
      console.error('Delete goal error:', error)
      toast.error('Failed to delete goal')
    }
  }

  const handleProgressUpdate = async (newProgress) => {
    setUpdating(true)
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/performance/goals', {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token 
        },
        body: JSON.stringify({ goalId: params.id, progress: newProgress })
      })

      const data = await response.json()
      if (data.success) {
        setGoal(prev => ({ ...prev, progress: newProgress }))
        toast.success('Progress updated')
      } else {
        toast.error(data.message || 'Failed to update progress')
      }
    } catch (error) {
      console.error('Update progress error:', error)
      toast.error('Failed to update progress')
    } finally {
      setUpdating(false)
    }
  }

  const handleMilestoneToggle = async (milestoneIndex, completed) => {
    setUpdating(true)
    try {
      const token = localStorage.getItem('token')
      
      const updatedMilestones = goal.milestones.map((m, i) => {
        if (i === milestoneIndex) {
          return { 
            ...m, 
            completed, 
            completedDate: completed ? new Date().toISOString() : null 
          }
        }
        return m
      })

      const response = await fetch('/api/performance/goals', {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token 
        },
        body: JSON.stringify({ goalId: params.id, milestones: updatedMilestones })
      })

      const data = await response.json()
      if (data.success) {
        setGoal(data.data)
        toast.success(completed ? 'Milestone completed!' : 'Milestone uncompleted')
      } else {
        toast.error(data.message || 'Failed to update milestone')
      }
    } catch (error) {
      console.error('Update milestone error:', error)
      toast.error('Failed to update milestone')
    } finally {
      setUpdating(false)
    }
  }

  const canManageGoals = () => {
    return user && ['admin', 'hr', 'manager', 'department_head'].includes(user.role)
  }

  const canUpdateProgress = () => {
    return user && (user.role === 'employee' || canManageGoals())
  }

  const getStatusConfig = (status) => {
    const configs = {
      'completed': { bg: 'bg-emerald-100', text: 'text-emerald-700', icon: FaCheckCircle },
      'in-progress': { bg: 'bg-blue-100', text: 'text-blue-700', icon: FaChartLine },
      'not-started': { bg: 'bg-gray-100', text: 'text-gray-700', icon: FaClock },
      'on-hold': { bg: 'bg-amber-100', text: 'text-amber-700', icon: FaExclamationTriangle },
      'cancelled': { bg: 'bg-red-100', text: 'text-red-700', icon: FaExclamationTriangle }
    }
    return configs[status] || configs['not-started']
  }

  const getPriorityConfig = (priority) => {
    const configs = {
      'critical': { bg: 'bg-red-100', text: 'text-red-700' },
      'high': { bg: 'bg-orange-100', text: 'text-orange-700' },
      'medium': { bg: 'bg-yellow-100', text: 'text-yellow-700' },
      'low': { bg: 'bg-green-100', text: 'text-green-700' }
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

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <Loader size="lg" />
          <p className="mt-4 text-gray-600">Loading goal details...</p>
        </div>
      </div>
    )
  }

  if (!goal) {
    return (
      <div className="p-6">
        <div className="text-center py-12">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-100 flex items-center justify-center">
            <FaBullseye className="w-8 h-8 text-gray-400" />
          </div>
          <h1 className="text-2xl font-bold text-gray-800 mb-4">Goal Not Found</h1>
          <p className="text-gray-600 mb-6">The goal you're looking for doesn't exist or has been deleted.</p>
          <button
            onClick={() => router.push('/dashboard/performance/goals')}
            className="px-6 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors"
          >
            Back to Goals
          </button>
        </div>
      </div>
    )
  }

  const statusConfig = getStatusConfig(goal.status)
  const priorityConfig = getPriorityConfig(goal.priority)
  const daysLeft = getDaysRemaining(goal.dueDate)
  const overdue = isOverdue(goal.dueDate, goal.status)
  const StatusIcon = statusConfig.icon
  const completedMilestones = (goal.milestones || []).filter(m => m.completed).length
  const totalMilestones = (goal.milestones || []).length

  return (
    <div className="p-4 sm:p-6 pb-24 md:pb-6 bg-gray-50 min-h-screen">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 gap-4">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.back()}
            className="p-2 text-gray-600 hover:text-gray-800 hover:bg-white rounded-lg transition-colors shadow-sm"
          >
            <FaArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Goal Details</h1>
            <p className="text-gray-600 mt-1 truncate max-w-md">{goal.title}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchGoal}
            className="p-2 text-gray-600 hover:text-primary-600 hover:bg-white rounded-lg transition-colors"
            title="Refresh"
          >
            <FaSync className={'w-4 h-4 ' + (loading ? 'animate-spin' : '')} />
          </button>
          {canManageGoals() && (
            <>
              <button
                onClick={() => router.push('/dashboard/performance/goals/edit/' + goal._id)}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors flex items-center gap-2"
              >
                <FaEdit className="w-4 h-4" />
                <span className="hidden sm:inline">Edit</span>
              </button>
              <button
                onClick={handleDelete}
                className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors flex items-center gap-2"
              >
                <FaTrash className="w-4 h-4" />
                <span className="hidden sm:inline">Delete</span>
              </button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Goal Overview Card */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-6">
              <div className="flex items-start gap-4 mb-6">
                <div className="w-14 h-14 bg-gradient-to-br from-primary-500 to-primary-600 rounded-xl flex items-center justify-center text-white font-bold text-xl flex-shrink-0 shadow-lg">
                  {(goal.employee?.firstName?.charAt(0) || 'U')}{(goal.employee?.lastName?.charAt(0) || '')}
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-xl font-bold text-gray-900 mb-1">{goal.title}</h2>
                  <p className="text-gray-600">
                    {goal.employee?.firstName} {goal.employee?.lastName}
                    {goal.employee?.employeeCode && <span className="text-gray-400 ml-2">({goal.employee.employeeCode})</span>}
                  </p>
                  {goal.employee?.position && (
                    <p className="text-sm text-gray-500">{goal.employee.position}</p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className={'inline-flex items-center gap-1.5 px-3 py-1 text-sm font-medium rounded-full ' + statusConfig.bg + ' ' + statusConfig.text}>
                    <StatusIcon className="w-3.5 h-3.5" />
                    {goal.status.replace('-', ' ')}
                  </span>
                  <span className={'px-3 py-1 text-sm font-medium rounded-full ' + priorityConfig.bg + ' ' + priorityConfig.text}>
                    {(goal.priority || 'medium').charAt(0).toUpperCase() + (goal.priority || 'medium').slice(1)} Priority
                  </span>
                </div>
              </div>

              {/* Progress Section */}
              <div className="bg-gray-50 rounded-xl p-4 mb-6">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-semibold text-gray-700">Overall Progress</span>
                  <span className={'text-lg font-bold ' + (goal.progress >= 80 ? 'text-emerald-600' : goal.progress >= 50 ? 'text-blue-600' : 'text-gray-600')}>
                    {goal.progress || 0}%
                  </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-3 mb-3">
                  <div 
                    className={'h-3 rounded-full transition-all duration-500 ' + 
                      (goal.progress >= 80 ? 'bg-emerald-500' : goal.progress >= 50 ? 'bg-blue-500' : goal.progress >= 25 ? 'bg-yellow-500' : 'bg-gray-400')}
                    style={{ width: (goal.progress || 0) + '%' }}
                  ></div>
                </div>
                
                {canUpdateProgress() && (
                  <div className="pt-2 border-t border-gray-200">
                    <label className="block text-xs font-medium text-gray-500 mb-2">Update Progress</label>
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={goal.progress || 0}
                        onChange={(e) => handleProgressUpdate(parseInt(e.target.value))}
                        disabled={updating}
                        className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                      />
                      <span className="text-sm font-medium text-gray-600 w-12 text-right">{goal.progress || 0}%</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Description */}
              {goal.description && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">Description</h3>
                  <p className="text-gray-600 leading-relaxed">{goal.description}</p>
                </div>
              )}
            </div>
          </div>

          {/* Milestones Card */}
          {goal.milestones && goal.milestones.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="p-4 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FaTasks className="w-4 h-4 text-gray-500" />
                  <h3 className="text-lg font-semibold text-gray-900">Milestones</h3>
                </div>
                <span className="text-sm text-gray-500">
                  {completedMilestones} of {totalMilestones} completed
                </span>
              </div>
              <div className="divide-y divide-gray-100">
                {goal.milestones.map((milestone, index) => (
                  <div key={index} className="p-4 hover:bg-gray-50 transition-colors">
                    <div className="flex items-start gap-3">
                      <button
                        onClick={() => handleMilestoneToggle(index, !milestone.completed)}
                        disabled={updating}
                        className={'w-6 h-6 rounded-full flex items-center justify-center transition-colors flex-shrink-0 mt-0.5 ' +
                          (milestone.completed 
                            ? 'bg-emerald-500 text-white hover:bg-emerald-600' 
                            : 'border-2 border-gray-300 hover:border-primary-500')}
                      >
                        {milestone.completed && <FaCheckCircle className="w-4 h-4" />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <h4 className={'font-medium ' + (milestone.completed ? 'text-gray-500 line-through' : 'text-gray-900')}>
                          {milestone.title}
                        </h4>
                        {milestone.description && (
                          <p className="text-sm text-gray-500 mt-1">{milestone.description}</p>
                        )}
                        <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
                          {milestone.dueDate && (
                            <span className="flex items-center gap-1">
                              <FaCalendar className="w-3 h-3" />
                              Due: {new Date(milestone.dueDate).toLocaleDateString()}
                            </span>
                          )}
                          {milestone.completed && milestone.completedDate && (
                            <span className="flex items-center gap-1 text-emerald-600">
                              <FaCheckCircle className="w-3 h-3" />
                              Completed: {new Date(milestone.completedDate).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Key Results (OKR style) */}
          {goal.keyResults && goal.keyResults.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="p-4 border-b border-gray-100">
                <h3 className="text-lg font-semibold text-gray-900">Key Results</h3>
              </div>
              <div className="divide-y divide-gray-100">
                {goal.keyResults.map((kr, index) => (
                  <div key={index} className="p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-gray-900">{kr.title}</span>
                      <span className="text-sm text-gray-500">{kr.current} / {kr.target} {kr.unit}</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div 
                        className="h-2 rounded-full bg-blue-500"
                        style={{ width: Math.min(100, (kr.current / kr.target) * 100) + '%' }}
                      ></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Updates/History */}
          {goal.updates && goal.updates.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="p-4 border-b border-gray-100">
                <h3 className="text-lg font-semibold text-gray-900">Updates History</h3>
              </div>
              <div className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
                {goal.updates.map((update, index) => (
                  <div key={index} className="p-4">
                    <p className="text-gray-700">{update.note}</p>
                    <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
                      <span>{new Date(update.date).toLocaleDateString()}</span>
                      {update.updatedBy && (
                        <span>by {update.updatedBy.firstName} {update.updatedBy.lastName}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Quick Stats Card */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900">Quick Stats</h3>
            </div>
            <div className="p-4 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Progress</span>
                <span className="font-bold text-primary-600">{goal.progress || 0}%</span>
              </div>
              {totalMilestones > 0 && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Milestones</span>
                    <span className="font-medium">{totalMilestones}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Completed</span>
                    <span className="font-medium text-emerald-600">{completedMilestones}</span>
                  </div>
                </>
              )}
              {goal.weightage && (
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">Weightage</span>
                  <span className="font-medium">{goal.weightage}%</span>
                </div>
              )}
            </div>
          </div>

          {/* Timeline Card */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900">Timeline</h3>
            </div>
            <div className="p-4 space-y-4">
              <div className="flex items-start gap-3">
                <FaCalendar className="w-4 h-4 text-gray-400 mt-0.5" />
                <div>
                  <p className="text-xs text-gray-500">Start Date</p>
                  <p className="font-medium text-gray-900">{new Date(goal.startDate).toLocaleDateString()}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <FaCalendar className={'w-4 h-4 mt-0.5 ' + (overdue ? 'text-red-500' : 'text-gray-400')} />
                <div>
                  <p className="text-xs text-gray-500">Due Date</p>
                  <p className={'font-medium ' + (overdue ? 'text-red-600' : 'text-gray-900')}>
                    {new Date(goal.dueDate).toLocaleDateString()}
                  </p>
                  {overdue ? (
                    <p className="text-xs text-red-500 mt-1">Overdue by {Math.abs(daysLeft)} days</p>
                  ) : daysLeft <= 7 && daysLeft >= 0 ? (
                    <p className="text-xs text-amber-500 mt-1">{daysLeft === 0 ? 'Due today!' : daysLeft + ' days remaining'}</p>
                  ) : null}
                </div>
              </div>
              {goal.completedAt && (
                <div className="flex items-start gap-3">
                  <FaCheckCircle className="w-4 h-4 text-emerald-500 mt-0.5" />
                  <div>
                    <p className="text-xs text-gray-500">Completed</p>
                    <p className="font-medium text-emerald-600">{new Date(goal.completedAt).toLocaleDateString()}</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Details Card */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900">Details</h3>
            </div>
            <div className="p-4 space-y-4">
              {goal.category && (
                <div className="flex items-start gap-3">
                  <FaFlag className="w-4 h-4 text-gray-400 mt-0.5" />
                  <div>
                    <p className="text-xs text-gray-500">Category</p>
                    <p className="font-medium text-gray-900">{goal.category}</p>
                  </div>
                </div>
              )}
              {goal.department && (
                <div className="flex items-start gap-3">
                  <FaBuilding className="w-4 h-4 text-gray-400 mt-0.5" />
                  <div>
                    <p className="text-xs text-gray-500">Department</p>
                    <p className="font-medium text-gray-900">{goal.department.name || goal.department}</p>
                  </div>
                </div>
              )}
              {goal.createdBy && (
                <div className="flex items-start gap-3">
                  <FaUser className="w-4 h-4 text-gray-400 mt-0.5" />
                  <div>
                    <p className="text-xs text-gray-500">Created By</p>
                    <p className="font-medium text-gray-900">
                      {goal.createdBy.firstName} {goal.createdBy.lastName}
                    </p>
                  </div>
                </div>
              )}
              {goal.alignedTo && (
                <div className="flex items-start gap-3">
                  <FaBullseye className="w-4 h-4 text-gray-400 mt-0.5" />
                  <div>
                    <p className="text-xs text-gray-500">Aligned To</p>
                    <p className="font-medium text-gray-900 capitalize">{goal.alignedTo} Goals</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Tags */}
          {goal.tags && goal.tags.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="p-4 border-b border-gray-100">
                <h3 className="font-semibold text-gray-900">Tags</h3>
              </div>
              <div className="p-4">
                <div className="flex flex-wrap gap-2">
                  {goal.tags.map((tag, index) => (
                    <span key={index} className="px-2 py-1 bg-gray-100 text-gray-600 rounded-full text-xs">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
