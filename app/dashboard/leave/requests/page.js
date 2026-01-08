'use client'

import { useState, useEffect } from 'react'
import toast from '@/utils/toast'
import { FaCalendarAlt, FaClock, FaCheck, FaTimes, FaEye, FaFilter } from 'react-icons/fa'
import ModalPortal from '@/components/ModalPortal'
import { getCurrentUser, getEmployeeId } from '@/utils/userHelper'
import Loader from '@/components/ui/Loader'

export default function LeaveRequestsPage() {
  const [leaves, setLeaves] = useState([])
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState(null)
  const [filter, setFilter] = useState('all')
  const [selectedLeave, setSelectedLeave] = useState(null)
  const [showModal, setShowModal] = useState(false)

  useEffect(() => {
    const parsedUser = getCurrentUser()
    if (parsedUser) {
      setUser(parsedUser)
      const empId = getEmployeeId(parsedUser)
      if (empId) {
        fetchLeaves(empId)
      } else {
        console.error('Employee ID not found in user data:', parsedUser)
        toast.error('Employee information not found. Please logout and login again.')
        setLoading(false)
      }
    } else {
      console.error('No user data found')
      toast.error('Please login to view leave requests')
      setLoading(false)
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
        setLeaves(data.data || [])
      } else {
        console.error('API Error:', data.message)
        toast.error(data.message || 'Failed to fetch leave requests')
      }
    } catch (error) {
      console.error('Fetch leaves error:', error)
      toast.error('Failed to fetch leave requests')
    } finally {
      setLoading(false)
    }
  }

  const getStatusColor = (status) => {
    switch (status) {
      case 'approved': return 'bg-green-100 text-green-800'
      case 'rejected': return 'bg-red-100 text-red-800'
      case 'pending': return 'bg-yellow-100 text-yellow-800'
      case 'cancelled': return 'bg-gray-100 text-gray-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  const filteredLeaves = leaves.filter(leave => {
    if (filter === 'all') return true
    return leave.status === filter
  })

  const formatDate = (date) => {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  }

  const calculateDuration = (startDate, endDate) => {
    const start = new Date(startDate)
    const end = new Date(endDate)
    const diffTime = Math.abs(end - start)
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1
    return diffDays
  }

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
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">My Leave Requests</h1>
          <p className="text-gray-600 mt-1">Track all your leave applications and their status</p>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
        {[
          { title: 'Total Requests', value: leaves.length, color: 'bg-blue-500', icon: FaCalendarAlt },
          { title: 'Pending', value: leaves.filter(l => l.status === 'pending').length, color: 'bg-yellow-500', icon: FaClock },
          { title: 'Approved', value: leaves.filter(l => l.status === 'approved').length, color: 'bg-green-500', icon: FaCheck },
          { title: 'Rejected', value: leaves.filter(l => l.status === 'rejected').length, color: 'bg-red-500', icon: FaTimes },
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

      {/* Filter Tabs */}
      <div className="bg-white rounded-lg shadow-md mb-6">
        <div className="border-b border-gray-200">
          <nav className="flex space-x-8 px-6">
            {[
              { key: 'all', label: 'All Requests', count: leaves.length },
              { key: 'pending', label: 'Pending', count: leaves.filter(l => l.status === 'pending').length },
              { key: 'approved', label: 'Approved', count: leaves.filter(l => l.status === 'approved').length },
              { key: 'rejected', label: 'Rejected', count: leaves.filter(l => l.status === 'rejected').length },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setFilter(tab.key)}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  filter === tab.key
                    ? 'border-primary-500 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {tab.label} ({tab.count})
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Leave Requests List */}
      <div className="bg-white rounded-lg shadow-md">
        {filteredLeaves.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <FaCalendarAlt className="w-12 h-12 mx-auto mb-4 text-gray-300" />
            <p>No leave requests found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Leave Type
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Duration
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Dates
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Applied Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredLeaves.map((leave) => (
                  <tr key={leave._id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">
                        {leave?.leaveType?.name || 'Unknown Leave Type'}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">
                        {leave?.startDate && leave?.endDate ?
                          `${calculateDuration(leave.startDate, leave.endDate)} day${calculateDuration(leave.startDate, leave.endDate) > 1 ? 's' : ''}`
                          : 'N/A'
                        }
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">
                        {leave?.startDate && leave?.endDate ?
                          `${formatDate(leave.startDate)} - ${formatDate(leave.endDate)}`
                          : 'N/A'
                        }
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(leave?.status || 'pending')}`}>
                        {leave?.status ? leave.status.charAt(0).toUpperCase() + leave.status.slice(1) : 'Pending'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {leave?.appliedDate ? formatDate(leave.appliedDate) : 'N/A'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      <button
                        onClick={() => {
                          setSelectedLeave(leave)
                          setShowModal(true)
                        }}
                        className="text-primary-600 hover:text-primary-900 flex items-center space-x-1"
                      >
                        <FaEye className="w-4 h-4" />
                        <span>View</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Leave Details Modal */}
      <ModalPortal show={showModal && selectedLeave}>
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center" style={{ zIndex: 99999 }}>
          <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-screen overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-gray-800">Leave Request Details</h2>
              <button
                onClick={() => setShowModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <FaTimes className="w-6 h-6" />
              </button>
            </div>

            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Leave Type</label>
                  <p className="text-gray-900">{selectedLeave?.leaveType?.name || 'Unknown Leave Type'}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
                  <span className={`px-3 py-1 text-sm font-semibold rounded-full ${getStatusColor(selectedLeave?.status || 'pending')}`}>
                    {selectedLeave?.status ? selectedLeave.status.charAt(0).toUpperCase() + selectedLeave.status.slice(1) : 'Pending'}
                  </span>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Start Date</label>
                  <p className="text-gray-900">{selectedLeave?.startDate ? formatDate(selectedLeave.startDate) : 'N/A'}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">End Date</label>
                  <p className="text-gray-900">{selectedLeave?.endDate ? formatDate(selectedLeave.endDate) : 'N/A'}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Duration</label>
                  <p className="text-gray-900">{selectedLeave?.startDate && selectedLeave?.endDate ? calculateDuration(selectedLeave.startDate, selectedLeave.endDate) : 0} day(s)</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Applied Date</label>
                  <p className="text-gray-900">{selectedLeave?.appliedDate ? formatDate(selectedLeave.appliedDate) : 'N/A'}</p>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Reason</label>
                <p className="text-gray-900 bg-gray-50 p-3 rounded-lg">{selectedLeave?.reason || 'No reason provided'}</p>
              </div>

              {selectedLeave?.status === 'approved' && selectedLeave?.approvedBy && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Approved By</label>
                  <p className="text-gray-900">{selectedLeave.approvedBy?.firstName} {selectedLeave.approvedBy?.lastName}</p>
                  {selectedLeave?.approvedDate && (
                    <p className="text-sm text-gray-500">on {formatDate(selectedLeave.approvedDate)}</p>
                  )}
                </div>
              )}

              {selectedLeave?.status === 'rejected' && selectedLeave?.rejectionReason && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Rejection Reason</label>
                  <p className="text-red-600 bg-red-50 p-3 rounded-lg">{selectedLeave.rejectionReason}</p>
                </div>
              )}
            </div>

            <div className="flex justify-end mt-6">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </ModalPortal>
    </div>
  )
}
