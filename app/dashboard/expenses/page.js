'use client'

import { useState, useMemo } from 'react'
import toast from '@/utils/toast'
import { useSocket, REALTIME_EVENTS } from '@/contexts/SocketContext'
import { FaPlus, FaMoneyBillWave, FaCheckCircle, FaClock, FaTimesCircle } from 'react-icons/fa'
import { getCurrentUser, getEmployeeId } from '@/utils/userHelper'
import ModalPortal from '@/components/ui/ModalPortal'
import { Select, SelectItem, Input, Textarea, Button, Skeleton, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@heroui/react'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import useApiMutation from '@/hooks/useApiMutation'
import LoadingButton from '@/components/ui/LoadingButton'
import { DataErrorState } from '@/components/ui/ErrorBoundary'
import BackgroundRefreshIndicator from '@/components/ui/BackgroundRefreshIndicator'

export default function ExpensesPage() {
  const [showModal, setShowModal] = useState(false)
  const [formData, setFormData] = useState({
    category: '',
    amount: '',
    expenseDate: '',
    description: '',
    expenseCode: ''
  })

  const { user, employeeId } = useMemo(() => {
    const parsedUser = getCurrentUser()
    return { user: parsedUser, employeeId: parsedUser ? getEmployeeId(parsedUser) : null }
  }, [])

  // --- SWR data fetching ---
  const swrKey = employeeId ? `/api/expenses?employeeId=${employeeId}` : null
  const { data: expensesRes, error, isLoading, isValidating, mutate: refreshExpenses } = useAuthedSWR(swrKey)
  const expenses = expensesRes?.data || []

  // Real-time updates
  const { socket, isConnected, onExpenseStatusUpdate, subscribe } = useSocket()

  useState(() => {
    if (!socket || !isConnected || !employeeId) return
    const handleExpenseUpdate = () => refreshExpenses()
    const unsub1 = onExpenseStatusUpdate?.(handleExpenseUpdate)
    const unsub2 = subscribe?.(REALTIME_EVENTS.EXPENSE_SUBMITTED, handleExpenseUpdate)
    return () => { unsub1?.(); unsub2?.() }
  })

  // --- Submit mutation ---
  const submitMutation = useApiMutation({
    method: 'POST',
    invalidateKeys: [swrKey],
    onSuccess: () => {
      toast.success('Expense submitted for approval')
      setShowModal(false)
      setFormData({ category: '', amount: '', expenseDate: '', description: '', expenseCode: '' })
    },
    onError: (msg) => toast.error(msg || 'Failed to submit expense'),
  })

  const handleInputChange = (e) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!employeeId) { toast.error('Employee ID not found'); return }
    submitMutation.execute('/api/expenses', {
      ...formData,
      employee: employeeId,
      expenseCode: `EXP-${Date.now()}`
    })
  }

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
    }).format(amount || 0)
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex md:justify-between md:items-center md:flex-row flex-col mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">Expenses</h1>
          <p className="text-gray-600 mt-1 flex items-center gap-2">
            Submit and track your expense claims
            <BackgroundRefreshIndicator isValidating={isValidating && !isLoading} position="inline" />
          </p>
        </div>
        <Button
          onPress={() => setShowModal(true)}
          color="primary"
          startContent={<FaPlus />}
        >
          Submit Expense
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center justify-start mb-2">
            <h3 className="text-sm font-medium text-gray-600">Total Expenses</h3>
            <FaMoneyBillWave className="text-primary-500" />
          </div>
          <div className="text-3xl font-bold text-gray-800">
            {formatCurrency(expenses.reduce((sum, e) => sum + (e.amount || 0), 0))}
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center justify-start mb-2">
            <h3 className="text-sm font-medium text-gray-600">Approved</h3>
            <FaCheckCircle className="text-green-500" />
          </div>
          <div className="text-3xl font-bold text-gray-800">
            {formatCurrency(
              expenses
                .filter(e => e.status === 'approved')
                .reduce((sum, e) => sum + (e.amount || 0), 0)
            )}
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center justify-start mb-2">
            <h3 className="text-sm font-medium text-gray-600">Pending</h3>
            <FaClock className="text-yellow-500" />
          </div>
          <div className="text-3xl font-bold text-gray-800">
            {formatCurrency(
              expenses
                .filter(e => e.status === 'pending')
                .reduce((sum, e) => sum + (e.amount || 0), 0)
            )}
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center justify-start mb-2">
            <h3 className="text-sm font-medium text-gray-600">Rejected</h3>
            <FaTimesCircle className="text-red-500" />
          </div>
          <div className="text-3xl font-bold text-gray-800">
            {expenses.filter(e => e.status === 'rejected').length}
          </div>
        </div>
      </div>

      {/* Expenses Table */}
      <div className="bg-white rounded-lg shadow-md overflow-hidden">
        <div className="p-4 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-800">My Expenses</h2>
        </div>

        {error ? (
          <div className="p-8">
            <DataErrorState message="Failed to load expenses" onRetry={() => refreshExpenses()} />
          </div>
        ) : isLoading ? (
          <div className="p-4 space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex items-center gap-4 py-3 px-6">
                <Skeleton className="h-4 w-24 rounded-lg" />
                <Skeleton className="h-4 w-20 rounded-lg" />
                <Skeleton className="h-4 w-16 rounded-lg" />
                <Skeleton className="h-5 w-20 rounded-full" />
              </div>
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Category
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Description
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Amount
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {expenses.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="px-6 py-4 text-center text-gray-500">
                      No expenses found
                    </td>
                  </tr>
                ) : (
                  expenses.map((expense) => (
                    <tr key={expense._id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {expense?.expenseDate ? new Date(expense.expenseDate).toLocaleDateString() : 'N/A'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {expense?.category || 'N/A'}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900 max-w-xs truncate">
                        {expense?.description || 'N/A'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900">
                        {formatCurrency(expense?.amount)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${expense?.status === 'approved' ? 'bg-green-100 text-green-800' :
                            expense?.status === 'rejected' ? 'bg-red-100 text-red-800' :
                              'bg-yellow-100 text-yellow-800'
                          }`}>
                          {expense?.status || 'pending'}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Submit Expense Modal */}
      <ModalPortal isOpen={showModal}>
        <div className="modal-overlay">
          <div className="bg-white rounded-[30px] animate-modal-enter p-6 w-full max-w-md">
            <h2 className="text-2xl font-bold text-gray-800 mb-4">Submit Expense</h2>
            <form onSubmit={handleSubmit}>
              <div className="space-y-4">
                <div>
                  <Select
                    label="Category"
                    isRequired
                    selectedKeys={formData.category ? [formData.category] : []}
                    onSelectionChange={(keys) => handleInputChange({ target: { name: 'category', value: Array.from(keys)[0] || '' } })}
                    placeholder="Select Category"
                  >
                    <SelectItem key="travel">Travel</SelectItem>
                    <SelectItem key="food">Food</SelectItem>
                    <SelectItem key="accommodation">Accommodation</SelectItem>
                    <SelectItem key="fuel">Fuel</SelectItem>
                    <SelectItem key="office-supplies">Office Supplies</SelectItem>
                    <SelectItem key="client-entertainment">Client Entertainment</SelectItem>
                    <SelectItem key="training">Training</SelectItem>
                    <SelectItem key="other">Other</SelectItem>
                  </Select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Amount
                  </label>
                  <input
                    type="number"
                    name="amount"
                    value={formData.amount}
                    onChange={handleInputChange}
                    required
                    step="0.01"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    placeholder="0.00"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Date
                  </label>
                  <input
                    type="date"
                    name="expenseDate"
                    value={formData.expenseDate}
                    onChange={handleInputChange}
                    required
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Description
                  </label>
                  <textarea
                    name="description"
                    value={formData.description}
                    onChange={handleInputChange}
                    required
                    rows="3"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    placeholder="Enter expense details"
                  />
                </div>
              </div>

              <div className="flex justify-end space-x-4 mt-6">
                <Button
                  type="button"
                  onPress={() => setShowModal(false)}
                  variant="flat"
                >
                  Cancel
                </Button>
                <LoadingButton type="submit" color="primary" isLoading={submitMutation.isLoading} loadingText="Submitting...">
                  Submit
                </LoadingButton>
              </div>
            </form>
          </div>
        </div>
      </ModalPortal>
    </div>
  )
}

