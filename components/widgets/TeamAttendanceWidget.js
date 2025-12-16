'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { FaUsers, FaCheck, FaTimes, FaClock } from 'react-icons/fa'

// Helper to get display label and colors for status
const getStatusDisplay = (status) => {
  switch (status) {
    case 'present':
      return { label: 'Present', bgColor: 'bg-green-100', textColor: 'text-green-700' }
    case 'in-progress':
      return { label: 'Working', bgColor: 'bg-blue-100', textColor: 'text-blue-700' }
    case 'half-day':
      return { label: 'Half Day', bgColor: 'bg-yellow-100', textColor: 'text-yellow-700' }
    case 'absent':
      return { label: 'Absent', bgColor: 'bg-red-100', textColor: 'text-red-700' }
    case 'on-leave':
      return { label: 'On Leave', bgColor: 'bg-purple-100', textColor: 'text-purple-700' }
    case 'not-checked-in':
      return { label: 'Not Checked In', bgColor: 'bg-amber-100', textColor: 'text-amber-700' }
    case 'not-started':
      return { label: 'Not Started', bgColor: 'bg-gray-100', textColor: 'text-gray-500' }
    case 'late':
      return { label: 'Late', bgColor: 'bg-orange-100', textColor: 'text-orange-700' }
    default:
      return { label: status, bgColor: 'bg-gray-100', textColor: 'text-gray-600' }
  }
}

export default function TeamAttendanceWidget() {
  const router = useRouter()
  const [teamAttendance, setTeamAttendance] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchTeamAttendance()
  }, [])

  const fetchTeamAttendance = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/attendance/team-today', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await response.json()
      if (data.success) {
        setTeamAttendance(data.data || [])
      }
    } catch (error) {
      console.error('Error fetching team attendance:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="p-4 sm:p-6 animate-pulse flex-1 flex flex-col h-full">
        <div className="h-6 bg-gray-200 rounded w-1/3 mb-4"></div>
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-12 bg-gray-200 rounded"></div>
          ))}
        </div>
      </div>
    )
  }

  const present = teamAttendance.filter(e => e.status === 'present' || e.status === 'in-progress')
  const absent = teamAttendance.filter(e => e.status === 'absent')

  return (
  <div className="p-4 sm:p-6 flex-1 flex flex-col h-full">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base sm:text-lg font-bold text-gray-800">Team Attendance</h3>
        <button
          onClick={() => router.push('/dashboard/attendance')}
          className="text-primary-600 hover:text-primary-800 text-sm font-medium"
        >
          View All
        </button>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="bg-gray-50 rounded-lg p-3 text-center">
          <FaUsers className="w-4 h-4 mx-auto text-primary-600 mb-1" />
          <p className="text-lg font-bold text-primary-600">{teamAttendance.length}</p>
          <p className="text-xs text-gray-600">Total</p>
        </div>
        <div className="bg-gray-50 rounded-lg p-3 text-center">
          <FaCheck className="w-4 h-4 mx-auto text-green-600 mb-1" />
          <p className="text-lg font-bold text-green-600">{present.length}</p>
          <p className="text-xs text-gray-600">Present</p>
        </div>
        <div className="bg-gray-50 rounded-lg p-3 text-center">
          <FaTimes className="w-4 h-4 mx-auto text-red-600 mb-1" />
          <p className="text-lg font-bold text-red-600">{absent.length}</p>
          <p className="text-xs text-gray-600">Absent</p>
        </div>
      </div>

      {/* Team List */}
      <div className="space-y-2 max-h-48 overflow-y-auto">
        {teamAttendance.slice(0, 6).map((member, index) => {
          const statusDisplay = getStatusDisplay(member.status)
          return (
            <div key={index} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center text-primary-600 text-xs font-medium">
                  {member.firstName?.charAt(0)}{member.lastName?.charAt(0)}
                </div>
                <span className="text-sm text-gray-700">{member.firstName} {member.lastName}</span>
              </div>
              <span className={`px-2 py-0.5 text-xs rounded-full ${statusDisplay.bgColor} ${statusDisplay.textColor}`}>
                {statusDisplay.label}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
