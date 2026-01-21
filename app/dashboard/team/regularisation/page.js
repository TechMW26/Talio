'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import toast from '@/utils/toast'
import { FaCheck, FaTimes, FaCalendarCheck, FaExclamationCircle, FaChevronDown, FaChevronUp, FaFilter, FaBuilding } from 'react-icons/fa'
import Loader from '@/components/ui/Loader'

export default function TeamRegularisationPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState(null)
  const [hasAccess, setHasAccess] = useState(false)
  const [pendingCorrections, setPendingCorrections] = useState([])
  const [allCorrections, setAllCorrections] = useState([])
  const [processingCorrection, setProcessingCorrection] = useState(null)
  const [expandedCards, setExpandedCards] = useState({})
  const [statusFilter, setStatusFilter] = useState('pending')
  const [departments, setDepartments] = useState([])
  const [selectedDepartment, setSelectedDepartment] = useState('all')

  useEffect(() => {
    const userData = localStorage.getItem('user')
    if (userData) {
      const parsedUser = JSON.parse(userData)
      setUser(parsedUser)
      checkAccess(parsedUser)
    }
  }, [])

  const checkAccess = async (currentUser) => {
    try {
      // Admin and HR have full access
      if (['admin', 'hr'].includes(currentUser?.role)) {
        setHasAccess(true)
        fetchDepartments()
        fetchCorrections()
        return
      }

      // Check for department head status
      const token = localStorage.getItem('token')
      const response = await fetch('/api/team/check-head', {
        headers: { 'Authorization': `Bearer ${token}` }
      })

      const data = await response.json()
      
      if (data.success && data.isDepartmentHead) {
        setHasAccess(true)
        fetchCorrections()
      } else {
        setHasAccess(false)
        setLoading(false)
      }
    } catch (error) {
      console.error('Error checking access:', error)
      setLoading(false)
    }
  }

  const fetchDepartments = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/departments', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await response.json()
      if (data.success) {
        setDepartments(data.data || [])
      }
    } catch (error) {
      console.error('Error fetching departments:', error)
    }
  }

  const fetchCorrections = async () => {
    try {
      const token = localStorage.getItem('token')
      
      // Build query params
      let queryParams = 'type=pending'
      if (selectedDepartment && selectedDepartment !== 'all') {
        queryParams += `&department=${selectedDepartment}`
      }
      
      // Fetch pending corrections
      const pendingResponse = await fetch(`/api/attendance/corrections?${queryParams}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const pendingData = await pendingResponse.json()
      
      // Fetch all corrections for history
      let allQueryParams = 'type=all'
      if (selectedDepartment && selectedDepartment !== 'all') {
        allQueryParams += `&department=${selectedDepartment}`
      }
      const allResponse = await fetch(`/api/attendance/corrections?${allQueryParams}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const allData = await allResponse.json()
      
      if (pendingData.success) {
        setPendingCorrections(pendingData.data)
      }
      if (allData.success) {
        setAllCorrections(allData.data)
      }
    } catch (error) {
      console.error('Fetch corrections error:', error)
    } finally {
      setLoading(false)
    }
  }

  // Refetch when department filter changes
  useEffect(() => {
    if (hasAccess) {
      setLoading(true)
      fetchCorrections()
    }
  }, [selectedDepartment])

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
        toast.success(`Correction ${action}d successfully`)
        fetchCorrections()
      } else {
        toast.error(data.message || `Failed to ${action} correction`)
      }
    } catch (error) {
      console.error(`${action} correction error:`, error)
      toast.error(`Failed to ${action} correction`)
    } finally {
      setProcessingCorrection(null)
    }
  }

  const formatTime = (dateString, { timeZone } = {}) => {
    if (!dateString) return 'N/A'
    return new Date(dateString).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      ...(timeZone ? { timeZone } : {})
    })
  }

  const formatRequestedTime = (dateString) => formatTime(dateString, { timeZone: 'UTC' })

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  const toggleCard = (id) => {
    setExpandedCards(prev => ({
      ...prev,
      [id]: !prev[id]
    }))
  }

  const getFilteredCorrections = () => {
    if (statusFilter === 'pending') {
      return pendingCorrections
    }
    return allCorrections.filter(c => statusFilter === 'all' || c.status === statusFilter)
  }

  const getStatusBadge = (status) => {
    switch (status) {
      case 'pending':
        return 'bg-yellow-100 text-yellow-800 border-yellow-300'
      case 'approved':
        return 'bg-green-100 text-green-800 border-green-300'
      case 'rejected':
        return 'bg-red-100 text-red-800 border-red-300'
      default:
        return 'bg-gray-100 text-gray-800 border-gray-300'
    }
  }

  const isAdminOrHR = ['admin', 'hr'].includes(user?.role)

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center pb-14 md:pb-6">
        <Loader size="lg" />
      </div>
    )
  }

  if (!hasAccess) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 py-4 sm:p-6 lg:p-8 pb-14 md:pb-6">
        <div className="text-center">
          <FaExclamationCircle className="mx-auto h-12 w-12 text-yellow-500 mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Access Restricted</h2>
          <p className="text-gray-600">This section is only available to admins, HR, and department heads.</p>
        </div>
      </div>
    )
  }

  const filteredCorrections = getFilteredCorrections()

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-4 sm:p-6 lg:p-8 pb-14 md:pb-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Attendance Regularisation</h1>
          <p className="text-gray-600 mt-1">
            Review and approve attendance correction requests {isAdminOrHR ? 'across all departments' : 'from your team'}
          </p>
        </div>
        
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Department filter - only for admin/HR */}
          {isAdminOrHR && departments.length > 0 && (
            <div className="flex items-center space-x-2">
              <FaBuilding className="text-gray-400" />
              <select
                value={selectedDepartment}
                onChange={(e) => setSelectedDepartment(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="all">All Departments</option>
                {departments.map(dept => (
                  <option key={dept._id} value={dept._id}>{dept.name}</option>
                ))}
              </select>
            </div>
          )}
          
          {/* Status filter */}
          <div className="flex items-center space-x-2">
            <FaFilter className="text-gray-400" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
            >
              <option value="pending">Pending ({pendingCorrections.length})</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="all">All Requests</option>
            </select>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-yellow-50 rounded-lg shadow p-6 border border-yellow-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-yellow-700">Pending Requests</p>
              <p className="text-3xl font-bold text-yellow-600 mt-1">
                {pendingCorrections.length}
              </p>
            </div>
            <div className="bg-yellow-100 p-3 rounded-lg">
              <FaCalendarCheck className="h-6 w-6 text-yellow-600" />
            </div>
          </div>
        </div>

        <div className="bg-green-50 rounded-lg shadow p-6 border border-green-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-green-700">Approved This Month</p>
              <p className="text-3xl font-bold text-green-600 mt-1">
                {allCorrections.filter(c => c.status === 'approved').length}
              </p>
            </div>
            <div className="bg-green-100 p-3 rounded-lg">
              <FaCheck className="h-6 w-6 text-green-600" />
            </div>
          </div>
        </div>

        <div className="bg-red-50 rounded-lg shadow p-6 border border-red-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-red-700">Rejected This Month</p>
              <p className="text-3xl font-bold text-red-600 mt-1">
                {allCorrections.filter(c => c.status === 'rejected').length}
              </p>
            </div>
            <div className="bg-red-100 p-3 rounded-lg">
              <FaTimes className="h-6 w-6 text-red-600" />
            </div>
          </div>
        </div>
      </div>

      {/* Corrections List */}
      {filteredCorrections.length === 0 ? (
        <div className="bg-white rounded-lg shadow-md p-12 text-center">
          <FaCalendarCheck className="mx-auto h-16 w-16 text-gray-300 mb-4" />
          <h3 className="text-xl font-semibold text-gray-700 mb-2">No Requests Found</h3>
          <p className="text-gray-500">
            {statusFilter === 'pending' 
              ? 'There are no pending attendance correction requests at the moment.'
              : `No ${statusFilter} requests found.`
            }
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredCorrections.map((correction) => (
            <div 
              key={correction._id} 
              className={`bg-white rounded-lg shadow-md border-l-4 overflow-hidden ${
                correction.status === 'pending' ? 'border-l-yellow-500' :
                correction.status === 'approved' ? 'border-l-green-500' :
                'border-l-red-500'
              }`}
            >
              {/* Header - Always visible */}
              <div 
                className="p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                onClick={() => toggleCard(correction._id)}
              >
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                  <div className="flex items-center space-x-4">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center text-white font-bold text-lg shadow-md">
                      {correction.employee?.firstName?.[0]}{correction.employee?.lastName?.[0]}
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900 text-lg">
                        {correction.employee?.firstName} {correction.employee?.lastName}
                      </h3>
                      <p className="text-sm text-gray-500">
                        {correction.employee?.designation?.title || 'Employee'} • {formatDate(correction.date)}
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-center space-x-3">
                    <span className={`px-3 py-1 rounded-full text-sm font-medium border ${getStatusBadge(correction.status)}`}>
                      {correction.status.charAt(0).toUpperCase() + correction.status.slice(1)}
                    </span>
                    <span className="px-3 py-1 bg-orange-100 text-orange-700 rounded-full text-sm font-medium capitalize">
                      {correction.correctionType?.replace('-', ' ')}
                    </span>
                    {expandedCards[correction._id] ? (
                      <FaChevronUp className="text-gray-400" />
                    ) : (
                      <FaChevronDown className="text-gray-400" />
                    )}
                  </div>
                </div>
              </div>

              {/* Expanded Details */}
              {expandedCards[correction._id] && (
                <div className="px-4 pb-4 pt-2 border-t border-gray-100 bg-gray-50">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                    {/* Current Record */}
                    <div className="bg-white rounded-lg p-4 border border-gray-200">
                      <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Current Record</h4>
                      <div className="space-y-1">
                        <p className="text-sm" style={{ color: '#111827' }}>
                          <span style={{ color: '#6b7280' }}>In:</span>{' '}
                          <span className="font-medium" style={{ color: '#111827' }}>{formatTime(correction.currentCheckIn)}</span>
                        </p>
                        <p className="text-sm" style={{ color: '#111827' }}>
                          <span style={{ color: '#6b7280' }}>Out:</span>{' '}
                          <span className="font-medium" style={{ color: '#111827' }}>{formatTime(correction.currentCheckOut)}</span>
                        </p>
                        <p className="text-sm" style={{ color: '#111827' }}>
                          <span style={{ color: '#6b7280' }}>Status:</span>{' '}
                          <span className="font-medium capitalize" style={{ color: '#111827' }}>{correction.currentStatus || 'N/A'}</span>
                        </p>
                      </div>
                    </div>

                    {/* Requested Changes */}
                    <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
                      <h4 className="text-xs font-semibold text-blue-600 uppercase mb-2">Requested Changes</h4>
                      <div className="space-y-1">
                        {correction.requestedCheckIn && (
                          <p className="text-sm">
                            <span className="text-blue-500">In:</span>{' '}
                            <span className="font-medium text-blue-800">{formatRequestedTime(correction.requestedCheckIn)}</span>
                          </p>
                        )}
                        {correction.requestedCheckOut && (
                          <p className="text-sm">
                            <span className="text-blue-500">Out:</span>{' '}
                            <span className="font-medium text-blue-800">{formatRequestedTime(correction.requestedCheckOut)}</span>
                          </p>
                        )}
                        {correction.requestedStatus && (
                          <p className="text-sm">
                            <span className="text-blue-500">Status:</span>{' '}
                            <span className="font-medium text-blue-800 capitalize">{correction.requestedStatus}</span>
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Reason */}
                    <div className="bg-yellow-50 rounded-lg p-4 border border-yellow-200">
                      <h4 className="text-xs font-semibold text-yellow-600 uppercase mb-2">Reason</h4>
                      <p className="text-sm text-gray-700 italic">&quot;{correction.reason}&quot;</p>
                      <p className="text-xs text-gray-400 mt-2">
                        Submitted: {new Date(correction.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </div>

                  {/* Reviewer comments if any */}
                  {correction.reviewerComments && (
                    <div className="bg-purple-50 rounded-lg p-4 border border-purple-200 mb-4">
                      <h4 className="text-xs font-semibold text-purple-600 uppercase mb-2">Reviewer Comments</h4>
                      <p className="text-sm text-gray-700">{correction.reviewerComments}</p>
                      <p className="text-xs text-gray-400 mt-2">
                        Reviewed by: {correction.reviewedBy?.firstName} {correction.reviewedBy?.lastName}
                      </p>
                    </div>
                  )}

                  {/* Action Buttons - Only for pending */}
                  {correction.status === 'pending' && (
                    <div className="flex justify-end space-x-3">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          const comment = prompt('Reason for rejection (optional):')
                          handleApproveReject(correction._id, 'reject', comment || '')
                        }}
                        disabled={processingCorrection === correction._id}
                        className="flex items-center space-x-2 px-5 py-2.5 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors disabled:opacity-50 shadow-md"
                      >
                        <FaTimes />
                        <span>Reject</span>
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleApproveReject(correction._id, 'approve')
                        }}
                        disabled={processingCorrection === correction._id}
                        className="flex items-center space-x-2 px-5 py-2.5 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors disabled:opacity-50 shadow-md"
                      >
                        <FaCheck />
                        <span>Approve</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
