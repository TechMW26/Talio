'use client'

import useAuthedSWR from '@/hooks/useAuthedSWR'
import { FaCalendarCheck, FaCalendarTimes, FaClock } from 'react-icons/fa'
import { Card, CardBody, Skeleton } from '@heroui/react'

export default function AttendanceSummaryWidget({ employeeId }) {
  const { data, error, isLoading } = useAuthedSWR(
    employeeId ? `/api/attendance/summary?employeeId=${employeeId}` : null,
    { refreshInterval: 120_000 }
  )

  const summary = data?.data

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 flex-1 flex flex-col h-full">
        <Skeleton className="h-6 w-1/3 rounded-lg mb-4" />
        <div className="grid grid-cols-3 gap-4">
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4 sm:p-6 flex-1 flex flex-col h-full">
        <h3 className="text-base sm:text-lg font-bold text-default-900 mb-4">Attendance</h3>
        <p className="text-sm text-default-500">Unable to load attendance summary.</p>
      </div>
    )
  }

  const currentMonth = new Date().toLocaleString('default', { month: 'long' })

  return (
    <div className="p-4 sm:p-6 flex-1 flex flex-col h-full">
      <div className="mb-4">
        <h3 className="text-base sm:text-lg font-bold text-default-900">
          Attendance - {currentMonth}
        </h3>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {/* Present Days */}
        <Card className="bg-success-50 border border-success-100">
          <CardBody className="p-3 text-center">
            <div className="w-10 h-10 mx-auto mb-2 bg-success-100 rounded-full flex items-center justify-center">
              <FaCalendarCheck className="w-5 h-5 text-success-600" />
            </div>
            <p className="text-xl font-bold text-success-600">{summary?.presentDays || 0}</p>
            <p className="text-xs text-default-600">Present</p>
          </CardBody>
        </Card>

        {/* Absent Days */}
        <Card className="bg-danger-50 border border-danger-100">
          <CardBody className="p-3 text-center">
            <div className="w-10 h-10 mx-auto mb-2 bg-danger-100 rounded-full flex items-center justify-center">
              <FaCalendarTimes className="w-5 h-5 text-danger-600" />
            </div>
            <p className="text-xl font-bold text-danger-600">{summary?.absentDays || 0}</p>
            <p className="text-xs text-default-600">Absent</p>
          </CardBody>
        </Card>

        {/* Avg Hours */}
        <Card className="bg-primary-50 border border-primary-100">
          <CardBody className="p-3 text-center">
            <div className="w-10 h-10 mx-auto mb-2 bg-primary-100 rounded-full flex items-center justify-center">
              <FaClock className="w-5 h-5 text-primary-600" />
            </div>
            <p className="text-xl font-bold text-primary-600">{summary?.avgHours || '0'}h</p>
            <p className="text-xs text-default-600">Avg Hours</p>
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
