'use client'
import { useState, useEffect } from 'react'
import { FaMoneyBillWave, FaPlus } from 'react-icons/fa'
import { useRouter } from 'next/navigation'
import { getEmployeeId } from '@/utils/userHelper'
import { Card, CardBody, Button, Skeleton, ScrollShadow } from '@heroui/react'

export default function MyExpensesWidget({ user, initialData }) {
  const router = useRouter()
  const [expenses, setExpenses] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Data provided from unified dashboard call (including empty array)
    if (initialData !== undefined) {
      setExpenses(initialData)
      setLoading(false)
      return
    }
    // undefined = standalone mode, self-fetch
    if (user) fetchExpenses()
  }, [user, initialData])

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
      <div className="p-4 sm:p-6 flex-1 flex flex-col h-full">
        <Skeleton className="h-6 w-1/3 rounded-lg mb-4" />
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="flex items-center gap-3">
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-3/4 rounded-lg" />
                <Skeleton className="h-3 w-1/2 rounded-lg" />
              </div>
              <Skeleton className="h-5 w-16 rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 flex-1 flex flex-col h-full">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base sm:text-lg font-bold text-default-900">Expenses</h3>
        <Button
          variant="light"
          color="primary"
          size="sm"
          startContent={<FaPlus className="w-3 h-3" />}
          onPress={() => router.push('/dashboard/expenses')}
        >
          Add
        </Button>
      </div>
      <ScrollShadow className="space-y-2 max-h-[200px]">
        {expenses.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center py-6">
            <img
              src="/assets/Expense.png"
              alt="No expenses yet"
              className="w-24 h-24 object-contain mb-3"
            />
            <p className="text-sm text-default-500">No expenses yet</p>
          </div>
        ) : (
          expenses.slice(0, 5).map(expense => (
            <Card key={expense._id} className="border border-default-100">
              <CardBody className="p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-default-900 capitalize truncate">{expense.category}</p>
                    <p className="text-xs text-default-500">{new Date(expense.date || expense.createdAt).toLocaleDateString()}</p>
                  </div>
                  <span className="text-sm font-bold text-default-700">${expense.amount}</span>
                </div>
              </CardBody>
            </Card>
          ))
        )}
      </ScrollShadow>
    </div>
  )
}
