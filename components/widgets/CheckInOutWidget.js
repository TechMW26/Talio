'use client'

import { FaUser, FaSignInAlt, FaSignOutAlt, FaCheckCircle, FaTimesCircle } from 'react-icons/fa'
import { Card, CardBody, Button, Avatar, Chip } from '@heroui/react'
import { formatDesignation } from '@/lib/formatters'

export default function CheckInOutWidget({
  user,
  employeeData,
  todayAttendance,
  attendanceLoading,
  onClockIn,
  onClockOut,
}) {

  const getStatus = () => {
    if (!todayAttendance?.checkIn) return { text: 'Not Checked In', color: 'warning', icon: FaTimesCircle, pulse: false }
    if (todayAttendance?.checkOut) return { text: 'Day Complete', color: 'success', icon: FaCheckCircle, pulse: false }
    return { text: 'Working', color: 'success', icon: FaCheckCircle, pulse: true }
  }

  const status = getStatus()
  const StatusIcon = status.icon

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
    <Card
      className="relative shadow-xl overflow-hidden h-full bg-gradient-to-br from-primary-500 via-primary-600 to-secondary-600"
      radius="lg"
    >
      {/* Decorative elements */}
      <div className="absolute top-0 right-0 w-40 h-40 bg-white/10 rounded-full -translate-y-1/2 translate-x-1/2 blur-2xl" />
      <div className="absolute bottom-0 left-0 w-32 h-32 bg-white/10 rounded-full translate-y-1/2 -translate-x-1/2 blur-2xl" />

      <CardBody className="p-5 sm:p-6 text-white h-full flex flex-col justify-between relative z-10">
        {/* Profile Row */}
        <div className="flex items-center gap-4">
          {/* Profile Image */}
          <Avatar
            src={employeeData?.profilePicture}
            name={getUserName()}
            fallback={
              <span className="text-lg font-bold text-white">{getInitials()}</span>
            }
            size="lg"
            isBordered
            color="default"
            className="w-20 h-20 sm:w-24 sm:h-24 ring-4 ring-white/30 bg-gradient-to-br from-primary-400 to-primary-600"
            classNames={{
              base: "bg-gradient-to-br from-primary-400 to-primary-600",
              fallback: "bg-transparent",
            }}
          />

          {/* User Info */}
          <div className="flex-1 min-w-0">
            {/* Status Badge */}
            <Chip
              variant="flat"
              color={status.color}
              size="sm"
              startContent={
                <StatusIcon className={`w-3 h-3 ${status.pulse ? 'animate-pulse' : ''}`} />
              }
              className="mb-2 bg-white/90 backdrop-blur-sm"
              classNames={{
                content: "font-semibold text-xs",
              }}
            >
              {status.text}
            </Chip>

            {/* Name */}
            <h2 className="text-xl sm:text-2xl font-bold tracking-wide leading-tight truncate drop-shadow-sm">
              {getUserName()}
            </h2>

            {/* Employee Code */}
            <p className="text-xs font-medium text-white/60 mt-1">
              {employeeData?.employeeCode || user?.employeeCode || user?.employeeNumber || '---'}
            </p>

            {/* Designation & Department */}
            {(designationText || departmentName) && (
              <p className="text-sm text-white/80 mt-1.5 truncate">
                {designationText}{designationText && departmentName ? ' • ' : ''}{departmentName}
              </p>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3 mt-5">
          <Button
            onPress={() => onClockIn()}
            isDisabled={attendanceLoading || (todayAttendance && todayAttendance.checkIn)}
            isLoading={attendanceLoading}
            size="lg"
            radius="full"
            startContent={!attendanceLoading && <FaSignInAlt className="w-4 h-4" />}
            className="flex-1 font-bold bg-white/20 hover:bg-white/30 text-white border-2 border-white/30 backdrop-blur-sm transition-all shadow-lg"
            variant="flat"
          >
            Check In
          </Button>
          <Button
            onPress={() => onClockOut()}
            isDisabled={attendanceLoading || !todayAttendance || !todayAttendance.checkIn || todayAttendance.checkOut}
            isLoading={attendanceLoading}
            size="lg"
            radius="full"
            startContent={!attendanceLoading && <FaSignOutAlt className="w-4 h-4" />}
            className="flex-1 font-bold bg-white text-primary-600 hover:bg-default-100 transition-all shadow-lg"
            variant="solid"
          >
            Check Out
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}
