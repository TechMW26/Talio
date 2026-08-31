'use client'

import { useState, useMemo } from 'react'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import { DataErrorState } from '@/components/ui/ErrorBoundary'
import BackgroundRefreshIndicator from '@/components/ui/BackgroundRefreshIndicator'
import toast from '@/utils/toast'
import { downloadExcelWorkbook } from '@/lib/client/spreadsheetExport'
import {
  FaUsers, FaChartLine, FaClock, FaCalendarAlt, FaExclamationTriangle,
  FaCheckCircle, FaTimesCircle, FaChartPie, FaDownload, FaFileExcel,
  FaSearch, FaBuilding, FaUserTie, FaChevronDown, FaChevronUp
} from 'react-icons/fa'
import { Card, CardBody, CardHeader, Button, Chip, Skeleton, Input, Select, SelectItem } from '@heroui/react'
import { getDateKeyInTimezone, getTodayDateString } from '@/lib/timezone'

export default function AttendanceReportPage() {
  const [dateRange, setDateRange] = useState('month')
  const [customStartDate, setCustomStartDate] = useState('')
  const [customEndDate, setCustomEndDate] = useState('')
  const [selectedDepartment, setSelectedDepartment] = useState('all')
  const [expandedSections, setExpandedSections] = useState({
    overview: true,
    shrinkage: true,
    departmentBreakdown: true,
    employeeDetails: true
  })
  const [searchTerm, setSearchTerm] = useState('')

  const user = useMemo(() => { try { return JSON.parse(localStorage.getItem('user')) } catch { return null } }, [])
  const isAuthorized = user && ['admin', 'hr'].includes(user.role)

  // Compute date range params (auto-updates SWR keys when filters change)
  const dateParams = useMemo(() => {
    const today = getTodayDateString()
    let startDate, endDate
    switch (dateRange) {
      case 'today':
        startDate = endDate = today
        break
      case 'yesterday': {
        const yesterday = new Date(`${today}T00:00:00Z`)
        yesterday.setUTCDate(yesterday.getUTCDate() - 1)
        startDate = endDate = getDateKeyInTimezone(yesterday)
        break
      }
      case 'week': {
        const weekStart = new Date(`${today}T00:00:00Z`)
        weekStart.setUTCDate(weekStart.getUTCDate() - 7)
        startDate = getDateKeyInTimezone(weekStart)
        endDate = today
        break
      }
      case 'month': {
        startDate = `${today.slice(0, 7)}-01`
        endDate = today
        break
      }
      case 'custom':
        startDate = customStartDate
        endDate = customEndDate
        break
      default:
        startDate = endDate = today
    }
    if (!startDate || !endDate) return null
    return { startDate, endDate }
  }, [dateRange, customStartDate, customEndDate])

  // SWR hooks - keys auto-change when filters change, triggering refetches
  const deptParam = selectedDepartment !== 'all' ? `&department=${selectedDepartment}` : ''

  const { data: deptsRes } = useAuthedSWR(isAuthorized ? '/api/departments' : null)
  const departments = deptsRes?.data || []

  const { data: attendanceRes, error: attError, isLoading: attLoading, isValidating: attValidating, mutate: refreshReport } = useAuthedSWR(
    isAuthorized && dateParams ? `/api/attendance?startDate=${dateParams.startDate}&endDate=${dateParams.endDate}${deptParam}&populate=true` : null
  )
  const { data: employeesRes, error: empError, isLoading: empLoading, isValidating: empValidating } = useAuthedSWR(
    isAuthorized && dateParams ? `/api/employees?limit=1000&status=active&populate=true${deptParam}` : null
  )
  const { data: companyRes, isLoading: compLoading } = useAuthedSWR(
    isAuthorized ? '/api/settings/company' : null
  )
  const { data: holidaysRes, isLoading: holLoading } = useAuthedSWR(
    isAuthorized && dateParams ? `/api/holidays?startDate=${dateParams.startDate}&endDate=${dateParams.endDate}` : null
  )

  const isLoading = attLoading || empLoading || compLoading || holLoading
  const error = attError || empError
  const isValidating = attValidating || empValidating

  // Helper function to count working days between two dates
  const countWorkingDays = (startDate, endDate, workingDays, holidays) => {
    const dayNameMap = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
    const holidayDates = new Set(holidays.map(h => getDateKeyInTimezone(h.date)))

    let count = 0
    const current = new Date(startDate)
    const end = new Date(endDate)

    while (current <= end) {
      const dayName = dayNameMap[current.getUTCDay()]
      const dateStr = getDateKeyInTimezone(current)

      if (workingDays.includes(dayName) && !holidayDates.has(dateStr)) {
        count++
      }
      current.setUTCDate(current.getUTCDate() + 1)
    }

    return count
  }

  // Helper function to count working days for a specific employee (respects joining date)
  const countEmployeeWorkingDays = (employee, startDate, endDate, workingDays, holidays) => {
    const joiningDate = employee.dateOfJoining ? new Date(employee.dateOfJoining) : null
    const start = new Date(startDate)
    const end = new Date(endDate)

    // If employee hasn't joined yet, they have 0 expected days
    if (joiningDate && joiningDate > end) {
      return 0
    }

    // Effective start date is the later of period start or joining date
    const effectiveStart = joiningDate && joiningDate > start ? joiningDate : start

    return countWorkingDays(effectiveStart, end, workingDays, holidays)
  }

  const calculateKPIs = (attendance, employees, startDate, endDate, companySettings, holidays) => {
    const totalEmployees = employees.length
    const start = new Date(startDate)
    const end = new Date(endDate)
    const daysDiff = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1

    // Get working days from company settings (workingDays is at root level, not under workingHours)
    const workingDays = companySettings?.workingDays ||
      ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']
    const fullDayHours = companySettings?.fullDayHours || 8

    // Calculate total working days in the period (for overview)
    const totalWorkingDaysInPeriod = countWorkingDays(start, end, workingDays, holidays)

    // Calculate expected attendance per employee (respecting their joining dates)
    let totalExpectedAttendance = 0
    employees.forEach(emp => {
      totalExpectedAttendance += countEmployeeWorkingDays(emp, startDate, endDate, workingDays, holidays)
    })

    // Group attendance by employee
    const employeeAttendance = {}
    attendance.forEach(record => {
      const empId = record.employee?._id || record.employee
      if (!employeeAttendance[empId]) {
        employeeAttendance[empId] = []
      }
      employeeAttendance[empId].push(record)
    })

    // Calculate status counts from actual attendance records only
    const statusCounts = {
      present: 0,
      absent: 0,
      'half-day': 0,
      late: 0,
      'on-leave': 0,
      'in-progress': 0
    }

    let totalWorkHours = 0
    let lateArrivals = 0
    let earlyDepartures = 0
    let totalAccountedRecords = 0

    attendance.forEach(record => {
      if (statusCounts[record.status] !== undefined) {
        statusCounts[record.status]++
        totalAccountedRecords++
      }
      if (record.workHours) {
        totalWorkHours += record.workHours
      }
      // Check for late arrivals using checkInStatus field (not status)
      // checkInStatus captures 'late', 'on-time', 'early' based on check-in time
      if (record.checkInStatus === 'late') {
        lateArrivals++
      }
      // Check for early departure (less than 81.25% of full day hours OR checkOutStatus is 'early')
      if ((record.status === 'present' || record.status === 'in-progress') &&
        (record.checkOutStatus === 'early' || (record.workHours && record.workHours < (fullDayHours * 0.8125)))) {
        earlyDepartures++
      }
    })

    // Calculate missing days (expected attendance - records we have)
    // These are days where no record exists at all = effectively absent
    const missingRecords = Math.max(0, totalExpectedAttendance - totalAccountedRecords)
    const effectiveAbsent = statusCounts.absent + missingRecords

    // Calculate scheduled hours based on actual expected attendance
    const totalScheduledHours = totalExpectedAttendance * fullDayHours

    // Calculate shrinkage metrics
    const shrinkageHours = Math.max(0, totalScheduledHours - totalWorkHours)
    const shrinkagePercentage = totalScheduledHours > 0
      ? ((shrinkageHours / totalScheduledHours) * 100).toFixed(2)
      : '0.00'

    // Attendance rate: (present + half-day*0.5 + in-progress) / expected attendance
    // Note: statusCounts.present already includes late arrivals since late is a checkInStatus, not status
    // statusCounts.late will always be 0 since status field never has 'late' value
    const actualAttendanceValue = statusCounts.present + (statusCounts['half-day'] * 0.5) + statusCounts['in-progress']
    const attendanceRate = totalExpectedAttendance > 0
      ? ((actualAttendanceValue / totalExpectedAttendance) * 100).toFixed(2)
      : '0.00'

    // Absenteeism rate: effective absent (including missing records) / expected attendance
    const absenteeismRate = totalExpectedAttendance > 0
      ? ((effectiveAbsent / totalExpectedAttendance) * 100).toFixed(2)
      : '0.00'

    // Punctuality rate calculation:
    // - Punctuality considers both on-time arrival AND completing full work hours
    // - Late arrival = checkInStatus === 'late' (counted in lateArrivals variable)
    // - Early departure = checkOutStatus === 'early' or worked < 81.25% of full day
    // Formula: (Total work instances - Late arrivals - Early departures) / Total work instances * 100
    const totalWorkInstances = statusCounts.present + statusCounts['half-day'] + statusCounts['in-progress']
    const punctualityDeductions = lateArrivals + earlyDepartures
    const punctualInstances = Math.max(0, totalWorkInstances - punctualityDeductions)
    const punctualityRate = totalWorkInstances > 0
      ? ((punctualInstances / totalWorkInstances) * 100).toFixed(2)
      : '0.00' // If no one worked, punctuality should be 0%, not 100%

    // Average work hours per actual worked days (not expected days)
    const totalWorkedDays = statusCounts.present + statusCounts['half-day'] + statusCounts['in-progress']
    const avgWorkHours = totalWorkedDays > 0
      ? (totalWorkHours / totalWorkedDays).toFixed(2)
      : '0.00'

    // Department breakdown - calculate expected days per department too
    const departmentStats = {}
    employees.forEach(emp => {
      const deptId = emp.department?._id || emp.department
      const deptName = emp.department?.name || 'Unknown'
      const empExpectedDays = countEmployeeWorkingDays(emp, startDate, endDate, workingDays, holidays)

      if (!departmentStats[deptId]) {
        departmentStats[deptId] = {
          name: deptName,
          totalEmployees: 0,
          expectedDays: 0,
          present: 0,
          absent: 0,
          late: 0,
          'half-day': 0,
          'on-leave': 0,
          totalHours: 0,
          recordCount: 0
        }
      }
      departmentStats[deptId].totalEmployees++
      departmentStats[deptId].expectedDays += empExpectedDays

      const empRecords = employeeAttendance[emp._id] || []
      empRecords.forEach(record => {
        // Count status-based metrics
        if (departmentStats[deptId][record.status] !== undefined) {
          departmentStats[deptId][record.status]++
        }
        // Count late arrivals using checkInStatus (not status)
        if (record.checkInStatus === 'late') {
          departmentStats[deptId].late++
        }
        departmentStats[deptId].recordCount++
        if (record.workHours) {
          departmentStats[deptId].totalHours += record.workHours
        }
      })
    })

    // Calculate effective absent for each department (including missing records)
    Object.keys(departmentStats).forEach(deptId => {
      const dept = departmentStats[deptId]
      const deptMissingDays = Math.max(0, dept.expectedDays - dept.recordCount)
      dept.absent = dept.absent + deptMissingDays
    })

    // Individual employee metrics
    const employeeMetrics = employees.map(emp => {
      const empRecords = employeeAttendance[emp._id] || []
      const empPresent = empRecords.filter(r => r.status === 'present' || r.status === 'in-progress').length
      // Use checkInStatus for late arrivals (status field never contains 'late')
      const empLate = empRecords.filter(r => r.checkInStatus === 'late').length
      const empHalfDay = empRecords.filter(r => r.status === 'half-day').length
      const empOnLeave = empRecords.filter(r => r.status === 'on-leave').length
      const empWorkHours = empRecords.reduce((sum, r) => sum + (r.workHours || 0), 0)

      // Calculate expected days for this employee
      const empExpectedDays = countEmployeeWorkingDays(emp, startDate, endDate, workingDays, holidays)

      // Calculate effective absences: days with no record or explicit absent status
      // Note: empLate is count of late arrivals, not separate from empPresent
      // People who arrived late are still in empPresent (status = 'present' or 'in-progress')
      const empExplicitAbsent = empRecords.filter(r => r.status === 'absent').length
      const empAccountedDays = empPresent + empHalfDay + empOnLeave + empExplicitAbsent
      const empMissingDays = Math.max(0, empExpectedDays - empAccountedDays)
      const empAbsent = empExplicitAbsent + empMissingDays // Total absent = explicit + missing records

      // Attendance rate: (present + half-day*0.5) / expected days
      // empPresent already includes people who arrived late (late is a checkInStatus, not status)
      const empAttendanceRate = empExpectedDays > 0
        ? (((empPresent + empHalfDay * 0.5) / empExpectedDays) * 100).toFixed(1)
        : '0.0'

      // Average hours per ACTUAL worked days (not expected days)
      // empPresent includes late arrivals since status is 'present' not 'late'
      const empWorkedDays = empPresent + empHalfDay
      const empAvgHours = empWorkedDays > 0 ? (empWorkHours / empWorkedDays).toFixed(2) : '0.00'

      return {
        id: emp._id,
        name: `${emp.firstName} ${emp.lastName}`,
        employeeCode: emp.employeeCode,
        department: emp.department?.name || 'Unknown',
        designation: emp.designation?.title || 'N/A',
        email: emp.email,
        avatar: emp.avatar,
        present: empPresent, // empPresent already includes late arrivals (status = 'present')
        absent: empAbsent,
        late: empLate, // This is count of checkInStatus === 'late'
        halfDay: empHalfDay,
        totalHours: empWorkHours.toFixed(2),
        avgHours: empAvgHours,
        attendanceRate: empAttendanceRate,
        expectedDays: empExpectedDays,
        records: empRecords
      }
    }).sort((a, b) => parseFloat(b.attendanceRate) - parseFloat(a.attendanceRate))

    // Update status counts to include effective absent (missing records)
    const effectiveStatusCounts = {
      ...statusCounts,
      absent: effectiveAbsent
    }

    // Calculate shrinkage breakdown properly
    // Shrinkage from complete absences (days with no work at all)
    const absentDays = effectiveAbsent
    const shrinkageFromAbsent = absentDays * fullDayHours

    // Shrinkage from half days (lost half the day's hours)
    const shrinkageFromHalfDay = statusCounts['half-day'] * (fullDayHours * 0.5)

    // Shrinkage from underwork on present days
    // Expected hours from worked days = (present + in-progress) * fullDayHours + half-day * fullDayHours
    // Note: statusCounts.late is always 0 since late is stored in checkInStatus, not status
    const expectedHoursFromWorkedDays = (statusCounts.present + statusCounts['in-progress']) * fullDayHours + statusCounts['half-day'] * fullDayHours
    const shrinkageFromUnderwork = Math.max(0, expectedHoursFromWorkedDays - totalWorkHours)

    // Recalculate total shrinkage to ensure consistency
    const calculatedShrinkage = shrinkageFromAbsent + shrinkageFromHalfDay + shrinkageFromUnderwork
    const finalShrinkageHours = Math.max(shrinkageHours, calculatedShrinkage) // Use max to ensure we capture all lost time

    return {
      period: { startDate, endDate, days: daysDiff, workingDays: totalWorkingDaysInPeriod },
      overview: {
        totalEmployees,
        expectedAttendance: totalExpectedAttendance,
        actualAttendance: actualAttendanceValue.toFixed(1),
        attendanceRate,
        absenteeismRate,
        punctualityRate,
        avgWorkHours
      },
      statusCounts: effectiveStatusCounts,
      workHours: {
        total: totalWorkHours.toFixed(2),
        scheduled: totalScheduledHours.toFixed(2),
        // statusCounts.present includes late arrivals (late is checkInStatus, not status)
        productive: ((statusCounts.present * fullDayHours) + (statusCounts['half-day'] * fullDayHours * 0.5)).toFixed(2),
        average: avgWorkHours
      },
      shrinkage: {
        totalHours: finalShrinkageHours.toFixed(2),
        percentage: totalScheduledHours > 0 ? ((finalShrinkageHours / totalScheduledHours) * 100).toFixed(2) : '0.00',
        breakdown: {
          absent: shrinkageFromAbsent.toFixed(2),
          halfDay: shrinkageFromHalfDay.toFixed(2),
          late: lateArrivals,
          earlyDeparture: earlyDepartures,
          unproductive: shrinkageFromUnderwork.toFixed(2)
        }
      },
      performance: {
        lateArrivals,
        earlyDepartures,
        perfectAttendance: employeeMetrics.filter(e => e.absent == 0 && e.late == 0).length,
        needsAttention: employeeMetrics.filter(e => parseFloat(e.attendanceRate) < 80).length
      },
      departments: Object.values(departmentStats),
      employees: employeeMetrics
    }
  }

  // Compute report data from SWR responses
  const reportData = useMemo(() => {
    if (!attendanceRes?.success || !employeesRes?.success || !dateParams) return null
    const attendance = attendanceRes.data || []
    const employees = employeesRes.data || []
    const companySettings = companyRes?.success ? companyRes.data : null
    const holidays = holidaysRes?.success ? (holidaysRes.data || []) : []
    return calculateKPIs(attendance, employees, dateParams.startDate, dateParams.endDate, companySettings, holidays)
  }, [attendanceRes, employeesRes, companyRes, holidaysRes, dateParams])

  const toggleSection = (section) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }))
  }

  const exportToCSV = () => {
    if (!reportData) return

    const csvData = [
      ['Attendance Report'],
      ['Period', `${reportData.period.startDate} to ${reportData.period.endDate}`],
      [''],
      ['Employee', 'Code', 'Department', 'Present', 'Absent', 'Late', 'Half Day', 'Total Hours', 'Avg Hours/Day', 'Attendance Rate'],
      ...reportData.employees.map(emp => [
        emp.name,
        emp.employeeCode,
        emp.department,
        emp.present,
        emp.absent,
        emp.late,
        emp.halfDay,
        emp.totalHours,
        emp.avgHours,
        emp.attendanceRate + '%'
      ])
    ]

    const csv = csvData.map(row => row.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `attendance-report-${reportData.period.startDate}-to-${reportData.period.endDate}.csv`
    a.click()
    toast.success('CSV Report exported successfully')
  }

  const exportToExcel = async () => {
    if (!reportData) return

    const sheets = []

    // Sheet 1: Overview & Summary
    const overviewData = [
      ['ATTENDANCE REPORT - OVERVIEW'],
      ['Period', `${reportData.period.startDate} to ${reportData.period.endDate}`],
      ['Days', reportData.period.days],
      [],
      ['KEY METRICS'],
      ['Total Employees', reportData.overview.totalEmployees],
      ['Expected Attendance', reportData.overview.expectedAttendance],
      ['Actual Attendance', reportData.overview.actualAttendance],
      ['Attendance Rate', reportData.overview.attendanceRate + '%'],
      ['Absenteeism Rate', reportData.overview.absenteeismRate + '%'],
      ['Punctuality Rate', reportData.overview.punctualityRate + '%'],
      ['Average Work Hours/Day', reportData.overview.avgWorkHours + 'h'],
      [],
      ['STATUS BREAKDOWN'],
      ['Present', reportData.statusCounts.present],
      ['Absent', reportData.statusCounts.absent],
      ['Late', reportData.performance.lateArrivals],
      ['Half Day', reportData.statusCounts['half-day']],
      ['On Leave', reportData.statusCounts['on-leave']],
      [],
      ['WORK HOURS'],
      ['Scheduled Hours', reportData.workHours.scheduled + 'h'],
      ['Actual Hours', reportData.workHours.total + 'h'],
      ['Productive Hours', reportData.workHours.productive + 'h'],
      [],
      ['PERFORMANCE INDICATORS'],
      ['Perfect Attendance', reportData.performance.perfectAttendance],
      ['Late Arrivals', reportData.performance.lateArrivals],
      ['Early Departures', reportData.performance.earlyDepartures],
      ['Needs Attention (<80%)', reportData.performance.needsAttention]
    ]
    sheets.push({ name: 'Overview', rows: overviewData })

    // Sheet 2: Shrinkage Analysis
    const shrinkageData = [
      ['SHRINKAGE ANALYSIS'],
      ['Period', `${reportData.period.startDate} to ${reportData.period.endDate}`],
      [],
      ['Total Shrinkage', reportData.shrinkage.percentage + '%'],
      ['Total Hours Lost', reportData.shrinkage.totalHours + 'h'],
      [],
      ['SHRINKAGE BREAKDOWN'],
      ['Category', 'Hours'],
      ['Absent Days', reportData.shrinkage.breakdown.absent + 'h'],
      ['Half Days', reportData.shrinkage.breakdown.halfDay + 'h'],
      ['Late Arrivals', reportData.shrinkage.breakdown.late + ' instances'],
      ['Early Departures', reportData.shrinkage.breakdown.earlyDeparture + ' instances'],
      ['Other Unproductive', reportData.shrinkage.breakdown.unproductive + 'h']
    ]
    sheets.push({ name: 'Shrinkage Analysis', rows: shrinkageData })

    // Sheet 3: Department Breakdown
    if (reportData.departments.length > 0) {
      const deptData = [
        ['DEPARTMENT BREAKDOWN'],
        ['Period', `${reportData.period.startDate} to ${reportData.period.endDate}`],
        [],
        ['Department', 'Total Employees', 'Present', 'Absent', 'Late', 'Half Day', 'Total Hours'],
        ...reportData.departments.map(dept => [
          dept.name,
          dept.totalEmployees,
          dept.present,
          dept.absent,
          dept.late,
          dept['half-day'],
          dept.totalHours.toFixed(2)
        ])
      ]
      sheets.push({ name: 'Department Breakdown', rows: deptData })
    }

    // Sheet 4: Individual Employee Details
    const employeeData = [
      ['INDIVIDUAL EMPLOYEE METRICS'],
      ['Period', `${reportData.period.startDate} to ${reportData.period.endDate}`],
      [],
      ['Employee', 'Code', 'Department', 'Designation', 'Email', 'Present', 'Absent', 'Late', 'Half Day', 'Total Hours', 'Avg Hours/Day', 'Attendance %'],
      ...reportData.employees.map(emp => [
        emp.name,
        emp.employeeCode,
        emp.department,
        emp.designation,
        emp.email,
        emp.present,
        emp.absent,
        emp.late,
        emp.halfDay,
        emp.totalHours,
        emp.avgHours,
        emp.attendanceRate + '%'
      ])
    ]
    sheets.push({ name: 'Employee Details', rows: employeeData })

    try {
      await downloadExcelWorkbook(`attendance-report-${reportData.period.startDate}-to-${reportData.period.endDate}.xlsx`, sheets)
      toast.success('Excel Report exported successfully')
    } catch (error) {
      toast.error(error?.message || 'Could not export the Excel report')
    }
  }

  const filteredEmployees = reportData?.employees.filter(emp => {
    const searchLower = searchTerm.toLowerCase()
    return (
      emp.name.toLowerCase().includes(searchLower) ||
      emp.employeeCode.toLowerCase().includes(searchLower) ||
      emp.department.toLowerCase().includes(searchLower)
    )
  }) || []

  if (error) return <DataErrorState message="Failed to load attendance report" onRetry={() => refreshReport()} />

  if (isLoading) {
    return (
      <div className="page-container space-y-6">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-8 w-72 rounded-lg" />
          <Skeleton className="h-4 w-96 rounded-lg" />
        </div>
        <Skeleton className="h-20 rounded-lg" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-28 rounded-lg" />)}
        </div>
        <Skeleton className="h-64 rounded-lg" />
      </div>
    )
  }

  if (!user || !['admin', 'hr'].includes(user.role)) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <FaExclamationTriangle className="mx-auto h-12 w-12 text-warning mb-4" />
          <h2 className="text-2xl font-bold text-default-800 mb-2">Access Restricted</h2>
          <p className="text-default-500">This report is only available to administrators and HR.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="page-container">
      {/* Header */}
      <div className="mb-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-default-800">Attendance Report & Analytics</h1>
            <p className="text-default-500 mt-1">
              Comprehensive attendance KPIs, shrinkage analysis, and employee metrics
              <BackgroundRefreshIndicator isValidating={isValidating} />
            </p>
          </div>
          <div className="flex items-center space-x-3">
            <Button
              color="success"
              onPress={exportToExcel}
              isDisabled={!reportData}
              startContent={<FaFileExcel />}
            >
              Export Excel
            </Button>
            <Button
              color="primary"
              onPress={exportToCSV}
              isDisabled={!reportData}
              startContent={<FaDownload />}
            >
              Export CSV
            </Button>
          </div>
        </div>
      </div>

      {/* Filters */}
      <Card className="shadow-md mb-6">
        <CardBody className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-default-700 mb-2">Date Range</label>
              <Select
                selectedKeys={[dateRange]}
                onChange={(e) => setDateRange(e.target.value)}
                aria-label="Date Range"
                classNames={{ trigger: "bg-content1" }}
              >
                <SelectItem key="today">Today</SelectItem>
                <SelectItem key="yesterday">Yesterday</SelectItem>
                <SelectItem key="week">Last 7 Days</SelectItem>
                <SelectItem key="month">This Month</SelectItem>
                <SelectItem key="custom">Custom Range</SelectItem>
              </Select>
            </div>

            {dateRange === 'custom' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-default-700 mb-2">Start Date</label>
                  <input
                    type="date"
                    value={customStartDate}
                    onChange={(e) => setCustomStartDate(e.target.value)}
                    className="w-full px-3 py-2 border border-default-300 rounded-lg focus:ring-2 focus:ring-primary bg-content1"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-default-700 mb-2">End Date</label>
                  <input
                    type="date"
                    value={customEndDate}
                    onChange={(e) => setCustomEndDate(e.target.value)}
                    className="w-full px-3 py-2 border border-default-300 rounded-lg focus:ring-2 focus:ring-primary bg-content1"
                  />
                </div>
              </>
            )}

            <div>
              <label className="block text-sm font-medium text-default-700 mb-2">Department</label>
              <Select
                selectedKeys={[selectedDepartment]}
                onChange={(e) => setSelectedDepartment(e.target.value)}
                aria-label="Department"
                classNames={{ trigger: "bg-content1" }}
              >
                <SelectItem key="all">All Departments</SelectItem>
                {departments.map(dept => (
                  <SelectItem key={dept._id}>{dept.name}</SelectItem>
                ))}
              </Select>
            </div>
          </div>
        </CardBody>
      </Card>

      {reportData && (
        <>
          {/* Overview KPIs */}
          <Card className="shadow-md mb-6">
            <CardBody className="p-6">
              <div
                className="flex items-center justify-between cursor-pointer mb-4"
                onClick={() => toggleSection('overview')}
              >
                <div>
                  <h2 className="text-xl font-bold text-default-800 flex items-center space-x-2">
                    <FaChartLine className="text-primary" />
                    <span>Overview Metrics</span>
                  </h2>
                  <p className="text-sm text-default-500 mt-1">
                    {reportData.period.startDate} to {reportData.period.endDate} ({reportData.period.workingDays} working days)
                  </p>
                </div>
                {expandedSections.overview ? <FaChevronUp /> : <FaChevronDown />}
              </div>

              {expandedSections.overview && (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                    <div className="bg-primary-50 rounded-lg p-4">
                      <div className="flex items-center space-x-2 mb-2">
                        <FaUsers className="text-primary" />
                        <span className="text-sm text-primary-700 font-medium">Total Employees</span>
                      </div>
                      <p className="text-3xl font-bold text-primary">{reportData.overview.totalEmployees}</p>
                    </div>

                    <div className="bg-success-50 rounded-lg p-4">
                      <div className="flex items-center space-x-2 mb-2">
                        <FaCheckCircle className="text-success" />
                        <span className="text-sm text-success-700 font-medium">Attendance Rate</span>
                      </div>
                      <p className="text-3xl font-bold text-success">{reportData.overview.attendanceRate}%</p>
                    </div>

                    <div className="bg-danger-50 rounded-lg p-4">
                      <div className="flex items-center space-x-2 mb-2">
                        <FaTimesCircle className="text-danger" />
                        <span className="text-sm text-danger-700 font-medium">Absenteeism Rate</span>
                      </div>
                      <p className="text-3xl font-bold text-danger">{reportData.overview.absenteeismRate}%</p>
                    </div>

                    <div className="bg-warning-50 rounded-lg p-4">
                      <div className="flex items-center space-x-2 mb-2">
                        <FaClock className="text-warning" />
                        <span className="text-sm text-warning-700 font-medium">Punctuality Rate</span>
                      </div>
                      <p className="text-3xl font-bold text-warning">{reportData.overview.punctualityRate}%</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                    <div className="bg-secondary-50 rounded-lg p-4 text-center">
                      <p className="text-2xl font-bold text-secondary">{reportData.statusCounts.present}</p>
                      <p className="text-sm text-secondary-700">Present</p>
                    </div>
                    <div className="bg-danger-50 rounded-lg p-4 text-center">
                      <p className="text-2xl font-bold text-danger">{reportData.statusCounts.absent}</p>
                      <p className="text-sm text-danger-700">Absent</p>
                    </div>
                    <div className="bg-warning-50 rounded-lg p-4 text-center">
                      <p className="text-2xl font-bold text-warning">{reportData.statusCounts['half-day']}</p>
                      <p className="text-sm text-warning-700">Half Day</p>
                    </div>
                    <div className="bg-warning-50 rounded-lg p-4 text-center">
                      <p className="text-2xl font-bold text-warning">{reportData.performance.lateArrivals}</p>
                      <p className="text-sm text-warning-700">Late</p>
                    </div>
                    <div className="bg-primary-50 rounded-lg p-4 text-center">
                      <p className="text-2xl font-bold text-primary">{reportData.statusCounts['on-leave']}</p>
                      <p className="text-sm text-primary-700">On Leave</p>
                    </div>
                  </div>
                </>
              )}
            </CardBody>
          </Card>

          {/* Shrinkage Analysis */}
          <Card className="shadow-md mb-6">
            <CardBody className="p-6">
              <div
                className="flex items-center justify-between cursor-pointer mb-4"
                onClick={() => toggleSection('shrinkage')}
              >
                <div>
                  <h2 className="text-xl font-bold text-default-800 flex items-center space-x-2">
                    <FaChartPie className="text-danger" />
                    <span>Shrinkage Analysis</span>
                  </h2>
                  <p className="text-sm text-default-500 mt-1">
                    {reportData.period.startDate} to {reportData.period.endDate} ({reportData.period.workingDays} working days)
                  </p>
                </div>
                {expandedSections.shrinkage ? <FaChevronUp /> : <FaChevronDown />}
              </div>

              {expandedSections.shrinkage && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <div className="bg-danger-50 rounded-lg p-6 mb-4">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-sm font-medium text-danger-700">Total Shrinkage</span>
                        <span className="text-3xl font-bold text-danger">{reportData.shrinkage.percentage}%</span>
                      </div>
                      <p className="text-sm text-danger">{reportData.shrinkage.totalHours} hours lost</p>
                      <div className="mt-2 bg-danger-200 rounded-full h-3">
                        <div
                          className="bg-danger h-3 rounded-full"
                          style={{ width: `${Math.min(reportData.shrinkage.percentage, 100)}%` }}
                        ></div>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="flex justify-between items-center p-3 bg-default-50 rounded-lg">
                        <div>
                          <span className="text-sm text-default-700">Scheduled Hours</span>
                          <p className="text-xs text-default-400">{reportData.overview.expectedAttendance} employee-days × 8h</p>
                        </div>
                        <span className="font-semibold text-default-800">{reportData.workHours.scheduled}h</span>
                      </div>
                      <div className="flex justify-between items-center p-3 bg-success-50 rounded-lg">
                        <span className="text-sm text-success-700">Actual Work Hours</span>
                        <span className="font-semibold text-success-800">{reportData.workHours.total}h</span>
                      </div>
                      <div className="flex justify-between items-center p-3 bg-primary-50 rounded-lg">
                        <span className="text-sm text-primary-700">Avg Hours/Employee/Day</span>
                        <span className="font-semibold text-primary-800">{reportData.workHours.average}h</span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-lg font-semibold text-default-800 mb-4">Shrinkage Breakdown</h3>
                    <div className="space-y-3">
                      <div className="flex justify-between items-center p-3 bg-danger-50 rounded-lg">
                        <span className="text-sm text-danger-700">Absent Days</span>
                        <span className="font-semibold text-danger-800">{reportData.shrinkage.breakdown.absent}h</span>
                      </div>
                      <div className="flex justify-between items-center p-3 bg-warning-50 rounded-lg">
                        <span className="text-sm text-warning-700">Half Days</span>
                        <span className="font-semibold text-warning-800">{reportData.shrinkage.breakdown.halfDay}h</span>
                      </div>
                      <div className="flex justify-between items-center p-3 bg-warning-50 rounded-lg">
                        <span className="text-sm text-warning-700">Late Arrivals</span>
                        <span className="font-semibold text-warning-800">{reportData.shrinkage.breakdown.late} instances</span>
                      </div>
                      <div className="flex justify-between items-center p-3 bg-warning-50 rounded-lg">
                        <span className="text-sm text-warning-700">Early Departures</span>
                        <span className="font-semibold text-warning-800">{reportData.shrinkage.breakdown.earlyDeparture} instances</span>
                      </div>
                      <div className="flex justify-between items-center p-3 bg-default-50 rounded-lg">
                        <span className="text-sm text-default-700">Other Unproductive</span>
                        <span className="font-semibold text-default-800">{reportData.shrinkage.breakdown.unproductive}h</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </CardBody>
          </Card>

          {/* Department Breakdown */}
          {reportData.departments.length > 0 && (
            <Card className="shadow-md mb-6">
              <CardBody className="p-6">
                <div
                  className="flex items-center justify-between cursor-pointer mb-4"
                  onClick={() => toggleSection('departmentBreakdown')}
                >
                  <h2 className="text-xl font-bold text-default-800 flex items-center space-x-2">
                    <FaBuilding className="text-primary" />
                    <span>Department Breakdown</span>
                  </h2>
                  {expandedSections.departmentBreakdown ? <FaChevronUp /> : <FaChevronDown />}
                </div>

                {expandedSections.departmentBreakdown && (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-default-50 border-b border-divider">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-default-500 uppercase">Department</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-default-500 uppercase">Employees</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-default-500 uppercase">Present</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-default-500 uppercase">Absent</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-default-500 uppercase">Late</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-default-500 uppercase">Half Day</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-default-500 uppercase">Total Hours</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-divider">
                        {reportData.departments.map((dept, idx) => (
                          <tr key={idx} className="hover:bg-default-50">
                            <td className="px-6 py-4 whitespace-nowrap font-medium text-default-800">{dept.name}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-default-600">{dept.totalEmployees}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-success font-semibold">{dept.present}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-danger font-semibold">{dept.absent}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-warning font-semibold">{dept.late}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-warning font-semibold">{dept['half-day']}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-primary font-semibold">{dept.totalHours.toFixed(2)}h</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardBody>
            </Card>
          )}

          {/* Employee Details */}
          <Card className="shadow-md">
            <CardBody className="p-6">
              <div
                className="flex items-center justify-between cursor-pointer mb-4"
                onClick={() => toggleSection('employeeDetails')}
              >
                <h2 className="text-xl font-bold text-default-800 flex items-center space-x-2">
                  <FaUserTie className="text-primary" />
                  <span>Individual Employee Metrics</span>
                </h2>
                {expandedSections.employeeDetails ? <FaChevronUp /> : <FaChevronDown />}
              </div>

              {expandedSections.employeeDetails && (
                <>
                  <div className="mb-4">
                    <Input
                      type="text"
                      placeholder="Search by name, code, or department..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      startContent={<FaSearch className="text-default-400" />}
                      variant="bordered"
                      classNames={{
                        inputWrapper: "bg-default-50 dark:bg-[#18181b] shadow-none",
                      }}
                    />
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-default-50 border-b border-divider">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-default-500 uppercase">Employee</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-default-500 uppercase">Code</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-default-500 uppercase">Department</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-default-500 uppercase">Present</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-default-500 uppercase">Absent</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-default-500 uppercase">Late</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-default-500 uppercase">Half Day</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-default-500 uppercase">Total Hours</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-default-500 uppercase">Avg Hours/Day</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-default-500 uppercase">Attendance %</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-divider">
                        {filteredEmployees.map((emp) => (
                          <tr key={emp.id} className="hover:bg-default-50">
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="flex items-center space-x-3">
                                {emp.avatar ? (
                                  <img src={emp.avatar} alt={emp.name} className="w-8 h-8 rounded-full" />
                                ) : (
                                  <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center">
                                    <span className="text-xs font-medium text-primary">
                                      {emp.name.split(' ').map(n => n[0]).join('')}
                                    </span>
                                  </div>
                                )}
                                <div>
                                  <p className="font-medium text-default-800">{emp.name}</p>
                                  <p className="text-xs text-default-500">{emp.designation}</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-default-600">{emp.employeeCode}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-default-600">{emp.department}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-success font-semibold">{emp.present}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-danger font-semibold">{emp.absent}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-warning font-semibold">{emp.late}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-warning font-semibold">{emp.halfDay}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-primary font-semibold">{emp.totalHours}h</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-default-600">{emp.avgHours}h</td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <Chip
                                color={parseFloat(emp.attendanceRate) >= 95 ? 'success' : parseFloat(emp.attendanceRate) >= 80 ? 'warning' : 'danger'}
                                variant="flat"
                                size="sm"
                              >
                                {emp.attendanceRate}%
                              </Chip>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </CardBody>
          </Card>
        </>
      )}

      {!reportData && !loading && (
        <div className="text-center py-12 text-default-500">
          <FaCalendarAlt className="w-12 h-12 mx-auto mb-4 text-default-300" />
          <p>Select filters above to generate the attendance report</p>
        </div>
      )}
    </div>
  )
}
