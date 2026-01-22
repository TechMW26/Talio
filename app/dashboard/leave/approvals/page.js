'use client'

import { useState, useEffect } from 'react'
import { Card, CardBody, Button, Chip, Skeleton, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@heroui/react'
import toast from '@/utils/toast'
import { FaCheck, FaTimes, FaEye, FaFilter } from 'react-icons/fa'
import { getCurrentUser, getEmployeeId } from '@/utils/userHelper'

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
          <h1 className="text-3xl font-bold text-default-800">Leave Approvals</h1>
          <p className="text-default-500 mt-1">Review and approve leave requests</p>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Card shadow="sm">
          <CardBody className="p-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-default-600">Pending</h3>
              <FaFilter className="text-warning" />
            </div>
            <div className="text-3xl font-bold text-default-800">
              {leaves.filter(l => l.status === 'pending').length}
            </div>
          </CardBody>
        </Card>

        <Card shadow="sm">
          <CardBody className="p-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-default-600">Approved</h3>
              <FaCheck className="text-success" />
            </div>
            <div className="text-3xl font-bold text-default-800">
              {leaves.filter(l => l.status === 'approved').length}
            </div>
          </CardBody>
        </Card>

        <Card shadow="sm">
          <CardBody className="p-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-default-600">Rejected</h3>
              <FaTimes className="text-danger" />
            </div>
            <div className="text-3xl font-bold text-default-800">
              {leaves.filter(l => l.status === 'rejected').length}
            </div>
          </CardBody>
        </Card>

        <Card shadow="sm">
          <CardBody className="p-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-default-600">Total Requests</h3>
              <FaFilter className="text-primary" />
            </div>
            <div className="text-3xl font-bold text-default-800">{leaves.length}</div>
          </CardBody>
        </Card>
      </div>

      {/* Filter Tabs */}
      <Card shadow="sm" className="mb-6">
        <CardBody className="p-0">
          <div className="flex border-b border-default-200">
            <button
              onClick={() => setFilter('pending')}
              className={`px-6 py-3 font-medium ${
                filter === 'pending'
                  ? 'text-primary border-b-2 border-primary'
                  : 'text-default-600 hover:text-default-800'
              }`}
            >
              Pending
            </button>
            <button
              onClick={() => setFilter('approved')}
              className={`px-6 py-3 font-medium ${
                filter === 'approved'
                  ? 'text-primary border-b-2 border-primary'
                  : 'text-default-600 hover:text-default-800'
              }`}
            >
              Approved
            </button>
            <button
              onClick={() => setFilter('rejected')}
              className={`px-6 py-3 font-medium ${
                filter === 'rejected'
                  ? 'text-primary border-b-2 border-primary'
                  : 'text-default-600 hover:text-default-800'
              }`}
            >
              Rejected
            </button>
            <button
              onClick={() => setFilter('')}
              className={`px-6 py-3 font-medium ${
                filter === ''
                  ? 'text-primary border-b-2 border-primary'
                  : 'text-default-600 hover:text-default-800'
              }`}
            >
              All
            </button>
          </div>
        </CardBody>
      </Card>

      {/* Leave Requests Table */}
      <Card shadow="sm">
        <CardBody className="p-0">
          {loading ? (
            <div className="p-8 space-y-4">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-default-50 border-b border-default-200">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">
                      Employee
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">
                      Leave Type
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">
                      Start Date
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">
                      End Date
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">
                      Days
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-content1 divide-y divide-default-200">
                  {leaves.length === 0 ? (
                    <tr>
                      <td colSpan="7" className="px-6 py-4 text-center text-default-500">
                        No leave requests found
                      </td>
                    </tr>
                  ) : (
                    leaves.map((leave) => (
                      <tr key={leave._id} className="hover:bg-default-50">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-default-800">
                            {leave.employee?.firstName} {leave.employee?.lastName}
                          </div>
                          <div className="text-sm text-default-500">
                            {leave.employee?.employeeCode}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-default-800">
                          {leave.leaveType?.name || 'N/A'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-default-800">
                          {new Date(leave.startDate).toLocaleDateString()}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-default-800">
                          {new Date(leave.endDate).toLocaleDateString()}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-default-800">
                          {leave.numberOfDays}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <Chip
                            size="sm"
                            variant="flat"
                            color={leave.status === 'approved' ? 'success' : leave.status === 'rejected' ? 'danger' : 'warning'}
                          >
                            {leave.status}
                          </Chip>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                          <div className="flex items-center gap-2">
                            <Button
                              isIconOnly
                              size="sm"
                              variant="light"
                              color="primary"
                              onPress={() => viewDetails(leave)}
                            >
                              <FaEye />
                            </Button>
                            {leave.status === 'pending' && (
                              <>
                                <Button
                                  isIconOnly
                                  size="sm"
                                  variant="light"
                                  color="success"
                                  onPress={() => handleApprove(leave._id)}
                                >
                                  <FaCheck />
                                </Button>
                                <Button
                                  isIconOnly
                                  size="sm"
                                  variant="light"
                                  color="danger"
                                  onPress={() => handleReject(leave._id)}
                                >
                                  <FaTimes />
                                </Button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Details Modal */}
      <Modal isOpen={showModal && !!selectedLeave} onOpenChange={(open) => !open && setShowModal(false)} size="2xl">
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>
                <h2 className="text-xl font-bold text-default-800">Leave Request Details</h2>
              </ModalHeader>
              <ModalBody>
                <div className="space-y-4 mb-6">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-default-500">Employee</p>
                      <p className="font-medium text-default-800">
                        {selectedLeave?.employee?.firstName} {selectedLeave?.employee?.lastName}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-default-500">Leave Type</p>
                      <p className="font-medium text-default-800">{selectedLeave?.leaveType?.name || 'Unknown Leave Type'}</p>
                    </div>
                    <div>
                      <p className="text-sm text-default-500">Start Date</p>
                      <p className="font-medium text-default-800">
                        {selectedLeave?.startDate && new Date(selectedLeave.startDate).toLocaleDateString()}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-default-500">End Date</p>
                      <p className="font-medium text-default-800">
                        {selectedLeave?.endDate && new Date(selectedLeave.endDate).toLocaleDateString()}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-default-500">Number of Days</p>
                      <p className="font-medium text-default-800">{selectedLeave?.numberOfDays}</p>
                    </div>
                    <div>
                      <p className="text-sm text-default-500">Status</p>
                      <Chip
                        size="sm"
                        variant="flat"
                        color={selectedLeave?.status === 'approved' ? 'success' : selectedLeave?.status === 'rejected' ? 'danger' : 'warning'}
                      >
                        {selectedLeave?.status}
                      </Chip>
                    </div>
                  </div>
                  
                  {selectedLeave?.reason && (
                    <div>
                      <p className="text-sm text-default-500">Reason</p>
                      <p className="font-medium text-default-800">{selectedLeave.reason}</p>
                    </div>
                  )}
                </div>
              </ModalBody>
              <ModalFooter>
                <Button variant="flat" onPress={onClose}>
                  Close
                </Button>
                {selectedLeave?.status === 'pending' && (
                  <>
                    <Button color="danger" variant="flat" onPress={() => handleReject(selectedLeave._id)}>
                      Reject
                    </Button>
                    <Button color="success" onPress={() => handleApprove(selectedLeave._id)}>
                      Approve
                    </Button>
                  </>
                )}
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  )
}

