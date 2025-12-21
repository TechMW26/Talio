'use client'

import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import { FaCheck, FaTimes, FaEye, FaFileInvoiceDollar, FaUser } from 'react-icons/fa'
import { getCurrentUser } from '@/utils/userHelper'
import { useRouter } from 'next/navigation'

export default function ExpenseApprovalsPage() {
  const [expenses, setExpenses] = useState([])
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState(null)
  const router = useRouter()

  useEffect(() => {
    const parsedUser = getCurrentUser()
    if (parsedUser) {
      setUser(parsedUser)
      if (['admin', 'hr', 'manager', 'department_head'].includes(parsedUser.role)) {
        fetchPendingExpenses()
      } else {
        toast.error('Unauthorized access')
        router.push('/dashboard/expenses')
      }
    }
  }, [])

  const fetchPendingExpenses = async () => {
    try {
      const token = localStorage.getItem('token')
      // Fetch all submitted expenses
      const response = await fetch('/api/expenses?status=submitted', {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      const data = await response.json()
      if (data.success) {
        setExpenses(data.data || [])
      } else {
        toast.error(data.message || 'Failed to fetch expenses')
      }
    } catch (error) {
      console.error('Fetch expenses error:', error)
      toast.error('Failed to fetch expenses')
    } finally {
      setLoading(false)
    }
  }

  const handleAction = async (expenseId, action, reason = '') => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/expenses/${expenseId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          status: action, // 'approved' or 'rejected'
          approvedBy: user.employeeId?._id || user.employeeId, // Assuming user object structure
          approvedDate: new Date(),
          rejectionReason: reason
        })
      })

      const data = await response.json()
      if (data.success) {
        toast.success(`Expense ${action} successfully`)
        fetchPendingExpenses() // Refresh list
      } else {
        toast.error(data.message || `Failed to ${action} expense`)
      }
    } catch (error) {
      console.error('Action error:', error)
      toast.error(`Failed to ${action} expense`)
    }
  }

  if (loading) {
    return (
      <div className="p-6 flex justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
      </div>
    )
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Expense Approvals</h1>
        <p className="text-gray-600">Review and approve employee expense claims</p>
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
                  <button
                    onClick={() => {
                      const reason = prompt('Enter rejection reason:')
                      if (reason) handleAction(expense._id, 'rejected', reason)
                    }}
                    className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors"
                  >
                    <FaTimes /> Reject
                  </button>
                  <button
                    onClick={() => handleAction(expense._id, 'approved')}
                    className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors shadow-sm"
                  >
                    <FaCheck /> Approve
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
