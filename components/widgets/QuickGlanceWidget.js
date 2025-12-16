'use client'

import { FaClock, FaSignInAlt, FaSignOutAlt, FaCheckCircle } from 'react-icons/fa'
import { useMemo, useState, useEffect } from 'react'

// Helper to calculate displayed status based on time and settings
function getDisplayedStatus(todayAttendance, companySettings) {
  // If user has an attendance record with check-in, show actual status
  if (todayAttendance?.checkIn) {
    if (todayAttendance.workFromHome) return { status: 'wfh', label: 'WFH', bgColor: 'bg-purple-100' }
    if (todayAttendance.status === 'present') return { status: 'present', label: 'Present', bgColor: 'bg-green-100' }
    if (todayAttendance.status === 'half-day') return { status: 'half-day', label: 'Half Day', bgColor: 'bg-yellow-100' }
    if (todayAttendance.status === 'in-progress') return { status: 'in-progress', label: 'In Progress', bgColor: 'bg-blue-100' }
    if (todayAttendance.status === 'on-leave') return { status: 'on-leave', label: 'On Leave', bgColor: 'bg-orange-100' }
    if (todayAttendance.status === 'absent') return { status: 'absent', label: 'Absent', bgColor: 'bg-red-100' }
    return { status: 'in-progress', label: 'In Progress', bgColor: 'bg-blue-100' }
  }

  // If on approved leave
  if (todayAttendance?.status === 'on-leave') {
    return { status: 'on-leave', label: 'On Leave', bgColor: 'bg-orange-100' }
  }

  // If attendance record exists with absent status (e.g., auto-marked)
  if (todayAttendance?.status === 'absent') {
    return { status: 'absent', label: 'Absent', bgColor: 'bg-red-100' }
  }

  // No check-in yet - calculate based on time and thresholds
  const now = new Date()
  const checkInTime = companySettings?.checkInTime || '09:00'
  const absentThresholdMinutes = companySettings?.absentThresholdMinutes || 60

  // Parse check-in time
  const [checkInHour, checkInMinute] = checkInTime.split(':').map(Number)
  
  // Create office start time for today
  const officeStart = new Date(now)
  officeStart.setHours(checkInHour, checkInMinute, 0, 0)

  // Calculate absent threshold time (checkIn + absentThresholdMinutes)
  const absentThresholdTime = new Date(officeStart)
  absentThresholdTime.setMinutes(absentThresholdTime.getMinutes() + absentThresholdMinutes)

  // If it's before office hours, show "Not Started"
  if (now < officeStart) {
    return { status: 'not-started', label: 'Not Started', bgColor: 'bg-gray-100' }
  }

  // If current time is past the absent threshold, show "Absent"
  if (now >= absentThresholdTime) {
    return { status: 'absent', label: 'Absent', bgColor: 'bg-red-100' }
  }

  // Between office start and absent threshold - show "Not Checked In"
  return { status: 'not-checked-in', label: 'Not Checked In', bgColor: 'bg-amber-100' }
}

