'use client'


import { Heading3, NativeButton, Heading1, Heading2, NativeSelect, NativeTextarea } from '@/components/ui/fernly/native'
import BackIcon from '@/components/ui/BackIcon'

import { useState, useMemo, useCallback, useEffect } from 'react'
import { patchProfilePhotoResponse } from '@/lib/client/profilePhoto'
import { useRouter, useParams } from 'next/navigation'
import toast from '@/utils/toast'
import { Select, SelectItem, Button, Skeleton, Card, CardBody, Chip } from '@/components/ui/fernly'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import useApiMutation from '@/hooks/useApiMutation'
import LoadingButton from '@/components/ui/LoadingButton'
import Loader from '@/components/ui/Loader'
import { DataErrorState } from '@/components/ui/ErrorBoundary'
import BackgroundRefreshIndicator from '@/components/ui/BackgroundRefreshIndicator'
import {
  FaUser, FaEnvelope, FaPhone, FaCalendarAlt,
  FaBriefcase, FaStar, FaTasks, FaChartLine, FaComments,
  FaPaperPlane, FaExclamationCircle, FaCheckCircle, FaClock,
  FaChevronLeft, FaChevronRight, FaFilter, FaProjectDiagram
} from 'react-icons/fa'
import { formatDesignation } from '@/lib/formatters'
import MemberOverview from './MemberOverview'
import FernlyMotion from '@/components/ui/FernlyMotion'
import MemberTaskList from './MemberTaskList'
import MemberAttendance from './MemberAttendance'
import MemberLifecycle from './MemberLifecycle'
import MemberDetails from './MemberDetails'
import MemberScreenshots from './MemberScreenshots'
import EmployeeTabs from './EmployeeTabs'
import styles from './member.module.css'

