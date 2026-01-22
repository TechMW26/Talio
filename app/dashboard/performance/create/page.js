'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import toast from '@/utils/toast'
import { FaStar, FaArrowLeft, FaSave } from 'react-icons/fa'
import { Select, SelectItem, Input, Button } from '@heroui/react'

export default function CreatePerformanceReviewPage() {
  const router = useRouter()
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [formData, setFormData] = useState({
    employee: '',
    reviewPeriod: {
      startDate: '',
      endDate: '',
    },
    ratings: {
      quality: 0,
      productivity: 0,
      communication: 0,
      teamwork: 0,
      initiative: 0,
    },
    strengths: '',
    areasOfImprovement: '',
    goals: '',
    comments: '',
  })

  useEffect(() => {
    fetchEmployees()
  }, [])

  const fetchEmployees = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/employees?limit=1000&status=active', {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      const data = await response.json()
      if (data.success) {
        setEmployees(data.data.filter(emp => emp.status === 'active'))
      }
    } catch (error) {
      console.error('Fetch employees error:', error)
      toast.error('Failed to fetch employees')
    } finally {
      setLoading(false)
    }
  }

  const handleRatingChange = (category, value) => {
    setFormData({
      ...formData,
      ratings: {
        ...formData.ratings,
        [category]: value,
      },
    })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSubmitting(true)

    try {
      const token = localStorage.getItem('token')
      const user = JSON.parse(localStorage.getItem('user'))

      const reviewData = {
        ...formData,
        reviewedBy: user.employeeId._id,
        reviewDate: new Date(),
      }

      const response = await fetch('/api/performance', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(reviewData),
      })

      const data = await response.json()

      if (data.success) {
        toast.success('Performance review created successfully!')
        router.push('/dashboard/performance')
      } else {
        toast.error(data.message || 'Failed to create review')
      }
    } catch (error) {
      console.error('Create review error:', error)
      toast.error('Failed to create review')
    } finally {
      setSubmitting(false)
    }
  }

  const RatingStars = ({ category, value }) => {
    return (
      <div className="flex items-center space-x-2">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            onClick={() => handleRatingChange(category, star)}
            className="focus:outline-none"
          >
            <FaStar
              className={`text-2xl ${
                star <= value ? 'text-yellow-400' : 'text-gray-300'
              }`}
            />
          </button>
        ))}
        <span className="text-sm text-gray-600 ml-2">{value}/5</span>
      </div>
    )
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">Create Performance Review</h1>
          <p className="text-gray-600 mt-1">Evaluate employee performance</p>
        </div>
        <button
          onClick={() => router.push('/dashboard/performance')}
          className="btn-secondary flex items-center space-x-2"
        >
          <FaArrowLeft />
          <span>Back</span>
        </button>
      </div>

      {/* Form */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <form onSubmit={handleSubmit}>
          {/* Employee Selection */}
          <div className="mb-8">
            <h2 className="text-xl font-bold text-gray-800 mb-4">Employee Information</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Select
                  label="Select Employee *"
                  isRequired
                  selectedKeys={formData.employee ? [formData.employee] : []}
                  onSelectionChange={(keys) => setFormData({ ...formData, employee: Array.from(keys)[0] || '' })}
                  placeholder="Select Employee"
                >
                  {employees.map((emp) => (
                    <SelectItem key={emp._id}>
                      {emp.firstName} {emp.lastName} - {emp.employeeCode}
                    </SelectItem>
                  ))}
                </Select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Review Period Start *
                </label>
                <input
                  type="date"
                  required
                  value={formData.reviewPeriod.startDate}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      reviewPeriod: { ...formData.reviewPeriod, startDate: e.target.value },
                    })
                  }
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Review Period End *
                </label>
                <input
                  type="date"
                  required
                  value={formData.reviewPeriod.endDate}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      reviewPeriod: { ...formData.reviewPeriod, endDate: e.target.value },
                    })
                  }
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>
            </div>
          </div>

          {/* Performance Ratings */}
          <div className="mb-8">
            <h2 className="text-xl font-bold text-gray-800 mb-4">Performance Ratings</h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                <div>
                  <h3 className="font-medium text-gray-800">Quality of Work</h3>
                  <p className="text-sm text-gray-600">Accuracy and thoroughness</p>
                </div>
                <RatingStars category="quality" value={formData.ratings.quality} />
              </div>

              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                <div>
                  <h3 className="font-medium text-gray-800">Productivity</h3>
                  <p className="text-sm text-gray-600">Efficiency and output</p>
                </div>
                <RatingStars category="productivity" value={formData.ratings.productivity} />
              </div>

              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                <div>
                  <h3 className="font-medium text-gray-800">Communication</h3>
                  <p className="text-sm text-gray-600">Clarity and effectiveness</p>
                </div>
                <RatingStars category="communication" value={formData.ratings.communication} />
              </div>

              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                <div>
                  <h3 className="font-medium text-gray-800">Teamwork</h3>
                  <p className="text-sm text-gray-600">Collaboration and cooperation</p>
                </div>
                <RatingStars category="teamwork" value={formData.ratings.teamwork} />
              </div>

              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                <div>
                  <h3 className="font-medium text-gray-800">Initiative</h3>
                  <p className="text-sm text-gray-600">Proactiveness and innovation</p>
                </div>
                <RatingStars category="initiative" value={formData.ratings.initiative} />
              </div>
            </div>
          </div>

          {/* Feedback */}
          <div className="mb-8">
            <h2 className="text-xl font-bold text-gray-800 mb-4">Detailed Feedback</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Strengths
                </label>
                <textarea
                  rows="3"
                  value={formData.strengths}
                  onChange={(e) => setFormData({ ...formData, strengths: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  placeholder="What are the employee's key strengths?"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Areas of Improvement
                </label>
                <textarea
                  rows="3"
                  value={formData.areasOfImprovement}
                  onChange={(e) =>
                    setFormData({ ...formData, areasOfImprovement: e.target.value })
                  }
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  placeholder="What areas need improvement?"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Goals for Next Period
                </label>
                <textarea
                  rows="3"
                  value={formData.goals}
                  onChange={(e) => setFormData({ ...formData, goals: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  placeholder="Set goals for the next review period"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Additional Comments
                </label>
                <textarea
                  rows="4"
                  value={formData.comments}
                  onChange={(e) => setFormData({ ...formData, comments: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  placeholder="Any additional comments or observations"
                />
              </div>
            </div>
          </div>

          {/* Submit Button */}
          <div className="flex justify-end space-x-4">
            <Button
              type="button"
              onPress={() => router.push('/dashboard/performance')}
              variant="flat"
              isDisabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              color="primary"
              startContent={<FaSave />}
              isDisabled={submitting}
            >
              {submitting ? 'Creating...' : 'Create Review'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

