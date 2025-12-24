'use client'

import { useState, useEffect } from 'react'
import toast from '@/utils/toast'
import { FaClock, FaUsers, FaCalendarAlt, FaSearch, FaDownload, FaMapMarkerAlt } from 'react-icons/fa'

export default function EmployeeCheckinsPage() {
  const [checkins, setCheckins] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0])
  const [searchTerm, setSearchTerm] = useState('')
  const [user, setUser] = useState(null)

  useEffect(() => {
    const userData = localStorage.getItem('user')
    if (userData) {
      const parsedUser = JSON.parse(userData)
      setUser(parsedUser)

      // Check if user is admin
      if (parsedUser.role !== 'admin') {
        toast.error('Access denied. Only Admin can view employee check-ins.')
        window.location.href = '/dashboard'
        return
      }

      fetchCheckins()
    }
  }, [selectedDate])

  const fetchCheckins = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/attendance/checkins?date=${selectedDate}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      const data = await response.json()
      if (data.success) {
        setCheckins(data.data)
      } else {
        toast.error(data.message || 'Failed to fetch check-ins')
      }
    } catch (error) {
      console.error('Fetch check-ins error:', error)
      toast.error('Failed to fetch check-ins')
    } finally {
      setLoading(false)
    }
  }

  const formatTime = (timeString, timezone) => {
    if (!timeString) return 'Not checked in'
    return new Date(timeString).toLocaleTimeString('en-US', {
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
      case 'present': return 'bg-green-100 text-green-800'
      case 'late': return 'bg-yellow-100 text-yellow-800'
      case 'absent': return 'bg-red-100 text-red-800'
      case 'half-day': return 'bg-blue-100 text-blue-800'
      case 'in-progress': return 'bg-purple-100 text-purple-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  const getTimingStatusColor = (status) => {
    switch (status) {
      case 'on-time': return 'bg-green-100 text-green-800'
      case 'late': return 'bg-red-100 text-red-800'
      case 'early': return 'bg-blue-100 text-blue-800'
      default: return 'bg-gray-100 text-gray-800'
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

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
      </div>
    )
  }

  return (
    <div className="page-container space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center space-y-3 sm:space-y-0">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-800">Employee Check-ins</h1>
          <p className="text-gray-600 mt-1 text-sm sm:text-base">Monitor real-time employee attendance</p>
        </div>
        <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-3">
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-3 py-2 sm:px-4 sm:py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm sm:text-base"
          />
          <button
            onClick={exportCheckins}
            className="px-3 py-2 sm:px-4 sm:py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors flex items-center justify-center space-x-2 text-sm sm:text-base"
          >
            <FaDownload className="w-3 h-3 sm:w-4 sm:h-4" />
            <span>Export</span>
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6">
        {[
          { title: 'Total Employees', value: stats.total, color: 'bg-blue-500', icon: FaUsers },
          { title: 'Present', value: stats.present, color: 'bg-green-500', icon: FaClock },
          { title: 'In Progress', value: stats.inProgress, color: 'bg-purple-500', icon: FaClock },
          { title: 'Absent', value: stats.absent, color: 'bg-red-500', icon: FaUsers },
        ].map((stat, index) => (
          <div key={index} className="bg-white rounded-lg shadow-md p-3 sm:p-6">
            <div className="flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <p className="text-gray-500 text-xs sm:text-sm font-medium truncate">{stat.title}</p>
                <h3 className="text-xl sm:text-2xl font-bold text-gray-900 mt-1 sm:mt-2">{stat.value}</h3>
              </div>
              <div className={`${stat.color} p-2 sm:p-4 rounded-lg flex-shrink-0`}>
                <stat.icon className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="bg-white rounded-lg shadow-md p-4 mb-6">
        <div className="relative">
          <FaSearch className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search by employee name or code..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
        </div>
      </div>

      {/* Check-ins Table */}
      <div className="bg-white rounded-lg shadow-md">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-800">
            Check-ins for {new Date(selectedDate).toLocaleDateString('en-US', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric'
            })}
          </h2>
        </div>

        {filteredCheckins.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <FaClock className="w-12 h-12 mx-auto mb-4 text-gray-300" />
            <p>No check-ins found for the selected date</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Employee
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Check In
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden lg:table-cell">
                    In Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Check Out
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden lg:table-cell">
                    Out Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden md:table-cell">
                    Locations
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Hours
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredCheckins.map((checkin) => (
                  <tr key={checkin._id} className="hover:bg-gray-50">
                    <td className="px-4 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="w-8 h-8 bg-primary-500 rounded-full flex items-center justify-center text-white font-semibold text-xs">
                          {checkin.employee?.firstName?.charAt(0)}{checkin.employee?.lastName?.charAt(0)}
                        </div>
                        <div className="ml-2">
                          <div className="text-sm font-medium text-gray-900">
                            {checkin.employee?.firstName} {checkin.employee?.lastName}
                          </div>
                          <div className="text-xs text-gray-500">{checkin.employee?.employeeCode}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                      {formatTime(checkin.checkInTime, checkin.employee?.companyTimezone)}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap hidden lg:table-cell">
                      {checkin.status === 'absent' ? (
                        <span className="text-gray-400">-</span>
                      ) : (
                        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getTimingStatusColor(checkin.checkInStatus || 'on-time')}`}>
                          {checkin.checkInStatus || 'on-time'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                      {formatTime(checkin.checkOutTime, checkin.employee?.companyTimezone)}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap hidden lg:table-cell">
                      {checkin.status === 'absent' || !checkin.checkOutTime ? (
                        <span className="text-gray-400">-</span>
                      ) : (
                        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getTimingStatusColor(checkin.checkOutStatus || 'on-time')}`}>
                          {checkin.checkOutStatus || 'on-time'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-4 text-xs text-gray-600 hidden md:table-cell max-w-[200px]">
                      {checkin.location?.checkIn?.address || checkin.location?.checkOut?.address ? (
                        <div className="space-y-1">
                          {checkin.location?.checkIn?.address && (
                            <div className="flex items-start gap-1" title={checkin.location.checkIn.address}>
                              <FaMapMarkerAlt className="text-green-500 mt-0.5 flex-shrink-0 w-3 h-3" />
                              <span className="truncate">
                                {checkin.location.checkIn.address.length > 35
                                  ? checkin.location.checkIn.address.substring(0, 35) + '...'
                                  : checkin.location.checkIn.address}
                              </span>
                            </div>
                          )}
                          {checkin.location?.checkOut?.address && (
                            <div className="flex items-start gap-1" title={checkin.location.checkOut.address}>
                              <FaMapMarkerAlt className="text-red-500 mt-0.5 flex-shrink-0 w-3 h-3" />
                              <span className="truncate">
                                {checkin.location.checkOut.address.length > 35
                                  ? checkin.location.checkOut.address.substring(0, 35) + '...'
                                  : checkin.location.checkOut.address}
                              </span>
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-400 italic">Not captured</span>
                      )}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                      {calculateWorkHours(checkin.checkInTime, checkin.checkOutTime, checkin.status)}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(checkin.status)}`}>
                        {checkin.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