export default function TeamMemberDetailsPage() {
  const router = useRouter()
  const params = useParams()
  const [activeTab, setActiveTab] = useState('overview')
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

  const { data: tasksRes, isLoading: tasksLoading, error: tasksError, mutate: refreshTasks } = useAuthedSWR(
    params.id && activeTab === 'tasks' ? `/api/team/members/${params.id}/tasks?${taskQueryString}` : null
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
  useEffect(() => {
    const applyPhoto = updatedUser => {
      const ref = updatedUser?.employeeId
      const employeeId = typeof ref === 'object' && ref ? ref._id || ref.id : ref
      const photo = updatedUser?.profilePicture || (typeof ref === 'object' && ref?.profilePicture)
      if (!photo || String(employeeId) !== String(params.id)) return
      void refresh(cached => patchProfilePhotoResponse(cached, employeeId, photo), { revalidate: false })
    }
    const onUpdate = event => applyPhoto(event.detail)
    const onStorage = event => {
      if (event.key !== 'user' || !event.newValue) return
      try { applyPhoto(JSON.parse(event.newValue)) } catch { /* Ignore malformed storage notifications. */ }
    }
    window.addEventListener('talio:user-updated', onUpdate)
    window.addEventListener('storage', onStorage)
    return () => { window.removeEventListener('talio:user-updated', onUpdate); window.removeEventListener('storage', onStorage) }
  }, [params.id, refresh])

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
          <Heading3 className="text-lg font-semibold text-gray-700 mb-2">Member Not Found</Heading3>
          <NativeButton
            onClick={() => router.back()}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Go Back
          </NativeButton>
        </div>
      </div>
    )
  }

  const { employee, taskStats = { total: 0, in_progress: 0, review: 0, completed: 0 } } = memberData || {}

  // Safety check for employee
  if (!employee) {
    return (
      <div className="p-6">
        <NativeButton
          onClick={() => router.back()}
          className="flex items-center text-blue-600 hover:text-blue-700 mb-4"
        >
          <BackIcon className="mr-2" />
          Go Back
        </NativeButton>
        <p className="text-gray-600">Employee data not available</p>
      </div>
    )
  }

  return (
    <FernlyMotion className={`${styles.page} ${styles.dashboard}`}>
      {/* Header */}
      <div className={styles.dashboardHeader}>
        <NativeButton
          onClick={() => router.back()}
          className={styles.backButton}
          aria-label="Back to previous page"
          title="Back to previous page"
        >
          <BackIcon aria-hidden="true" />
        </NativeButton>
        <div><Heading1>{employee.firstName} {employee.lastName}</Heading1><p>{employee.employeeCode} · {employee.department?.name || 'Department not recorded'} · {formatDesignation(employee.designation, employee)}</p></div>
        <NativeButton onClick={() => refresh()} disabled={isValidating} aria-label="Refresh employee">↻</NativeButton>
      </div>
      <BackgroundRefreshIndicator isValidating={isValidating && !isLoading} position="inline" />
      <EmployeeTabs active={activeTab} onChange={setActiveTab} />
      <div id={`employee-panel-${activeTab}`} role="tabpanel" aria-labelledby={`employee-tab-${activeTab}`} tabIndex={0} data-slide={activeTab} className={styles.slide} key={activeTab}>
      {activeTab === 'overview' && <MemberOverview showHeading={false} onTasks={() => setActiveTab('tasks')} employee={employee} stats={taskStats} tasks={memberData.recentTasks || []} />}
      {activeTab === 'profile' && <MemberDetails employee={employee} />}
      {activeTab === 'assets' && <MemberDetails employee={employee} assetsOnly />}
      {activeTab === 'lifecycle' && <MemberLifecycle key={employee._id} employeeId={employee._id} />}
      {activeTab === 'screenshots' && <MemberScreenshots employee={employee} />}

      {/* Employee Details */}
      <div hidden={!['overview', 'tasks', 'reviews'].includes(activeTab)} className={styles.legacyPanels}>
        <div hidden={!['overview', 'tasks'].includes(activeTab)} className={styles.fillPanel}>
          {/* Basic Info */}
          <div hidden={activeTab !== 'overview'} className="bg-white rounded-lg shadow-md p-4 sm:p-6">
            <Heading2 className="text-xl font-bold text-gray-900 mb-4">Basic Information</Heading2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex items-center text-gray-600">
                <div>
                  <p className="text-xs text-gray-500">Designation</p>
                  <p className="font-medium">
                    {formatDesignation(employee.designation, employee)}
                  </p>
                </div>
              </div>
              <div className="flex items-center text-gray-600">
                <div>
                  <p className="text-xs text-gray-500">Email</p>
                  <p className="font-medium">{employee.email}</p>
                </div>
              </div>
              <div className="flex items-center text-gray-600">
                <div>
                  <p className="text-xs text-gray-500">Phone</p>
                  <p className="font-medium">{employee.phone}</p>
                </div>
              </div>
              <div className="flex items-center text-gray-600">
                <div>
                  <p className="text-xs text-gray-500">Date of Joining</p>
                  <p className="font-medium">{employee.dateOfJoining && !Number.isNaN(new Date(employee.dateOfJoining).getTime()) ? new Date(employee.dateOfJoining).toLocaleDateString() : 'Not provided'}</p>
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

          {/* Member Tasks - Month Wise */}
          <div hidden={activeTab !== 'tasks'} id="member-tasks" data-fernly-element className="bg-white dark:bg-zinc-900 rounded-lg shadow-md p-4 sm:p-6">
            {/* Month Navigator */}
            <div className="flex items-center justify-between mb-4">
              <Heading2 className="text-xl font-bold text-gray-900 dark:text-zinc-100 flex items-center">
                Tasks
              </Heading2>
              <div className="flex items-center gap-2">
                <NativeButton
                  onClick={goToPrevMonth}
                  className="p-2 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-lg text-gray-600 dark:text-zinc-400"
                >
                  <FaChevronLeft className="w-3 h-3" />
                </NativeButton>
                <span className="text-sm font-medium text-gray-700 dark:text-zinc-300 min-w-[140px] text-center">
                  {monthLabel}
                </span>
                <NativeButton
                  onClick={goToNextMonth}
                  disabled={isCurrentMonth}
                  className={`p-2 rounded-lg ${isCurrentMonth ? 'text-gray-300 dark:text-zinc-600 cursor-not-allowed' : 'hover:bg-gray-100 dark:hover:bg-zinc-800 text-gray-600 dark:text-zinc-400'}`}
                >
                  <FaChevronRight className="w-3 h-3" />
                </NativeButton>
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
              <NativeSelect
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
              </NativeSelect>

              <NativeSelect
                value={taskProject}
                onChange={e => setTaskProject(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-gray-700 dark:text-zinc-300"
              >
                <option value="all">All Projects</option>
                <option value="standalone">Standalone Tasks</option>
                {filterOptions.projects.map(p => (
                  <option key={p._id} value={p._id}>{p.name}</option>
                ))}
              </NativeSelect>

              <NativeSelect
                value={taskAssignedBy}
                onChange={e => setTaskAssignedBy(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-gray-700 dark:text-zinc-300"
              >
                <option value="all">All Assigners</option>
                {filterOptions.assigners.map(a => (
                  <option key={a._id} value={a._id}>{a.firstName} {a.lastName}</option>
                ))}
              </NativeSelect>
            </div>

            {/* Task List */}
            {tasksError ? <DataErrorState message="Unable to load this month's tasks" onRetry={() => refreshTasks()} /> : tasksLoading ? (
              <div className="flex justify-center py-8">
                <Loader />
              </div>
            ) : memberTasks.length === 0 ? (
              <p className="text-gray-500 dark:text-zinc-400 text-center py-8 text-sm">
                No tasks found for {monthLabel}
              </p>
            ) : (
              <MemberTaskList tasks={memberTasks} />
            )}
          </div>
        </div>

        {/* Right Sidebar - Reviews */}
        <div hidden={activeTab !== 'reviews'} className={styles.fillPanel}>
          {/* Add Review Button */}
          <NativeButton
            onClick={() => setShowReviewForm(!showReviewForm)}
            className="w-full px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center font-medium"
          >
            <FaComments className="mr-2" />
            {showReviewForm ? 'Cancel' : 'Add Review / Remark'}
          </NativeButton>

          {/* Review Form */}
          {showReviewForm && (
            <div className="bg-white rounded-lg shadow-md p-4 sm:p-6">
              <Heading3 className="text-lg font-bold text-gray-900 mb-4">Add Review / Remark</Heading3>

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
                      <NativeButton
                        key={star}
                        type="button"
                        onClick={() => setReviewForm({ ...reviewForm, rating: star })}
                        className="focus:outline-none"
                      >
                        <FaStar
                          className={`text-2xl ${star <= reviewForm.rating ? 'text-yellow-400' : 'text-gray-300'
                            }`}
                        />
                      </NativeButton>
                    ))}
                  </div>
                </div>
              )}

              {/* Content */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">Content</label>
                <NativeTextarea
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
            <Heading3 className="text-lg font-bold text-gray-900 mb-4">Reviews & Remarks</Heading3>
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
      {activeTab === 'attendance' && <MemberAttendance key={employee._id} employee={employee} showProductivity={false} />}
      </div>
    </FernlyMotion>
  )
}
