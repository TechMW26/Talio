'use client'
import { NativeTable } from '@/components/ui/fernly'
import { SummaryCard } from '@/components/ui/fernly'


import { Heading1, Heading3 } from '@/components/ui/fernly/native'
import { useState, useMemo } from 'react'
import { Card, CardBody, CardHeader, Skeleton, Select, SelectItem } from '@/components/ui/fernly'
import { FaCalendarAlt, FaClock, FaChartPie, FaHistory } from 'react-icons/fa'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from '@/components/charts/FernlyCharts'
import CustomTooltip from '@/components/charts/CustomTooltip'
import { getCurrentUser, getEmployeeId } from '@/utils/userHelper'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import useLeaveBalance from '@/hooks/useLeaveBalance'
import { currentFiscalYear, fiscalYearLabel } from '@/lib/leavePolicy'
import { formatLeaveDays } from '@/lib/leaveDays'
import { DataErrorState } from '@/components/ui/ErrorBoundary'
import BackgroundRefreshIndicator from '@/components/ui/BackgroundRefreshIndicator'

export default function LeaveBalancePage() {
  const [selectedYear, setSelectedYear] = useState(currentFiscalYear())

  const employeeId = useMemo(() => {
    const parsedUser = getCurrentUser()
    return parsedUser ? getEmployeeId(parsedUser) : null
  }, [])

  // --- SWR data fetching ---
  const {
    balances: leaveBalance,
    error: balanceError,
    loading: balanceLoading,
    isValidating,
    refresh: refreshBalance,
  } = useLeaveBalance({ year: selectedYear, employeeId, enabled: Boolean(employeeId) })

  const { data: historyRes, error: historyError, isLoading: historyLoading } = useAuthedSWR(
    employeeId ? `/api/leave?employeeId=${employeeId}&year=${selectedYear}` : null
  )
  const leaveHistory = useMemo(() => {
    return [...(historyRes?.data || [])].sort((left, right) => {
      const leftDate = new Date(left.createdAt || left.startDate || 0).getTime()
      const rightDate = new Date(right.createdAt || right.startDate || 0).getTime()
      return rightDate - leftDate
    })
  }, [historyRes])

  const loading = balanceLoading || historyLoading
  const error = balanceError || historyError

  const getTotalBalance = () => {
    return leaveBalance.reduce((total, balance) => total + balance.available, 0)
  }

  const getTotalUsed = () => {
    return leaveBalance.reduce((total, balance) => total + balance.usedDays, 0)
  }

  const getTotalPending = () => {
    return leaveBalance.reduce((total, balance) => total + balance.pending, 0)
  }

  const getTotalAllocated = () => {
    return leaveBalance.reduce((total, balance) => total + Number(balance.totalDays || 0), 0)
  }

  const getChartData = () => {
    return leaveBalance.map(balance => {
      const credited = Number(balance.totalDays || 0)
      return {
        name: balance.leaveType?.name || 'Unknown',
        used: balance.usedDays,
        pending: balance.pending,
        available: balance.available ?? 0,
        // Credited days that are still locked are shown as their own grey bar.
        locked: balance.isLocked ? credited : 0,
        total: credited,
      }
    })
  }

  const formatDay = (value) => {
    if (!value) return ''
    const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`)
    return Number.isNaN(date.getTime())
      ? String(value)
      : date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
  }

  const formatDate = (date) => {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  }

  const getMonthlyUsage = () => {
    // The leave year runs April to March, so the axis follows the fiscal year.
    const fiscalMonths = [3, 4, 5, 6, 7, 8, 9, 10, 11, 0, 1, 2]
    const monthlyData = fiscalMonths.map(monthIndex => ({
      month: new Date(2000, monthIndex, 1).toLocaleString('en-US', { month: 'short' }),
      approved: 0,
      pending: 0,
    }))

    leaveHistory.forEach(leave => {
      const status = String(leave.status || '').toLowerCase()
      if (!['approved', 'pending'].includes(status)) return
      const slot = fiscalMonths.indexOf(new Date(leave.startDate).getUTCMonth())
      const days = Number(leave.numberOfDays ?? leave.days ?? 0)
      if (slot >= 0 && Number.isFinite(days)) monthlyData[slot][status] += days
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

  if (error) {
    return (
      <div className="p-6">
        <DataErrorState message="Failed to load leave balance" onRetry={() => refreshBalance()} />
      </div>
    )
  }

  return (
    <div className="p-6 pb-24 md:pb-6">
      <BackgroundRefreshIndicator isRefreshing={isValidating && !loading} />
      {/* Header */}
      <div className="flex md:justify-between md:items-center md:flex-row flex-col mb-6">
        <div>
          <Heading1 className="text-3xl font-bold text-default-800">Leave Balance</Heading1>
          <p className="text-default-500 mt-1">Track your leave entitlements and usage</p>
        </div>
        <div className="flex items-center space-x-4 mt-4 md:mt-0">
          <Select
            selectedKeys={[String(selectedYear)]}
            onSelectionChange={(keys) => setSelectedYear(parseInt(Array.from(keys)[0]))}
            className="min-w-[170px]"
            size="sm"
            aria-label="Select Year"
          >
            {Array.from({ length: 5 }, (_, i) => currentFiscalYear() - i).map(year => (
              <SelectItem key={String(year)}>{fiscalYearLabel(year)}</SelectItem>
            ))}
          </Select>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
        {[
          { title: 'Total Allocated', value: getTotalAllocated(), color: 'primary', icon: FaCalendarAlt },
          { title: 'Used', value: getTotalUsed(), color: 'danger', icon: FaClock },
          { title: 'Pending', value: getTotalPending(), color: 'warning', icon: FaCalendarAlt },
          { title: 'Available', value: getTotalBalance(), color: 'success', icon: FaChartPie },
        ].map((stat, index) => (
          <SummaryCard key={index} shadow="sm" label={<>{stat.title}</>} value={<>{stat.value}</>} />
        ))}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 sm:gap-8 mb-6">
        {/* Leave Balance Chart */}
        <Card shadow="sm" className="bg-primary-50">
          <CardBody>
            <Heading3 className="text-sm sm:text-base font-bold text-default-800 mb-4">Leave Balance by Type</Heading3>
            <div className="h-72">
              {leaveBalance.length === 0 ? (
                <div className="flex h-full items-center justify-center text-sm text-default-500">No leave balance allocated</div>
              ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={getChartData()} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#d1d5db" />
                  <XAxis dataKey="name" fontSize={9} tick={{ fontSize: 9, fill: '#6b7280' }} stroke="#9ca3af" />
                  <YAxis fontSize={9} tick={{ fontSize: 9, fill: '#6b7280' }} stroke="#9ca3af" width={35} />
                  <Tooltip content={<CustomTooltip valueFormatter={(value) => formatLeaveDays(value)} />} />
                  <Legend wrapperStyle={{ fontSize: '10px' }} />
                  <Bar dataKey="used" fill="#ef4444" name="Used" radius={[8, 8, 0, 0]} />
                  <Bar dataKey="pending" fill="#f59e0b" name="Pending" radius={[8, 8, 0, 0]} />
                  <Bar dataKey="available" fill="#10b981" name="Available" radius={[8, 8, 0, 0]} />
                  <Bar dataKey="locked" fill="#9ca3af" name="Locked" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              )}
            </div>
          </CardBody>
        </Card>

        {/* Monthly Usage */}
        <Card shadow="sm" className="bg-primary-50">
          <CardBody>
            <Heading3 className="text-sm sm:text-base font-bold text-default-800 mb-4">Monthly Leave Usage</Heading3>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={getMonthlyUsage()} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#d1d5db" />
                  <XAxis dataKey="month" fontSize={9} tick={{ fontSize: 9, fill: '#6b7280' }} stroke="#9ca3af" />
                  <YAxis fontSize={9} tick={{ fontSize: 9, fill: '#6b7280' }} stroke="#9ca3af" width={35} />
                  <Tooltip
                    labelStyle={{ fontSize: '11px', color: '#374151' }}
                    contentStyle={{ fontSize: '11px', backgroundColor: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '8px' }}
                  />
                  <Legend wrapperStyle={{ fontSize: '11px' }} />
                  <Bar dataKey="approved" fill="#8b5cf6" name="Approved" radius={[8, 8, 0, 0]} />
                  <Bar dataKey="pending" fill="#f59e0b" name="Pending" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Leave Balance Details */}
      <Card shadow="sm" className="mb-6">
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <NativeTable className="min-w-full divide-y divide-default-200">
              <thead className="bg-default-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">
                    Leave Type
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">
                    Credited
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">
                    Carried Forward
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">
                    Used
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">
                    Pending
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">
                    Available
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">
                    Usage %
                  </th>
                </tr>
              </thead>
              <tbody className="bg-content1 divide-y divide-default-200">
                {leaveBalance.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-8 text-center text-sm text-default-500">
                      No leave balance allocated for {fiscalYearLabel(selectedYear)}
                    </td>
                  </tr>
                ) : leaveBalance.map((balance) => {
                  // The server projection already folds carried-forward days into totalDays.
                  const capacity = balance.totalDays
                  const usage = capacity > 0 ? Math.min(100, Math.round(((balance.usedDays + balance.pending) / capacity) * 100)) : 0
                  const credited = balance.yearlyEntitlement != null
                    ? `${balance.accrued} of ${balance.yearlyEntitlement}`
                    : balance.manualAllocation
                      ? `${balance.totalDays} (manual)`
                      : '—'
                  const locked = balance.isLocked === true
                  const unlimited = balance.requiresBalance === false
                  const status = unlimited
                    ? 'No limit'
                    : locked
                      ? 'Locked'
                      : balance.manualAllocation
                        ? 'Allocated'
                        : 'Available'
                  return (
                    <tr key={balance._id} className="hover:bg-default-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-default-800">
                          {balance.leaveType?.name || balance.leaveType?.code || 'Leave'}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-success">
                        {credited}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-default-600">
                        {formatLeaveDays(balance.carriedForward)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-danger font-medium">
                        {formatLeaveDays(balance.usedDays)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-warning-600 font-medium">
                        {formatLeaveDays(balance.pending)}
                      </td>
                      <td className={`px-6 py-4 whitespace-nowrap text-sm font-medium ${locked || unlimited ? 'text-default-500' : 'text-blue-600'}`}>
                        {unlimited
                          ? 'No limit'
                          : locked
                            ? `Locked till ${formatDay(balance.unlocksOn)}`
                            : formatLeaveDays(balance.available)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-default-600">
                        {status}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className="w-16 bg-default-200 rounded-full h-2 mr-2">
                            <div
                              className="bg-primary h-2 rounded-full"
                              style={{ width: `${Math.min(100, usage)}%` }}
                            ></div>
                          </div>
                          <span className="text-sm text-default-600">
                            {usage}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </NativeTable>
          </div>
        </CardBody>
      </Card>

      {/* Recent Leave History */}
      <Card shadow="sm">
        <CardHeader className="px-6 py-4 border-b border-default-200">
          <Heading3 className="text-lg font-semibold text-default-800">Recent Leave History</Heading3>
        </CardHeader>
        <CardBody className="p-0">
          {leaveHistory.length === 0 ? (
            <div className="p-8 text-center text-default-500">
              <FaHistory className="w-12 h-12 mx-auto mb-4 text-default-300" />
              <p>No leave history found for {selectedYear}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <NativeTable className="min-w-full divide-y divide-default-200">
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
                    <th className="px-6 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-content1 divide-y divide-default-200">
                  {leaveHistory.slice(0, 10).map((leave) => (
                    <tr key={leave._id} className="hover:bg-default-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-default-800">
                          {leave.leaveType?.name || leave.leaveTypeName || leave.leaveTypeCode || leave.requestLabel || 'Leave'}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-default-800">
                        {formatLeaveDays(leave.numberOfDays ?? leave.days)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-default-800">
                        {formatDate(leave.startDate)} - {formatDate(leave.endDate)}
                      </td>
                      <td className="px-6 py-4 text-sm text-default-500 max-w-xs truncate">
                        {leave.reason}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          {
                            approved: 'bg-success-100 text-success-700',
                            pending: 'bg-warning-100 text-warning-700',
                            rejected: 'bg-danger-100 text-danger-700',
                            cancelled: 'bg-default-200 text-default-600',
                          }[String(leave.status || '').toLowerCase()] || 'bg-default-200 text-default-600'
                        }`}>
                          {leave.status
                            ? `${String(leave.status).charAt(0).toUpperCase()}${String(leave.status).slice(1)}`
                            : 'Unknown'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </NativeTable>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
