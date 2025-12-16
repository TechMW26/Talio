'use client'

import { useState, useEffect } from 'react'
import { FaCalendarCheck, FaCalendarTimes, FaClock } from 'react-icons/fa'

export default function AttendanceSummaryWidget({ employeeId }) {
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (employeeId) {
      fetchAttendanceSummary()
    }
  }, [employeeId])

  const fetchAttendanceSummary = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/attendance/summary?employeeId=${employeeId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await response.json()
      if (data.success) {
        setSummary(data.data)
      }
    } catch (error) {
      console.error('Error fetching attendance summary:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="p-4 sm:p-6 animate-pulse">
        <div className="h-6 bg-gray-200 rounded w-1/3 mb-4"></div>
        <div className="grid grid-cols-3 gap-4">
          <div className="h-20 bg-gray-200 rounded"></div>
          <div className="h-20 bg-gray-200 rounded"></div>
          <div className="h-20 bg-gray-200 rounded"></div>
        </div>
      </div>
    )
  }

  const currentMonth = new Date().toLocaleString('default', { month: 'long' })

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center gap-2 mb-4">
        <FaClock className="w-5 h-5 text-primary-500" />
        <h3 className="text-base sm:text-lg font-bold text-gray-800">
          Attendance - {currentMonth}
        </h3>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {/* Present Days */}
        <div className="bg-gray-50 rounded-lg p-3 text-center">
          <div className="w-10 h-10 mx-auto mb-2 bg-green-100 rounded-full flex items-center justify-center">
            <FaCalendarCheck className="w-5 h-5 text-green-600" />
          </div>
          <p className="text-xl font-bold text-green-600">{summary?.presentDays || 0}</p>
          <p className="text-xs text-gray-600">Present</p>
        </div>

        {/* Absent Days */}
        <div className="bg-gray-50 rounded-lg p-3 text-center">
          <div className="w-10 h-10 mx-auto mb-2 bg-red-100 rounded-full flex items-center justify-center">
            <FaCalendarTimes className="w-5 h-5 text-red-600" />
          </div>
          <p className="text-xl font-bold text-red-600">{summary?.absentDays || 0}</p>
          <p className="text-xs text-gray-600">Absent</p>
        </div>

        {/* Avg Hours */}
        <div className="bg-gray-50 rounded-lg p-3 text-center">
          <div className="w-10 h-10 mx-auto mb-2 bg-primary-100 rounded-full flex items-center justify-center">
            <FaClock className="w-5 h-5 text-primary-600" />
          </div>
          <p className="text-xl font-bold text-primary-600">{summary?.avgHours || '0'}h</p>
          <p className="text-xs text-gray-600">Avg Hours</p>
        </div>
      </div>
    </div>
  )
}
