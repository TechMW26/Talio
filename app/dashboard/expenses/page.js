'use client'
import { DialogSurface } from '@/components/ui/fernly'
import { NativeTable } from '@/components/ui/fernly'


import { Heading1, Heading2, NativeInput, NativeTextarea } from '@/components/ui/fernly/native'
import { useState, useMemo } from 'react'
import toast from '@/utils/toast'
import { useSocket, REALTIME_EVENTS } from '@/contexts/SocketContext'
import { FaPlus } from 'react-icons/fa'
import { getCurrentUser, getEmployeeId } from '@/utils/userHelper'
import ModalPortal from '@/components/ui/ModalPortal'
import { Select, SelectItem, Button, Skeleton, Card, CardBody, Chip } from '@/components/ui/fernly'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import useApiMutation from '@/hooks/useApiMutation'
import LoadingButton from '@/components/ui/LoadingButton'
import { DataErrorState } from '@/components/ui/ErrorBoundary'
import BackgroundRefreshIndicator from '@/components/ui/BackgroundRefreshIndicator'
import styles from './expenses.module.css'
import { SummaryCard } from '@/components/ui/fernly'

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
    <div className="p-4 sm:p-6">
      {/* Header */}
      <div className="flex md:justify-between md:items-center md:flex-row flex-col gap-4 mb-6">
        <div>
          <Heading1 className="text-3xl font-bold text-default-800">Expenses</Heading1>
          <p className="text-default-500 mt-1 flex items-center gap-2">
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

      {/* Shared Fernly summary cards, with plain text labels. */}
      <div className={styles.summary}>
        {[
          { label: 'Total Expenses', value: formatCurrency(expenses.reduce((sum, expense) => sum + (expense.amount || 0), 0)) },
          { label: 'Approved', value: formatCurrency(expenses.filter(expense => expense.status === 'approved').reduce((sum, expense) => sum + (expense.amount || 0), 0)) },
          { label: 'Pending', value: formatCurrency(expenses.filter(expense => expense.status === 'pending').reduce((sum, expense) => sum + (expense.amount || 0), 0)) },
          { label: 'Rejected', value: expenses.filter(expense => expense.status === 'rejected').length },
        ].map(({ label, value }) => (
          <SummaryCard key={label} as="section" aria-label={label} label={label}
            value={isLoading ? <Skeleton className="h-9 w-28 rounded-lg" /> : error ? '—' : value} />
        ))}
      </div>

      {/* Expenses Table */}
      <Card as="section" shadow="none" className={styles.card}>
        <div className={styles.tableHeading}>
          <Heading2 className="text-xl font-semibold text-default-800">My Expenses</Heading2>
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
            <NativeTable className={styles.table} aria-label="My Expenses">
              <thead>
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">
                    Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">
                    Category
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">
                    Description
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">
                    Amount
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {expenses.length === 0 ? (
                  <tr>
                    <td colSpan="5" className={styles.empty}>
                      No expenses found
                    </td>
                  </tr>
                ) : (
                  expenses.map((expense) => (
                    <tr key={expense._id}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-default-800">
                        {expense?.expenseDate ? new Date(expense.expenseDate).toLocaleDateString() : 'N/A'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-default-800">
                        {expense?.category || 'N/A'}
                      </td>
                      <td className="px-6 py-4 text-sm text-default-800 max-w-xs truncate">
                        {expense?.description || 'N/A'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-default-800">
                        {formatCurrency(expense?.amount)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <Chip size="sm" variant="flat" color={expense?.status === 'approved' ? 'success' : expense?.status === 'rejected' ? 'danger' : 'warning'}>
                          {expense?.status || 'pending'}
                        </Chip>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </NativeTable>
          </div>
        )}
      </Card>

      {/* Submit Expense Modal */}
      <ModalPortal isOpen={showModal}>
        <div className="modal-overlay">
          <DialogSurface className="bg-white rounded-[30px] animate-modal-enter p-6 w-full max-w-md">
            <Heading2 className="text-2xl font-bold text-default-800 mb-4">Submit Expense</Heading2>
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
                  <NativeInput
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
                  <NativeInput
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
                  <NativeTextarea
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
          </DialogSurface>
        </div>
      </ModalPortal>
    </div>
  )
}

