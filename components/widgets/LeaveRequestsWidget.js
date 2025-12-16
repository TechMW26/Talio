'use client'

import { useRouter } from 'next/navigation'
import { FaCheck, FaTimes, FaCalendarCheck } from 'react-icons/fa'

export default function LeaveRequestsWidget({
  leaveRequests = [],
  onApprove,
  onReject
}) {
  const router = useRouter()

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base sm:text-lg font-bold text-gray-800">Leave Requests</h3>
        <button
          onClick={() => router.push('/dashboard/leave/approvals')}
          className="text-primary-600 hover:text-primary-800 text-sm font-medium"
        >
          View All
        </button>
      </div>

      <div className="space-y-2 max-h-48 overflow-y-auto">
        {leaveRequests.length === 0 ? (
          <div className="text-center py-6 text-gray-500">
            <FaCalendarCheck className="w-8 h-8 mx-auto mb-2 text-gray-400" />
            <p className="text-sm">No leave requests found</p>
          </div>
        ) : (
          leaveRequests.slice(0, 5).map((request) => (
            <div
              key={request._id}
              className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center text-primary-600 font-semibold text-sm flex-shrink-0">
                  {request.employee?.firstName?.charAt(0)}{request.employee?.lastName?.charAt(0)}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">
                    {request.employee?.firstName} {request.employee?.lastName}
                  </p>
                  <p className="text-xs text-gray-500">
                    {request.leaveType?.name} - {request.numberOfDays} day(s)
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                <span className={`px-2 py-1 text-xs rounded-full ${request.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                    request.status === 'approved' ? 'bg-green-100 text-green-700' :
                      'bg-red-100 text-red-700'
                  }`}>
                  {request.status}
                </span>

                {request.status === 'pending' && onApprove && onReject && (
                  <div className="flex gap-1">
                    <button
                      onClick={() => onApprove(request._id)}
                      className="p-1.5 bg-green-100 text-green-600 rounded hover:bg-green-200 transition-colors"
                      title="Approve"
                    >
                      <FaCheck className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => onReject(request._id)}
                      className="p-1.5 bg-red-100 text-red-600 rounded hover:bg-red-200 transition-colors"
                      title="Reject"
                    >
                      <FaTimes className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
