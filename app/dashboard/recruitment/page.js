'use client'

import { useState, useEffect } from 'react'
import toast from '@/utils/toast'
import { useSocket, REALTIME_EVENTS } from '@/contexts/SocketContext'
import { FaPlus, FaBriefcase, FaMapMarkerAlt, FaClock } from 'react-icons/fa'

export default function RecruitmentPage() {
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)

  // Real-time updates
  const { socket, isConnected, subscribe } = useSocket()

  useEffect(() => {
    fetchJobs()
  }, [])

  // Subscribe to real-time recruitment updates
  useEffect(() => {
    if (!socket || !isConnected) return

    const handleRecruitmentUpdate = (data) => {
      console.log('🔄 [Recruitment] Real-time update received:', data)
      fetchJobs()
    }

    const unsub = subscribe?.(REALTIME_EVENTS.RECRUITMENT_UPDATE, handleRecruitmentUpdate)

    return () => {
      unsub?.()
    }
  }, [socket, isConnected])

  const fetchJobs = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/recruitment', {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      const data = await response.json()
      if (data.success) {
        setJobs(data.data)
      }
    } catch (error) {
      console.error('Fetch jobs error:', error)
      toast.error('Failed to fetch job postings')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page-container space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center space-y-3 sm:space-y-0">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-800">Recruitment</h1>
          <p className="text-gray-600 mt-1 text-sm sm:text-base">Manage job postings and candidates</p>
        </div>
        <button
          onClick={() => window.location.href = '/dashboard/recruitment/create'}
          className="btn-primary flex items-center justify-center space-x-2 w-full sm:w-auto"
        >
          <FaPlus className="w-4 h-4" />
          <span>Post Job</span>
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white rounded-lg shadow-md p-3 sm:p-6">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs sm:text-sm font-medium text-gray-600 truncate">Total Jobs</h3>
            <FaBriefcase className="text-primary-500 flex-shrink-0" />
          </div>
          <div className="text-2xl sm:text-3xl font-bold text-gray-800">{jobs.length}</div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-3 sm:p-6">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs sm:text-sm font-medium text-gray-600 truncate">Active Jobs</h3>
            <FaBriefcase className="text-green-500 flex-shrink-0" />
          </div>
          <div className="text-2xl sm:text-3xl font-bold text-gray-800">
            {jobs.filter(j => j.status === 'open').length}
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-gray-600">Total Applicants</h3>
            <FaBriefcase className="text-blue-500" />
          </div>
          <div className="text-3xl font-bold text-gray-800">
            {jobs.reduce((sum, job) => sum + (job.applicants?.length || 0), 0)}
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-gray-600">Hired</h3>
            <FaBriefcase className="text-purple-500" />
          </div>
          <div className="text-3xl font-bold text-gray-800">
            {jobs.filter(j => j.status === 'closed').length}
          </div>
        </div>
      </div>

      {/* Job Listings */}
      <div className="bg-white rounded-lg shadow-md overflow-hidden">
        <div className="p-4 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-800">Job Postings</h2>
        </div>

        {loading ? (
          <div className="p-8 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500 mx-auto"></div>
            <p className="mt-4 text-gray-600">Loading jobs...</p>
          </div>
        ) : jobs.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            No job postings found
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {jobs.map((job) => (
              <div key={job._id} className="p-6 hover:bg-gray-50 cursor-pointer">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-gray-800 mb-2">
                      {job.jobTitle}
                    </h3>
                    <div className="flex flex-wrap gap-4 text-sm text-gray-600 mb-3">
                      <div className="flex items-center space-x-1">
                        <FaBriefcase />
                        <span>{job.department?.name || 'N/A'}</span>
                      </div>
                      <div className="flex items-center space-x-1">
                        <FaMapMarkerAlt />
                        <span>{job.location || 'N/A'}</span>
                      </div>
                      <div className="flex items-center space-x-1">
                        <FaClock />
                        <span>{job.employmentType || 'Full-time'}</span>
                      </div>
                    </div>
                    <p className="text-sm text-gray-600 line-clamp-2">
                      {job.description}
                    </p>
                  </div>
                  <div className="ml-4 flex flex-col items-end space-y-2">
                    <span className={`px-3 py-1 text-xs font-semibold rounded-full ${
                      job.status === 'open' ? 'bg-green-100 text-green-800' :
                      job.status === 'closed' ? 'bg-gray-100 text-gray-800' :
                      'bg-yellow-100 text-yellow-800'
                    }`}>
                      {job.status}
                    </span>
                    <span className="text-sm text-gray-600">
                      {job.applicants?.length || 0} applicants
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

