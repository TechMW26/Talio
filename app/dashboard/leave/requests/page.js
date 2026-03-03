'use client'

import { useState, useMemo } from 'react'
import { Card, CardBody, CardHeader, Button, Chip, Skeleton, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@heroui/react'
import toast from '@/utils/toast'
import { FaCalendarAlt, FaClock, FaCheck, FaTimes, FaEye, FaFilter } from 'react-icons/fa'
import { getCurrentUser, getEmployeeId } from '@/utils/userHelper'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import { DataErrorState } from '@/components/ui/ErrorBoundary'
import BackgroundRefreshIndicator from '@/components/ui/BackgroundRefreshIndicator'

export default function LeaveRequestsPage() {
  const [filter, setFilter] = useState('all')
  const [selectedLeave, setSelectedLeave] = useState(null)
  const [showModal, setShowModal] = useState(false)

  const { user, employeeId } = useMemo(() => {
    const parsedUser = getCurrentUser()
    return { user: parsedUser, employeeId: parsedUser ? getEmployeeId(parsedUser) : null }
  }, [])

  // --- SWR data fetching ---
  const { data: leavesRes, error, isLoading, isValidating, mutate: refreshLeaves } = useAuthedSWR(
    employeeId ? `/api/leave?employeeId=${employeeId}` : null
  )
  const leaves = leavesRes?.data || []

  const getStatusColor = (status) => {
    switch (status) {
      case 'approved': return 'success'
      case 'rejected': return 'danger'
      case 'pending': return 'warning'
      case 'cancelled': return 'default'
      default: return 'default'
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

  if (error) {
    return (
      <div className="p-6">
        <DataErrorState message="Failed to load leave requests" onRetry={() => refreshLeaves()} />
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="p-6 pb-24 md:pb-6 space-y-6">
        <Skeleton className="h-10 w-1/3 rounded-lg" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-lg" />)}
        </div>
        <Skeleton className="h-64 rounded-lg" />
      </div>
    )
  }

  return (
    <div className="p-6 pb-24 md:pb-6">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold text-default-800">My Leave Requests</h1>
          <p className="text-default-500 mt-1 flex items-center gap-2">
            Track all your leave applications and their status
            <BackgroundRefreshIndicator isValidating={isValidating && !isLoading} position="inline" />
          </p>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
        {[
          { title: 'Total Requests', value: leaves.length, color: 'primary', icon: FaCalendarAlt },
          { title: 'Pending', value: leaves.filter(l => l.status === 'pending').length, color: 'warning', icon: FaClock },
          { title: 'Approved', value: leaves.filter(l => l.status === 'approved').length, color: 'success', icon: FaCheck },
          { title: 'Rejected', value: leaves.filter(l => l.status === 'rejected').length, color: 'danger', icon: FaTimes },
        ].map((stat, index) => (
          <Card key={index} shadow="sm">
            <CardBody className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-default-500 text-sm font-medium">{stat.title}</p>
                  <h3 className="text-2xl font-bold text-default-800 mt-2">{stat.value}</h3>
                </div>
                <div className={`bg-${stat.color} p-4 rounded-lg`}>
                  <stat.icon className="w-6 h-6 text-white" />
                </div>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>

      {/* Filter Tabs */}
      <Card shadow="sm" className="mb-6">
        <CardBody className="p-0">
          <div className="border-b border-default-200">
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
                  className={`py-4 px-1 border-b-2 font-medium text-sm ${filter === tab.key
                      ? 'border-primary text-primary'
                      : 'border-transparent text-default-500 hover:text-default-700 hover:border-default-300'
                    }`}
                >
                  {tab.label} ({tab.count})
                </button>
              ))}
            </nav>
          </div>
        </CardBody>
      </Card>

      {/* Leave Requests List */}
      <Card shadow="sm">
        <CardBody className="p-0">
          {filteredLeaves.length === 0 ? (
            <div className="p-8 text-center text-default-500">
              <FaCalendarAlt className="w-12 h-12 mx-auto mb-4 text-default-300" />
              <p>No leave requests found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-default-200">
                <thead className="bg-default-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">
                      Leave Type
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">
                      Duration
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">
                      Dates
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">
                      Applied Date
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-content1 divide-y divide-default-200">
                  {filteredLeaves.map((leave) => (
                    <tr key={leave._id} className="hover:bg-default-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-default-800">
                          {leave?.leaveType?.name || 'Unknown Leave Type'}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-default-800">
                          {leave?.startDate && leave?.endDate ?
                            `${calculateDuration(leave.startDate, leave.endDate)} day${calculateDuration(leave.startDate, leave.endDate) > 1 ? 's' : ''}`
                            : 'N/A'
                          }
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-default-800">
                          {leave?.startDate && leave?.endDate ?
                            `${formatDate(leave.startDate)} - ${formatDate(leave.endDate)}`
                            : 'N/A'
                          }
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <Chip size="sm" variant="flat" color={getStatusColor(leave?.status || 'pending')}>
                          {leave?.status ? leave.status.charAt(0).toUpperCase() + leave.status.slice(1) : 'Pending'}
                        </Chip>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-default-500">
                        {leave?.appliedDate ? formatDate(leave.appliedDate) : 'N/A'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <Button
                          size="sm"
                          variant="light"
                          color="primary"
                          startContent={<FaEye className="w-4 h-4" />}
                          onPress={() => {
                            setSelectedLeave(leave)
                            setShowModal(true)
                          }}
                        >
                          View
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Leave Details Modal */}
      <Modal isOpen={showModal && !!selectedLeave} onOpenChange={(open) => !open && setShowModal(false)} size="2xl">
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex justify-between items-center">
                <h2 className="text-xl font-bold text-default-800">Leave Request Details</h2>
              </ModalHeader>
              <ModalBody>
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-default-500 mb-2">Leave Type</label>
                      <p className="text-default-800">{selectedLeave?.leaveType?.name || 'Unknown Leave Type'}</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-default-500 mb-2">Status</label>
                      <Chip variant="flat" color={getStatusColor(selectedLeave?.status || 'pending')}>
                        {selectedLeave?.status ? selectedLeave.status.charAt(0).toUpperCase() + selectedLeave.status.slice(1) : 'Pending'}
                      </Chip>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-default-500 mb-2">Start Date</label>
                      <p className="text-default-800">{selectedLeave?.startDate ? formatDate(selectedLeave.startDate) : 'N/A'}</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-default-500 mb-2">End Date</label>
                      <p className="text-default-800">{selectedLeave?.endDate ? formatDate(selectedLeave.endDate) : 'N/A'}</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-default-500 mb-2">Duration</label>
                      <p className="text-default-800">{selectedLeave?.startDate && selectedLeave?.endDate ? calculateDuration(selectedLeave.startDate, selectedLeave.endDate) : 0} day(s)</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-default-500 mb-2">Applied Date</label>
                      <p className="text-default-800">{selectedLeave?.appliedDate ? formatDate(selectedLeave.appliedDate) : 'N/A'}</p>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-default-500 mb-2">Reason</label>
                    <p className="text-default-800 bg-default-50 p-3 rounded-lg">{selectedLeave?.reason || 'No reason provided'}</p>
                  </div>

                  {selectedLeave?.status === 'approved' && selectedLeave?.approvedBy && (
                    <div>
                      <label className="block text-sm font-medium text-default-500 mb-2">Approved By</label>
                      <p className="text-default-800">{selectedLeave.approvedBy?.firstName} {selectedLeave.approvedBy?.lastName}</p>
                      {selectedLeave?.approvedDate && (
                        <p className="text-sm text-default-500">on {formatDate(selectedLeave.approvedDate)}</p>
                      )}
                    </div>
                  )}

                  {selectedLeave?.status === 'rejected' && selectedLeave?.rejectionReason && (
                    <div>
                      <label className="block text-sm font-medium text-default-500 mb-2">Rejection Reason</label>
                      <p className="text-danger bg-danger-50 p-3 rounded-lg">{selectedLeave.rejectionReason}</p>
                    </div>
                  )}
                </div>
              </ModalBody>
              <ModalFooter>
                <Button variant="flat" onPress={onClose}>
                  Close
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  )
}