export default function QuickGlanceWidget({
  todayAttendance,
  remainingTime,
  isCountingDown,
  formatCountdown,
  companySettings,
}) {
  // Calculate displayed status
  const displayedStatus = useMemo(() => 
    getDisplayedStatus(todayAttendance, companySettings),
    [todayAttendance, companySettings]
  )

  // State to track dynamic work hours (updates every minute)
  const [currentWorkHours, setCurrentWorkHours] = useState('')

  // Calculate work hours dynamically
  useEffect(() => {
    const calculateWorkHours = () => {
      // If already checked out, use the stored workHours
      if (todayAttendance?.checkOut) {
        const hours = todayAttendance.workHours
        if (hours) {
          // Format as Xh Ym
          const h = Math.floor(hours)
          const m = Math.round((hours - h) * 60)
          setCurrentWorkHours(m > 0 ? `${h}h ${m}m` : `${h}h`)
        } else {
          // Calculate from checkIn and checkOut
          const checkIn = new Date(todayAttendance.checkIn)
          const checkOut = new Date(todayAttendance.checkOut)
          const diffMs = checkOut - checkIn
          const diffHours = diffMs / (1000 * 60 * 60)
          const h = Math.floor(diffHours)
          const m = Math.round((diffHours - h) * 60)
          setCurrentWorkHours(m > 0 ? `${h}h ${m}m` : `${h}h`)
        }
        return
      }

      // If checked in but not checked out, calculate live hours
      if (todayAttendance?.checkIn) {
        const checkIn = new Date(todayAttendance.checkIn)
        const now = new Date()
        const diffMs = now - checkIn
        const diffHours = diffMs / (1000 * 60 * 60)
        
        if (diffHours < 0) {
          setCurrentWorkHours('0h 0m')
          return
        }
        
        const h = Math.floor(diffHours)
        const m = Math.round((diffHours - h) * 60)
        setCurrentWorkHours(m > 0 ? `${h}h ${m}m` : `${h}h`)
        return
      }

      // No check-in yet
      setCurrentWorkHours('--:--')
    }

    // Calculate immediately
    calculateWorkHours()

    // Update every minute if user is checked in but not checked out
    let intervalId = null
    if (todayAttendance?.checkIn && !todayAttendance?.checkOut) {
      intervalId = setInterval(calculateWorkHours, 60000) // Update every minute
    }

    return () => {
      if (intervalId) clearInterval(intervalId)
    }
  }, [todayAttendance])

  return (
    <div className="p-4 sm:p-6 flex-1 flex flex-col h-full">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <FaClock className="w-5 h-5 text-primary-500" />
          <h3 className="text-base sm:text-lg font-bold text-gray-800">Quick Glance</h3>
        </div>
        <div className="flex items-center gap-2">
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg ${isCountingDown
              ? remainingTime > 3600 ? 'bg-green-100'
                : remainingTime > 1800 ? 'bg-yellow-100'
                  : 'bg-red-100'
              : 'bg-gray-100'
            }`}>
            <FaClock className={`w-3.5 h-3.5 ${isCountingDown
                ? remainingTime > 3600 ? 'text-green-600'
                  : remainingTime > 1800 ? 'text-yellow-600'
                    : 'text-red-600'
                : 'text-gray-600'
              }`} />
            <span className={`text-sm font-bold ${isCountingDown
                ? remainingTime > 3600 ? 'text-green-700'
                  : remainingTime > 1800 ? 'text-yellow-700'
                    : 'text-red-700'
                : 'text-gray-700'
              }`}>
              {formatCountdown(remainingTime)}
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 flex-1">
        {/* Check In Time */}
        <div className="bg-gray-50 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center">
              <FaSignInAlt className="w-3 h-3 text-green-600" />
            </div>
            <p className="text-xs font-medium text-gray-600">Check In</p>
          </div>
          <p className="text-lg font-bold text-gray-800">
            {todayAttendance?.checkIn
              ? new Date(todayAttendance.checkIn).toLocaleTimeString('en-IN', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true
              })
              : '--:--'}
          </p>
        </div>

        {/* Check Out Time */}
        <div className="bg-gray-50 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-6 h-6 rounded-full bg-red-100 flex items-center justify-center">
              <FaSignOutAlt className="w-3 h-3 text-red-600" />
            </div>
            <p className="text-xs font-medium text-gray-600">Check Out</p>
          </div>
          <p className="text-lg font-bold text-gray-800">
            {todayAttendance?.checkOut
              ? new Date(todayAttendance.checkOut).toLocaleTimeString('en-IN', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true
              })
              : '--:--'}
          </p>
        </div>

        {/* Work Hours */}
        <div className="bg-gray-50 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-6 h-6 rounded-full bg-primary-100 flex items-center justify-center">
              <FaClock className="w-3 h-3 text-primary-600" />
            </div>
            <p className="text-xs font-medium text-gray-600">Work Hours</p>
          </div>
          <p className="text-lg font-bold text-gray-800">
            {currentWorkHours}
          </p>
        </div>

        {/* Work Status */}
        <div className="bg-gray-50 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-6 h-6 rounded-full bg-purple-100 flex items-center justify-center">
              <FaCheckCircle className="w-3 h-3 text-purple-600" />
            </div>
            <p className="text-xs font-medium text-gray-600">Status</p>
          </div>
          <p className={`text-sm font-bold capitalize ${
            displayedStatus.status === 'present' || displayedStatus.status === 'in-progress' ? 'text-green-700' :
            displayedStatus.status === 'absent' ? 'text-red-700' :
            displayedStatus.status === 'on-leave' ? 'text-orange-700' :
            'text-gray-700'
          }`}>
            {displayedStatus.label}
          </p>
        </div>
      </div>
    </div>
  )
}
