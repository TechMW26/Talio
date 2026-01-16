'use client'

import useAuthedSWR from '@/hooks/useAuthedSWR'
import { FaCalendarCheck, FaCalendarTimes, FaClock } from 'react-icons/fa'

export default function AttendanceSummaryWidget({ employeeId }) {
  const { data, error, isLoading } = useAuthedSWR(
    employeeId ? `/api/attendance/summary?employeeId=${employeeId}` : null,
    { refreshInterval: 120_000 }
  )

  const summary = data?.data

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 animate-pulse flex-1 flex flex-col h-full">
        <div className="h-6 bg-gray-200 rounded w-1/3 mb-4"></div>
        <div className="grid grid-cols-3 gap-4">
          <div className="h-20 bg-gray-200 rounded"></div>
          <div className="h-20 bg-gray-200 rounded"></div>
          <div className="h-20 bg-gray-200 rounded"></div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4 sm:p-6 flex-1 flex flex-col h-full">
        <h3 className="text-base sm:text-lg font-bold text-gray-800 mb-4">Attendance</h3>
        <p className="text-sm text-gray-500">Unable to load attendance summary.</p>
      </div>
    )
  }

  const currentMonth = new Date().toLocaleString('default', { month: 'long' })

  return (
  <div className="p-4 sm:p-6 flex-1 flex flex-col h-full">
      <div className="mb-4">
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
