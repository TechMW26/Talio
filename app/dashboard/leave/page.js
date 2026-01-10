'use client'

import { useState, useEffect, useCallback } from 'react'
import toast from '@/utils/toast'
import { useSocket, REALTIME_EVENTS } from '@/contexts/SocketContext'
import { FaPlus, FaCalendarAlt, FaCheckCircle, FaTimesCircle, FaClock } from 'react-icons/fa'
import { getCurrentUser, getEmployeeId } from '@/utils/userHelper'

export default function LeavePage() {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])
  const [leaves, setLeaves] = useState([])
  const [leaveBalance, setLeaveBalance] = useState([])
  const [leaveTypes, setLeaveTypes] = useState([])
  const [loading, setLoading] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [user, setUser] = useState(null)
  const [employeeId, setEmployeeId] = useState(null)
  const [formData, setFormData] = useState({
    leaveType: '',
    startDate: '',
    endDate: '',
    reason: '',
    isHalfDay: false,
  })

  // Real-time updates
  const { socket, isConnected, onLeaveStatusUpdate, onLeaveRequest, subscribe } = useSocket()

  // Subscribe to real-time leave updates
  useEffect(() => {
    if (!socket || !isConnected || !employeeId) return

    const handleLeaveUpdate = (data) => {
      console.log('🔄 [Leave] Real-time update received:', data)
      fetchLeaves(employeeId)
      fetchLeaveBalance(employeeId)
    }

    const unsub1 = onLeaveStatusUpdate?.(handleLeaveUpdate)
    const unsub2 = onLeaveRequest?.(handleLeaveUpdate)
    const unsub3 = subscribe?.(REALTIME_EVENTS.LEAVE_CANCELLED, handleLeaveUpdate)

    return () => {
      unsub1?.()
      unsub2?.()
      unsub3?.()
    }
  }, [socket, isConnected, employeeId])

  useEffect(() => {
    const parsedUser = getCurrentUser()
    if (parsedUser) {
      setUser(parsedUser)
      const empId = getEmployeeId(parsedUser)
      setEmployeeId(empId)
      if (empId) {
        fetchLeaves(empId)
        fetchLeaveBalance(empId)
        fetchLeaveTypes()
      } else {
        toast.error('Employee information not found. Please logout and login again.')
      }
    }
  }, [])

  const fetchLeaves = async (employeeId) => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/leave?employeeId=${employeeId}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      const data = await response.json()
      if (data.success) {
        setLeaves(data.data)
      }
    } catch (error) {
      console.error('Fetch leaves error:', error)
    }
  }

  const fetchLeaveBalance = async (employeeId) => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/leave/balance?employeeId=${employeeId}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      const data = await response.json()
      if (data.success) {
        setLeaveBalance(data.data)
      }
    } catch (error) {
      console.error('Fetch leave balance error:', error)
    }
  }

  const fetchLeaveTypes = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/leave/types', {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      const data = await response.json()
      if (data.success) {
        setLeaveTypes(data.data)
      }
    } catch (error) {
      console.error('Fetch leave types error:', error)
    }
  }

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target
    setFormData({
      ...formData,
      [name]: type === 'checkbox' ? checked : value,
    })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!user) return

    setLoading(true)

    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/leave', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          ...formData,
          employee: employeeId,
        }),
      })

      const data = await response.json()

      if (data.success) {
        toast.success('Leave request submitted successfully')
        setShowModal(false)
        setFormData({
          leaveType: '',
          startDate: '',
          endDate: '',
          reason: '',
          isHalfDay: false,
        })
        fetchLeaves(employeeId)
        fetchLeaveBalance(employeeId)
      } else {
        toast.error(data.message || 'Failed to submit leave request')
      }
    } catch (error) {
      console.error('Submit leave error:', error)
      toast.error('An error occurred while submitting leave request')
    } finally {
      setLoading(false)
    }
  }

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  // Prevent hydration mismatch
  if (!mounted) {
    return (
      <div className="page-container pb-24 md:pb-6">
        <div className="animate-pulse space-y-4">
          <div className="h-10 bg-gray-200 rounded w-1/4"></div>
          <div className="h-32 bg-gray-200 rounded"></div>
        </div>
      </div>
    )
  }

  return (
    <div className="page-container pb-24 md:pb-6">
      {/* Header */}
      <div className="mb-4 sm:mb-6">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-800">Leave Management</h1>
            <p className="text-sm sm:text-base text-gray-600 mt-1">Apply and manage your leave requests</p>
          </div>
          <div className="flex gap-2 sm:gap-3">
            <button
              onClick={() => window.location.href = '/dashboard/leave/apply'}
              className="flex-1 sm:flex-none btn-theme-primary px-3 sm:px-4 py-2 rounded-lg transition-all duration-200 flex items-center justify-center gap-2 text-sm sm:text-base font-semibold shadow-md hover:shadow-lg"
            >
              <FaPlus className="text-sm" />
              <span>Apply Leave</span>
            </button>
            <button
              onClick={() => window.location.href = '/dashboard/leave/requests'}
              className="flex-1 sm:flex-none bg-gray-200 text-gray-700 px-3 sm:px-4 py-2 rounded-lg hover:bg-gray-300 transition-colors flex items-center justify-center gap-2 text-sm sm:text-base"
            >
              <FaCalendarAlt className="text-sm" />
              <span>My Requests</span>
            </button>
          </div>
        </div>
      </div>

      {/* Leave Balance Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-4 sm:mb-6">
        {leaveBalance.map((balance) => (
          <div key={balance._id} className="bg-white rounded-lg shadow-md p-3 sm:p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs sm:text-sm font-medium text-gray-600 truncate">
                {balance.leaveType?.name || 'Leave'}
              </h3>
              <FaCalendarAlt className="text-blue-500 text-sm sm:text-base flex-shrink-0" />
            </div>
            <div className="text-2xl sm:text-3xl font-bold text-gray-800 mb-1">
              {balance.available}
            </div>
            <p className="text-xs text-gray-500">
              Used: {balance.used} / Total: {balance.total}
            </p>
          </div>
        ))}
      </div>

      {/* Leave Requests */}
      <div className="bg-white rounded-lg shadow-md overflow-hidden">
        <div className="p-3 sm:p-4 border-b border-gray-200">
          <h2 className="text-lg sm:text-xl font-semibold text-gray-800">My Leave Requests</h2>
        </div>

        {/* Mobile Card View */}
        <div className="block sm:hidden">
          {leaves.length === 0 ? (
            <div className="p-6 text-center text-gray-500">
              No leave requests found
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {leaves.map((leave) => (
                <div key={leave._id} className="p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <h3 className="font-semibold text-gray-900">{leave.leaveType?.name || 'N/A'}</h3>
                      <p className="text-sm text-gray-600">{leave.numberOfDays} {leave.isHalfDay ? '(Half Day)' : 'days'}</p>
                    </div>
                    <span className={`px-2 py-1 text-xs font-semibold rounded-full flex items-center gap-1 ${
                      leave.status === 'approved' ? 'bg-green-100 text-green-800' :
                      leave.status === 'rejected' ? 'bg-red-100 text-red-800' :
                      'bg-yellow-100 text-yellow-800'
                    }`}>
                      {leave.status === 'approved' && <FaCheckCircle />}
                      {leave.status === 'rejected' && <FaTimesCircle />}
                      {leave.status === 'pending' && <FaClock />}
                      <span className="capitalize">{leave.status}</span>
                    </span>
                  </div>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Start:</span>
                      <span className="text-gray-900">{formatDate(leave.startDate)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">End:</span>
                      <span className="text-gray-900">{formatDate(leave.endDate)}</span>
                    </div>
                    <div className="mt-2">
                      <span className="text-gray-500">Reason:</span>
                      <p className="text-gray-900 mt-1">{leave.reason}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Desktop Table View */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Leave Type
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Start Date
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  End Date
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Days
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Reason
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {leaves.length === 0 ? (
                <tr>
                  <td colSpan="6" className="px-4 py-4 text-center text-gray-500">
                    No leave requests found
                  </td>
                </tr>
              ) : (
                leaves.map((leave) => (
                  <tr key={leave._id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                      {leave.leaveType?.name || 'N/A'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                      {formatDate(leave.startDate)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                      {formatDate(leave.endDate)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                      {leave.numberOfDays} {leave.isHalfDay ? '(Half Day)' : ''}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900 max-w-xs truncate">
                      {leave.reason}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full items-center gap-1 ${
                        leave.status === 'approved' ? 'bg-green-100 text-green-800' :
                        leave.status === 'rejected' ? 'bg-red-100 text-red-800' :
                        'bg-yellow-100 text-yellow-800'
                      }`}>
                        {leave.status === 'approved' && <FaCheckCircle />}
                        {leave.status === 'rejected' && <FaTimesCircle />}
                        {leave.status === 'pending' && <FaClock />}
                        <span className="capitalize">{leave.status}</span>
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Apply Leave Modal */}
      {showModal && (
        <div className="fixed inset-0 modal-overlay flex items-center justify-center style={{ zIndex: 99999 }}">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-2xl font-bold text-gray-800 mb-4">Apply for Leave</h2>
            <form onSubmit={handleSubmit}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Leave Type <span className="text-red-500">*</span>
                  </label>
                  <select
                    name="leaveType"
                    value={formData.leaveType}
                    onChange={handleChange}
                    required
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  >
                    <option value="">Select Leave Type</option>
                    {leaveTypes.map((type) => (
                      <option key={type._id} value={type._id}>
                        {type.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Start Date <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    name="startDate"
                    value={formData.startDate}
                    onChange={handleChange}
                    required
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    End Date <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    name="endDate"
                    value={formData.endDate}
                    onChange={handleChange}
                    required
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Reason <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    name="reason"
                    value={formData.reason}
                    onChange={handleChange}
                    required
                    rows="3"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    placeholder="Enter reason for leave"
                  />
                </div>

                <div className="flex items-center">
                  <input
                    type="checkbox"
                    name="isHalfDay"
                    checked={formData.isHalfDay}
                    onChange={handleChange}
                    className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                  />
                  <label className="ml-2 block text-sm text-gray-900">
                    Half Day Leave
                  </label>
                </div>
              </div>

              <div className="flex justify-end space-x-4 mt-6">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="btn-primary"
                >
                  {loading ? 'Submitting...' : 'Submit'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

