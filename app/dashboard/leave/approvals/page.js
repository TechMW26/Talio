'use client'

import { useState, useEffect } from 'react'
import toast from '@/utils/toast'
import { FaCheck, FaTimes, FaEye, FaFilter } from 'react-icons/fa'
import { getCurrentUser, getEmployeeId } from '@/utils/userHelper'
import Loader from '@/components/ui/Loader'

export default function LeaveApprovalsPage() {
  const [leaves, setLeaves] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('pending')
  const [selectedLeave, setSelectedLeave] = useState(null)
  const [showModal, setShowModal] = useState(false)

  useEffect(() => {
    fetchLeaves()
  }, [filter])

  const fetchLeaves = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/leave?status=${filter}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      const data = await response.json()
      if (data.success) {
        setLeaves(data.data)
      }
    } catch (error) {
      console.error('Fetch leaves error:', error)
      toast.error('Failed to fetch leave requests')
    } finally {
      setLoading(false)
    }
  }

  const handleApprove = async (leaveId) => {
    try {
      const token = localStorage.getItem('token')
      const user = getCurrentUser()
      const empId = getEmployeeId(user)

      const response = await fetch(`/api/leave/${leaveId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          status: 'approved',
          approvedBy: empId,
          approvedDate: new Date(),
        }),
      })

      const data = await response.json()

      if (data.success) {
        toast.success('Leave request approved!')
        fetchLeaves()
        setShowModal(false)
      } else {
        toast.error(data.message)
      }
    } catch (error) {
      console.error('Approve leave error:', error)
      toast.error('Failed to approve leave')
    }
  }

  const handleReject = async (leaveId) => {
    try {
      const token = localStorage.getItem('token')
      const user = getCurrentUser()
      const empId = getEmployeeId(user)

      const response = await fetch(`/api/leave/${leaveId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          status: 'rejected',
          approvedBy: empId,
          approvedDate: new Date(),
        }),
      })

      const data = await response.json()

      if (data.success) {
        toast.success('Leave request rejected')
        fetchLeaves()
        setShowModal(false)
      } else {
        toast.error(data.message)
      }
    } catch (error) {
      console.error('Reject leave error:', error)
      toast.error('Failed to reject leave')
    }
  }

  const viewDetails = (leave) => {
    setSelectedLeave(leave)
    setShowModal(true)
  }

  return (
    <div className="p-6 pb-24 md:pb-6">
      {/* Header */}
      <div className="flex md:justify-between md:items-center md:flex-row flex-col mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">Leave Approvals</h1>
          <p className="text-gray-600 mt-1">Review and approve leave requests</p>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-gray-600">Pending</h3>
            <FaFilter className="text-yellow-500" />
          </div>
          <div className="text-3xl font-bold text-gray-800">
            {leaves.filter(l => l.status === 'pending').length}
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-gray-600">Approved</h3>
            <FaCheck className="text-green-500" />
          </div>
          <div className="text-3xl font-bold text-gray-800">
            {leaves.filter(l => l.status === 'approved').length}
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-gray-600">Rejected</h3>
            <FaTimes className="text-red-500" />
          </div>
          <div className="text-3xl font-bold text-gray-800">
            {leaves.filter(l => l.status === 'rejected').length}
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-gray-600">Total Requests</h3>
            <FaFilter className="text-primary-500" />
          </div>
          <div className="text-3xl font-bold text-gray-800">{leaves.length}</div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="bg-white rounded-lg shadow-md mb-6">
        <div className="flex border-b border-gray-200">
          <button
            onClick={() => setFilter('pending')}
            className={`px-6 py-3 font-medium ${
              filter === 'pending'
                ? 'text-primary-600 border-b-2 border-primary-600'
                : 'text-gray-600 hover:text-gray-800'
            }`}
          >
            Pending
          </button>
          <button
            onClick={() => setFilter('approved')}
            className={`px-6 py-3 font-medium ${
              filter === 'approved'
                ? 'text-primary-600 border-b-2 border-primary-600'
                : 'text-gray-600 hover:text-gray-800'
            }`}
          >
            Approved
          </button>
          <button
            onClick={() => setFilter('rejected')}
            className={`px-6 py-3 font-medium ${
              filter === 'rejected'
                ? 'text-primary-600 border-b-2 border-primary-600'
                : 'text-gray-600 hover:text-gray-800'
            }`}
          >
            Rejected
          </button>
          <button
            onClick={() => setFilter('')}
            className={`px-6 py-3 font-medium ${
              filter === ''
                ? 'text-primary-600 border-b-2 border-primary-600'
                : 'text-gray-600 hover:text-gray-800'
            }`}
          >
            All
          </button>
        </div>
      </div>

      {/* Leave Requests Table */}
      <div className="bg-white rounded-lg shadow-md overflow-hidden">
        {loading ? (
          <div className="p-8 text-center">
            <Loader size="lg" />
            <p className="mt-4 text-gray-600">Loading leave requests...</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Employee
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Leave Type
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Start Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    End Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Days
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {leaves.length === 0 ? (
                  <tr>
                    <td colSpan="7" className="px-6 py-4 text-center text-gray-500">
                      No leave requests found
                    </td>
                  </tr>
                ) : (
                  leaves.map((leave) => (
                    <tr key={leave._id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">
                          {leave.employee?.firstName} {leave.employee?.lastName}
                        </div>
                        <div className="text-sm text-gray-500">
                          {leave.employee?.employeeCode}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {leave.leaveType?.name || 'N/A'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {new Date(leave.startDate).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {new Date(leave.endDate).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900">
                        {leave.numberOfDays}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                          leave.status === 'approved' ? 'bg-green-100 text-green-800' :
                          leave.status === 'rejected' ? 'bg-red-100 text-red-800' :
                          'bg-yellow-100 text-yellow-800'
                        }`}>
                          {leave.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <button
                          onClick={() => viewDetails(leave)}
                          className="text-blue-600 hover:text-blue-900 mr-3"
                        >
                          <FaEye />
                        </button>
                        {leave.status === 'pending' && (
                          <>
                            <button
                              onClick={() => handleApprove(leave._id)}
                              className="text-green-600 hover:text-green-900 mr-3"
                            >
                              <FaCheck />
                            </button>
                            <button
                              onClick={() => handleReject(leave._id)}
                              className="text-red-600 hover:text-red-900"
                            >
                              <FaTimes />
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Details Modal */}
      {showModal && selectedLeave && (
        <div className="fixed inset-0 modal-overlay flex items-center justify-center style={{ zIndex: 99999 }}">
          <div className="bg-white rounded-lg p-6 w-full max-w-2xl">
            <h2 className="text-2xl font-bold text-gray-800 mb-4">Leave Request Details</h2>
            
            <div className="space-y-4 mb-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-600">Employee</p>
                  <p className="font-medium text-gray-800">
                    {selectedLeave.employee?.firstName} {selectedLeave.employee?.lastName}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Leave Type</p>
                  <p className="font-medium text-gray-800">{selectedLeave?.leaveType?.name || 'Unknown Leave Type'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Start Date</p>
                  <p className="font-medium text-gray-800">
                    {new Date(selectedLeave.startDate).toLocaleDateString()}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">End Date</p>
                  <p className="font-medium text-gray-800">
                    {new Date(selectedLeave.endDate).toLocaleDateString()}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Number of Days</p>
                  <p className="font-medium text-gray-800">{selectedLeave.numberOfDays}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Status</p>
                  <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                    selectedLeave.status === 'approved' ? 'bg-green-100 text-green-800' :
                    selectedLeave.status === 'rejected' ? 'bg-red-100 text-red-800' :
                    'bg-yellow-100 text-yellow-800'
                  }`}>
                    {selectedLeave.status}
                  </span>
                </div>
              </div>
              
              {selectedLeave.reason && (
                <div>
                  <p className="text-sm text-gray-600">Reason</p>
                  <p className="font-medium text-gray-800">{selectedLeave.reason}</p>
                </div>
              )}
            </div>

            <div className="flex justify-end space-x-4">
              <button
                onClick={() => setShowModal(false)}
                className="btn-secondary"
              >
                Close
              </button>
              {selectedLeave.status === 'pending' && (
                <>
                  <button
                    onClick={() => handleReject(selectedLeave._id)}
                    className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
                  >
                    Reject
                  </button>
                  <button
                    onClick={() => handleApprove(selectedLeave._id)}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                  >
                    Approve
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

