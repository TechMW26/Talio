'use client'

import { useState, useEffect } from 'react'
import { FaPlay, FaCheckCircle, FaClock, FaTrophy, FaBook, FaChartLine } from 'react-icons/fa'
import toast from '@/utils/toast'
import { useIsMobile } from '@/components/MobileApp'
import MobileTrainings from '@/components/MobileApp/pages/MobileTrainings'

export default function TrainingsPage() {
  const { isMobile, mounted } = useIsMobile()
  const [trainings, setTrainings] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all') // all, in-progress, completed
  const [user, setUser] = useState(null)

  useEffect(() => {
    const userData = localStorage.getItem('user')
    if (userData) {
      setUser(JSON.parse(userData))
    }
    fetchTrainings()
  }, [])

  const fetchTrainings = async () => {
    try {
      // Mock data - replace with actual API call
      const mockTrainings = [
        {
          id: 1,
          courseId: 2,
          title: 'Project Management Fundamentals',
          instructor: 'Jane Smith',
          enrolledDate: '2024-01-15',
          progress: 75,
          totalLessons: 12,
          completedLessons: 9,
          duration: '8 hours',
          estimatedCompletion: '2024-02-10',
          status: 'in-progress',
          lastAccessed: '2 hours ago'
        },
        {
          id: 2,
          courseId: 3,
          title: 'Effective Communication Skills',
          instructor: 'Mike Johnson',
          enrolledDate: '2024-01-20',
          progress: 100,
          totalLessons: 10,
          completedLessons: 10,
          duration: '6 hours',
          completedDate: '2024-01-28',
          status: 'completed',
          certificateId: 'CERT-2024-001'
        },
        {
          id: 3,
          courseId: 5,
          title: 'Leadership & Team Building',
          instructor: 'Robert Brown',
          enrolledDate: '2024-01-25',
          progress: 40,
          totalLessons: 15,
          completedLessons: 6,
          duration: '10 hours',
          estimatedCompletion: '2024-02-20',
          status: 'in-progress',
          lastAccessed: '1 day ago'
        },
        {
          id: 4,
          courseId: 1,
          title: 'Advanced JavaScript Programming',
          instructor: 'John Doe',
          enrolledDate: '2024-02-01',
          progress: 15,
          totalLessons: 20,
          completedLessons: 3,
          duration: '12 hours',
          estimatedCompletion: '2024-03-01',
          status: 'in-progress',
          lastAccessed: '3 hours ago'
        }
      ]

      setTrainings(mockTrainings)
    } catch (error) {
      console.error('Error fetching trainings:', error)
      toast.error('Failed to load trainings')
    } finally {
      setLoading(false)
    }
  }

  const filteredTrainings = trainings.filter(training => {
    if (filter === 'all') return true
    return training.status === filter
  })

  const stats = {
    total: trainings.length,
    inProgress: trainings.filter(t => t.status === 'in-progress').length,
    completed: trainings.filter(t => t.status === 'completed').length,
    avgProgress: trainings.length > 0
      ? Math.round(trainings.reduce((sum, t) => sum + t.progress, 0) / trainings.length)
      : 0
  }

  const handleContinue = (trainingId) => {
    toast.success('Resuming course...')
    // Navigate to course player
  }

  const handleViewCertificate = (certificateId) => {
    toast.success('Opening certificate...')
    // Navigate to certificate view
  }

  // Show loading state while detecting device
  if (!mounted) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  // Show mobile trainings on mobile devices
  if (isMobile) {
    return <MobileTrainings user={user} trainings={trainings} stats={stats} />
  }

  return (
    <div className="p-3 sm:p-6 pb-20 md:pb-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 flex items-center gap-2">
          <FaBook className="text-blue-600" />
          My Trainings
        </h1>
        <p className="text-sm sm:text-base text-gray-600 mt-1">
          Track your learning progress and continue where you left off
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-gradient-to-br from-blue-500 to-blue-600 text-white rounded-lg p-4 shadow-md">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm opacity-90">Total Enrolled</p>
              <p className="text-3xl font-bold mt-1">{stats.total}</p>
            </div>
            <FaBook className="text-4xl opacity-30" />
          </div>
        </div>

        <div className="bg-gradient-to-br from-yellow-500 to-yellow-600 text-white rounded-lg p-4 shadow-md">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm opacity-90">In Progress</p>
              <p className="text-3xl font-bold mt-1">{stats.inProgress}</p>
            </div>
            <FaClock className="text-4xl opacity-30" />
          </div>
        </div>

        <div className="bg-gradient-to-br from-green-500 to-green-600 text-white rounded-lg p-4 shadow-md">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm opacity-90">Completed</p>
              <p className="text-3xl font-bold mt-1">{stats.completed}</p>
            </div>
            <FaCheckCircle className="text-4xl opacity-30" />
          </div>
        </div>

        <div className="bg-gradient-to-br from-purple-500 to-purple-600 text-white rounded-lg p-4 shadow-md">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm opacity-90">Avg Progress</p>
              <p className="text-3xl font-bold mt-1">{stats.avgProgress}%</p>
            </div>
            <FaChartLine className="text-4xl opacity-30" />
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="bg-white rounded-lg shadow-md p-3 sm:p-4 mb-6">
        <div className="flex gap-2 overflow-x-auto scrollbar-hide sm:flex-wrap">
          <button
            onClick={() => setFilter('all')}
            className={`flex-shrink-0 px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-sm sm:text-base font-medium transition-colors ${filter === 'all'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
          >
            All ({stats.total})
          </button>

          <button
            onClick={() => setFilter('in-progress')}
            className={`flex-shrink-0 px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-sm sm:text-base font-medium transition-colors ${filter === 'in-progress'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
          >
            In Progress ({stats.inProgress})
          </button>

          <button
            onClick={() => setFilter('completed')}
            className={`flex-shrink-0 px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-sm sm:text-base font-medium transition-colors ${filter === 'completed'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
          >
            Completed ({stats.completed})
          </button>
        </div>
      </div>


      {/* Trainings List */}
      {loading ? (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="text-gray-600 mt-4">Loading trainings...</p>
        </div>
      ) : filteredTrainings.length === 0 ? (
        <div className="bg-white rounded-lg shadow-md p-12 text-center">
          <FaBook className="text-6xl text-gray-300 mx-auto mb-4" />
          <p className="text-gray-600 text-lg">No trainings found</p>
          <p className="text-gray-500 text-sm mt-2">
            {filter === 'all'
              ? 'Browse the course library to enroll in new courses'
              : `You don't have any ${filter.replace('-', ' ')} trainings`
            }
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredTrainings.map((training) => (
            <div key={training.id} className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow">
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                {/* Training Info */}
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-lg font-bold text-gray-800">{training.title}</h3>
                    {training.status === 'completed' && (
                      <span className="flex items-center gap-1 px-3 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                        <FaCheckCircle />
                        Completed
                      </span>
                    )}
                  </div>

                  <p className="text-sm text-gray-600 mb-3">
                    Instructor: <span className="font-medium">{training.instructor}</span>
                  </p>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm text-gray-600 mb-4">
                    <div>
                      <span className="text-gray-500">Enrolled:</span>
                      <p className="font-medium">{new Date(training.enrolledDate).toLocaleDateString()}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Duration:</span>
                      <p className="font-medium">{training.duration}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Lessons:</span>
                      <p className="font-medium">{training.completedLessons}/{training.totalLessons}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">
                        {training.status === 'completed' ? 'Completed:' : 'Last Active:'}
                      </span>
                      <p className="font-medium">
                        {training.status === 'completed'
                          ? new Date(training.completedDate).toLocaleDateString()
                          : training.lastAccessed
                        }
                      </p>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="mb-2">
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-600">Progress</span>
                      <span className="font-medium text-blue-600">{training.progress}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full ${training.progress === 100 ? 'bg-green-500' : 'bg-blue-600'
                          }`}
                        style={{ width: `${training.progress}%` }}
                      />
                    </div>
                  </div>

                  {training.status === 'in-progress' && training.estimatedCompletion && (
                    <p className="text-xs text-gray-500">
                      Estimated completion: {new Date(training.estimatedCompletion).toLocaleDateString()}
                    </p>
                  )}
                </div>

                {/* Action Buttons */}
                <div className="flex flex-col gap-2 lg:w-48">
                  {training.status === 'completed' ? (
                    <>
                      <button
                        onClick={() => handleViewCertificate(training.certificateId)}
                        className="flex items-center justify-center gap-2 px-4 py-2 bg-gradient-to-r from-yellow-500 to-yellow-600 text-white rounded-lg hover:from-yellow-600 hover:to-yellow-700"
                      >
                        <FaTrophy />
                        View Certificate
                      </button>
                      <button
                        onClick={() => handleContinue(training.id)}
                        className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
                      >
                        Review Course
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => handleContinue(training.id)}
                      className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                    >
                      <FaPlay />
                      Continue Learning
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
