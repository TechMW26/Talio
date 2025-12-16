'use client'
import { useState, useEffect } from 'react'
import { FaMoneyBillWave, FaPlus } from 'react-icons/fa'
import { useRouter } from 'next/navigation'
import { getEmployeeId } from '@/utils/userHelper'

export default function MyExpensesWidget({ user }) {
  const router = useRouter()
  const [expenses, setExpenses] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (user) fetchExpenses()
  }, [user])

  const fetchExpenses = async () => {
    try {
      const employeeId = getEmployeeId(user)
      if (!employeeId) return
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/expenses?employeeId=${employeeId}&limit=3`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await response.json()
      if (data.success) setExpenses(data.data)
    } catch (error) {
      console.error('Error fetching expenses:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="p-4 sm:p-6 animate-pulse flex-1 flex flex-col h-full">
        <div className="h-6 bg-gray-200 rounded w-1/3 mb-4"></div>
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-12 bg-gray-200 rounded"></div>
          ))}
        </div>
      </div>
    )
  }

  return (
  <div className="p-4 sm:p-6 flex-1 flex flex-col h-full">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base sm:text-lg font-bold text-gray-800">Expenses</h3>
        <button 
          onClick={() => router.push('/dashboard/expenses')}
          className="text-primary-600 hover:text-primary-800 text-sm font-medium flex items-center gap-1"
        >
          <FaPlus className="w-3 h-3" /> Add
        </button>
      </div>
      {expenses.length === 0 ? (
        <div className="text-center py-6 text-gray-500">
          <FaMoneyBillWave className="w-8 h-8 mx-auto mb-2 text-gray-400" />
          <p className="text-sm">No recent expenses</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {expenses.slice(0, 5).map(expense => (
            <div key={expense._id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-800 capitalize truncate">{expense.category}</p>
                <p className="text-xs text-gray-500">{new Date(expense.date || expense.createdAt).toLocaleDateString()}</p>
              </div>
              <span className="text-sm font-bold text-gray-700">${expense.amount}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
