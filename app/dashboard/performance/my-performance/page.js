'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Skeleton } from '@heroui/react'
import toast from '@/utils/toast'
import {
  FaChartLine, FaStar, FaTrophy, FaBullseye, FaCalendarAlt,
  FaCheckCircle, FaClock, FaExclamationTriangle, FaArrowUp,
  FaArrowDown, FaMinus, FaChevronRight, FaPlus,
  FaEdit, FaEye, FaAward, FaLightbulb, FaUserTie
} from 'react-icons/fa'
import { getCurrentUser, getEmployeeId } from '@/utils/userHelper'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import { DataErrorState } from '@/components/ui/ErrorBoundary'
import BackgroundRefreshIndicator from '@/components/ui/BackgroundRefreshIndicator'

export default function MyPerformancePage() {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState('overview')

  const user = useMemo(() => getCurrentUser(), [])

  // Redirect if not logged in
  useEffect(() => {
    if (!user) {
      toast.error('Please login to view your performance')
      router.push('/login')
    }
  }, [user])

  // SWR: fetch all performance data in parallel
  const { data: reviewsRes, error: reviewsErr, isLoading: reviewsLoading, isValidating: reviewsValidating } = useAuthedSWR('/api/performance/ratings')
  const { data: goalsRes, error: goalsErr, isLoading: goalsLoading, isValidating: goalsValidating } = useAuthedSWR('/api/performance/goals')
  const { data: perfReviewsRes, error: perfErr, isLoading: perfLoading, isValidating: perfValidating } = useAuthedSWR('/api/performance')
  const { data: profileRes, error: profileErr, isLoading: profileLoading, isValidating: profileValidating } = useAuthedSWR('/api/profile')

  const isLoading = reviewsLoading || goalsLoading || perfLoading || profileLoading
  const isValidating = reviewsValidating || goalsValidating || perfValidating || profileValidating
  const error = reviewsErr || goalsErr || perfErr || profileErr

  // Derive data
  const employee = profileRes?.data?.employee || null
  const reviews = reviewsRes?.data || []
  const goals = goalsRes?.data || []
  const performanceReviews = perfReviewsRes?.data || []

  // Calculate stats
  const stats = useMemo(() => {
    const completedGoals = goals.filter(g => g.status === 'completed').length
    const inProgressGoals = goals.filter(g => g.status === 'in-progress').length
    const overdueGoals = goals.filter(g =>
      g.status !== 'completed' && g.status !== 'cancelled' && new Date(g.dueDate) < new Date()
    ).length

    const totalProgress = goals.reduce((sum, g) => sum + (g.progress || 0), 0)
    const avgProgress = goals.length > 0 ? Math.round(totalProgress / goals.length) : 0

    const totalRating = reviews.reduce((sum, r) => sum + (r.rating || 0), 0)
    const avgRating = reviews.length > 0 ? (totalRating / reviews.length).toFixed(1) : 0

    return {
      averageRating: avgRating,
      totalReviews: reviews.length,
      totalGoals: goals.length,
      completedGoals,
      inProgressGoals,
      overdueGoals,
      goalsProgress: avgProgress
    }
  }, [reviews, goals])

  const getStatusColor = (status) => {
    switch (status) {
      case 'completed': return 'bg-green-100 text-green-800 border-green-200'
      case 'in-progress': return 'bg-blue-100 text-blue-800 border-blue-200'
      case 'not-started': return 'bg-gray-100 text-gray-800 border-gray-200'
      case 'on-hold': return 'bg-yellow-100 text-yellow-800 border-yellow-200'
      case 'cancelled': return 'bg-red-100 text-red-800 border-red-200'
      default: return 'bg-gray-100 text-gray-800 border-gray-200'
    }
  }

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'critical': return 'bg-red-500 text-white'
      case 'high': return 'bg-orange-500 text-white'
      case 'medium': return 'bg-yellow-500 text-white'
      case 'low': return 'bg-green-500 text-white'
      default: return 'bg-gray-500 text-white'
    }
  }

  const getRatingStars = (rating) => {
    const stars = []
    for (let i = 1; i <= 5; i++) {
      stars.push(
        <FaStar
          key={i}
          className={`w-4 h-4 ${i <= rating ? 'text-yellow-400' : 'text-gray-300'}`}
        />
      )
    }
    return stars
  }

  const getRatingLabel = (rating) => {
    if (rating >= 4.5) return { label: 'Exceptional', color: 'text-green-600' }
    if (rating >= 3.5) return { label: 'Exceeds Expectations', color: 'text-blue-600' }
    if (rating >= 2.5) return { label: 'Meets Expectations', color: 'text-yellow-600' }
    if (rating >= 1.5) return { label: 'Needs Improvement', color: 'text-orange-600' }
    return { label: 'Below Expectations', color: 'text-red-600' }
  }

  const formatDate = (date) => {
    if (!date) return 'N/A'
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  }

  const getDaysRemaining = (dueDate) => {
    const today = new Date()
    const due = new Date(dueDate)
    const diffTime = due - today
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
    return diffDays
  }

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
          <div>
            <Skeleton className="h-8 w-56 rounded-lg mb-2" />
            <Skeleton className="h-4 w-72 rounded-lg" />
          </div>
          <Skeleton className="h-10 w-36 rounded-lg" />
        </div>
        <Skeleton className="h-48 w-full rounded-xl" />
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          <Skeleton className="h-12 w-full" />
          <div className="p-6 space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map(i => (
                <Skeleton key={i} className="h-24 w-full rounded-lg" />
              ))}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Skeleton className="h-64 w-full rounded-xl" />
              <Skeleton className="h-64 w-full rounded-xl" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return <DataErrorState error={error} title="Failed to load performance data" />
  }

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <BackgroundRefreshIndicator isValidating={isValidating} />
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-800">My Performance</h1>
          <p className="text-gray-600 mt-1 text-sm sm:text-base">
            Track your goals, reviews, and overall performance
          </p>
        </div>
        <Button
          onPress={() => router.push('/dashboard/performance/goals')}
          color="primary"
          startContent={<FaPlus />}
          className="w-full sm:w-auto"
        >
          Set New Goal
        </Button>
      </div>

      {/* Performance Score Card */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-xl shadow-lg p-4 sm:p-6 text-white">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center space-x-4">
            <div className="w-16 h-16 sm:w-20 sm:h-20 bg-yellow-400 rounded-full flex items-center justify-center shadow-lg">
              <FaTrophy className="w-8 h-8 sm:w-10 sm:h-10 text-yellow-700" />
            </div>
            <div>
              <p className="text-blue-100 text-sm font-medium">Overall Performance Rating</p>
              <div className="flex items-center space-x-2 mt-1">
                <span className="text-3xl sm:text-4xl font-bold">{stats.averageRating > 0 ? stats.averageRating : 'N/A'}</span>
                {stats.averageRating > 0 && (
                  <span className="text-lg text-blue-200">/5.0</span>
                )}
              </div>
              {stats.averageRating > 0 ? (
                <p className={`text-sm font-medium ${getRatingLabel(stats.averageRating).color} bg-white px-3 py-1 rounded-full inline-block mt-2 shadow-sm`}>
                  {getRatingLabel(stats.averageRating).label}
                </p>
              ) : (
                <p className="text-sm text-blue-200 mt-2">No ratings yet - keep up the good work!</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
            <div className="bg-blue-500/50 rounded-xl p-4 text-center border border-blue-400/30">
              <p className="text-2xl sm:text-3xl font-bold">{stats.totalReviews}</p>
              <p className="text-xs sm:text-sm text-blue-100 font-medium mt-1">Reviews</p>
            </div>
            <div className="bg-blue-500/50 rounded-xl p-4 text-center border border-blue-400/30">
              <p className="text-2xl sm:text-3xl font-bold">{stats.totalGoals}</p>
              <p className="text-xs sm:text-sm text-blue-100 font-medium mt-1">Goals</p>
            </div>
            <div className="bg-blue-500/50 rounded-xl p-4 text-center border border-blue-400/30">
              <p className="text-2xl sm:text-3xl font-bold">{stats.completedGoals}</p>
              <p className="text-xs sm:text-sm text-blue-100 font-medium mt-1">Completed</p>
            </div>
            <div className="bg-blue-500/50 rounded-xl p-4 text-center border border-blue-400/30">
              <p className="text-2xl sm:text-3xl font-bold">{stats.goalsProgress}%</p>
              <p className="text-xs sm:text-sm text-blue-100 font-medium mt-1">Progress</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-lg shadow-md overflow-hidden">
        <div className="border-b border-gray-200 overflow-x-auto overflow-y-hidden relative"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
          <style jsx>{`
            div::-webkit-scrollbar {
              display: none;
            }
          `}</style>
          <nav className="flex" aria-label="Tabs">
            {[
              { id: 'overview', label: 'Overview', icon: FaChartLine },
              { id: 'goals', label: 'My Goals', icon: FaBullseye },
              { id: 'reviews', label: 'Reviews', fullLabel: 'Reviews & Feedback', icon: FaStar },
              { id: 'performance-reviews', label: 'Formal', fullLabel: 'Formal Reviews', icon: FaUserTie }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center justify-center gap-1.5 px-3 sm:px-5 py-3 text-xs sm:text-sm font-medium whitespace-nowrap border-b-2 transition-colors flex-shrink-0 ${activeTab === tab.id
                    ? 'border-blue-500 text-blue-600 bg-blue-50'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
              >
                <tab.icon className="w-3.5 h-3.5 sm:w-4 sm:h-4 flex-shrink-0" />
                <span className="hidden sm:inline">{tab.fullLabel || tab.label}</span>
                <span className="sm:hidden">{tab.label}</span>
              </button>
            ))}
          </nav>
        </div>

        <div className="p-4 sm:p-6">
          {/* Overview Tab */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* Quick Stats */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-green-50 rounded-lg p-4 border border-green-200">
                  <div className="flex items-center justify-between">
                    <FaCheckCircle className="w-8 h-8 text-green-500" />
                    <span className="text-2xl font-bold text-green-700">{stats.completedGoals}</span>
                  </div>
                  <p className="text-sm text-green-600 mt-2">Completed Goals</p>
                </div>

                <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
                  <div className="flex items-center justify-between">
                    <FaClock className="w-8 h-8 text-blue-500" />
                    <span className="text-2xl font-bold text-blue-700">{stats.inProgressGoals}</span>
                  </div>
                  <p className="text-sm text-blue-600 mt-2">In Progress</p>
                </div>

                <div className="bg-red-50 rounded-lg p-4 border border-red-200">
                  <div className="flex items-center justify-between">
                    <FaExclamationTriangle className="w-8 h-8 text-red-500" />
                    <span className="text-2xl font-bold text-red-700">{stats.overdueGoals}</span>
                  </div>
                  <p className="text-sm text-red-600 mt-2">Overdue</p>
                </div>

                <div className="bg-yellow-50 rounded-lg p-4 border border-yellow-200">
                  <div className="flex items-center justify-between">
                    <FaStar className="w-8 h-8 text-yellow-500" />
                    <span className="text-2xl font-bold text-yellow-700">{stats.averageRating}</span>
                  </div>
                  <p className="text-sm text-yellow-600 mt-2">Avg. Rating</p>
                </div>
              </div>

              {/* Recent Activity */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Recent Goals */}
                <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center space-x-2">
                      <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                        <FaBullseye className="w-4 h-4 text-blue-600" />
                      </div>
                      <h3 className="text-lg font-semibold text-gray-800">Recent Goals</h3>
                    </div>
                    <button
                      onClick={() => setActiveTab('goals')}
                      className="text-blue-600 hover:text-blue-700 text-sm font-medium flex items-center hover:bg-blue-50 px-2 py-1 rounded-lg transition-colors"
                    >
                      View All <FaChevronRight className="ml-1 w-3 h-3" />
                    </button>
                  </div>
                  <div className="space-y-3">
                    {goals.slice(0, 3).map((goal) => (
                      <div key={goal._id} className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0">
                            <h4 className="font-medium text-gray-800 truncate">{goal.title}</h4>
                            <p className="text-sm text-gray-500 mt-1">Due: {formatDate(goal.dueDate)}</p>
                          </div>
                          <span className={`px-2 py-1 text-xs rounded-full ${getStatusColor(goal.status)}`}>
                            {goal.status?.replace('-', ' ')}
                          </span>
                        </div>
                        <div className="mt-3">
                          <div className="flex items-center justify-between text-sm text-gray-600 mb-1">
                            <span>Progress</span>
                            <span>{goal.progress || 0}%</span>
                          </div>
                          <div className="w-full bg-gray-200 rounded-full h-2">
                            <div
                              className="bg-primary-500 h-2 rounded-full transition-all duration-300"
                              style={{ width: `${goal.progress || 0}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                    {goals.length === 0 && (
                      <div className="text-center py-10 bg-gradient-to-br from-gray-50 to-blue-50 rounded-xl border-2 border-dashed border-gray-200">
                        <div className="w-16 h-16 mx-auto bg-blue-100 rounded-full flex items-center justify-center mb-4">
                          <FaBullseye className="w-8 h-8 text-blue-500" />
                        </div>
                        <h4 className="text-gray-700 font-medium mb-1">No goals set yet</h4>
                        <p className="text-gray-500 text-sm mb-4">Start tracking your progress by setting goals</p>
                        <Button
                          onPress={() => router.push('/dashboard/performance/goals')}
                          color="primary"
                          size="sm"
                        >
                          Set your first goal
                        </Button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Recent Reviews */}
                <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center space-x-2">
                      <div className="w-8 h-8 bg-yellow-100 rounded-lg flex items-center justify-center">
                        <FaStar className="w-4 h-4 text-yellow-600" />
                      </div>
                      <h3 className="text-lg font-semibold text-gray-800">Recent Feedback</h3>
                    </div>
                    <button
                      onClick={() => setActiveTab('reviews')}
                      className="text-blue-600 hover:text-blue-700 text-sm font-medium flex items-center hover:bg-blue-50 px-2 py-1 rounded-lg transition-colors"
                    >
                      View All <FaChevronRight className="ml-1 w-3 h-3" />
                    </button>
                  </div>
                  <div className="space-y-3">
                    {reviews.slice(0, 3).map((review) => (
                      <div key={review._id} className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center space-x-2">
                              <span className="text-sm font-medium text-gray-800">
                                {review.rater?.firstName} {review.rater?.lastName}
                              </span>
                              <span className="text-xs text-gray-500 capitalize bg-gray-200 px-2 py-0.5 rounded">
                                {review.type || 'Review'}
                              </span>
                            </div>
                            <p className="text-sm text-gray-600 mt-1 line-clamp-2">{review.content}</p>
                          </div>
                          <div className="flex ml-2">{getRatingStars(review.rating || 0)}</div>
                        </div>
                        <p className="text-xs text-gray-400 mt-2">{formatDate(review.createdAt)}</p>
                      </div>
                    ))}
                    {reviews.length === 0 && (
                      <div className="text-center py-10 bg-gradient-to-br from-gray-50 to-yellow-50 rounded-xl border-2 border-dashed border-gray-200">
                        <div className="w-16 h-16 mx-auto bg-yellow-100 rounded-full flex items-center justify-center mb-4">
                          <FaStar className="w-8 h-8 text-yellow-500" />
                        </div>
                        <h4 className="text-gray-700 font-medium mb-1">No reviews yet</h4>
                        <p className="text-gray-500 text-sm">Your feedback will appear here</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Goals Tab */}
          {activeTab === 'goals' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                <h3 className="text-lg font-semibold text-gray-800">My Goals ({goals.length})</h3>
                <Button
                  onPress={() => router.push('/dashboard/performance/goals')}
                  color="primary"
                  size="sm"
                  startContent={<FaPlus className="w-3 h-3" />}
                >
                  Add Goal
                </Button>
              </div>

              {goals.length === 0 ? (
                <div className="text-center py-16 bg-gradient-to-br from-gray-50 to-blue-50 rounded-xl border-2 border-dashed border-gray-200">
                  <div className="w-20 h-20 mx-auto bg-blue-100 rounded-full flex items-center justify-center mb-5">
                    <FaBullseye className="w-10 h-10 text-blue-500" />
                  </div>
                  <h3 className="text-xl font-semibold text-gray-800 mb-2">No Goals Set Yet</h3>
                  <p className="text-gray-500 mb-6 max-w-md mx-auto">Set personal and professional goals to track your progress and achieve more</p>
                  <Button
                    onPress={() => router.push('/dashboard/performance/goals')}
                    color="primary"
                    startContent={<FaPlus />}
                  >
                    Set Your First Goal
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  {goals.map((goal) => {
                    const daysRemaining = getDaysRemaining(goal.dueDate)
                    const isOverdue = daysRemaining < 0 && goal.status !== 'completed' && goal.status !== 'cancelled'

                    return (
                      <div
                        key={goal._id}
                        className={`bg-white border rounded-lg p-4 sm:p-5 hover:shadow-md transition-shadow ${isOverdue ? 'border-red-300 bg-red-50' : 'border-gray-200'
                          }`}
                      >
                        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center flex-wrap gap-2">
                              <h4 className="font-semibold text-gray-800">{goal.title}</h4>
                              <span className={`px-2 py-0.5 text-xs rounded ${getPriorityColor(goal.priority)}`}>
                                {goal.priority}
                              </span>
                              <span className={`px-2 py-0.5 text-xs rounded-full border ${getStatusColor(goal.status)}`}>
                                {goal.status?.replace('-', ' ')}
                              </span>
                            </div>
                            {goal.description && (
                              <p className="text-sm text-gray-600 mt-2 line-clamp-2">{goal.description}</p>
                            )}
                            <div className="flex flex-wrap items-center gap-4 mt-3 text-sm text-gray-500">
                              <span className="flex items-center">
                                <FaCalendarAlt className="mr-1" />
                                Due: {formatDate(goal.dueDate)}
                              </span>
                              {goal.category && (
                                <span className="bg-gray-100 px-2 py-0.5 rounded text-xs">
                                  {goal.category}
                                </span>
                              )}
                              {isOverdue && (
                                <span className="text-red-600 font-medium flex items-center">
                                  <FaExclamationTriangle className="mr-1" />
                                  {Math.abs(daysRemaining)} days overdue
                                </span>
                              )}
                              {!isOverdue && daysRemaining >= 0 && daysRemaining <= 7 && goal.status !== 'completed' && (
                                <span className="text-orange-600 font-medium">
                                  {daysRemaining} days left
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center space-x-2">
                            <button
                              onClick={() => router.push(`/dashboard/performance/goals?goalId=${goal._id}`)}
                              className="p-2 text-gray-500 hover:text-primary-600 hover:bg-gray-100 rounded-lg"
                              title="View Details"
                            >
                              <FaEye />
                            </button>
                          </div>
                        </div>

                        {/* Progress Bar */}
                        <div className="mt-4">
                          <div className="flex items-center justify-between text-sm mb-1">
                            <span className="text-gray-600">Progress</span>
                            <span className="font-medium text-gray-800">{goal.progress || 0}%</span>
                          </div>
                          <div className="w-full bg-gray-200 rounded-full h-2.5">
                            <div
                              className={`h-2.5 rounded-full transition-all duration-300 ${goal.status === 'completed' ? 'bg-green-500' :
                                  isOverdue ? 'bg-red-500' : 'bg-primary-500'
                                }`}
                              style={{ width: `${goal.progress || 0}%` }}
                            />
                          </div>
                        </div>

                        {/* Milestones Preview */}
                        {goal.milestones && goal.milestones.length > 0 && (
                          <div className="mt-4 pt-3 border-t border-gray-100">
                            <p className="text-xs text-gray-500 mb-2">
                              Milestones: {goal.milestones.filter(m => m.completed).length}/{goal.milestones.length} completed
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {goal.milestones.slice(0, 3).map((milestone, idx) => (
                                <span
                                  key={idx}
                                  className={`text-xs px-2 py-1 rounded ${milestone.completed
                                      ? 'bg-green-100 text-green-700 line-through'
                                      : 'bg-gray-100 text-gray-600'
                                    }`}
                                >
                                  {milestone.title}
                                </span>
                              ))}
                              {goal.milestones.length > 3 && (
                                <span className="text-xs text-gray-400">
                                  +{goal.milestones.length - 3} more
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Reviews Tab */}
          {activeTab === 'reviews' && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">Reviews & Feedback ({reviews.length})</h3>

              {reviews.length === 0 ? (
                <div className="text-center py-16 bg-gradient-to-br from-gray-50 to-yellow-50 rounded-xl border-2 border-dashed border-gray-200">
                  <div className="w-20 h-20 mx-auto bg-yellow-100 rounded-full flex items-center justify-center mb-5">
                    <FaStar className="w-10 h-10 text-yellow-500" />
                  </div>
                  <h3 className="text-xl font-semibold text-gray-800 mb-2">No Reviews Yet</h3>
                  <p className="text-gray-500 max-w-md mx-auto">You haven't received any reviews or feedback yet. Keep up the good work and feedback will appear here!</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {reviews.map((review) => (
                    <div key={review._id} className="bg-white border border-gray-200 rounded-lg p-4 sm:p-5">
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                        <div className="flex-1">
                          <div className="flex items-center flex-wrap gap-2 mb-2">
                            <span className="font-medium text-gray-800">
                              {review.rater?.firstName} {review.rater?.lastName}
                            </span>
                            <span className={`px-2 py-0.5 text-xs rounded capitalize ${review.type === 'appreciation' ? 'bg-green-100 text-green-700' :
                                review.type === 'warning' ? 'bg-red-100 text-red-700' :
                                  review.type === 'feedback' ? 'bg-blue-100 text-blue-700' :
                                    'bg-gray-100 text-gray-700'
                              }`}>
                              {review.type || 'Review'}
                            </span>
                            {review.category && (
                              <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded capitalize">
                                {review.category}
                              </span>
                            )}
                          </div>
                          <p className="text-gray-700">{review.content}</p>
                          <p className="text-sm text-gray-400 mt-2">{formatDate(review.createdAt)}</p>
                        </div>
                        <div className="flex items-center">
                          {review.rating > 0 && (
                            <div className="flex items-center space-x-1 bg-yellow-50 px-3 py-1 rounded-lg">
                              {getRatingStars(review.rating)}
                              <span className="ml-2 font-medium text-yellow-700">{review.rating}/5</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Formal Performance Reviews Tab */}
          {activeTab === 'performance-reviews' && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">
                Formal Performance Reviews ({performanceReviews.length})
              </h3>

              {performanceReviews.length === 0 ? (
                <div className="text-center py-16 bg-gradient-to-br from-gray-50 to-purple-50 rounded-xl border-2 border-dashed border-gray-200">
                  <div className="w-20 h-20 mx-auto bg-purple-100 rounded-full flex items-center justify-center mb-5">
                    <FaUserTie className="w-10 h-10 text-purple-500" />
                  </div>
                  <h3 className="text-xl font-semibold text-gray-800 mb-2">No Formal Reviews</h3>
                  <p className="text-gray-500 max-w-md mx-auto">You don't have any formal performance reviews yet. Check back during review periods.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {performanceReviews.map((review) => (
                    <div key={review._id} className="bg-white border border-gray-200 rounded-lg p-4 sm:p-5">
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                        <div className="flex-1">
                          <div className="flex items-center flex-wrap gap-2 mb-2">
                            <span className="font-medium text-gray-800 capitalize">
                              {review.reviewType?.replace('-', ' ')} Review
                            </span>
                            <span className={`px-2 py-0.5 text-xs rounded-full border ${getStatusColor(review.status)}`}>
                              {review.status}
                            </span>
                          </div>
                          <div className="text-sm text-gray-600 space-y-1">
                            <p>
                              <span className="font-medium">Review Period:</span>{' '}
                              {formatDate(review.reviewPeriod?.startDate)} - {formatDate(review.reviewPeriod?.endDate)}
                            </p>
                            <p>
                              <span className="font-medium">Reviewer:</span>{' '}
                              {review.reviewer?.firstName} {review.reviewer?.lastName}
                            </p>
                          </div>

                          {review.strengths && (
                            <div className="mt-3">
                              <p className="text-sm font-medium text-green-700">Strengths:</p>
                              <p className="text-sm text-gray-600">{review.strengths}</p>
                            </div>
                          )}

                          {review.areasOfImprovement && (
                            <div className="mt-2">
                              <p className="text-sm font-medium text-orange-700">Areas for Improvement:</p>
                              <p className="text-sm text-gray-600">{review.areasOfImprovement}</p>
                            </div>
                          )}
                        </div>

                        <div className="flex flex-col items-end">
                          {review.overallRating && (
                            <div className="text-center bg-primary-50 px-4 py-2 rounded-lg">
                              <p className="text-2xl font-bold text-primary-600">{review.overallRating.toFixed(1)}</p>
                              <p className="text-xs text-primary-500">Overall Rating</p>
                              <div className="flex mt-1">{getRatingStars(Math.round(review.overallRating))}</div>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* KRAs/KPIs Summary */}
                      {((review.kras && review.kras.length > 0) || (review.kpis && review.kpis.length > 0)) && (
                        <div className="mt-4 pt-4 border-t border-gray-100">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {review.kras && review.kras.length > 0 && (
                              <div>
                                <p className="text-sm font-medium text-gray-700 mb-2">KRAs ({review.kras.length})</p>
                                <div className="space-y-1">
                                  {review.kras.slice(0, 2).map((kra, idx) => (
                                    <div key={idx} className="flex items-center justify-between text-sm">
                                      <span className="text-gray-600 truncate">{kra.title}</span>
                                      {kra.rating && (
                                        <span className="text-primary-600 font-medium ml-2">{kra.rating}/5</span>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            {review.kpis && review.kpis.length > 0 && (
                              <div>
                                <p className="text-sm font-medium text-gray-700 mb-2">KPIs ({review.kpis.length})</p>
                                <div className="space-y-1">
                                  {review.kpis.slice(0, 2).map((kpi, idx) => (
                                    <div key={idx} className="flex items-center justify-between text-sm">
                                      <span className="text-gray-600 truncate">{kpi.title}</span>
                                      <span className="text-primary-600 font-medium ml-2">
                                        {kpi.achieved}/{kpi.target} {kpi.unit}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
