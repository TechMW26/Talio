'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import toast from '@/utils/toast'
import { FaPlus, FaEye, FaEdit, FaTrash, FaStar, FaSearch, FaFilter, FaUser } from 'react-icons/fa'
import Loader from '@/components/ui/Loader'

export default function EmployeeRatingsPage() {
  const router = useRouter()
  const [ratings, setRatings] = useState([])
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [filterCategory, setFilterCategory] = useState('all')

  useEffect(() => {
    const userData = localStorage.getItem('user')
    if (userData) {
      const parsedUser = JSON.parse(userData)
      setUser(parsedUser)
      fetchRatings()
    }
  }, [])

  const fetchRatings = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/performance/ratings', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await response.json()
      
      if (data.success) {
        setRatings(data.data)
      } else {
        toast.error(data.message || 'Failed to fetch ratings')
      }
    } catch (error) {
      console.error('Fetch ratings error:', error)
      toast.error('Failed to fetch employee ratings')
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (ratingId) => {
    if (!confirm('Are you sure you want to delete this rating?')) return

    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/performance/ratings?id=${ratingId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      const data = await response.json()

      if (data.success) {
        setRatings(ratings.filter(r => r._id !== ratingId))
        toast.success('Rating deleted successfully')
      } else {
        toast.error(data.message || 'Failed to delete rating')
      }
    } catch (error) {
      console.error('Delete rating error:', error)
      toast.error('Failed to delete rating')
    }
  }

  const canManageRatings = () => {
    return user && ['admin', 'hr', 'manager', 'department_head'].includes(user.role)
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

  const getRatingColor = (rating) => {
    if (rating >= 4.5) return 'text-green-600'
    if (rating >= 3.5) return 'text-blue-600'
    if (rating >= 2.5) return 'text-yellow-600'
    return 'text-red-600'
  }

  const filteredRatings = ratings.filter(rating => {
    const matchesSearch = searchTerm === '' || 
      `${rating.employee.firstName} ${rating.employee.lastName}`.toLowerCase().includes(searchTerm.toLowerCase()) ||
      rating.employee.employeeCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
      rating.employee.department.toLowerCase().includes(searchTerm.toLowerCase())
    
    const matchesFilter = filterCategory === 'all' || rating.category === filterCategory
    
    return matchesSearch && matchesFilter
  })

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader size="lg" />
      </div>
    )
  }

  return (
    <div className="p-6 pb-24 md:pb-6">
      {/* Header */}
      <div className="flex md:justify-between md:items-center md:flex-row flex-col mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">Employee Ratings</h1>
          <p className="text-gray-600 mt-1">Manage employee performance ratings and reviews</p>
        </div>

      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
        {[
          { 
            title: 'Total Reviews', 
            value: ratings.length, 
            color: 'bg-blue-500',
            icon: FaUser
          },
          { 
            title: 'Average Rating', 
            value: ratings.filter(r => r.rating > 0).length > 0 
              ? (ratings.filter(r => r.rating > 0).reduce((sum, r) => sum + r.rating, 0) / ratings.filter(r => r.rating > 0).length).toFixed(1) 
              : '0.0', 
            color: 'bg-green-500',
            icon: FaStar
          },
          { 
            title: 'High Performers', 
            value: ratings.filter(r => r.rating >= 4.5).length, 
            color: 'bg-yellow-500',
            icon: FaStar
          },
          { 
            title: 'This Month', 
            value: ratings.filter(r => {
              const date = new Date(r.createdAt)
              const now = new Date()
              return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear()
            }).length, 
            color: 'bg-purple-500',
            icon: FaUser
          },
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

      {/* Filters */}
      <div className="bg-white rounded-lg shadow-md p-4 mb-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between space-y-4 md:space-y-0">
          <div className="flex items-center space-x-4">
            <div className="relative">
              <FaSearch className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <input
                type="text"
                placeholder="Search employees..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>
            <div className="flex items-center space-x-2">
              <FaFilter className="text-gray-400 w-4 h-4" />
              <select
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent capitalize"
              >
                <option value="all">All Categories</option>
                <option value="performance">Performance</option>
                <option value="behavior">Behavior</option>
                <option value="skills">Skills</option>
                <option value="general">General</option>
              </select>
            </div>
          </div>
          <div className="text-sm text-gray-500">
            {filteredRatings.length} review{filteredRatings.length !== 1 ? 's' : ''} found
          </div>
        </div>
      </div>

      {/* Ratings List */}
      {filteredRatings.length === 0 ? (
        <div className="bg-white rounded-lg shadow-md p-8 text-center">
          <FaStar className="w-16 h-16 mx-auto mb-4 text-gray-300" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No ratings found</h3>
          <p className="text-gray-500">
            {canManageRatings() ? 'Go to Team Dashboard to add reviews.' : 'No employee ratings have been created yet.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredRatings.map((rating) => (
            <div key={rating._id} className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow">
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-start space-x-4">
                  <div className="w-12 h-12 bg-primary-500 rounded-full flex items-center justify-center text-white font-semibold overflow-hidden">
                    {rating.employee.profilePicture ? (
                      <img src={rating.employee.profilePicture} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span>{rating.employee.firstName.charAt(0)}{rating.employee.lastName.charAt(0)}</span>
                    )}
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">
                      {rating.employee.firstName} {rating.employee.lastName}
                    </h3>
                    <p className="text-sm text-gray-500">{rating.employee.employeeCode}</p>
                    <p className="text-sm text-gray-600">{rating.employee.department}</p>
                    <p className="text-xs text-gray-400 mt-1 capitalize">{rating.type} • {rating.category}</p>
                  </div>
                </div>
                <div className="flex items-center space-x-3">
                  <div className="text-right">
                    {rating.rating > 0 && (
                      <div className="flex items-center space-x-2 mb-1">
                        <div className="flex">{getRatingStars(rating.rating)}</div>
                        <span className={`text-lg font-bold ${getRatingColor(rating.rating)}`}>
                          {rating.rating}
                        </span>
                      </div>
                    )}
                    <span className="text-xs text-gray-500">
                      {new Date(rating.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mb-4 bg-gray-50 p-4 rounded-lg">
                <p className="text-gray-700 whitespace-pre-wrap">{rating.content}</p>
              </div>

              <div className="flex justify-between items-center text-sm text-gray-500 pt-3 border-t border-gray-100">
                <div className="flex items-center space-x-2">
                  <span>Rated by:</span>
                  <span className="font-medium text-gray-700">
                    {rating.rater.firstName} {rating.rater.lastName}
                  </span>
                </div>
                {canManageRatings() && (
                  <button
                    onClick={() => router.push(`/dashboard/team/members/${rating.employee._id}`)}
                    className="text-primary-600 hover:text-primary-800 text-xs font-medium"
                  >
                    View Profile
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
