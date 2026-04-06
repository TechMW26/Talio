'use client'

import useAuthedSWR from '@/hooks/useAuthedSWR'
import { FaCalendarCheck, FaCalendarTimes, FaClock, FaExclamationTriangle } from 'react-icons/fa'
import { Skeleton } from '@heroui/react'

export default function AttendanceSummaryWidget({ employeeId }) {
  const { data, error, isLoading } = useAuthedSWR(
    employeeId ? `/api/attendance/summary?employeeId=${employeeId}` : null,
    { refreshInterval: 120_000 }
  )

  const summary = data?.data

  if (isLoading) {
    return (
      <div className="p-4 sm:p-5 flex-1 flex flex-col h-full">
        <Skeleton className="h-5 w-1/3 rounded-lg mb-4" />
        <div className="grid grid-cols-2 gap-3 flex-1">
          <Skeleton className="rounded-2xl" />
          <Skeleton className="rounded-2xl" />
          <Skeleton className="rounded-2xl" />
          <Skeleton className="rounded-2xl" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4 sm:p-5 flex-1 flex flex-col h-full">
        <h3 className="text-sm font-semibold text-default-900 mb-4">Attendance</h3>
        <p className="text-sm text-default-500">Unable to load attendance summary.</p>
      </div>
    )
  }

  const currentMonth = new Date().toLocaleString('default', { month: 'long' })

  const stats = [
    {
      label: 'Present',
      value: summary?.presentDays || 0,
      icon: FaCalendarCheck,
      bg: 'bg-emerald-500/10 dark:bg-emerald-500/15',
      iconBg: 'bg-emerald-500/20 dark:bg-emerald-400/20',
      iconColor: 'text-emerald-600 dark:text-emerald-400',
      valueColor: 'text-emerald-600 dark:text-emerald-400',
    },
    {
      label: 'Absent',
      value: summary?.absentDays || 0,
      icon: FaCalendarTimes,
      bg: 'bg-rose-500/10 dark:bg-rose-500/15',
      iconBg: 'bg-rose-500/20 dark:bg-rose-400/20',
      iconColor: 'text-rose-600 dark:text-rose-400',
      valueColor: 'text-rose-600 dark:text-rose-400',
    },
    {
      label: 'Late',
      value: summary?.lateDays || 0,
      icon: FaExclamationTriangle,
      bg: 'bg-amber-500/10 dark:bg-amber-500/15',
      iconBg: 'bg-amber-500/20 dark:bg-amber-400/20',
      iconColor: 'text-amber-600 dark:text-amber-400',
      valueColor: 'text-amber-600 dark:text-amber-400',
    },
    {
      label: 'Avg Hours',
      value: `${summary?.avgHours || '0'}h`,
      icon: FaClock,
      bg: 'bg-blue-500/10 dark:bg-blue-500/15',
      iconBg: 'bg-blue-500/20 dark:bg-blue-400/20',
      iconColor: 'text-blue-600 dark:text-blue-400',
      valueColor: 'text-blue-600 dark:text-blue-400',
    },
  ]

  return (
    <div className="p-4 sm:p-5 flex-1 flex flex-col h-full">
      <h3 className="text-sm font-semibold text-default-900 mb-3">
        Attendance &mdash; {currentMonth}
      </h3>

      <div className="grid grid-cols-2 gap-2.5 flex-1">
        {stats.map(({ label, value, icon: Icon, bg, iconBg, iconColor, valueColor }) => (
          <div
            key={label}
            className={`${bg} rounded-2xl flex flex-col items-center justify-center gap-1.5 p-3 min-h-0`}
          >
            <div className={`w-9 h-9 ${iconBg} rounded-full flex items-center justify-center`}>
              <Icon className={`w-4 h-4 ${iconColor}`} />
            </div>
            <p className={`text-xl font-bold leading-none ${valueColor}`}>{value}</p>
            <p className="text-[11px] font-medium text-default-500">{label}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
