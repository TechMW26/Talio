'use client'

import { FaClock, FaSignInAlt, FaSignOutAlt, FaCheckCircle } from 'react-icons/fa'
import { useMemo, useState, useEffect } from 'react'
import { Card, CardBody, Chip } from '@heroui/react'

// Helper to calculate displayed status based on time and settings
function getDisplayedStatus(todayAttendance, companySettings) {
  // If user has an attendance record with check-in, show actual status
  if (todayAttendance?.checkIn) {
    if (todayAttendance.workFromHome) return { status: 'wfh', label: 'WFH', color: 'secondary' }
    if (todayAttendance.status === 'present') return { status: 'present', label: 'Present', color: 'success' }
    if (todayAttendance.status === 'half-day') return { status: 'half-day', label: 'Half Day', color: 'warning' }
    if (todayAttendance.status === 'in-progress') return { status: 'in-progress', label: 'In Progress', color: 'primary' }
    if (todayAttendance.status === 'on-leave') return { status: 'on-leave', label: 'On Leave', color: 'warning' }
    if (todayAttendance.status === 'absent') return { status: 'absent', label: 'Absent', color: 'danger' }
    return { status: 'in-progress', label: 'In Progress', color: 'primary' }
  }

  // If on approved leave
  if (todayAttendance?.status === 'on-leave') {
    return { status: 'on-leave', label: 'On Leave', color: 'warning' }
  }

  // If attendance record exists with absent status (e.g., auto-marked)
  if (todayAttendance?.status === 'absent') {
    return { status: 'absent', label: 'Absent', color: 'danger' }
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
    return { status: 'not-started', label: 'Not Started', color: 'default' }
  }

  // If current time is past the absent threshold, show "Absent"
  if (now >= absentThresholdTime) {
    return { status: 'absent', label: 'Absent', color: 'danger' }
  }

  // Between office start and absent threshold - show "Not Checked In"
  return { status: 'not-checked-in', label: 'Not Checked In', color: 'warning' }
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
          <h3 className="text-base sm:text-lg font-bold text-default-900">Quick Glance</h3>
        </div>
        <div className="flex items-center gap-2">
          <Chip
            size="sm"
            variant="flat"
            color={isCountingDown
              ? remainingTime > 3600 ? 'success'
                : remainingTime > 1800 ? 'warning'
                  : 'danger'
              : 'default'
            }
            startContent={<FaClock className="w-3 h-3" />}
          >
            {formatCountdown(remainingTime)}
          </Chip>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 flex-1">
        {/* Check In Time */}
        <Card className="bg-success-50 dark:bg-success-900/30 border border-success-100 dark:border-transparent">
          <CardBody className="p-3">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-6 h-6 rounded-full bg-success-100 flex items-center justify-center">
                <FaSignInAlt className="w-3 h-3 text-success-600" />
              </div>
              <p className="text-xs font-medium text-default-600">Check In</p>
            </div>
            <p className="text-lg font-bold text-default-900">
              {todayAttendance?.checkIn
                ? new Date(todayAttendance.checkIn).toLocaleTimeString('en-IN', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true
              })
              : '--:--'}
            </p>
          </CardBody>
        </Card>

        {/* Check Out Time */}
        <Card className="bg-danger-50 dark:bg-danger-900/30 border border-danger-100 dark:border-transparent">
          <CardBody className="p-3">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-6 h-6 rounded-full bg-danger-100 flex items-center justify-center">
                <FaSignOutAlt className="w-3 h-3 text-danger-600" />
              </div>
              <p className="text-xs font-medium text-default-600">Check Out</p>
            </div>
            <p className="text-lg font-bold text-default-900">
              {todayAttendance?.checkOut
                ? new Date(todayAttendance.checkOut).toLocaleTimeString('en-IN', {
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: true
                })
                : '--:--'}
            </p>
          </CardBody>
        </Card>

        {/* Work Hours */}
        <Card className="bg-primary-50 dark:bg-primary-900/30 border border-primary-100 dark:border-transparent">
          <CardBody className="p-3">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-6 h-6 rounded-full bg-primary-100 flex items-center justify-center">
                <FaClock className="w-3 h-3 text-primary-600" />
              </div>
              <p className="text-xs font-medium text-default-600">Work Hours</p>
            </div>
            <p className="text-lg font-bold text-default-900">
              {currentWorkHours}
            </p>
          </CardBody>
        </Card>

        {/* Work Status */}
        <Card className="bg-secondary-50 dark:bg-secondary-900/30 border border-secondary-100 dark:border-transparent">
          <CardBody className="p-3">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-6 h-6 rounded-full bg-secondary-100 flex items-center justify-center">
                <FaCheckCircle className="w-3 h-3 text-secondary-600" />
              </div>
              <p className="text-xs font-medium text-default-600">Status</p>
            </div>
            <Chip size="sm" color={displayedStatus.color} variant="flat" className="capitalize">
              {displayedStatus.label}
            </Chip>
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
