'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import toast from '@/utils/toast'

export default function RemindersPage() {
  const [reminders, setReminders] = useState([])
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('pending')

  useEffect(() => {
    fetchReminders()
  }, [filter])

  const fetchReminders = async () => {
    try {
      const token = localStorage.getItem('superadmin_token')
      const res = await fetch(`/api/superadmin/reminders?status=${filter}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (data.success) {
        setReminders(data.reminders)
        setStats(data.stats)
      } else {
        toast.error(data.message)
      }
    } catch (error) {
      toast.error('Failed to fetch reminders')
    } finally {
      setLoading(false)
    }
  }

  const completeReminder = async (companyId, reminderId) => {
    try {
      const token = localStorage.getItem('superadmin_token')
      const res = await fetch(`/api/superadmin/companies/${companyId}/reminders`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ reminderId, status: 'completed' }),
      })
      const data = await res.json()
      if (data.success) {
        toast.success('Reminder completed')
        fetchReminders()
      }
    } catch (error) {
      toast.error('Failed to update reminder')
    }
  }

  return (
    <div className="p-6 lg:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-gray-900">Reminders</h1>
          <p className="text-gray-500 mt-1">All reminders across companies</p>
        </div>

        {/* Stats */}
        {stats && (
          <div className="flex gap-3">
            <div className="px-4 py-2 bg-white rounded-xl border border-gray-200 shadow-sm">
              <span className="text-gray-500 text-sm">Total:</span>
              <span className="text-gray-900 font-semibold ml-2">{stats.total}</span>
            </div>
            <div className="px-4 py-2 bg-red-50 rounded-xl border border-red-200">
              <span className="text-red-700 text-sm">Overdue:</span>
              <span className="text-red-700 font-semibold ml-2">{stats.overdue}</span>
            </div>
            <div className="px-4 py-2 bg-yellow-50 rounded-xl border border-yellow-200">
              <span className="text-yellow-700 text-sm">This Week:</span>
              <span className="text-yellow-700 font-semibold ml-2">{stats.upcoming}</span>
            </div>
          </div>
        )}
      </div>

      {/* Filter */}
      <div className="flex gap-2">
        <button
          onClick={() => setFilter('pending')}
          className={`px-4 py-2 rounded-xl transition-colors ${
            filter === 'pending'
              ? 'bg-purple-600 text-white'
              : 'bg-white text-gray-600 border border-gray-200 hover:text-gray-900 hover:border-gray-300'
          }`}
        >
          Pending
        </button>
        <button
          onClick={() => setFilter('completed')}
          className={`px-4 py-2 rounded-xl transition-colors ${
            filter === 'completed'
              ? 'bg-purple-600 text-white'
              : 'bg-white text-gray-600 border border-gray-200 hover:text-gray-900 hover:border-gray-300'
          }`}
        >
          Completed
        </button>
      </div>

      {/* Reminders List */}
      {loading ? (
        <div className="space-y-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-24 bg-gray-100 rounded-2xl animate-pulse"></div>
          ))}
        </div>
      ) : reminders.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">No {filter} reminders</h3>
          <p className="text-gray-500">All caught up!</p>
        </div>
      ) : (
        <div className="space-y-4">
          {reminders.map((reminder) => {
            const isOverdue = new Date(reminder.dueDate) < new Date() && filter === 'pending'
            return (
              <div
                key={reminder._id}
                className={`bg-white rounded-2xl p-5 border shadow-sm ${
                  isOverdue ? 'border-red-300' : 'border-gray-200'
                }`}
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <Link
                        href={`/superadmin/companies/${reminder.companyId}`}
                        className="text-purple-600 hover:text-purple-700 font-medium"
                      >
                        {reminder.companyName}
                      </Link>
                      <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${
                        reminder.priority === 'urgent' ? 'bg-red-100 text-red-700' :
                        reminder.priority === 'high' ? 'bg-orange-100 text-orange-700' :
                        reminder.priority === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>
                        {reminder.priority}
                      </span>
                    </div>
                    <h3 className="text-gray-900 font-medium text-lg">{reminder.title}</h3>
                    {reminder.description && (
                      <p className="text-gray-500 text-sm mt-1">{reminder.description}</p>
                    )}
                    <p className={`text-sm mt-2 ${isOverdue ? 'text-red-600' : 'text-gray-500'}`}>
                      Due: {new Date(reminder.dueDate).toLocaleDateString()}
                      {isOverdue && ' (Overdue)'}
                    </p>
                  </div>

                  {filter === 'pending' && (
                    <button
                      onClick={() => completeReminder(reminder.companyId, reminder._id)}
                      className="flex items-center gap-2 px-4 py-2 bg-green-100 text-green-700 rounded-xl hover:bg-green-200 transition-colors"
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Complete
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
