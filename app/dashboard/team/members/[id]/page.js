'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import toast from '@/utils/toast'
import { Select, SelectItem, Button } from '@heroui/react'
import Loader from '@/components/ui/Loader'
import {
  FaArrowLeft, FaUser, FaEnvelope, FaPhone, FaCalendarAlt,
  FaBriefcase, FaStar, FaTasks, FaChartLine, FaComments,
  FaPaperPlane, FaExclamationCircle, FaCheckCircle, FaClock
} from 'react-icons/fa'
import { formatDesignation } from '@/lib/formatters'

export default function TeamMemberDetailsPage() {
  const router = useRouter()
  const params = useParams()
  const [loading, setLoading] = useState(true)
  const [memberData, setMemberData] = useState(null)
  const [showReviewForm, setShowReviewForm] = useState(false)
  const [reviewForm, setReviewForm] = useState({
    type: 'review',
    content: '',
    rating: 0,
    category: 'general'
  })

  useEffect(() => {
    if (params.id) {
      fetchMemberDetails()
    }
  }, [params.id])

  const fetchMemberDetails = async () => {
    try {
      setLoading(true)
      const token = localStorage.getItem('token')

      const response = await fetch(`/api/team/members/${params.id}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      const data = await response.json()
      if (data.success) {
        setMemberData(data.data)
      } else {
        toast.error(data.message || 'Failed to fetch member details')
      }
    } catch (error) {
      console.error('Error fetching member details:', error)
      toast.error('Failed to fetch member details')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmitReview = async () => {
    if (!reviewForm.content.trim()) {
      toast.error('Please enter review content')
      return
    }

    if (reviewForm.type === 'review' && reviewForm.rating === 0) {
      toast.error('Please select a rating')
      return
    }

    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/team/members/${params.id}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(reviewForm)
      })

      const data = await response.json()
      if (data.success) {
        toast.success(data.message)
        setShowReviewForm(false)
        setReviewForm({
          type: 'review',
          content: '',
          rating: 0,
          category: 'general'
        })
        fetchMemberDetails()
      } else {
        toast.error(data.message || 'Failed to add review')
      }
    } catch (error) {
      console.error('Error adding review:', error)
      toast.error('Failed to add review')
    }
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

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader size="lg" />
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

  const { employee, taskStats = { total: 0, in_progress: 0, review: 0, completed: 0 }, recentTasks = [] } = memberData || {}

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

          {/* Recent Tasks */}
          <div className="bg-white rounded-lg shadow-md p-4 sm:p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center">
              <FaClock className="mr-2" />
              Recent Tasks
            </h2>
            {recentTasks.length === 0 ? (
              <p className="text-gray-600 text-center py-4">No tasks assigned yet</p>
            ) : (
              <div className="space-y-3">
                {recentTasks.map((task) => (
                  <div key={task._id} className="border border-gray-200 rounded-lg p-3">
                    <div className="flex items-start justify-between mb-2">
                      <h3 className="font-medium text-gray-900 flex-1">{task.title}</h3>
                      <span className={`px-2 py-1 text-xs rounded capitalize ${getStatusColor(task.status)}`}>
                        {task.status.replace(/-/g, ' ')}
                      </span>
                    </div>
                    {task.project && (
                      <p className="text-xs text-gray-600 mb-1">
                        Project: {task.project.name}
                      </p>
                    )}
                    <div className="flex items-center justify-between text-xs text-gray-500">
                      <span>Assigned by: {task.assignedBy?.firstName || 'Unknown'} {task.assignedBy?.lastName || ''}</span>
                      {task.dueDate && (
                        <span>Due: {new Date(task.dueDate).toLocaleDateString()}</span>
                      )}
                    </div>
                  </div>
                ))}
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
              <button
                onClick={handleSubmitReview}
                className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center"
              >
                <FaPaperPlane className="mr-2" />
                Submit
              </button>
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

