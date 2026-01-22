'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { FaUsers, FaCheck, FaTimes, FaClock } from 'react-icons/fa'
import { Card, CardBody, Button, Chip, Skeleton, ScrollShadow, Avatar } from '@heroui/react'

// Helper to get display label and colors for status
const getStatusDisplay = (status) => {
  switch (status) {
    case 'present':
      return { label: 'Present', color: 'success' }
    case 'in-progress':
      return { label: 'Working', color: 'primary' }
    case 'half-day':
      return { label: 'Half Day', color: 'warning' }
    case 'absent':
      return { label: 'Absent', color: 'danger' }
    case 'on-leave':
      return { label: 'On Leave', color: 'secondary' }
    case 'not-checked-in':
      return { label: 'Not Checked In', color: 'warning' }
    case 'not-started':
      return { label: 'Not Started', color: 'default' }
    case 'late':
      return { label: 'Late', color: 'warning' }
    default:
      return { label: status, color: 'default' }
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
      <div className="p-4 sm:p-6 flex-1 flex flex-col h-full">
        <Skeleton className="h-6 w-1/3 rounded-lg mb-4" />
        <div className="grid grid-cols-3 gap-2 mb-4">
          <Skeleton className="h-20 rounded-xl" />
          <Skeleton className="h-20 rounded-xl" />
          <Skeleton className="h-20 rounded-xl" />
        </div>
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="w-8 h-8 rounded-full" />
              <Skeleton className="h-4 flex-1 rounded-lg" />
            </div>
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
        <h3 className="text-base sm:text-lg font-bold text-default-900">Team Attendance</h3>
        <Button
          variant="light"
          color="primary"
          size="sm"
          onPress={() => router.push('/dashboard/attendance')}
        >
          View All
        </Button>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <Card className="bg-primary-50 border border-primary-100">
          <CardBody className="p-3 text-center">
            <FaUsers className="w-4 h-4 mx-auto text-primary-600 mb-1" />
            <p className="text-lg font-bold text-primary-600">{teamAttendance.length}</p>
            <p className="text-xs text-default-600">Total</p>
          </CardBody>
        </Card>
        <Card className="bg-success-50 border border-success-100">
          <CardBody className="p-3 text-center">
            <FaCheck className="w-4 h-4 mx-auto text-success-600 mb-1" />
            <p className="text-lg font-bold text-success-600">{present.length}</p>
            <p className="text-xs text-default-600">Present</p>
          </CardBody>
        </Card>
        <Card className="bg-danger-50 border border-danger-100">
          <CardBody className="p-3 text-center">
            <FaTimes className="w-4 h-4 mx-auto text-danger-600 mb-1" />
            <p className="text-lg font-bold text-danger-600">{absent.length}</p>
            <p className="text-xs text-default-600">Absent</p>
          </CardBody>
        </Card>
      </div>

      {/* Team List */}
      <ScrollShadow className="space-y-2 max-h-48">
        {teamAttendance.slice(0, 6).map((member, index) => {
          const statusDisplay = getStatusDisplay(member.status)
          return (
            <div key={index} className="flex items-center justify-between gap-2 py-2 border-b border-default-100 last:border-0">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <Avatar
                  name={`${member.firstName?.charAt(0) || ''}${member.lastName?.charAt(0) || ''}`}
                  size="sm"
                  className="bg-primary-100 text-primary-600"
                />
                <span className="text-sm text-default-700 truncate">{member.firstName} {member.lastName}</span>
              </div>
              <Chip size="sm" color={statusDisplay.color} variant="flat">
                {statusDisplay.label}
              </Chip>
            </div>
          )
        })}
      </ScrollShadow>
    </div>
  )
}
