'use client'

import styles from './CheckInOutWidget.module.css'
import { useEffect, useState } from 'react'
import Link from 'next/link'

import { FaSignInAlt, FaSignOutAlt, FaClock, FaCalendarAlt } from 'react-icons/fa'
import { Card, CardBody, Button, Avatar, Chip, Heading2 } from '@/components/ui/fernly'
import { formatDesignation } from '@/lib/formatters'
import LocationAccessStatus from '@/components/attendance/LocationAccessStatus'
import DayCompass from './DayCompass'
import { photoViewportStyle } from '@/lib/profilePhotoViewport'

export default function CheckInOutWidget({
  user,
  employeeData,
  todayAttendance,
  companySettings,
  attendanceLoading,
  onClockIn,
  onClockOut,
  geofence,
  permissionStatus,
  capturedLocation,
  locationError,
  locationLoading,
  onRetryLocation,
  enableDayCompassTasks = false,
  enableMeetingReminders = false,
}) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    setNow(Date.now())
    if (!todayAttendance?.checkIn || todayAttendance?.checkOut) return
    const timer = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(timer)
  }, [todayAttendance?.checkIn, todayAttendance?.checkOut])
  const start = todayAttendance?.checkIn ? +new Date(todayAttendance.checkIn) : NaN
  const end = todayAttendance?.checkOut ? +new Date(todayAttendance.checkOut) : now
  const elapsed = Number.isFinite(start) && Number.isFinite(end) && end >= start ? Math.floor((end - start) / 60000) : null
  const schedule = companySettings?.workingHours || {}
  const shiftStart = formatScheduleTime(companySettings?.checkInTime || schedule.checkInTime)
  const shiftEnd = formatScheduleTime(companySettings?.checkOutTime || schedule.checkOutTime)
  const target = Number(schedule.fullDayHours)

  const getStatus = () => {
    if (todayAttendance?.workFromHome && todayAttendance?.checkIn) return { text: 'WFH', color: 'success' }
    const labels = { 'half-day': 'Half Day', 'on-leave': 'On Leave', absent: 'Absent' }
    if (labels[todayAttendance?.status]) return { text: labels[todayAttendance.status], color: 'warning' }
    if (!todayAttendance?.checkIn) return { text: 'Not Checked In', color: 'warning' }
    if (todayAttendance?.checkOut) return { text: 'Day Complete', color: 'success' }
    return { text: 'Working', color: 'success' }
  }

  const status = getStatus()

  const getDepartmentName = () => {
    const dept = employeeData?.department || user?.department
    if (!dept) return null
    return typeof dept === 'object' ? dept.name : dept
  }

  const getDesignationText = () => {
    const designation = employeeData?.designation || user?.designation
    if (!designation) return null
    return String(formatDesignation(designation, employeeData || user))
  }

  const departmentName = getDepartmentName()
  const designationText = getDesignationText()

  const getUserName = () => {
    if (employeeData) {
      return `${employeeData.firstName || ''} ${employeeData.lastName || ''}`.trim()
    }
    if (user?.firstName && user?.lastName) {
      return `${user.firstName} ${user.lastName}`
    }
    return 'User'
  }

  const getInitials = () => {
    const name = getUserName()
    if (!name || name === 'User') return 'U'
    const parts = name.split(' ')
    return parts.length > 1 
      ? `${parts[0][0]}${parts[1][0]}`.toUpperCase()
      : name[0].toUpperCase()
  }

  return (
    <section className={styles.layout} aria-label="Check in and out">
    <Card className={styles.panel} data-status={status.color} radius="lg">
      <CardBody className={styles.body}>
        <div className={styles.hero}>
          <div className={styles.portrait}>
            <Avatar
              src={employeeData?.profilePicture}
              name={getUserName()}
              fallback={<span>{getInitials()}</span>}
              className={styles.avatar}
              radius="lg"
              classNames={{ img: styles.avatarImage }}
              imgProps={{ style: photoViewportStyle(employeeData?.profilePictureViewport || user?.profilePictureViewport) }}
            />
          </div>
          <div className={styles.identity}>
            <Heading2>{getUserName()}</Heading2>
            <p className={styles.code}>{employeeData?.employeeCode || user?.employeeCode || user?.employeeNumber || '---'}</p>
            {(designationText || departmentName) && <p className={styles.role}>
              {designationText}{designationText && departmentName ? ' · ' : ''}{departmentName}
            </p>}
            <Chip size="sm" variant="flat" className={styles.status} startContent={<i aria-hidden="true" />}>{status.text}</Chip>
          </div>
        </div>

      <DayCompass enabled={enableDayCompassTasks} meetingsEnabled={enableMeetingReminders} />
      </CardBody>
    </Card>
    <div className={styles.punches}>
      <section className={`${styles.punch} ${styles.arrival}`} aria-label="Check in card">
        <div className={styles.punchHeading}><span><FaSignInAlt aria-hidden="true" /></span><div><h3>Check In</h3><p>Start your workday</p></div></div>
        <p className={styles.time}>{formatPunchTime(todayAttendance?.checkIn)}</p>
        <Button onPress={() => onClockIn()} isDisabled={Boolean(attendanceLoading || locationLoading || todayAttendance?.checkIn)} isLoading={attendanceLoading || locationLoading} className={styles.checkIn}>Check In</Button>
      </section>
      <section className={`${styles.punch} ${styles.departure}`} aria-label="Check out card">
        <div className={styles.punchHeading}><span><FaSignOutAlt aria-hidden="true" /></span><div><h3>Check Out</h3><p>End your workday</p></div></div>
        <p className={styles.time}>{formatPunchTime(todayAttendance?.checkOut)}</p>
        <Button onPress={() => onClockOut()} isDisabled={Boolean(attendanceLoading || locationLoading || !todayAttendance?.checkIn || todayAttendance?.checkOut)} isLoading={attendanceLoading || locationLoading} className={styles.checkOut}>Check Out</Button>
      </section>
      <section className={`${styles.punch} ${styles.duration}`} aria-label="Time worked card">
        <div className={styles.punchHeading}><span><FaClock aria-hidden="true" /></span><div><h3>Time worked</h3><p>{todayAttendance?.checkOut ? 'Completed session' : todayAttendance?.checkIn ? 'Live elapsed time' : 'Your session at a glance'}</p></div></div>
        <p className={styles.time} aria-live="off">{attendanceLoading ? '—' : elapsed === null ? '--:--' : `${Math.floor(elapsed / 60)}h ${String(elapsed % 60).padStart(2, '0')}m`}</p>
        <footer className={styles.cardFooter}><p>{elapsed === null ? 'Starts when you check in.' : 'Since check-in · includes breaks'}</p><Link href="/dashboard/attendance">View attendance →</Link></footer>
      </section>
      <section className={`${styles.punch} ${styles.schedule}`} aria-label="Work schedule card">
        <div className={styles.punchHeading}><span><FaCalendarAlt aria-hidden="true" /></span><div><h3>Work schedule</h3><p>Company working hours</p></div></div>
        <div className={styles.shiftTimes}>{shiftStart && shiftEnd ? <><strong>{shiftStart}</strong><span>to</span><strong>{shiftEnd}</strong></> : <strong>Not configured</strong>}</div>
        <footer className={styles.cardFooter}><p>{companySettings?.timezone || 'Company timezone unavailable'}</p>{Number.isFinite(target) && target > 0 && <span>{target}h daily target</span>}</footer>
      </section>
        <div className={styles.location}>
          <LocationAccessStatus
            compact
            showLocation
            geofence={geofence}
            permissionStatus={permissionStatus}
            location={capturedLocation}
            error={locationError}
            loading={locationLoading}
            onRetry={onRetryLocation}
          />
        </div>
    </div>

    </section>
  )
}

function formatPunchTime(value) {
  const date = value ? new Date(value) : null
  return date && Number.isFinite(date.getTime())
    ? date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
    : '--:--'
}

function formatScheduleTime(value) {
  const match = typeof value === 'string' && /^(\d{1,2}):(\d{2})$/.exec(value)
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null
  const hour = Number(match[1])
  return `${hour % 12 || 12}:${match[2]} ${hour < 12 ? 'am' : 'pm'}`
}
