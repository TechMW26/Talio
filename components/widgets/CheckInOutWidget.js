'use client'

import styles from './CheckInOutWidget.module.css'

import { FaSignInAlt, FaSignOutAlt, FaEnvelope, FaPhone, FaCalendarAlt } from 'react-icons/fa'
import { Card, CardBody, Button, Avatar } from '@heroui/react'
import { formatDesignation } from '@/lib/formatters'
import LocationAccessStatus from '@/components/attendance/LocationAccessStatus'

export default function CheckInOutWidget({
  user,
  employeeData,
  todayAttendance,
  attendanceLoading,
  onClockIn,
  onClockOut,
  geofence,
  permissionStatus,
  capturedLocation,
  locationError,
  locationLoading,
  onRetryLocation,
}) {

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

  const getDateOfJoining = () => {
    const doj = employeeData?.dateOfJoining || user?.dateOfJoining
    if (!doj) return null
    return new Date(doj).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  }

  const getEmail = () => employeeData?.email || user?.email || null
  const getPhone = () => employeeData?.phone || user?.phone || null

  const dateOfJoining = getDateOfJoining()
  const email = getEmail()
  const phone = getPhone()

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

  const details = [
    { label: 'Email', value: email, icon: FaEnvelope },
    { label: 'Phone', value: phone, icon: FaPhone },
    { label: 'Joined', value: dateOfJoining, icon: FaCalendarAlt },
  ].filter(detail => detail.value)

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
            />
          </div>
          <div className={styles.identity}>
            <span className={styles.status}><i aria-hidden="true" />{status.text}</span>
            <h2>{getUserName()}</h2>
            <p className={styles.code}>{employeeData?.employeeCode || user?.employeeCode || user?.employeeNumber || '---'}</p>
            {(designationText || departmentName) && <p className={styles.role}>
              {designationText}{designationText && departmentName ? ' · ' : ''}{departmentName}
            </p>}
          </div>
        </div>

        <dl className={styles.details}>
          {details.map(({ label, value, icon: Icon }) => <div className={styles.detail} key={label}>
            <span className={styles.detailIcon} aria-hidden="true"><Icon /></span>
            <div><dt>{label}</dt><dd title={value}>{value}</dd></div>
          </div>)}
        </dl>

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
    </div>
        <div className={styles.location}>
          <LocationAccessStatus
            compact
            geofence={geofence}
            permissionStatus={permissionStatus}
            location={capturedLocation}
            error={locationError}
            loading={locationLoading}
            onRetry={onRetryLocation}
          />
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
