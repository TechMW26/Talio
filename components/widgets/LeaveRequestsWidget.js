'use client'

import { useRouter } from 'next/navigation'
import { FaCheck, FaTimes, FaCalendarCheck } from 'react-icons/fa'
import { Card, CardBody, Button, Chip, Avatar, ScrollShadow } from '@heroui/react'

export default function LeaveRequestsWidget({
  leaveRequests = [],
  onApprove,
  onReject
}) {
  const router = useRouter()

  const getStatusColor = (status) => {
    switch (status) {
      case 'pending': return 'warning'
      case 'approved': return 'success'
      case 'rejected': return 'danger'
      default: return 'default'
    }
  }

  return (
    <div className="p-4 sm:p-6 flex-1 flex flex-col h-full">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base sm:text-lg font-bold text-default-900">Leave Requests</h3>
        <Button
          variant="light"
          color="primary"
          size="sm"
          onPress={() => router.push('/dashboard/leave/approvals')}
        >
          View All
        </Button>
      </div>

      <ScrollShadow className="space-y-2 flex-1 max-h-[200px]">
        {leaveRequests.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center py-6 flex-1">
            <img
              src="/assets/Leave-Request.png"
              alt="No leave requests"
              className="w-24 h-24 object-contain mb-3"
            />
            <p className="text-sm text-default-500">No leave requests found</p>
          </div>
        ) : (
          leaveRequests.slice(0, 5).map((request) => (
            <Card key={request._id} className="border border-default-100">
              <CardBody className="p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <Avatar
                      name={`${request.employee?.firstName?.charAt(0) || ''}${request.employee?.lastName?.charAt(0) || ''}`}
                      size="sm"
                      className="bg-primary-100 text-primary-600"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-default-900 truncate">
                        {request.employee?.firstName} {request.employee?.lastName}
                      </p>
                      <p className="text-xs text-default-500">
                        {request.leaveType?.name} - {request.numberOfDays} day(s)
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                    <Chip size="sm" color={getStatusColor(request.status)} variant="flat">
                      {request.status}
                    </Chip>

                    {request.status === 'pending' && onApprove && onReject && (
                      <div className="flex gap-1">
                        <Button
                          isIconOnly
                          size="sm"
                          color="success"
                          variant="flat"
                          onPress={() => onApprove(request._id)}
                          aria-label="Approve"
                        >
                          <FaCheck className="w-3 h-3" />
                        </Button>
                        <Button
                          isIconOnly
                          size="sm"
                          color="danger"
                          variant="flat"
                          onPress={() => onReject(request._id)}
                          aria-label="Reject"
                        >
                          <FaTimes className="w-3 h-3" />
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </CardBody>
            </Card>
          ))
        )}
      </ScrollShadow>
    </div>
  )
}
