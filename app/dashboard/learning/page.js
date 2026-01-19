'use client'

import { useState, useEffect } from 'react'
import { FaGraduationCap, FaBook, FaCertificate, FaClock, FaTrophy, FaUsers, FaChartLine } from 'react-icons/fa'
import { useRouter } from 'next/navigation'

export default function LearningDashboard() {
  const router = useRouter()
  const [stats, setStats] = useState({
    totalCourses: 0,
    enrolledCourses: 0,
    completedCourses: 0,
    certificates: 0,
    hoursLearned: 0
  })

  useEffect(() => {
    // Fetch learning stats
    setStats({
      totalCourses: 24,
      enrolledCourses: 5,
      completedCourses: 3,
      certificates: 2,
      hoursLearned: 48
    })
  }, [])

  const quickActions = [
    {
      title: 'Browse Courses',
      description: 'Explore available courses',
      icon: FaBook,
      color: 'blue',
      path: '/dashboard/learning/courses'
    },
    {
      title: 'My Trainings',
      description: 'View your enrolled trainings',
      icon: FaGraduationCap,
      color: 'green',
      path: '/dashboard/learning/trainings'
    },
    {
      title: 'Certificates',
      description: 'View your achievements',
      icon: FaCertificate,
      color: 'yellow',
      path: '/dashboard/learning/certificates'
    }
  ]

  const recentCourses = [
    {
      id: 1,
      title: 'Advanced JavaScript',
      progress: 75,
      duration: '12 hours',
      instructor: 'John Doe'
    },
    {
      id: 2,
      title: 'Project Management Basics',
      progress: 45,
      duration: '8 hours',
      instructor: 'Jane Smith'
    },
    {
      id: 3,
      title: 'Communication Skills',
      progress: 100,
      duration: '6 hours',
      instructor: 'Mike Johnson'
    }
  ]

  return (
    <div className="p-3 sm:p-6 pb-20 md:pb-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 flex items-center gap-2">
          <FaGraduationCap className="text-blue-600" />
          Learning Management System
        </h1>
        <p className="text-sm sm:text-base text-gray-600 mt-1">
          Enhance your skills and track your learning progress
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center justify-start mb-2">
            <h3 className="text-sm font-medium text-gray-600">Total Courses</h3>
            <FaBook className="text-blue-500 text-xl" />
          </div>
          <p className="text-3xl font-bold text-gray-800">{stats.totalCourses}</p>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center justify-start mb-2">
            <h3 className="text-sm font-medium text-gray-600">Enrolled</h3>
            <FaGraduationCap className="text-green-500 text-xl" />
          </div>
          <p className="text-3xl font-bold text-gray-800">{stats.enrolledCourses}</p>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center justify-start mb-2">
            <h3 className="text-sm font-medium text-gray-600">Completed</h3>
            <FaTrophy className="text-yellow-500 text-xl" />
          </div>
          <p className="text-3xl font-bold text-gray-800">{stats.completedCourses}</p>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center justify-start mb-2">
            <h3 className="text-sm font-medium text-gray-600">Certificates</h3>
            <FaCertificate className="text-purple-500 text-xl" />
          </div>
          <p className="text-3xl font-bold text-gray-800">{stats.certificates}</p>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center justify-start mb-2">
            <h3 className="text-sm font-medium text-gray-600">Hours Learned</h3>
            <FaClock className="text-red-500 text-xl" />
          </div>
          <p className="text-3xl font-bold text-gray-800">{stats.hoursLearned}</p>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        {quickActions.map((action, index) => (
          <button
            key={index}
            onClick={() => router.push(action.path)}
            className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow text-left"
          >
            <div className={`inline-flex p-3 rounded-lg mb-4 bg-${action.color}-100`}>
              <action.icon className={`text-2xl text-${action.color}-600`} />
            </div>
            <h3 className="text-lg font-semibold text-gray-800 mb-2">{action.title}</h3>
            <p className="text-sm text-gray-600">{action.description}</p>
          </button>
        ))}
      </div>

      {/* Recent Courses */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-xl font-bold text-gray-800 mb-4">Continue Learning</h2>
        <div className="space-y-4">
          {recentCourses.map((course) => (
            <div key={course.id} className="border rounded-lg p-4 hover:shadow-md transition-shadow">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h3 className="font-semibold text-gray-800">{course.title}</h3>
                  <p className="text-sm text-gray-600 mt-1">
                    Instructor: {course.instructor} • {course.duration}
                  </p>
                </div>
                <span className="text-sm font-medium text-blue-600">{course.progress}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all"
                  style={{ width: `${course.progress}%` }}
                ></div>
              </div>
              {course.progress === 100 && (
                <div className="mt-3">
                  <span className="inline-flex items-center gap-1 text-sm text-green-600 font-medium">
                    <FaTrophy /> Completed!
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
