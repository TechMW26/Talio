'use client'

import { useState, useMemo, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import toast from '@/utils/toast'
import { Select, SelectItem, Button, Skeleton, Card, CardBody, Chip } from '@heroui/react'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import useApiMutation from '@/hooks/useApiMutation'
import LoadingButton from '@/components/ui/LoadingButton'
import Loader from '@/components/ui/Loader'
import { DataErrorState } from '@/components/ui/ErrorBoundary'
import BackgroundRefreshIndicator from '@/components/ui/BackgroundRefreshIndicator'
import {
  FaArrowLeft, FaUser, FaEnvelope, FaPhone, FaCalendarAlt,
  FaBriefcase, FaStar, FaTasks, FaChartLine, FaComments,
  FaPaperPlane, FaExclamationCircle, FaCheckCircle, FaClock,
  FaChevronLeft, FaChevronRight, FaFilter, FaProjectDiagram
} from 'react-icons/fa'
import { formatDesignation } from '@/lib/formatters'

export default function TeamMemberDetailsPage() {
  const router = useRouter()
  const params = useParams()
  const [showReviewForm, setShowReviewForm] = useState(false)
  const [reviewForm, setReviewForm] = useState({
    type: 'review',
    content: '',
    rating: 0,
    category: 'general'
  })

  // Task filter state
  const now = new Date()
  const [taskMonth, setTaskMonth] = useState(now.getMonth())
  const [taskYear, setTaskYear] = useState(now.getFullYear())
  const [taskStatus, setTaskStatus] = useState('all')
  const [taskProject, setTaskProject] = useState('all')
  const [taskAssignedBy, setTaskAssignedBy] = useState('all')

  const taskQueryString = useMemo(() => {
    const p = new URLSearchParams()
    p.append('month', taskMonth)
    p.append('year', taskYear)
    if (taskStatus !== 'all') p.append('status', taskStatus)
    if (taskProject !== 'all') p.append('projectId', taskProject)
    if (taskAssignedBy !== 'all') p.append('assignedById', taskAssignedBy)
    return p.toString()
  }, [taskMonth, taskYear, taskStatus, taskProject, taskAssignedBy])

  const { data: tasksRes, isLoading: tasksLoading } = useAuthedSWR(
    params.id ? `/api/team/members/${params.id}/tasks?${taskQueryString}` : null
  )
  const memberTasks = tasksRes?.data?.tasks || []
  const monthStats = tasksRes?.data?.stats || {}
  const filterOptions = tasksRes?.data?.filterOptions || { projects: [], assigners: [] }

  const monthLabel = new Date(taskYear, taskMonth).toLocaleString('default', { month: 'long', year: 'numeric' })

  const goToPrevMonth = () => {
    if (taskMonth === 0) { setTaskMonth(11); setTaskYear(y => y - 1) }
    else setTaskMonth(m => m - 1)
  }
  const goToNextMonth = () => {
    const isCurrentMonth = taskMonth === now.getMonth() && taskYear === now.getFullYear()
    if (isCurrentMonth) return
    if (taskMonth === 11) { setTaskMonth(0); setTaskYear(y => y + 1) }
    else setTaskMonth(m => m + 1)
  }
  const isCurrentMonth = taskMonth === now.getMonth() && taskYear === now.getFullYear()

  const { data: res, error, isLoading, isValidating, mutate: refresh } = useAuthedSWR(params.id ? `/api/team/members/${params.id}` : null)
  const memberData = res?.data || null

  const reviewMutation = useApiMutation({
    method: 'POST',
    invalidateKeys: [`/api/team/members/${params.id}`],
    onSuccess: (data) => {
      toast.success(data?.message || 'Review added')
      setShowReviewForm(false)
      setReviewForm({
        type: 'review',
        content: '',
        rating: 0,
        category: 'general'
      })
    },
    onError: (msg) => toast.error(msg || 'Failed to add review'),
  })

  const handleSubmitReview = async () => {
    if (!reviewForm.content.trim()) {
      toast.error('Please enter review content')
      return
    }

    if (reviewForm.type === 'review' && reviewForm.rating === 0) {
      toast.error('Please select a rating')
      return
    }

    await reviewMutation.execute(`/api/team/members/${params.id}`, reviewForm)
  }

  const getStatusColor = (status) => {
    const colors = {
      'todo': 'bg-gray-100 text-gray-800',
      'in-progress': 'bg-yellow-100 text-yellow-800',
      'review': 'bg-purple-100 text-purple-800',
      'completed': 'bg-green-100 text-green-800',
      'completed-pending-approval': 'bg-purple-100 text-purple-800',
      'rejected': 'bg-red-100 text-red-800',
      'blocked': 'bg-orange-100 text-orange-800',
      'archived': 'bg-gray-100 text-gray-600'
    }
    return colors[status] || 'bg-gray-100 text-gray-800'
  }

  const getReviewTypeColor = (type) => {
    const colors = {
      review: 'bg-blue-100 text-blue-800',
      remark: 'bg-purple-100 text-purple-800',
      feedback: 'bg-green-100 text-green-800',
      warning: 'bg-red-100 text-red-800',
      appreciation: 'bg-yellow-100 text-yellow-800'
    }
    return colors[type] || 'bg-gray-100 text-gray-800'
  }

  if (isLoading) {
    return (
      <div className="px-4 py-4 sm:p-6 lg:p-8 pb-14 md:pb-6">
        <div className="space-y-6">
          <div className="flex items-center">
            <Skeleton className="w-20 h-20 rounded-full mr-4" />
            <div className="space-y-2">
              <Skeleton className="h-8 w-48 rounded-lg" />
              <Skeleton className="h-5 w-32 rounded-lg" />
            </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              <Skeleton className="h-48 rounded-xl" />
              <Skeleton className="h-32 rounded-xl" />
              <Skeleton className="h-64 rounded-xl" />
            </div>
            <div className="space-y-6">
              <Skeleton className="h-12 rounded-xl" />
              <Skeleton className="h-64 rounded-xl" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="px-4 py-4 sm:p-6 lg:p-8 pb-14 md:pb-6">
        <DataErrorState message="Failed to load member details" onRetry={() => refresh()} />
      </div>
    )
  }

  if (!memberData) {
    return (
      <div className="px-4 py-4 sm:p-6 lg:p-8 pb-14 md:pb-6">
        <div className="bg-white rounded-lg shadow-md p-8 text-center">
          <FaExclamationCircle className="text-red-500 text-4xl mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-700 mb-2">Member Not Found</h3>
          <button
            onClick={() => router.back()}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Go Back
          </button>
        </div>
      </div>
    )
  }

  const { employee, taskStats = { total: 0, in_progress: 0, review: 0, completed: 0 } } = memberData || {}

  // Safety check for employee
  if (!employee) {
    return (
      <div className="p-6">
        <button
          onClick={() => router.back()}
          className="flex items-center text-blue-600 hover:text-blue-700 mb-4"
        >
          <FaArrowLeft className="mr-2" />
          Go Back
        </button>
        <p className="text-gray-600">Employee data not available</p>
      </div>
    )
  }

  return (
    <div className="px-4 py-4 sm:p-6 lg:p-8 pb-24 md:pb-6">
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={() => router.back()}
          className="flex items-center text-blue-600 hover:text-blue-700 mb-4"
        >
          <FaArrowLeft className="mr-2" />
          Back to Team Members
        </button>
        <div className="flex items-center">
          <div className="w-20 h-20 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-2xl mr-4">
            {employee.profilePicture ? (
              <img
                src={employee.profilePicture}
                alt={`${employee.firstName} ${employee.lastName}`}
                className="w-20 h-20 rounded-full object-cover"
              />
            ) : (
              `${employee.firstName.charAt(0)}${employee.lastName.charAt(0)}`
            )}
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">
              {employee.firstName} {employee.lastName}
            </h1>
            <p className="text-gray-600">{employee.employeeCode}</p>
          </div>
        </div>
      </div>
      <BackgroundRefreshIndicator isValidating={isValidating && !isLoading} position="inline" />

      {/* Employee Details */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Basic Info */}
          <div className="bg-white rounded-lg shadow-md p-4 sm:p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Basic Information</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex items-center text-gray-600">
                <FaBriefcase className="mr-3 text-gray-400" />
                <div>
                  <p className="text-xs text-gray-500">Designation</p>
                  <p className="font-medium">
                    {formatDesignation(employee.designation, employee)}
                  </p>
                </div>
              </div>
              <div className="flex items-center text-gray-600">
                <FaEnvelope className="mr-3 text-gray-400" />
                <div>
                  <p className="text-xs text-gray-500">Email</p>
                  <p className="font-medium">{employee.email}</p>
                </div>
              </div>
              <div className="flex items-center text-gray-600">
                <FaPhone className="mr-3 text-gray-400" />
                <div>
                  <p className="text-xs text-gray-500">Phone</p>
                  <p className="font-medium">{employee.phone}</p>
                </div>
              </div>
              <div className="flex items-center text-gray-600">
                <FaCalendarAlt className="mr-3 text-gray-400" />
                <div>
                  <p className="text-xs text-gray-500">Date of Joining</p>
                  <p className="font-medium">{new Date(employee.dateOfJoining).toLocaleDateString()}</p>
                </div>
              </div>
            </div>

            {/* Skills */}
            {employee.skills && employee.skills.length > 0 && (
              <div className="mt-4">
                <p className="text-sm text-gray-500 mb-2">Skills:</p>
                <div className="flex flex-wrap gap-2">
                  {employee.skills.map((skill, index) => (
                    <span
                      key={index}
                      className="px-3 py-1 bg-blue-100 text-blue-800 text-sm rounded-full"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Task Statistics */}
          <div className="bg-white rounded-lg shadow-md p-4 sm:p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center">
              <FaTasks className="mr-2" />
              Task Statistics
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="text-center">
                <p className="text-2xl font-bold text-gray-900">{taskStats.total}</p>
                <p className="text-xs text-gray-600">Total Tasks</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-yellow-600">{taskStats.in_progress}</p>
                <p className="text-xs text-gray-600">In Progress</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-purple-600">{taskStats.review}</p>
                <p className="text-xs text-gray-600">In Review</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-green-600">{taskStats.completed}</p>
                <p className="text-xs text-gray-600">Completed</p>
              </div>
            </div>
          </div>

          {/* Member Tasks - Month Wise */}
          <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-md p-4 sm:p-6">
            {/* Month Navigator */}
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900 dark:text-zinc-100 flex items-center">
                <FaTasks className="mr-2" />
                Tasks
              </h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={goToPrevMonth}
                  className="p-2 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-lg text-gray-600 dark:text-zinc-400"
                >
                  <FaChevronLeft className="w-3 h-3" />
                </button>
                <span className="text-sm font-medium text-gray-700 dark:text-zinc-300 min-w-[140px] text-center">
                  {monthLabel}
                </span>
                <button
                  onClick={goToNextMonth}
                  disabled={isCurrentMonth}
                  className={`p-2 rounded-lg ${isCurrentMonth ? 'text-gray-300 dark:text-zinc-600 cursor-not-allowed' : 'hover:bg-gray-100 dark:hover:bg-zinc-800 text-gray-600 dark:text-zinc-400'}`}
                >
                  <FaChevronRight className="w-3 h-3" />
                </button>
              </div>
            </div>

            {/* Month Stats */}
            <div className="grid grid-cols-3 sm:grid-cols-7 gap-2 mb-4">
              {[
                { label: 'Total', value: monthStats.total || 0, color: 'text-gray-900 dark:text-zinc-100' },
                { label: 'Pending', value: monthStats.pendingAcceptance || 0, color: 'text-amber-600' },
                { label: 'Todo', value: monthStats.todo || 0, color: 'text-gray-500' },
                { label: 'In Progress', value: monthStats.inProgress || 0, color: 'text-yellow-600' },
                { label: 'Review', value: monthStats.review || 0, color: 'text-purple-600' },
                { label: 'Completed', value: monthStats.completed || 0, color: 'text-green-600' },
                { label: 'Blocked', value: monthStats.blocked || 0, color: 'text-red-600' }
              ].map(s => (
                <div key={s.label} className="text-center p-2 bg-gray-50 dark:bg-zinc-800 rounded-lg">
                  <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
                  <p className="text-[10px] text-gray-500 dark:text-zinc-400">{s.label}</p>
                </div>
              ))}
            </div>

            {/* Filters */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4">
              <select
                value={taskStatus}
                onChange={e => setTaskStatus(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-gray-700 dark:text-zinc-300"
              >
                <option value="all">All Statuses</option>
                <option value="todo">Todo</option>
                <option value="in-progress">In Progress</option>
                <option value="review">Review</option>
                <option value="completed">Completed</option>
                <option value="blocked">Blocked</option>
              </select>

              <select
                value={taskProject}
                onChange={e => setTaskProject(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-gray-700 dark:text-zinc-300"
              >
                <option value="all">All Projects</option>
                <option value="standalone">Standalone Tasks</option>
                {filterOptions.projects.map(p => (
                  <option key={p._id} value={p._id}>{p.name}</option>
                ))}
              </select>

              <select
                value={taskAssignedBy}
                onChange={e => setTaskAssignedBy(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-gray-700 dark:text-zinc-300"
              >
                <option value="all">All Assigners</option>
                {filterOptions.assigners.map(a => (
                  <option key={a._id} value={a._id}>{a.firstName} {a.lastName}</option>
                ))}
              </select>
            </div>

            {/* Task List */}
            {tasksLoading ? (
              <div className="flex justify-center py-8">
                <Loader />
              </div>
            ) : memberTasks.length === 0 ? (
              <p className="text-gray-500 dark:text-zinc-400 text-center py-8 text-sm">
                No tasks found for {monthLabel}
              </p>
            ) : (
              <div className="space-y-3 max-h-[500px] overflow-y-auto">
                {memberTasks.map((task) => {
                  const isCompleted = task.status === 'completed'
                  const isPending = task.assignmentStatus === 'pending'
                  const isRejected = task.assignmentStatus === 'rejected'

                  return (
                  <div
                    key={task._id}
                    className={`border rounded-lg p-3 transition-colors ${
                      isCompleted
                        ? 'border-green-200 dark:border-green-800/40 bg-green-50/60 dark:bg-green-900/10'
                        : isPending
                          ? 'border-amber-200 dark:border-amber-800/40 bg-amber-50/40 dark:bg-amber-900/10'
                          : isRejected
                            ? 'border-red-200 dark:border-red-800/40 bg-red-50/40 dark:bg-red-900/10'
                            : 'border-gray-200 dark:border-zinc-700 hover:bg-gray-50 dark:hover:bg-zinc-800/50'
                    }`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <h3 className={`font-medium flex-1 text-sm ${isCompleted ? 'text-green-800 dark:text-green-300' : 'text-gray-900 dark:text-zinc-100'}`}>
                        {isCompleted && <FaCheckCircle className="inline w-3 h-3 mr-1.5 text-green-500" />}
                        {task.title}
                      </h3>
                      <div className="flex items-center gap-1.5 ml-2">
                        {isPending && (
                          <span className="px-2 py-0.5 text-xs rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 whitespace-nowrap">
                            Pending Acceptance
                          </span>
                        )}
                        {isRejected && (
                          <span className="px-2 py-0.5 text-xs rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 whitespace-nowrap">
                            Rejected
                          </span>
                        )}
                        <span className={`px-2 py-0.5 text-xs rounded-full capitalize whitespace-nowrap ${getStatusColor(task.status)}`}>
                          {task.status.replace(/-/g, ' ')}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-zinc-400">
                      {task.project && (
                        <span className="flex items-center gap-1 px-2 py-0.5 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 rounded">
                          <FaProjectDiagram className="w-2.5 h-2.5" />
                          {task.project.name}
                        </span>
                      )}
                      {!task.project && (
                        <span className="px-2 py-0.5 bg-gray-100 dark:bg-zinc-700 text-gray-600 dark:text-zinc-400 rounded">
                          Standalone
                        </span>
                      )}
                      <span>
                        Assigned by: {task.assignedBy?.firstName || task.createdBy?.firstName || 'Unknown'} {task.assignedBy?.lastName || task.createdBy?.lastName || ''}
                      </span>
                      {task.dueDate && (
                        <span className={`${new Date(task.dueDate) < new Date() && task.status !== 'completed' ? 'text-red-500' : ''}`}>
                          Due: {new Date(task.dueDate).toLocaleDateString()}
                        </span>
                      )}
                      {task.priority && task.priority !== 'medium' && (
                        <span className={`px-2 py-0.5 rounded capitalize ${
                          task.priority === 'critical' ? 'bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-400' :
                          task.priority === 'high' ? 'bg-orange-100 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400' :
                          'bg-gray-100 dark:bg-zinc-700 text-gray-600 dark:text-zinc-400'
                        }`}>
                          {task.priority}
                        </span>
                      )}
                    </div>
                  </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right Sidebar - Reviews */}
        <div className="space-y-6">
          {/* Add Review Button */}
          <button
            onClick={() => setShowReviewForm(!showReviewForm)}
            className="w-full px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center font-medium"
          >
            <FaComments className="mr-2" />
            {showReviewForm ? 'Cancel' : 'Add Review / Remark'}
          </button>

          {/* Review Form */}
          {showReviewForm && (
            <div className="bg-white rounded-lg shadow-md p-4 sm:p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Add Review / Remark</h3>

              {/* Type Selection */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">Type</label>
                <Select
                  selectedKeys={[reviewForm.type]}
                  onChange={(e) => setReviewForm({ ...reviewForm, type: e.target.value })}
                  aria-label="Type"
                  classNames={{ trigger: "bg-white" }}
                >
                  <SelectItem key="review">Review</SelectItem>
                  <SelectItem key="remark">Remark</SelectItem>
                  <SelectItem key="feedback">Feedback</SelectItem>
                  <SelectItem key="warning">Warning</SelectItem>
                  <SelectItem key="appreciation">Appreciation</SelectItem>
                </Select>
              </div>

              {/* Category Selection */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">Category</label>
                <Select
                  selectedKeys={[reviewForm.category]}
                  onChange={(e) => setReviewForm({ ...reviewForm, category: e.target.value })}
                  aria-label="Category"
                  classNames={{ trigger: "bg-white" }}
                >
                  <SelectItem key="general">General</SelectItem>
                  <SelectItem key="performance">Performance</SelectItem>
                  <SelectItem key="behavior">Behavior</SelectItem>
                  <SelectItem key="skills">Skills</SelectItem>
                </Select>
              </div>

              {/* Rating (only for reviews) */}
              {reviewForm.type === 'review' && (
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">Rating</label>
                  <div className="flex gap-2">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        onClick={() => setReviewForm({ ...reviewForm, rating: star })}
                        className="focus:outline-none"
                      >
                        <FaStar
                          className={`text-2xl ${star <= reviewForm.rating ? 'text-yellow-400' : 'text-gray-300'
                            }`}
                        />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Content */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">Content</label>
                <textarea
                  value={reviewForm.content}
                  onChange={(e) => setReviewForm({ ...reviewForm, content: e.target.value })}
                  rows={4}
                  placeholder="Enter your review, remark, or feedback..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              {/* Submit Button */}
              <LoadingButton
                onClick={handleSubmitReview}
                isLoading={reviewMutation.isLoading}
                loadingText="Submitting..."
                className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center"
              >
                <FaPaperPlane className="mr-2" />
                Submit
              </LoadingButton>
            </div>
          )}

          {/* Reviews History */}
          <div className="bg-white rounded-lg shadow-md p-4 sm:p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-4">Reviews & Remarks</h3>
            {!employee.reviews || employee.reviews.length === 0 ? (
              <p className="text-gray-600 text-center py-4">No reviews yet</p>
            ) : (
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {employee.reviews.slice().reverse().map((review, index) => (
                  <div key={index} className="border border-gray-200 rounded-lg p-3">
                    <div className="flex items-start justify-between mb-2">
                      <span className={`px-2 py-1 text-xs rounded ${getReviewTypeColor(review.type)}`}>
                        {review.type.charAt(0).toUpperCase() + review.type.slice(1)}
                      </span>
                      {review.rating && (
                        <div className="flex">
                          {[...Array(review.rating)].map((_, i) => (
                            <FaStar key={i} className="text-yellow-400 text-xs" />
                          ))}
                        </div>
                      )}
                    </div>
                    <p className="text-sm text-gray-700 mb-2">{review.content}</p>
                    <div className="flex items-center justify-between text-xs text-gray-500">
                      <span className={`px-2 py-1 bg-gray-100 rounded`}>
                        {review.category}
                      </span>
                      <span>{new Date(review.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

