'use client'

import { useState, useEffect } from 'react'
import { Card, CardBody, CardHeader, Skeleton, Select, SelectItem } from '@heroui/react'
import toast from '@/utils/toast'
import { FaCalendarAlt, FaClock, FaChartPie, FaHistory } from 'react-icons/fa'
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import CustomTooltip, { CustomPieTooltip } from '@/components/charts/CustomTooltip'
import { getCurrentUser, getEmployeeId } from '@/utils/userHelper'

export default function LeaveBalancePage() {
  const [leaveBalance, setLeaveBalance] = useState([])
  const [leaveHistory, setLeaveHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState(null)
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())

  useEffect(() => {
    const parsedUser = getCurrentUser()
    if (parsedUser) {
      setUser(parsedUser)
      const empId = getEmployeeId(parsedUser)
      if (empId) {
        fetchLeaveBalance(empId)
        fetchLeaveHistory(empId)
      } else {
        toast.error('Employee information not found. Please logout and login again.')
        setLoading(false)
      }
    } else {
      setLoading(false)
    }
  }, [selectedYear])

  const fetchLeaveBalance = async (employeeId) => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/leave/balance?employeeId=${employeeId}&year=${selectedYear}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })
      const data = await response.json()
      if (data.success) {
        setLeaveBalance(data.data)
      }
    } catch (error) {
      console.error('Fetch leave balance error:', error)
      toast.error('Failed to fetch leave balance')
    }
  }

  const fetchLeaveHistory = async (employeeId) => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/leave?employeeId=${employeeId}&year=${selectedYear}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })
      const data = await response.json()
      if (data.success) {
        setLeaveHistory(data.data.filter(leave => leave.status === 'approved'))
      }
    } catch (error) {
      console.error('Fetch leave history error:', error)
    } finally {
      setLoading(false)
    }
  }

  const getTotalBalance = () => {
    return leaveBalance.reduce((total, balance) => total + balance.remainingDays, 0)
  }

  const getTotalUsed = () => {
    return leaveBalance.reduce((total, balance) => total + balance.usedDays, 0)
  }

  const getTotalAllocated = () => {
    return leaveBalance.reduce((total, balance) => total + balance.totalDays, 0)
  }

  const getChartData = () => {
    return leaveBalance.map(balance => ({
      name: balance.leaveType?.name || 'Unknown',
      used: balance.usedDays,
      remaining: balance.remainingDays,
      total: balance.totalDays,
    }))
  }

  const getPieChartData = () => {
    return leaveBalance.map(balance => ({
      name: balance.leaveType?.name || 'Unknown',
      value: balance.usedDays,
      color: getRandomColor(),
    }))
  }

  const getRandomColor = () => {
    const colors = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8', '#82CA9D']
    return colors[Math.floor(Math.random() * colors.length)]
  }

  const formatDate = (date) => {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  }

  const getMonthlyUsage = () => {
    const monthlyData = Array.from({ length: 12 }, (_, i) => ({
      month: new Date(0, i).toLocaleString('en-US', { month: 'short' }),
      leaves: 0,
    }))

    leaveHistory.forEach(leave => {
      const month = new Date(leave.startDate).getMonth()
      monthlyData[month].leaves += leave.numberOfDays
    })

    return monthlyData
  }

  if (loading) {
    return (
      <div className="p-6 pb-24 md:pb-6 space-y-6">
        <Skeleton className="h-10 w-1/3 rounded-lg" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-lg" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton className="h-80 rounded-lg" />
          <Skeleton className="h-80 rounded-lg" />
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 pb-24 md:pb-6">
      {/* Header */}
      <div className="flex md:justify-between md:items-center md:flex-row flex-col mb-6">
        <div>
          <h1 className="text-3xl font-bold text-default-800">Leave Balance</h1>
          <p className="text-default-500 mt-1">Track your leave entitlements and usage</p>
        </div>
        <div className="flex items-center space-x-4 mt-4 md:mt-0">
          <Select
            selectedKeys={[String(selectedYear)]}
            onSelectionChange={(keys) => setSelectedYear(parseInt(Array.from(keys)[0]))}
            className="min-w-[120px]"
            size="sm"
            aria-label="Select Year"
          >
            {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map(year => (
              <SelectItem key={String(year)}>{String(year)}</SelectItem>
            ))}
          </Select>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
        {[
          { title: 'Total Allocated', value: getTotalAllocated(), color: 'primary', icon: FaCalendarAlt },
          { title: 'Total Used', value: getTotalUsed(), color: 'danger', icon: FaClock },
          { title: 'Remaining Balance', value: getTotalBalance(), color: 'success', icon: FaChartPie },
          { title: 'Leave Requests', value: leaveHistory.length, color: 'secondary', icon: FaHistory },
        ].map((stat, index) => (
          <Card key={index} shadow="sm">
            <CardBody className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-default-500 text-sm font-medium">{stat.title}</p>
                  <h3 className="text-2xl font-bold text-default-800 mt-2">{stat.value}</h3>
                </div>
                <div className={`bg-${stat.color} p-4 rounded-lg`}>
                  <stat.icon className="w-6 h-6 text-white" />
                </div>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 sm:gap-8 mb-6">
        {/* Leave Balance Chart */}
        <Card shadow="sm" className="bg-primary-50">
          <CardBody>
            <h3 className="text-sm sm:text-base font-bold text-default-800 mb-4">Leave Balance by Type</h3>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={getChartData()} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#d1d5db" />
                  <XAxis dataKey="name" fontSize={9} tick={{ fontSize: 9, fill: '#6b7280' }} stroke="#9ca3af" />
                  <YAxis fontSize={9} tick={{ fontSize: 9, fill: '#6b7280' }} stroke="#9ca3af" width={35} />
                  <Tooltip content={<CustomTooltip valueFormatter={(value) => `${value} days`} />} />
                  <Bar dataKey="used" fill="#ef4444" name="Used" radius={[8, 8, 0, 0]} />
                  <Bar dataKey="remaining" fill="#10b981" name="Remaining" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardBody>
        </Card>

        {/* Monthly Usage */}
        <Card shadow="sm" className="bg-primary-50">
          <CardBody>
            <h3 className="text-sm sm:text-base font-bold text-default-800 mb-4">Monthly Leave Usage</h3>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={getMonthlyUsage()} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#d1d5db" />
                  <XAxis dataKey="month" fontSize={9} tick={{ fontSize: 9, fill: '#6b7280' }} stroke="#9ca3af" />
                  <YAxis fontSize={9} tick={{ fontSize: 9, fill: '#6b7280' }} stroke="#9ca3af" width={35} />
                  <Tooltip
                    labelStyle={{ fontSize: '11px', color: '#374151' }}
                    contentStyle={{ fontSize: '11px', backgroundColor: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '8px' }}
                  />
                  <Bar dataKey="leaves" fill="#8b5cf6" name="Days Taken" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Leave Balance Details */}
      <Card shadow="sm" className="mb-6">
        <CardHeader className="px-6 py-4 border-b border-default-200">
          <h3 className="text-lg font-semibold text-default-800">Leave Balance Details</h3>
        </CardHeader>
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-default-200">
              <thead className="bg-default-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">
                    Leave Type
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">
                    Total Allocated
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">
                    Used
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">
                    Remaining
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">
                    Carried Forward
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">
                    Usage %
                  </th>
                </tr>
              </thead>
              <tbody className="bg-content1 divide-y divide-default-200">
                {leaveBalance.map((balance) => (
                  <tr key={balance._id} className="hover:bg-default-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-default-800">
                        {balance.leaveType?.name || 'N/A'}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-default-800">
                      {balance.totalDays} days
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-danger font-medium">
                      {balance.usedDays} days
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-success font-medium">
                      {balance.remainingDays} days
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-primary">
                      {balance.carriedForward} days
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="w-16 bg-default-200 rounded-full h-2 mr-2">
                          <div 
                            className="bg-primary h-2 rounded-full" 
                            style={{ width: `${(balance.usedDays / balance.totalDays) * 100}%` }}
                          ></div>
                        </div>
                        <span className="text-sm text-default-600">
                          {Math.round((balance.usedDays / balance.totalDays) * 100)}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      {/* Recent Leave History */}
      <Card shadow="sm">
        <CardHeader className="px-6 py-4 border-b border-default-200">
          <h3 className="text-lg font-semibold text-default-800">Recent Leave History</h3>
        </CardHeader>
        <CardBody className="p-0">
          {leaveHistory.length === 0 ? (
            <div className="p-8 text-center text-default-500">
              <FaHistory className="w-12 h-12 mx-auto mb-4 text-default-300" />
              <p>No leave history found for {selectedYear}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-default-200">
                <thead className="bg-default-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">
                      Leave Type
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">
                      Duration
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">
                      Dates
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">
                      Reason
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-content1 divide-y divide-default-200">
                  {leaveHistory.slice(0, 10).map((leave) => (
                    <tr key={leave._id} className="hover:bg-default-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-default-800">
                          {leave.leaveType?.name || 'N/A'}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-default-800">
                        {leave.numberOfDays} day{leave.numberOfDays > 1 ? 's' : ''}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-default-800">
                        {formatDate(leave.startDate)} - {formatDate(leave.endDate)}
                      </td>
                      <td className="px-6 py-4 text-sm text-default-500 max-w-xs truncate">
                        {leave.reason}
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
