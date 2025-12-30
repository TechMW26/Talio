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
    if (!todayAttendance?.checkIn) return { text: 'Not Checked In', color: 'text-amber-800', bgColor: 'bg-amber-100', icon: FaTimesCircle, pulse: false }
    if (todayAttendance?.checkOut) return { text: 'Day Complete', color: 'text-emerald-800', bgColor: 'bg-emerald-100', icon: FaCheckCircle, pulse: false }
    return { text: 'Working', color: 'text-emerald-800', bgColor: 'bg-emerald-100', icon: FaCheckCircle, pulse: true }
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
      className="relative rounded-[30px] shadow-2xl p-5 sm:p-6 text-white h-full flex flex-col justify-between overflow-hidden"
      style={{ background: 'var(--color-accent-gradient)' }}
    >
      {/* Content - Takes remaining space (details aligned top) */}
      <div className="relative z-10 flex-1 flex flex-col justify-start">

        {/* Profile Row */}
        <div className="flex items-center gap-5">
          {/* Profile Image - Clean Circle */}
          <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full overflow-hidden flex items-center justify-center flex-shrink-0 shadow-xl ring-4 ring-white/25">
            {employeeData?.profilePicture ? (
              <img src={employeeData.profilePicture} alt="Profile" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center">
                <FaUser className="w-10 h-10 sm:w-12 sm:h-12 text-white" />
              </div>
            )}
          </div>

          {/* User Info */}
          <div className="flex-1 min-w-0">
            {/* Status Badge with Animation */}
            <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full ${status.bgColor} mb-2 transition-all duration-300 hover:scale-105`}>
              <StatusIcon className={`w-3 h-3 ${status.color} ${status.pulse ? 'animate-pulse' : ''}`} />
              <span className={`text-xs font-semibold ${status.color}`}>{status.text}</span>
            </div>

            {/* Name */}
            <h2 className="text-xl sm:text-2xl font-bold tracking-wide leading-tight truncate drop-shadow-sm">
              {employeeData ? `${employeeData.firstName || ''} ${employeeData.lastName || ''}`.trim() :
                (user?.firstName && user?.lastName ? `${user.firstName} ${user.lastName}` : 'User')}
            </h2>

            {/* Employee Code */}
            <p className="text-xs font-medium text-white/60 mt-1">
              {employeeData?.employeeCode || user?.employeeCode || user?.employeeNumber || '---'}
            </p>

            {/* Designation & Department */}
            {(designationText || departmentName) && (
              <p className="text-sm text-white/75 mt-1.5 truncate">
                {designationText}{designationText && departmentName ? ' • ' : ''}{departmentName}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="relative z-10 flex gap-3 mt-5">
        <button
          onClick={() => onClockIn()}
          disabled={attendanceLoading || (todayAttendance && todayAttendance.checkIn)}
          className="disabled:opacity-40 disabled:cursor-not-allowed px-5 py-3.5 rounded-full font-bold text-sm shadow-lg transition-all duration-200 flex items-center justify-center flex-1 gap-2 bg-blue-500/30 hover:bg-blue-500/40 hover:shadow-xl active:scale-[0.98] text-white"
        >
          <FaSignInAlt className="w-4 h-4" />
          <span>Check In</span>
        </button>
        <button
          onClick={() => onClockOut()}
          disabled={attendanceLoading || !todayAttendance || !todayAttendance.checkIn || todayAttendance.checkOut}
          className="disabled:opacity-40 disabled:cursor-not-allowed px-5 py-3.5 rounded-full font-bold text-sm shadow-lg transition-all duration-200 flex items-center justify-center flex-1 gap-2 bg-white text-blue-600 hover:bg-gray-50 hover:shadow-xl active:scale-[0.98]"
        >
          <FaSignOutAlt className="w-4 h-4" />
          <span>Check Out</span>
        </button>
      </div>
    </div>
  )
}
