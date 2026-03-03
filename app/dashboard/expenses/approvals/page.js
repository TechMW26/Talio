'use client'

import { useState, useMemo } from 'react'
import { Skeleton } from '@heroui/react'
import toast from '@/utils/toast'
import { FaCheck, FaTimes, FaEye, FaFileInvoiceDollar, FaUser } from 'react-icons/fa'
import { getCurrentUser } from '@/utils/userHelper'
import { useRouter } from 'next/navigation'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import useApiMutation from '@/hooks/useApiMutation'
import LoadingButton from '@/components/ui/LoadingButton'
import { DataErrorState } from '@/components/ui/ErrorBoundary'
import BackgroundRefreshIndicator from '@/components/ui/BackgroundRefreshIndicator'

export default function ExpenseApprovalsPage() {
  const router = useRouter()
  const [processingId, setProcessingId] = useState(null)

  const user = useMemo(() => {
    const parsedUser = getCurrentUser()
    if (parsedUser && !['admin', 'hr', 'manager', 'department_head'].includes(parsedUser.role)) {
      toast.error('Unauthorized access')
      router.push('/dashboard/expenses')
      return null
    }
    return parsedUser
  }, [])

  // --- SWR data fetching ---
  const { data: expensesRes, error, isLoading, isValidating, mutate: refreshExpenses } = useAuthedSWR(
    user ? '/api/expenses?status=pending' : null
  )
  const expenses = expensesRes?.data || []

  // --- Action mutation (approve/reject) ---
  const actionMutation = useApiMutation({
    method: 'PUT',
    invalidateKeys: ['/api/expenses'],
    onSuccess: (data, { action }) => {
      toast.success(`Expense ${action} successfully`)
      setProcessingId(null)
    },
    onError: (msg) => {
      toast.error(msg || 'Failed to process expense')
      setProcessingId(null)
    },
  })

  const handleAction = (expenseId, action, reason = '') => {
    setProcessingId(expenseId)
    actionMutation.execute(`/api/expenses/${expenseId}`, {
      status: action,
      approvedBy: user?.employeeId?._id || user?.employeeId,
      approvedDate: new Date(),
      rejectionReason: reason
    })
  }

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="mb-6">
          <Skeleton className="h-7 w-48 rounded-lg mb-2" />
          <Skeleton className="h-4 w-64 rounded-lg" />
        </div>
        <div className="grid gap-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-white rounded-lg shadow-md p-6 border-l-4 border-gray-200 space-y-3">
              <div className="flex gap-3">
                <Skeleton className="w-16 h-5 rounded" />
                <Skeleton className="w-24 h-5 rounded" />
              </div>
              <div className="flex items-center gap-3">
                <Skeleton className="w-10 h-10 rounded-full" />
                <div>
                  <Skeleton className="h-4 w-32 rounded-lg mb-1" />
                  <Skeleton className="h-3 w-20 rounded-lg" />
                </div>
              </div>
              <Skeleton className="h-5 w-40 rounded-lg" />
              <Skeleton className="h-8 w-24 rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <DataErrorState message="Failed to load pending expenses" onRetry={() => refreshExpenses()} />
      </div>
    )
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Expense Approvals</h1>
        <p className="text-gray-600 flex items-center gap-2">
          Review and approve employee expense claims
          <BackgroundRefreshIndicator isValidating={isValidating && !isLoading} position="inline" />
        </p>
      </div>

      {expenses.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
          <FaFileInvoiceDollar className="mx-auto text-4xl mb-4 text-gray-300" />
          <p>No pending expense requests found.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {expenses.map((expense) => (
            <div key={expense._id} className="bg-white rounded-lg shadow-md p-6 border-l-4 border-yellow-400">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="px-2 py-1 bg-gray-100 text-xs font-bold rounded text-gray-600">
                      {expense.expenseCode}
                    </span>
                    <span className="text-sm text-gray-500">
                      {new Date(expense.expenseDate).toLocaleDateString()}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center text-primary-600">
                      <FaUser />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-800">
                        {expense.employee?.firstName} {expense.employee?.lastName}
                      </h3>
                      <p className="text-xs text-gray-500">{expense.employee?.employeeCode}</p>
                    </div>
                  </div>

                  <h4 className="text-lg font-medium text-gray-800 mb-1">
                    {expense.category} - {expense.description}
                  </h4>
                  <p className="text-2xl font-bold text-gray-900">
                    {expense.currency} {expense.amount}
                  </p>
                </div>

                <div className="flex gap-3">
                  <LoadingButton
                    onPress={() => {
                      const reason = prompt('Enter rejection reason:')
                      if (reason) handleAction(expense._id, 'rejected', reason)
                    }}
                    color="danger"
                    variant="flat"
                    isLoading={processingId === expense._id && actionMutation.isLoading}
                    isDisabled={processingId !== null && processingId !== expense._id}
                    startContent={<FaTimes />}
                    loadingText="Rejecting..."
                  >
                    Reject
                  </LoadingButton>
                  <LoadingButton
                    onPress={() => handleAction(expense._id, 'approved')}
                    color="success"
                    isLoading={processingId === expense._id && actionMutation.isLoading}
                    isDisabled={processingId !== null && processingId !== expense._id}
                    startContent={<FaCheck />}
                    loadingText="Approving..."
                  >
                    Approve
                  </LoadingButton>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
