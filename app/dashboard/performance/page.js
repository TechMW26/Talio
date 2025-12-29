'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSocket, REALTIME_EVENTS } from '@/contexts/SocketContext'
import toast from '@/utils/toast'
import {
  FaChartLine, FaUsers, FaPlus, FaEye, FaEdit, FaAward,
  FaStar, FaTrophy, FaBullseye, FaCalendarAlt
} from 'react-icons/fa'

export default function PerformancePage() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [performanceData, setPerformanceData] = useState({
    reviews: [],
    goals: [],
    stats: {
      totalReviews: 0,
      completedGoals: 0,
      averageRating: 0,
      pendingReviews: 0
    }
  })

  // Real-time updates
  const { socket, isConnected, subscribe, onPerformanceReview } = useSocket()

  useEffect(() => {
    const userData = localStorage.getItem('user')
    if (userData) {
      const parsedUser = JSON.parse(userData)
      setUser(parsedUser)
      fetchPerformanceData()
    }
  }, [])

  // Subscribe to real-time performance updates
  useEffect(() => {
    if (!socket || !isConnected) return

    const handlePerformanceUpdate = (data) => {
      console.log('🔄 [Performance] Real-time update received:', data)
      fetchPerformanceData()
    }

    const unsub1 = onPerformanceReview?.(handlePerformanceUpdate)
    const unsub2 = subscribe?.(REALTIME_EVENTS.PERFORMANCE_REVIEW, handlePerformanceUpdate)
    const unsub3 = subscribe?.(REALTIME_EVENTS.DAILY_GOAL_UPDATED, handlePerformanceUpdate)

    return () => {
      unsub1?.()
      unsub2?.()
      unsub3?.()
    }
  }, [socket, isConnected])

  const fetchPerformanceData = async () => {
    try {
      const token = localStorage.getItem('token')

      // Fetch reviews from API
      const reviewsResponse = await fetch('/api/performance/ratings', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      const reviewsData = await reviewsResponse.json()

      // Fetch goals from API
      const goalsResponse = await fetch('/api/performance/goals', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      const goalsData = await goalsResponse.json()

      const reviews = reviewsData.success ? reviewsData.data : []
      const goals = goalsData.success ? goalsData.data : []

      setPerformanceData({
        reviews,
        goals,
        stats: {
          totalReviews: reviews.length,
          completedGoals: goals.filter(g => g.status === 'completed').length,
          averageRating: reviews.length > 0
            ? (reviews.reduce((sum, r) => sum + (r.rating || 0), 0) / reviews.length).toFixed(1)
            : 0,
          pendingReviews: reviews.filter(r => r.status === 'pending').length
        }
      })
    } catch (error) {
      console.error('Fetch performance data error:', error)
      toast.error('Failed to fetch performance data')
    } finally {
      setLoading(false)
    }
  }

  const canManagePerformance = () => {
    return user && ['admin', 'hr', 'manager'].includes(user.role)
  }

  const getStatusColor = (status) => {
    switch (status) {
      case 'completed': return 'bg-green-100 text-green-800'
      case 'in-progress': return 'bg-blue-100 text-blue-800'
      case 'pending': return 'bg-yellow-100 text-yellow-800'
      case 'overdue': return 'bg-red-100 text-red-800'
      default: return 'bg-gray-100 text-gray-800'
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

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
      </div>
    )
  }

  return (
    <div className="p-6 pb-24 md:pb-6">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">Performance Management</h1>
          <p className="text-gray-600 mt-1">
            {user?.role === 'employee' ? 'Track your performance and goals' :
             user?.role === 'manager' ? 'Manage team performance and reviews' :
             'Track and manage organizational performance'}
          </p>
        </div>
        {canManagePerformance() && (
          <div className="flex space-x-3">
            <button
              onClick={() => router.push('/dashboard/team')}
              className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors flex items-center space-x-2"
            >
              <FaPlus className="w-4 h-4" />
              <span>New Rating</span>
            </button>
            <button
              onClick={() => router.push('/dashboard/performance/goals/create')}
              className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors flex items-center space-x-2"
            >
              <FaBullseye className="w-4 h-4" />
              <span>Set Goal</span>
            </button>
          </div>
        )}
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
        {[
          { title: 'Total Reviews', value: performanceData.stats.totalReviews, icon: FaChartLine, color: 'bg-blue-500' },
          { title: 'Completed Goals', value: performanceData.stats.completedGoals, icon: FaBullseye, color: 'bg-green-500' },
          { title: 'Average Rating', value: performanceData.stats.averageRating, icon: FaStar, color: 'bg-yellow-500' },
          { title: 'Pending Reviews', value: performanceData.stats.pendingReviews, icon: FaAward, color: 'bg-purple-500' },
        ].map((stat, index) => (
          <div key={index} className="bg-white rounded-lg shadow-md p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-500 text-sm font-medium">{stat.title}</p>
                <h3 className="text-2xl font-bold text-gray-900 mt-2">{stat.value}</h3>
              </div>
              <div className={`${stat.color} p-4 rounded-lg`}>
                <stat.icon className="w-6 h-6 text-white" />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-6">
        {[
          { name: 'Goals & Objectives', icon: FaBullseye, href: '/dashboard/performance/goals', color: 'bg-green-500' },
          { name: 'Employee Ratings', icon: FaStar, href: '/dashboard/performance/ratings', color: 'bg-yellow-500' },
          { name: 'Performance Reports', icon: FaTrophy, href: '/dashboard/performance/reports', color: 'bg-purple-500' },
        ].map((action, index) => (
          <button
            key={index}
            onClick={() => router.push(action.href)}
            className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow cursor-pointer text-left"
          >
            <div className="flex items-center space-x-4">
              <div className={`${action.color} p-3 rounded-lg`}>
                <action.icon className="w-6 h-6 text-white" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">{action.name}</h3>
                <p className="text-sm text-gray-500">Manage {action.name.toLowerCase()}</p>
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Reviews List */}
      <div className="bg-white rounded-lg shadow-md overflow-hidden">
        <div className="p-4 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-800">Performance Reviews</h2>
        </div>

        {loading ? (
          <div className="p-8 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500 mx-auto"></div>
            <p className="mt-4 text-gray-600">Loading reviews...</p>
          </div>
        ) : reviews.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            No performance reviews found
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {reviews.map((review) => (
              <div key={review._id} className="p-6 hover:bg-gray-50">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-800">
                      {review.reviewPeriod}
                    </h3>
                    <p className="text-sm text-gray-600">
                      Reviewed by: {review.reviewer?.firstName} {review.reviewer?.lastName}
                    </p>
                    <p className="text-sm text-gray-500">
                      {new Date(review.reviewDate).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                      })}
                    </p>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="text-2xl font-bold text-gray-800">
                      {review.overallRating?.toFixed(1)}
                    </span>
                    <div className="flex">
                      {renderStars(Math.round(review.overallRating || 0))}
                    </div>
                  </div>
                </div>

                {review.comments && (
                  <div className="mb-4">
                    <h4 className="text-sm font-medium text-gray-700 mb-2">Comments:</h4>
                    <p className="text-sm text-gray-600">{review.comments}</p>
                  </div>
                )}

                {review.strengths && review.strengths.length > 0 && (
                  <div className="mb-4">
                    <h4 className="text-sm font-medium text-gray-700 mb-2">Strengths:</h4>
                    <ul className="list-disc list-inside text-sm text-gray-600">
                      {review.strengths.map((strength, index) => (
                        <li key={index}>{strength}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {review.areasOfImprovement && review.areasOfImprovement.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium text-gray-700 mb-2">Areas of Improvement:</h4>
                    <ul className="list-disc list-inside text-sm text-gray-600">
                      {review.areasOfImprovement.map((area, index) => (
                        <li key={index}>{area}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

