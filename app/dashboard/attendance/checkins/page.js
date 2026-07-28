'use client'

import { useState, useMemo, useEffect } from 'react'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import { DataErrorState } from '@/components/ui/ErrorBoundary'
import BackgroundRefreshIndicator from '@/components/ui/BackgroundRefreshIndicator'
import toast from '@/utils/toast'
import { FaClock, FaUsers, FaCalendarAlt, FaSearch, FaDownload, FaMapMarkerAlt } from 'react-icons/fa'
import { Card, CardBody, CardHeader, Button, Chip, Skeleton, Input } from '@heroui/react'
import { getTodayDateString, IST_TIMEZONE } from '@/lib/timezone'

export default function EmployeeCheckinsPage() {
  const [selectedDate, setSelectedDate] = useState(getTodayDateString())
  const [searchTerm, setSearchTerm] = useState('')

  const user = useMemo(() => { try { return JSON.parse(localStorage.getItem('user')) } catch { return null } }, [])

  // Redirect non-authorized users
  useEffect(() => {
    if (user && user.role !== 'admin' && user.role !== 'hr') {
      toast.error('Access denied. Only Admin or HR can view employee check-ins.')
      window.location.href = '/dashboard'
    }
  }, [user])

  const isAuthorized = user?.role === 'admin' || user?.role === 'hr'
  const { data: checkinsRes, error, isLoading, isValidating, mutate: refreshCheckins } = useAuthedSWR(
    isAuthorized ? `/api/attendance/checkins?date=${selectedDate}` : null
  )
  const checkins = checkinsRes?.data || []

  const formatTime = (timeString, timezone) => {
    if (!timeString) return 'Not checked in'
    return new Date(timeString).toLocaleTimeString('en-US', {
      timeZone: IST_TIMEZONE,
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: timezone || 'Asia/Kolkata'
    })
  }

  const calculateWorkHours = (checkIn, checkOut, status) => {
    if (status === 'absent') return '0h 0m'
    if (!checkIn) return '-'
    if (!checkOut) return 'In progress'
    const diff = new Date(checkOut) - new Date(checkIn)
    const hours = Math.floor(diff / (1000 * 60 * 60))
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
    return `${hours}h ${minutes}m`
  }

  const getStatusColor = (status) => {
    switch (status) {
      case 'present': return 'success'
      case 'late': return 'warning'
      case 'absent': return 'danger'
      case 'half-day': return 'primary'
      case 'in-progress': return 'secondary'
      default: return 'default'
    }
  }

  const getTimingStatusColor = (status) => {
    switch (status) {
      case 'on-time': return 'success'
      case 'late': return 'danger'
      case 'early': return 'primary'
      default: return 'default'
    }
  }

  const exportCheckins = () => {
    const csvData = []
    csvData.push(['Employee Code', 'Employee Name', 'Check In', 'Check In Location', 'Check Out', 'Check Out Location', 'Work Hours', 'Status'])

    filteredCheckins.forEach(checkin => {
      csvData.push([
        checkin.employee.employeeCode,
        `"${checkin.employee.firstName} ${checkin.employee.lastName}"`,
        formatTime(checkin.checkInTime, checkin.employee?.companyTimezone),
        `"${checkin.location?.checkIn?.address || 'Not captured'}"`,
        formatTime(checkin.checkOutTime, checkin.employee?.companyTimezone),
        `"${checkin.location?.checkOut?.address || 'Not captured'}"`,
        calculateWorkHours(checkin.checkInTime, checkin.checkOutTime, checkin.status),
        checkin.status
      ])
    })

    const csvContent = csvData.map(row => row.join(',')).join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `checkins-${selectedDate}.csv`
    a.click()
    window.URL.revokeObjectURL(url)
  }

  const filteredCheckins = checkins.filter(checkin =>
    searchTerm === '' ||
    `${checkin.employee.firstName} ${checkin.employee.lastName}`.toLowerCase().includes(searchTerm.toLowerCase()) ||
    checkin.employee.employeeCode.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const stats = {
    total: checkins.length,
    present: checkins.filter(c => c.status === 'present').length,
    inProgress: checkins.filter(c => c.status === 'in-progress').length,
    absent: checkins.filter(c => c.status === 'absent').length,
  }

  if (error) return <DataErrorState message="Failed to load check-ins" onRetry={() => refreshCheckins()} />

  if (isLoading) {
    return (
      <div className="page-container space-y-6">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-8 w-48 rounded-lg" />
          <Skeleton className="h-4 w-64 rounded-lg" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24 rounded-lg" />)}
        </div>
        <Skeleton className="h-96 rounded-lg" />
      </div>
    )
  }

  return (
    <div className="page-container space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center space-y-3 sm:space-y-0">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-default-800">Employee Check-ins</h1>
          <p className="text-default-500 mt-1 text-sm sm:text-base">
            Monitor real-time employee attendance
            <BackgroundRefreshIndicator isValidating={isValidating} />
          </p>
        </div>
        <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-3">
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-3 py-2 sm:px-4 sm:py-2 border border-default-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent text-sm sm:text-base bg-content1"
          />
          <Button
            color="success"
            onPress={exportCheckins}
            startContent={<FaDownload className="w-3 h-3 sm:w-4 sm:h-4" />}
          >
            Export
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6">
        {[
          { title: 'Total Employees', value: stats.total, color: 'primary', icon: FaUsers },
          { title: 'Present', value: stats.present, color: 'success', icon: FaClock },
          { title: 'In Progress', value: stats.inProgress, color: 'secondary', icon: FaClock },
          { title: 'Absent', value: stats.absent, color: 'danger', icon: FaUsers },
        ].map((stat, index) => (
          <Card key={index} className="shadow-md">
            <CardBody className="flex flex-row items-center justify-between p-3 sm:p-6">
              <div className="flex-1 min-w-0">
                <p className="text-default-500 text-xs sm:text-sm font-medium truncate">{stat.title}</p>
                <h3 className="text-xl sm:text-2xl font-bold text-default-800 mt-1 sm:mt-2">{stat.value}</h3>
              </div>
              <div className={`bg-${stat.color} p-2 sm:p-4 rounded-lg flex-shrink-0`}>
                <stat.icon className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
              </div>
            </CardBody>
          </Card>
        ))}
      </div>

      {/* Search */}
      <Card className="shadow-md">
        <CardBody className="p-4">
          <Input
            type="text"
            placeholder="Search by employee name or code..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            startContent={<FaSearch className="text-default-400" />}
            variant="bordered"
            classNames={{
              inputWrapper: "bg-default-50 dark:bg-[#18181b] shadow-none",
            }}
          />
        </CardBody>
      </Card>

      {/* Check-ins Table */}
      <Card className="shadow-md">
        <CardHeader className="border-b border-divider px-6 py-4">
          <h2 className="text-lg font-semibold text-default-800">
            Check-ins for {new Date(selectedDate).toLocaleDateString('en-US', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric'
            })}
          </h2>
        </CardHeader>
        <CardBody className="p-0">
          {filteredCheckins.length === 0 ? (
            <div className="p-8 text-center text-default-500">
              <FaClock className="w-12 h-12 mx-auto mb-4 text-default-300" />
              <p>No check-ins found for the selected date</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-divider">
                <thead className="bg-default-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">
                      Employee
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">
                      Check In
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider hidden lg:table-cell">
                      In Status
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">
                      Check Out
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider hidden lg:table-cell">
                      Out Status
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider hidden md:table-cell">
                      Locations
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">
                      Hours
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-content1 divide-y divide-divider">
                  {filteredCheckins.map((checkin) => (
                    <tr key={checkin._id} className="hover:bg-default-50">
                      <td className="px-4 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className="w-8 h-8 bg-primary rounded-full flex items-center justify-center text-white font-semibold text-xs">
                            {checkin.employee?.firstName?.charAt(0)}{checkin.employee?.lastName?.charAt(0)}
                          </div>
                          <div className="ml-2">
                            <div className="text-sm font-medium text-default-800">
                              {checkin.employee?.firstName} {checkin.employee?.lastName}
                            </div>
                            <div className="text-xs text-default-500">{checkin.employee?.employeeCode}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap text-sm text-default-800">
                        {formatTime(checkin.checkInTime, checkin.employee?.companyTimezone)}
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap hidden lg:table-cell">
                        {checkin.status === 'absent' ? (
                          <span className="text-default-400">-</span>
                        ) : (
                          <Chip color={getTimingStatusColor(checkin.checkInStatus || 'on-time')} variant="flat" size="sm">
                            {checkin.checkInStatus || 'on-time'}
                          </Chip>
                        )}
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap text-sm text-default-800">
                        {formatTime(checkin.checkOutTime, checkin.employee?.companyTimezone)}
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap hidden lg:table-cell">
                        {checkin.status === 'absent' || !checkin.checkOutTime ? (
                          <span className="text-default-400">-</span>
                        ) : (
                          <Chip color={getTimingStatusColor(checkin.checkOutStatus || 'on-time')} variant="flat" size="sm">
                            {checkin.checkOutStatus || 'on-time'}
                          </Chip>
                        )}
                      </td>
                      <td className="px-4 py-4 text-xs text-default-600 hidden md:table-cell max-w-[200px]">
                        {checkin.location?.checkIn?.address || checkin.location?.checkOut?.address ? (
                          <div className="space-y-1">
                            {checkin.location?.checkIn?.address && (
                              <div className="flex items-start gap-1" title={checkin.location.checkIn.address}>
                                <FaMapMarkerAlt className="text-success mt-0.5 flex-shrink-0 w-3 h-3" />
                                <span className="truncate">
                                  {checkin.location.checkIn.address.length > 35
                                    ? checkin.location.checkIn.address.substring(0, 35) + '...'
                                    : checkin.location.checkIn.address}
                                </span>
                              </div>
                            )}
                            {checkin.location?.checkOut?.address && (
                              <div className="flex items-start gap-1" title={checkin.location.checkOut.address}>
                                <FaMapMarkerAlt className="text-danger mt-0.5 flex-shrink-0 w-3 h-3" />
                                <span className="truncate">
                                  {checkin.location.checkOut.address.length > 35
                                    ? checkin.location.checkOut.address.substring(0, 35) + '...'
                                    : checkin.location.checkOut.address}
                                </span>
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-default-400 italic">Not captured</span>
                        )}
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap text-sm text-default-800">
                        {calculateWorkHours(checkin.checkInTime, checkin.checkOutTime, checkin.status)}
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap">
                        <Chip color={getStatusColor(checkin.status)} variant="flat" size="sm">
                          {checkin.status}
                        </Chip>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
