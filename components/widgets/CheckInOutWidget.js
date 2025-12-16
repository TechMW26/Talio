'use client'

import { FaUser, FaSignInAlt, FaSignOutAlt, FaCheckCircle, FaTimesCircle } from 'react-icons/fa'
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
    if (!todayAttendance?.checkIn) return { text: 'Not Checked In', color: 'text-amber-200', bgColor: 'bg-amber-500/30', icon: FaTimesCircle }
    if (todayAttendance?.checkOut) return { text: 'Day Complete', color: 'text-white/80', bgColor: 'bg-white/20', icon: FaCheckCircle }
    return { text: 'Working', color: 'text-emerald-200', bgColor: 'bg-emerald-500/30', icon: FaCheckCircle }
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

  return (
    <div
      style={{ background: 'var(--color-accent-gradient)' }}
      className="rounded-[30px] shadow-lg p-5 sm:p-6 text-white h-full flex flex-col"
    >
      {/* Profile Row */}
      <div className="flex items-start gap-4 flex-1">
        {/* Profile Image */}
        <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl overflow-hidden bg-white/20 flex items-center justify-center flex-shrink-0 shadow-lg border-2 border-white/30">
          {employeeData?.profilePicture ? (
            <img src={employeeData.profilePicture} alt="Profile" className="w-full h-full object-cover" />
          ) : (
            <FaUser className="w-8 h-8 sm:w-10 sm:h-10 text-white/90" />
          )}
        </div>
        
        {/* User Info */}
        <div className="flex-1 min-w-0">
          {/* Status Badge */}
          <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full ${status.bgColor} mb-1.5`}>
            <StatusIcon className={`w-2.5 h-2.5 ${status.color}`} />
            <span className={`text-[10px] font-semibold ${status.color}`}>{status.text}</span>
          </div>
          
          {/* Name */}
          <h2 className="text-lg sm:text-xl font-bold tracking-wide leading-tight truncate">
            {employeeData ? `${employeeData.firstName || ''} ${employeeData.lastName || ''}`.trim() :
              (user?.firstName && user?.lastName ? `${user.firstName} ${user.lastName}` : 'User')}
          </h2>
          
          {/* Employee Code */}
          <p className="text-[11px] font-medium text-white/70 mt-0.5">
            {employeeData?.employeeCode || user?.employeeCode || user?.employeeNumber || '---'}
          </p>

          {/* Designation & Department */}
          {(designationText || departmentName) && (
            <p className="text-xs text-white/80 mt-1 truncate">
              {designationText}{designationText && departmentName ? ' • ' : ''}{departmentName}
            </p>
          )}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-3 mt-4">
        <button
          onClick={onClockIn}
          disabled={attendanceLoading || (todayAttendance && todayAttendance.checkIn)}
          className="btn-theme-primary disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2.5 rounded-xl font-bold text-sm shadow-lg hover:shadow-xl transition-all duration-200 flex items-center justify-center flex-1 gap-2"
        >
          <FaSignInAlt className="w-3.5 h-3.5" />
          <span>Check In</span>
        </button>
        <button
          onClick={onClockOut}
          disabled={attendanceLoading || !todayAttendance || !todayAttendance.checkIn || todayAttendance.checkOut}
          className="btn-theme-secondary disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2.5 rounded-xl font-bold text-sm shadow-lg hover:shadow-xl transition-all duration-200 flex items-center justify-center flex-1 gap-2"
        >
          <FaSignOutAlt className="w-3.5 h-3.5" />
          <span>Check Out</span>
        </button>
      </div>
    </div>
  )
}
