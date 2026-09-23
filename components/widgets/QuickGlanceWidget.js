'use client'

import { FaClock, FaSignInAlt, FaSignOutAlt, FaCheckCircle } from 'react-icons/fa'
import { useMemo, useState, useEffect } from 'react'
import styles from './QuickGlanceWidget.module.css'

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

  const formatTime = value => value && !Number.isNaN(new Date(value).getTime())
    ? new Date(value).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
    : '--:--'
  const tiles = [
    { label: 'Check In', description: 'Time you started work', value: formatTime(todayAttendance?.checkIn), icon: FaSignInAlt, color: '39, 234, 179' },
    { label: 'Check Out', description: 'Time you finished work', value: formatTime(todayAttendance?.checkOut), icon: FaSignOutAlt, color: '255, 113, 151' },
    { label: 'Work Hours', description: 'Total time worked today', value: currentWorkHours, icon: FaClock, color: '167, 184, 210' },
    { label: 'Status', description: 'Current attendance status', value: displayedStatus.label, icon: FaCheckCircle, color: '104, 174, 255' },
  ]
  const timerColor = !isCountingDown ? '167, 184, 210' : remainingTime > 3600 ? '39, 234, 179' : remainingTime > 1800 ? '255, 204, 70' : '255, 113, 131'

  return (
    <section className={styles.panel} aria-label="Quick Glance">
      <div className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.clock}><FaClock aria-hidden="true" /></span>
          <div><h3>Quick Glance</h3><p>Your attendance overview for today</p></div>
        </div>
        <span className={styles.timer} style={{ '--accent': timerColor }} aria-label="Remaining work time">
          <i aria-hidden="true" />{formatCountdown(remainingTime)}
        </span>
      </div>
      <div className={styles.grid}>
        {tiles.map(({ label, description, value, icon: Icon, color }) => (
          <div className={styles.tile} key={label} style={{ '--accent': color }}>
            {label === 'Work Hours' ? <div className={styles.bars} aria-hidden="true">{[28, 46, 66, 88].map(height => <i key={height} style={{ height: height + '%' }} />)}</div> : label === 'Status' ? <FaCheckCircle className={styles.watermark} aria-hidden="true" /> : <FaClock className={styles.watermark} aria-hidden="true" />}
            <div className={styles.tileHeading}>
              <span className={styles.icon}><Icon aria-hidden="true" /></span>
              <div><h4>{label}</h4><p>{description}</p></div>
            </div>
            {label === 'Status' ? <span className={styles.status} data-status={displayedStatus.status}><i aria-hidden="true" />{value}</span> : <p className={styles.value}>{value}</p>}
          </div>
        ))}
      </div>
    </section>
  )
}
