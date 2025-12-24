'use client'

import { useState, useEffect } from 'react'
import toast from '@/utils/toast'
import * as XLSX from 'xlsx'
import { 
  FaUsers, FaChartLine, FaClock, FaCalendarAlt, FaExclamationTriangle,
  FaCheckCircle, FaTimesCircle, FaChartPie, FaDownload, FaFileExcel,
  FaSearch, FaBuilding, FaUserTie, FaChevronDown, FaChevronUp
} from 'react-icons/fa'

export default function AttendanceReportPage() {
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState(null)
  const [dateRange, setDateRange] = useState('today')
  const [customStartDate, setCustomStartDate] = useState('')
  const [customEndDate, setCustomEndDate] = useState('')
  const [selectedDepartment, setSelectedDepartment] = useState('all')
  const [departments, setDepartments] = useState([])
  const [reportData, setReportData] = useState(null)
  const [expandedSections, setExpandedSections] = useState({
    overview: true,
    shrinkage: true,
    departmentBreakdown: true,
    employeeDetails: true
  })
  const [searchTerm, setSearchTerm] = useState('')

  useEffect(() => {
    const userData = localStorage.getItem('user')
    if (userData) {
      const parsedUser = JSON.parse(userData)
      setUser(parsedUser)
      
      if (!['admin', 'hr'].includes(parsedUser.role)) {
        toast.error('Access denied. This page is for admins and HR only.')
        setLoading(false)
        return
      }
      
      fetchDepartments()
      fetchReportData()
    }
  }, [])

  useEffect(() => {
    if (user && ['admin', 'hr'].includes(user.role)) {
      fetchReportData()
    }
  }, [dateRange, customStartDate, customEndDate, selectedDepartment])

  const fetchDepartments = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/departments', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await response.json()
      if (data.success) {
        setDepartments(data.data || [])
      }
    } catch (error) {
      console.error('Error fetching departments:', error)
    }
  }

  const fetchReportData = async () => {
    try {
      setLoading(true)
      const token = localStorage.getItem('token')
      
      let startDate, endDate
      const today = new Date()
      
      switch (dateRange) {
        case 'today':
          startDate = endDate = today.toISOString().split('T')[0]
          break
        case 'yesterday':
          const yesterday = new Date(today)
          yesterday.setDate(yesterday.getDate() - 1)
          startDate = endDate = yesterday.toISOString().split('T')[0]
          break
        case 'week':
          const weekStart = new Date(today)
          weekStart.setDate(weekStart.getDate() - 7)
          startDate = weekStart.toISOString().split('T')[0]
          endDate = today.toISOString().split('T')[0]
          break
        case 'month':
          const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
          startDate = monthStart.toISOString().split('T')[0]
          endDate = today.toISOString().split('T')[0]
          break
        case 'custom':
          startDate = customStartDate
          endDate = customEndDate
          break
        default:
          startDate = endDate = today.toISOString().split('T')[0]
      }

      if (!startDate || !endDate) {
        setLoading(false)
        return
      }

      // Fetch all necessary data
      const [attendanceRes, employeesRes] = await Promise.all([
        fetch(`/api/attendance?startDate=${startDate}&endDate=${endDate}${selectedDepartment !== 'all' ? `&department=${selectedDepartment}` : ''}&populate=true`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch(`/api/employees?limit=1000&status=active&populate=true${selectedDepartment !== 'all' ? `&department=${selectedDepartment}` : ''}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        })
      ])

      const attendanceData = await attendanceRes.json()
      const employeesData = await employeesRes.json()

      if (attendanceData.success && employeesData.success) {
        const attendance = attendanceData.data || []
        const employees = employeesData.data || []
        
        // Calculate comprehensive KPIs
        const kpis = calculateKPIs(attendance, employees, startDate, endDate)
        setReportData(kpis)
      }
    } catch (error) {
      console.error('Error fetching report data:', error)
      toast.error('Failed to fetch attendance report')
    } finally {
      setLoading(false)
    }
  }

  const calculateKPIs = (attendance, employees, startDate, endDate) => {
    const totalEmployees = employees.length
    const start = new Date(startDate)
    const end = new Date(endDate)
    const daysDiff = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1
    
    // Group attendance by employee
    const employeeAttendance = {}
    attendance.forEach(record => {
      const empId = record.employee?._id || record.employee
      if (!employeeAttendance[empId]) {
        employeeAttendance[empId] = []
      }
      employeeAttendance[empId].push(record)
    })

    // Calculate status counts
    const statusCounts = {
      present: 0,
      absent: 0,
      'half-day': 0,
      late: 0,
      'on-leave': 0,
      'in-progress': 0
    }

    let totalWorkHours = 0
    let totalScheduledHours = daysDiff * totalEmployees * 8 // Assuming 8-hour workday
    let lateArrivals = 0
    let earlyDepartures = 0
    
    attendance.forEach(record => {
      if (statusCounts[record.status] !== undefined) {
        statusCounts[record.status]++
      }
      if (record.workHours) {
        totalWorkHours += record.workHours
      }
      if (record.status === 'late') {
        lateArrivals++
      }
      // Check for early departure (less than 7 hours on a present day)
      if (record.status === 'present' && record.workHours && record.workHours < 7) {
        earlyDepartures++
      }
    })

    // Calculate shrinkage metrics
    const totalPossibleWorkHours = totalScheduledHours
    const productiveHours = statusCounts.present * 8 + statusCounts['half-day'] * 4
    const shrinkageHours = totalScheduledHours - totalWorkHours
    const shrinkagePercentage = ((shrinkageHours / totalScheduledHours) * 100).toFixed(2)
    
    // Attendance rate
    const expectedAttendance = totalEmployees * daysDiff
    const actualAttendance = statusCounts.present + statusCounts['half-day'] * 0.5
    const attendanceRate = ((actualAttendance / expectedAttendance) * 100).toFixed(2)
    
    // Absenteeism rate
    const absenteeismRate = ((statusCounts.absent / expectedAttendance) * 100).toFixed(2)
    
    // Punctuality rate
    const punctualityRate = (((statusCounts.present - lateArrivals) / (statusCounts.present || 1)) * 100).toFixed(2)
    
    // Average work hours per employee
    const avgWorkHours = (totalWorkHours / (totalEmployees * daysDiff)).toFixed(2)

    // Department breakdown
    const departmentStats = {}
    employees.forEach(emp => {
      const deptId = emp.department?._id || emp.department
      const deptName = emp.department?.name || 'Unknown'
      if (!departmentStats[deptId]) {
        departmentStats[deptId] = {
          name: deptName,
          totalEmployees: 0,
          present: 0,
          absent: 0,
          late: 0,
          'half-day': 0,
          totalHours: 0
        }
      }
      departmentStats[deptId].totalEmployees++
      
      const empRecords = employeeAttendance[emp._id] || []
      empRecords.forEach(record => {
        if (departmentStats[deptId][record.status] !== undefined) {
          departmentStats[deptId][record.status]++
        }
        if (record.workHours) {
          departmentStats[deptId].totalHours += record.workHours
        }
      })
    })

    // Individual employee metrics
    const employeeMetrics = employees.map(emp => {
      const empRecords = employeeAttendance[emp._id] || []
      const empPresent = empRecords.filter(r => r.status === 'present').length
      const empAbsent = empRecords.filter(r => r.status === 'absent').length
      const empLate = empRecords.filter(r => r.status === 'late').length
      const empHalfDay = empRecords.filter(r => r.status === 'half-day').length
      const empWorkHours = empRecords.reduce((sum, r) => sum + (r.workHours || 0), 0)
      
      return {
        id: emp._id,
        name: `${emp.firstName} ${emp.lastName}`,
        employeeCode: emp.employeeCode,
        department: emp.department?.name || 'Unknown',
        designation: emp.designation?.title || 'N/A',
        email: emp.email,
        avatar: emp.avatar,
        present: empPresent,
        absent: empAbsent,
        late: empLate,
        halfDay: empHalfDay,
        totalHours: empWorkHours.toFixed(2),
        avgHours: (empWorkHours / daysDiff).toFixed(2),
        attendanceRate: ((empPresent / daysDiff) * 100).toFixed(1),
        records: empRecords
      }
    }).sort((a, b) => parseFloat(b.attendanceRate) - parseFloat(a.attendanceRate))

    return {
      period: { startDate, endDate, days: daysDiff },
      overview: {
        totalEmployees,
        expectedAttendance,
        actualAttendance: actualAttendance.toFixed(1),
        attendanceRate,
        absenteeismRate,
        punctualityRate,
        avgWorkHours
      },
      statusCounts,
      workHours: {
        total: totalWorkHours.toFixed(2),
        scheduled: totalScheduledHours.toFixed(2),
        productive: productiveHours.toFixed(2),
        average: avgWorkHours
      },
      shrinkage: {
        totalHours: shrinkageHours.toFixed(2),
        percentage: shrinkagePercentage,
        breakdown: {
          absent: statusCounts.absent * 8,
          halfDay: statusCounts['half-day'] * 4,
          late: lateArrivals,
          earlyDeparture: earlyDepartures,
          unproductive: (shrinkageHours - (statusCounts.absent * 8 + statusCounts['half-day'] * 4)).toFixed(2)
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

  const exportToExcel = () => {
    if (!reportData) return

    // Create workbook
    const wb = XLSX.utils.book_new()

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
      ['Late', reportData.statusCounts.late],
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
    const ws1 = XLSX.utils.aoa_to_sheet(overviewData)
    XLSX.utils.book_append_sheet(wb, ws1, 'Overview')

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
    const ws2 = XLSX.utils.aoa_to_sheet(shrinkageData)
    XLSX.utils.book_append_sheet(wb, ws2, 'Shrinkage Analysis')

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
      const ws3 = XLSX.utils.aoa_to_sheet(deptData)
      XLSX.utils.book_append_sheet(wb, ws3, 'Department Breakdown')
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
    const ws4 = XLSX.utils.aoa_to_sheet(employeeData)
    XLSX.utils.book_append_sheet(wb, ws4, 'Employee Details')

    // Generate file and download
    XLSX.writeFile(wb, `attendance-report-${reportData.period.startDate}-to-${reportData.period.endDate}.xlsx`)
    toast.success('Excel Report exported successfully')
  }

  const filteredEmployees = reportData?.employees.filter(emp => {
    const searchLower = searchTerm.toLowerCase()
    return (
      emp.name.toLowerCase().includes(searchLower) ||
      emp.employeeCode.toLowerCase().includes(searchLower) ||
      emp.department.toLowerCase().includes(searchLower)
    )
  }) || []

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
      </div>
    )
  }

  if (!user || !['admin', 'hr'].includes(user.role)) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <FaExclamationTriangle className="mx-auto h-12 w-12 text-yellow-500 mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Access Restricted</h2>
          <p className="text-gray-600">This report is only available to administrators and HR.</p>
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
            <h1 className="text-3xl font-bold text-gray-800">Attendance Report & Analytics</h1>
            <p className="text-gray-600 mt-1">Comprehensive attendance KPIs, shrinkage analysis, and employee metrics</p>
          </div>
          <div className="flex items-center space-x-3">
            <button
              onClick={exportToExcel}
              disabled={!reportData}
              className="flex items-center space-x-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <FaFileExcel />
              <span>Export Excel</span>
            </button>
            <button
              onClick={exportToCSV}
              disabled={!reportData}
              className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <FaDownload />
              <span>Export CSV</span>
            </button>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow-md p-6 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Date Range</label>
            <select
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
            >
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="week">Last 7 Days</option>
              <option value="month">This Month</option>
              <option value="custom">Custom Range</option>
            </select>
          </div>

          {dateRange === 'custom' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Start Date</label>
                <input
                  type="date"
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">End Date</label>
                <input
                  type="date"
                  value={customEndDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Department</label>
            <select
              value={selectedDepartment}
              onChange={(e) => setSelectedDepartment(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
            >
              <option value="all">All Departments</option>
              {departments.map(dept => (
                <option key={dept._id} value={dept._id}>{dept.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {reportData && (
        <>
          {/* Overview KPIs */}
          <div className="bg-white rounded-lg shadow-md p-6 mb-6">
            <div 
              className="flex items-center justify-between cursor-pointer mb-4"
              onClick={() => toggleSection('overview')}
            >
              <h2 className="text-xl font-bold text-gray-800 flex items-center space-x-2">
                <FaChartLine className="text-primary-600" />
                <span>Overview Metrics</span>
              </h2>
              {expandedSections.overview ? <FaChevronUp /> : <FaChevronDown />}
            </div>
            
            {expandedSections.overview && (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                  <div className="bg-blue-50 rounded-lg p-4">
                    <div className="flex items-center space-x-2 mb-2">
                      <FaUsers className="text-blue-600" />
                      <span className="text-sm text-blue-700 font-medium">Total Employees</span>
                    </div>
                    <p className="text-3xl font-bold text-blue-600">{reportData.overview.totalEmployees}</p>
                  </div>

                  <div className="bg-green-50 rounded-lg p-4">
                    <div className="flex items-center space-x-2 mb-2">
                      <FaCheckCircle className="text-green-600" />
                      <span className="text-sm text-green-700 font-medium">Attendance Rate</span>
                    </div>
                    <p className="text-3xl font-bold text-green-600">{reportData.overview.attendanceRate}%</p>
                  </div>

                  <div className="bg-red-50 rounded-lg p-4">
                    <div className="flex items-center space-x-2 mb-2">
                      <FaTimesCircle className="text-red-600" />
                      <span className="text-sm text-red-700 font-medium">Absenteeism Rate</span>
                    </div>
                    <p className="text-3xl font-bold text-red-600">{reportData.overview.absenteeismRate}%</p>
                  </div>

                  <div className="bg-amber-50 rounded-lg p-4">
                    <div className="flex items-center space-x-2 mb-2">
                      <FaClock className="text-amber-600" />
                      <span className="text-sm text-amber-700 font-medium">Punctuality Rate</span>
                    </div>
                    <p className="text-3xl font-bold text-amber-600">{reportData.overview.punctualityRate}%</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  <div className="bg-purple-50 rounded-lg p-4 text-center">
                    <p className="text-2xl font-bold text-purple-600">{reportData.statusCounts.present}</p>
                    <p className="text-sm text-purple-700">Present</p>
                  </div>
                  <div className="bg-red-50 rounded-lg p-4 text-center">
                    <p className="text-2xl font-bold text-red-600">{reportData.statusCounts.absent}</p>
                    <p className="text-sm text-red-700">Absent</p>
                  </div>
                  <div className="bg-yellow-50 rounded-lg p-4 text-center">
                    <p className="text-2xl font-bold text-yellow-600">{reportData.statusCounts['half-day']}</p>
                    <p className="text-sm text-yellow-700">Half Day</p>
                  </div>
                  <div className="bg-orange-50 rounded-lg p-4 text-center">
                    <p className="text-2xl font-bold text-orange-600">{reportData.statusCounts.late}</p>
                    <p className="text-sm text-orange-700">Late</p>
                  </div>
                  <div className="bg-blue-50 rounded-lg p-4 text-center">
                    <p className="text-2xl font-bold text-blue-600">{reportData.statusCounts['on-leave']}</p>
                    <p className="text-sm text-blue-700">On Leave</p>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Shrinkage Analysis */}
          <div className="bg-white rounded-lg shadow-md p-6 mb-6">
            <div 
              className="flex items-center justify-between cursor-pointer mb-4"
              onClick={() => toggleSection('shrinkage')}
            >
              <h2 className="text-xl font-bold text-gray-800 flex items-center space-x-2">
                <FaChartPie className="text-red-600" />
                <span>Shrinkage Analysis</span>
              </h2>
              {expandedSections.shrinkage ? <FaChevronUp /> : <FaChevronDown />}
            </div>
            
            {expandedSections.shrinkage && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <div className="bg-red-50 rounded-lg p-6 mb-4">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-sm font-medium text-red-700">Total Shrinkage</span>
                      <span className="text-3xl font-bold text-red-600">{reportData.shrinkage.percentage}%</span>
                    </div>
                    <p className="text-sm text-red-600">{reportData.shrinkage.totalHours} hours lost</p>
                    <div className="mt-2 bg-red-200 rounded-full h-3">
                      <div 
                        className="bg-red-600 h-3 rounded-full" 
                        style={{ width: `${Math.min(reportData.shrinkage.percentage, 100)}%` }}
                      ></div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                      <span className="text-sm text-gray-700">Scheduled Hours</span>
                      <span className="font-semibold text-gray-900">{reportData.workHours.scheduled}h</span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-green-50 rounded-lg">
                      <span className="text-sm text-green-700">Actual Work Hours</span>
                      <span className="font-semibold text-green-900">{reportData.workHours.total}h</span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-blue-50 rounded-lg">
                      <span className="text-sm text-blue-700">Avg Hours/Employee/Day</span>
                      <span className="font-semibold text-blue-900">{reportData.workHours.average}h</span>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-lg font-semibold text-gray-800 mb-4">Shrinkage Breakdown</h3>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center p-3 bg-red-50 rounded-lg">
                      <span className="text-sm text-red-700">Absent Days</span>
                      <span className="font-semibold text-red-900">{reportData.shrinkage.breakdown.absent}h</span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-yellow-50 rounded-lg">
                      <span className="text-sm text-yellow-700">Half Days</span>
                      <span className="font-semibold text-yellow-900">{reportData.shrinkage.breakdown.halfDay}h</span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-orange-50 rounded-lg">
                      <span className="text-sm text-orange-700">Late Arrivals</span>
                      <span className="font-semibold text-orange-900">{reportData.shrinkage.breakdown.late} instances</span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-amber-50 rounded-lg">
                      <span className="text-sm text-amber-700">Early Departures</span>
                      <span className="font-semibold text-amber-900">{reportData.shrinkage.breakdown.earlyDeparture} instances</span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                      <span className="text-sm text-gray-700">Other Unproductive</span>
                      <span className="font-semibold text-gray-900">{reportData.shrinkage.breakdown.unproductive}h</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Department Breakdown */}
          {reportData.departments.length > 0 && (
            <div className="bg-white rounded-lg shadow-md p-6 mb-6">
              <div 
                className="flex items-center justify-between cursor-pointer mb-4"
                onClick={() => toggleSection('departmentBreakdown')}
              >
                <h2 className="text-xl font-bold text-gray-800 flex items-center space-x-2">
                  <FaBuilding className="text-primary-600" />
                  <span>Department Breakdown</span>
                </h2>
                {expandedSections.departmentBreakdown ? <FaChevronUp /> : <FaChevronDown />}
              </div>
              
              {expandedSections.departmentBreakdown && (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Department</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Employees</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Present</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Absent</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Late</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Half Day</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Total Hours</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {reportData.departments.map((dept, idx) => (
                        <tr key={idx} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap font-medium text-gray-900">{dept.name}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-gray-600">{dept.totalEmployees}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-green-600 font-semibold">{dept.present}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-red-600 font-semibold">{dept.absent}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-orange-600 font-semibold">{dept.late}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-yellow-600 font-semibold">{dept['half-day']}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-blue-600 font-semibold">{dept.totalHours.toFixed(2)}h</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Employee Details */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <div 
              className="flex items-center justify-between cursor-pointer mb-4"
              onClick={() => toggleSection('employeeDetails')}
            >
              <h2 className="text-xl font-bold text-gray-800 flex items-center space-x-2">
                <FaUserTie className="text-primary-600" />
                <span>Individual Employee Metrics</span>
              </h2>
              {expandedSections.employeeDetails ? <FaChevronUp /> : <FaChevronDown />}
            </div>
            
            {expandedSections.employeeDetails && (
              <>
                <div className="mb-4">
                  <div className="relative">
                    <FaSearch className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Search by name, code, or department..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Employee</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Code</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Department</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Present</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Absent</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Late</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Half Day</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Total Hours</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Avg Hours/Day</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Attendance %</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {filteredEmployees.map((emp) => (
                        <tr key={emp.id} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center space-x-3">
                              {emp.avatar ? (
                                <img src={emp.avatar} alt={emp.name} className="w-8 h-8 rounded-full" />
                              ) : (
                                <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center">
                                  <span className="text-xs font-medium text-primary-600">
                                    {emp.name.split(' ').map(n => n[0]).join('')}
                                  </span>
                                </div>
                              )}
                              <div>
                                <p className="font-medium text-gray-900">{emp.name}</p>
                                <p className="text-xs text-gray-500">{emp.designation}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{emp.employeeCode}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{emp.department}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-green-600 font-semibold">{emp.present}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-red-600 font-semibold">{emp.absent}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-orange-600 font-semibold">{emp.late}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-yellow-600 font-semibold">{emp.halfDay}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-blue-600 font-semibold">{emp.totalHours}h</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{emp.avgHours}h</td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                              parseFloat(emp.attendanceRate) >= 95 ? 'bg-green-100 text-green-800' :
                              parseFloat(emp.attendanceRate) >= 80 ? 'bg-yellow-100 text-yellow-800' :
                              'bg-red-100 text-red-800'
                            }`}>
                              {emp.attendanceRate}%
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </>
      )}

      {!reportData && !loading && (
        <div className="text-center py-12 text-gray-500">
          <FaCalendarAlt className="w-12 h-12 mx-auto mb-4 text-gray-300" />
          <p>Select filters above to generate the attendance report</p>
        </div>
      )}
    </div>
  )
}
