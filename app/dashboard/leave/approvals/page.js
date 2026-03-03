'use client'

import { useState, useMemo } from 'react'
import { Card, CardBody, Button, Chip, Skeleton, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@heroui/react'
import toast from '@/utils/toast'
import { FaCheck, FaTimes, FaEye, FaFilter } from 'react-icons/fa'
import { getCurrentUser, getEmployeeId } from '@/utils/userHelper'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import useApiMutation from '@/hooks/useApiMutation'
import LoadingButton, { ApproveButton, RejectButton } from '@/components/ui/LoadingButton'
import { DataErrorState } from '@/components/ui/ErrorBoundary'
import BackgroundRefreshIndicator from '@/components/ui/BackgroundRefreshIndicator'

// Skeleton for approvals page
function ApprovalsSkeleton() {
  return (
    <div className="p-6 pb-24 md:pb-6">
      <div className="mb-6">
        <Skeleton className="h-8 w-48 rounded-lg mb-2" />
        <Skeleton className="h-4 w-64 rounded-lg" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        {[...Array(4)].map((_, i) => (
          <Card key={i} shadow="sm"><CardBody className="p-6"><Skeleton className="h-3 w-20 rounded mb-3" /><Skeleton className="h-8 w-12 rounded" /></CardBody></Card>
        ))}
      </div>
      <Card shadow="sm" className="mb-6"><CardBody className="p-0"><div className="flex border-b border-default-200">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 w-24 mx-2 my-2 rounded" />)}</div></CardBody></Card>
      <Card shadow="sm"><CardBody className="p-4">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 rounded-lg mb-2" />)}</CardBody></Card>
    </div>
  )
}

export default function LeaveApprovalsPage() {
  const [filter, setFilter] = useState('pending')
  const [selectedLeave, setSelectedLeave] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [processingId, setProcessingId] = useState(null) // Track which leave is being processed

  // --- SWR Data Fetching ---
  const swrKey = `/api/leave?status=${filter}`
  const { data: leavesRes, error, isLoading, isValidating, mutate: refreshLeaves } = useAuthedSWR(swrKey)
  const leaves = leavesRes?.data || []

  // --- Mutations with optimistic UI ---
  const approveMutation = useApiMutation({
    method: 'PUT',
    invalidateKeys: [swrKey, '/api/leave?status=pending', '/api/leave?status=approved'],
    onSuccess: () => {
      toast.success('Leave request approved!')
      setShowModal(false)
      setProcessingId(null)
    },
    onError: (msg) => { toast.error(msg || 'Failed to approve leave'); setProcessingId(null) },
  })

  const rejectMutation = useApiMutation({
    method: 'PUT',
    invalidateKeys: [swrKey, '/api/leave?status=pending', '/api/leave?status=rejected'],
    onSuccess: () => {
      toast.success('Leave request rejected')
      setShowModal(false)
      setProcessingId(null)
    },
    onError: (msg) => { toast.error(msg || 'Failed to reject leave'); setProcessingId(null) },
  })

  const handleApprove = async (leaveId) => {
    const user = getCurrentUser()
    const empId = getEmployeeId(user)
    setProcessingId(leaveId)

    await approveMutation.execute(`/api/leave/${leaveId}`, {
      status: 'approved',
      approvedBy: empId,
      approvedDate: new Date(),
    })
  }

  const handleReject = async (leaveId) => {
    const user = getCurrentUser()
    const empId = getEmployeeId(user)
    setProcessingId(leaveId)

    await rejectMutation.execute(`/api/leave/${leaveId}`, {
      status: 'rejected',
      approvedBy: empId,
      approvedDate: new Date(),
    })
  }

  const viewDetails = (leave) => {
    setSelectedLeave(leave)
    setShowModal(true)
  }

  const isProcessing = approveMutation.isLoading || rejectMutation.isLoading

  if (isLoading) return <ApprovalsSkeleton />

  if (error) {
    return (
      <div className="p-6 pb-24 md:pb-6">
        <DataErrorState title="Failed to load leave approvals" message={error.message} onRetry={() => refreshLeaves()} />
      </div>
    )
  }

  return (
    <div className="p-6 pb-24 md:pb-6">
      {/* Header */}
      <div className="flex md:justify-between md:items-center md:flex-row flex-col mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold text-default-800">Leave Approvals</h1>
            <BackgroundRefreshIndicator isValidating={isValidating} />
          </div>
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
              className={`px-6 py-3 font-medium ${filter === 'pending'
                  ? 'text-primary border-b-2 border-primary'
                  : 'text-default-600 hover:text-default-800'
                }`}
            >
              Pending
            </button>
            <button
              onClick={() => setFilter('approved')}
              className={`px-6 py-3 font-medium ${filter === 'approved'
                  ? 'text-primary border-b-2 border-primary'
                  : 'text-default-600 hover:text-default-800'
                }`}
            >
              Approved
            </button>
            <button
              onClick={() => setFilter('rejected')}
              className={`px-6 py-3 font-medium ${filter === 'rejected'
                  ? 'text-primary border-b-2 border-primary'
                  : 'text-default-600 hover:text-default-800'
                }`}
            >
              Rejected
            </button>
            <button
              onClick={() => setFilter('')}
              className={`px-6 py-3 font-medium ${filter === ''
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
                                isDisabled={isProcessing}
                                isLoading={processingId === leave._id && approveMutation.isLoading}
                                onPress={() => handleApprove(leave._id)}
                              >
                                <FaCheck />
                              </Button>
                              <Button
                                isIconOnly
                                size="sm"
                                variant="light"
                                color="danger"
                                isDisabled={isProcessing}
                                isLoading={processingId === leave._id && rejectMutation.isLoading}
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
                <Button variant="flat" onPress={onClose} isDisabled={isProcessing}>
                  Close
                </Button>
                {selectedLeave?.status === 'pending' && (
                  <>
                    <RejectButton
                      isLoading={processingId === selectedLeave?._id && rejectMutation.isLoading}
                      isDisabled={isProcessing}
                      onPress={() => handleReject(selectedLeave._id)}
                    />
                    <ApproveButton
                      isLoading={processingId === selectedLeave?._id && approveMutation.isLoading}
                      isDisabled={isProcessing}
                      onPress={() => handleApprove(selectedLeave._id)}
                    />
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

