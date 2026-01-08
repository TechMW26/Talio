'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { FaUsers, FaFileAlt, FaCheckCircle, FaClock, FaExclamationCircle, FaEdit, FaCheck, FaTimes, FaCalendarCheck } from 'react-icons/fa'
import Loader from '@/components/ui/Loader'

export default function TeamDashboard() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [isDepartmentHead, setIsDepartmentHead] = useState(false)
  const [teamData, setTeamData] = useState(null)
  const [pendingCorrections, setPendingCorrections] = useState([])
  const [showPendingApprovals, setShowPendingApprovals] = useState(false)
  const [processingCorrection, setProcessingCorrection] = useState(null)

  useEffect(() => {
    checkDepartmentHead()
  }, [])

  const checkDepartmentHead = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/team/check-head', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      const data = await response.json()
      
      if (data.success && data.isDepartmentHead) {
        setIsDepartmentHead(true)
        fetchTeamData()
        fetchPendingCorrections()
      } else {
        setIsDepartmentHead(false)
        setLoading(false)
      }
    } catch (error) {
      console.error('Error checking department head:', error)
      setLoading(false)
    }
  }

  const fetchPendingCorrections = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/attendance/corrections?type=pending', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await response.json()
      if (data.success) {
        setPendingCorrections(data.data)
      }
    } catch (error) {
      console.error('Fetch pending corrections error:', error)
    }
  }

  const handleApproveReject = async (correctionId, action, comments = '') => {
    setProcessingCorrection(correctionId)
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/attendance/corrections', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          correctionId,
          action,
          reviewerComments: comments
        })
      })

      const data = await response.json()
      if (data.success) {
        fetchPendingCorrections()
        fetchTeamData() // Refresh team data to update counts
      }
    } catch (error) {
      console.error(`${action} correction error:`, error)
    } finally {
      setProcessingCorrection(null)
    }
  }

  const formatTime = (dateString) => {
    if (!dateString) return 'N/A'
    return new Date(dateString).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  const fetchTeamData = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/team/pending-requests', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      const data = await response.json()
      
      if (data.success) {
        setTeamData(data.data)
      }
    } catch (error) {
      console.error('Error fetching team data:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center pb-14 md:pb-6">
        <Loader size="lg" />
      </div>
    )
  }

  if (!isDepartmentHead) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 py-4 sm:p-6 lg:p-8 pb-14 md:pb-6">
        <div className="text-center">
          <FaExclamationCircle className="mx-auto h-12 w-12 text-yellow-500 mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Access Restricted</h2>
          <p className="text-gray-600">This section is only available to department heads.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-4 sm:p-6 lg:p-8 pb-14 md:pb-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Team Management</h1>
        <p className="text-gray-600 mt-1">
          {teamData?.department?.name} Department
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Team Members</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">
                {teamData?.teamMembersCount || 0}
              </p>
            </div>
            <div className="bg-blue-100 p-3 rounded-lg">
              <FaUsers className="h-6 w-6 text-blue-600" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Pending Tasks</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">
                {teamData?.pendingTasks || 0}
              </p>
            </div>
            <div className="bg-purple-100 p-3 rounded-lg">
              <FaFileAlt className="h-6 w-6 text-purple-600" />
            </div>
          </div>
        </div>

        <div 
          className="bg-white rounded-lg shadow p-6 cursor-pointer hover:shadow-lg transition-shadow"
          onClick={() => setShowPendingApprovals(!showPendingApprovals)}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Attendance Corrections</p>
              <p className="text-2xl font-bold text-orange-600 mt-1">
                {pendingCorrections.length}
              </p>
            </div>
            <div className="bg-orange-100 p-3 rounded-lg">
              <FaCalendarCheck className="h-6 w-6 text-orange-600" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Total Pending</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">
                {(teamData?.pendingTasks || 0) + pendingCorrections.length}
              </p>
            </div>
            <div className="bg-green-100 p-3 rounded-lg">
              <FaCheckCircle className="h-6 w-6 text-green-600" />
            </div>
          </div>
        </div>
      </div>

      {/* Attendance Regularisation Dashboard */}
      {showPendingApprovals && (
        <div className="bg-orange-50 rounded-lg shadow-md p-6 mb-6 border border-orange-200">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold text-orange-800">Attendance Regularisation Requests</h2>
            <button
              onClick={() => setShowPendingApprovals(false)}
              className="p-2 text-gray-500 hover:text-gray-700"
            >
              <FaTimes />
            </button>
          </div>
          
          {pendingCorrections.length === 0 ? (
            <div className="text-center py-8">
              <FaCalendarCheck className="mx-auto h-12 w-12 text-orange-300 mb-4" />
              <p className="text-gray-500">No pending attendance correction requests</p>
            </div>
          ) : (
            <div className="space-y-4">
              {pendingCorrections.map((correction) => (
                <div key={correction._id} className="bg-white rounded-lg p-4 border border-orange-100 shadow-sm">
                  <div className="flex flex-col md:flex-row justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center space-x-3 mb-2">
                        <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center">
                          <span className="text-orange-600 font-semibold">
                            {correction.employee?.firstName?.[0]}{correction.employee?.lastName?.[0]}
                          </span>
                        </div>
                        <div>
                          <p className="font-semibold text-gray-800">
                            {correction.employee?.firstName} {correction.employee?.lastName}
                          </p>
                          <p className="text-xs text-gray-500">
                            {correction.employee?.designation?.title || 'Employee'}
                          </p>
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                        <div className="bg-gray-50 rounded p-3">
                          <p className="text-xs text-gray-500 mb-1">Date & Type</p>
                          <p className="text-sm font-medium text-gray-800">
                            {formatDate(correction.date)}
                          </p>
                          <span className="inline-block mt-1 px-2 py-0.5 text-xs rounded-full bg-orange-100 text-orange-700 capitalize">
                            {correction.correctionType?.replace('-', ' ')}
                          </span>
                        </div>
                        
                        <div className="bg-gray-50 rounded p-3">
                          <p className="text-xs text-gray-500 mb-1">Current Record</p>
                          <p className="text-sm text-gray-700">
                            In: {formatTime(correction.currentCheckIn)} | Out: {formatTime(correction.currentCheckOut)}
                          </p>
                          <p className="text-xs text-gray-500 mt-1">Status: {correction.currentStatus || 'N/A'}</p>
                        </div>
                        
                        <div className="bg-blue-50 rounded p-3 md:col-span-2">
                          <p className="text-xs text-blue-600 mb-1">Requested Changes</p>
                          <p className="text-sm text-blue-800">
                            {correction.requestedCheckIn && `In: ${formatTime(correction.requestedCheckIn)}`}
                            {correction.requestedCheckIn && correction.requestedCheckOut && ' | '}
                            {correction.requestedCheckOut && `Out: ${formatTime(correction.requestedCheckOut)}`}
                            {correction.requestedStatus && ` | Status: ${correction.requestedStatus}`}
                          </p>
                        </div>
                      </div>
                      
                      <div className="mt-3 p-3 bg-yellow-50 rounded">
                        <p className="text-xs text-yellow-600 mb-1">Reason</p>
                        <p className="text-sm text-gray-700 italic">&quot;{correction.reason}&quot;</p>
                      </div>
                      
                      <p className="text-xs text-gray-400 mt-2">
                        Submitted: {new Date(correction.createdAt).toLocaleString()}
                      </p>
                    </div>
                    
                    <div className="flex md:flex-col justify-end gap-2 shrink-0">
                      <button
                        onClick={() => handleApproveReject(correction._id, 'approve')}
                        disabled={processingCorrection === correction._id}
                        className="flex items-center space-x-2 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors disabled:opacity-50"
                      >
                        <FaCheck />
                        <span>Approve</span>
                      </button>
                      <button
                        onClick={() => {
                          const comment = prompt('Reason for rejection (optional):')
                          handleApproveReject(correction._id, 'reject', comment || '')
                        }}
                        disabled={processingCorrection === correction._id}
                        className="flex items-center space-x-2 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors disabled:opacity-50"
                      >
                        <FaTimes />
                        <span>Reject</span>
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Quick Actions */}
      <div className="grid grid-cols-1 gap-6">
        {/* Task Approvals */}
        <div 
          onClick={() => router.push('/dashboard/team/task-approvals')}
          className="bg-white rounded-lg shadow p-6 cursor-pointer hover:shadow-lg transition-shadow"
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-gray-900">Project Approvals</h2>
            <div className="bg-purple-100 p-2 rounded-lg">
              <FaFileAlt className="h-5 w-5 text-purple-600" />
            </div>
          </div>
          <p className="text-gray-600 mb-4">
            Review and approve completed tasks from your team
          </p>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500">
              {teamData?.pendingTasks || 0} pending approvals
            </span>
            <button className="text-blue-600 hover:text-blue-700 font-medium text-sm">
              View All →
            </button>
          </div>
        </div>
      </div>

      {/* Recent Activity */}
      {teamData?.recentTasks?.length > 0 && (
        <div className="mt-6 bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Recent Pending Items</h2>
          
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Project Approvals</h3>
            <div className="space-y-2">
              {teamData.recentTasks.map((task) => (
                <div key={task._id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center space-x-3">
                    <div className="bg-purple-100 p-2 rounded-full">
                      <FaFileAlt className="h-4 w-4 text-purple-600" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {task.title}
                      </p>
                      <p className="text-xs text-gray-500">
                        Assigned by: {task.assignedBy?.firstName} {task.assignedBy?.lastName}
                      </p>
                    </div>
                  </div>
                  <span className="text-xs text-gray-500">
                    {new Date(task.updatedAt).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

