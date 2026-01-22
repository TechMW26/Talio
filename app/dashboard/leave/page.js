'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardBody, CardHeader, Button, Chip, Skeleton, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Input, Textarea, Select, SelectItem, Checkbox } from '@heroui/react'
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
        <div className="space-y-4">
          <Skeleton className="h-10 w-1/4 rounded-lg" />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28 rounded-lg" />)}
          </div>
          <Skeleton className="h-64 rounded-lg" />
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
            <h1 className="text-2xl sm:text-3xl font-bold text-default-800">Leave Management</h1>
            <p className="text-sm sm:text-base text-default-500 mt-1">Apply and manage your leave requests</p>
          </div>
          <div className="flex gap-2 sm:gap-3">
            <Button
              color="primary"
              onPress={() => window.location.href = '/dashboard/leave/apply'}
              startContent={<FaPlus />}
              className="flex-1 sm:flex-none font-semibold shadow-md"
            >
              Apply Leave
            </Button>
            <Button
              variant="flat"
              onPress={() => window.location.href = '/dashboard/leave/requests'}
              startContent={<FaCalendarAlt />}
              className="flex-1 sm:flex-none"
            >
              My Requests
            </Button>
          </div>
        </div>
      </div>

      {/* Leave Balance Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-4 sm:mb-6">
        {leaveBalance.map((balance) => (
          <Card key={balance._id} shadow="sm">
            <CardBody className="p-3 sm:p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs sm:text-sm font-medium text-default-600 truncate">
                  {balance.leaveType?.name || 'Leave'}
                </h3>
                <FaCalendarAlt className="text-primary text-sm sm:text-base flex-shrink-0" />
              </div>
              <div className="text-2xl sm:text-3xl font-bold text-default-800 mb-1">
                {balance.available}
              </div>
              <p className="text-xs text-default-500">
                Used: {balance.used} / Total: {balance.total}
              </p>
            </CardBody>
          </Card>
        ))}
      </div>

      {/* Leave Requests */}
      <Card shadow="sm">
        <CardHeader className="border-b border-default-200 px-3 sm:px-4 py-3">
          <h2 className="text-lg sm:text-xl font-semibold text-default-800">My Leave Requests</h2>
        </CardHeader>
        <CardBody className="p-0">

        {/* Mobile Card View */}
          <div className="block sm:hidden">
            {leaves.length === 0 ? (
              <div className="p-6 text-center text-default-500">
                No leave requests found
              </div>
            ) : (
              <div className="divide-y divide-default-200">
                {leaves.map((leave) => (
                  <div key={leave._id} className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <h3 className="font-semibold text-default-800">{leave.leaveType?.name || 'N/A'}</h3>
                        <p className="text-sm text-default-600">{leave.numberOfDays} {leave.isHalfDay ? '(Half Day)' : 'days'}</p>
                      </div>
                      <Chip
                        size="sm"
                        variant="flat"
                        color={leave.status === 'approved' ? 'success' : leave.status === 'rejected' ? 'danger' : 'warning'}
                        startContent={leave.status === 'approved' ? <FaCheckCircle className="text-xs" /> : leave.status === 'rejected' ? <FaTimesCircle className="text-xs" /> : <FaClock className="text-xs" />}
                      >
                        <span className="capitalize">{leave.status}</span>
                      </Chip>
                    </div>
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span className="text-default-500">Start:</span>
                        <span className="text-default-800">{formatDate(leave.startDate)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-default-500">End:</span>
                        <span className="text-default-800">{formatDate(leave.endDate)}</span>
                      </div>
                      <div className="mt-2">
                        <span className="text-default-500">Reason:</span>
                        <p className="text-default-800 mt-1">{leave.reason}</p>
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
              <thead className="bg-default-50 border-b border-default-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">
                    Leave Type
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">
                    Start Date
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">
                    End Date
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">
                    Days
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">
                    Reason
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="bg-content1 divide-y divide-default-200">
                {leaves.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="px-4 py-4 text-center text-default-500">
                      No leave requests found
                    </td>
                  </tr>
                ) : (
                  leaves.map((leave) => (
                    <tr key={leave._id} className="hover:bg-default-50">
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-default-800">
                        {leave.leaveType?.name || 'N/A'}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-default-800">
                        {formatDate(leave.startDate)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-default-800">
                        {formatDate(leave.endDate)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-default-800">
                        {leave.numberOfDays} {leave.isHalfDay ? '(Half Day)' : ''}
                      </td>
                      <td className="px-4 py-3 text-sm text-default-800 max-w-xs truncate">
                        {leave.reason}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <Chip
                          size="sm"
                          variant="flat"
                          color={leave.status === 'approved' ? 'success' : leave.status === 'rejected' ? 'danger' : 'warning'}
                          startContent={leave.status === 'approved' ? <FaCheckCircle className="text-xs" /> : leave.status === 'rejected' ? <FaTimesCircle className="text-xs" /> : <FaClock className="text-xs" />}
                        >
                          <span className="capitalize">{leave.status}</span>
                        </Chip>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      {/* Apply Leave Modal */}
      <Modal isOpen={showModal} onOpenChange={setShowModal} size="lg">
        <ModalContent>
          {(onClose) => (
            <form onSubmit={(e) => { handleSubmit(e); onClose(); }}>
              <ModalHeader className="flex flex-col gap-1">
                <h2 className="text-xl font-bold text-default-800">Apply for Leave</h2>
              </ModalHeader>
              <ModalBody>
                <div className="space-y-4">
                  <Select
                    label="Leave Type"
                    placeholder="Select Leave Type"
                    selectedKeys={formData.leaveType ? [formData.leaveType] : []}
                    onSelectionChange={(keys) => setFormData({ ...formData, leaveType: Array.from(keys)[0] })}
                    isRequired
                  >
                    {leaveTypes.map((type) => (
                      <SelectItem key={type._id}>
                        {type.name}
                      </SelectItem>
                    ))}
                  </Select>

                  <Input
                    type="date"
                    label="Start Date"
                    name="startDate"
                    value={formData.startDate}
                    onChange={handleChange}
                    isRequired
                  />

                  <Input
                    type="date"
                    label="End Date"
                    name="endDate"
                    value={formData.endDate}
                    onChange={handleChange}
                    isRequired
                  />

                  <Textarea
                    label="Reason"
                    name="reason"
                    value={formData.reason}
                    onChange={handleChange}
                    placeholder="Enter reason for leave"
                    minRows={3}
                    isRequired
                  />

                  <Checkbox
                    isSelected={formData.isHalfDay}
                    onValueChange={(checked) => setFormData({ ...formData, isHalfDay: checked })}
                  >
                    Half Day Leave
                  </Checkbox>
                </div>
              </ModalBody>
              <ModalFooter>
                <Button variant="flat" onPress={onClose}>
                  Cancel
                </Button>
                <Button color="primary" type="submit" isLoading={loading}>
                  Submit
                </Button>
              </ModalFooter>
            </form>
          )}
        </ModalContent>
      </Modal>
    </div>
  )
}

