'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import toast from '@/utils/toast'
import {
  FaMoneyBillWave, FaArrowLeft, FaCalculator, FaEye, FaDownload,
  FaFilter, FaSync, FaExclamationTriangle, FaCheckCircle, FaClock,
  FaUserClock, FaCalendarCheck, FaInfoCircle, FaToggleOn, FaToggleOff,
  FaExclamationCircle, FaSearch, FaChevronDown, FaChevronUp, FaTimes
} from 'react-icons/fa'
import Loader from '@/components/ui/Loader'
import { formatDepartments } from '@/lib/formatters'

export default function GeneratePayrollPage() {
  const router = useRouter()
  const [employees, setEmployees] = useState([])
  const [departments, setDepartments] = useState([])
  const [existingPayrollEmployeeIds, setExistingPayrollEmployeeIds] = useState([])
  const [attendanceData, setAttendanceData] = useState({})
  const [leaveData, setLeaveData] = useState({}) // Leave data per employee
  const [holidayData, setHolidayData] = useState([]) // Holidays for the month
  const [companySettings, setCompanySettings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [selectedEmployees, setSelectedEmployees] = useState([])
  const [pendingLeavesWarning, setPendingLeavesWarning] = useState([]) // Employees with pending leaves
  
  // Filter states
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedDepartment, setSelectedDepartment] = useState('all')
  const [expandedDepartments, setExpandedDepartments] = useState({})
  const [showFilters, setShowFilters] = useState(true)
  
  const [formData, setFormData] = useState({
    month: new Date().getMonth() + 1,
    year: new Date().getFullYear(),
    paymentDate: new Date().toISOString().split('T')[0],
  })

  // Format currency in Indian Rupees
  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(amount || 0)
  }

  // Format time for display
  const formatTime = (timeStr) => {
    if (!timeStr) return '--:--'
    const [hours, mins] = timeStr.split(':')
    const h = parseInt(hours)
    const ampm = h >= 12 ? 'PM' : 'AM'
    const h12 = h % 12 || 12
    return h12 + ':' + mins + ' ' + ampm
  }

  useEffect(() => {
    fetchInitialData()
  }, [])

  useEffect(() => {
    if (employees.length > 0 && companySettings) {
      fetchAttendanceData()
      fetchLeaveData() // Fetch leave data for accurate payroll calculation
      fetchHolidayData() // Fetch holidays for the month
      fetchExistingPayrolls()
    }
  }, [formData.month, formData.year, employees, companySettings])

  const fetchExistingPayrolls = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch(
        `/api/payroll?month=${formData.month}&year=${formData.year}`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      )
      const data = await response.json()
      if (data.success && data.data) {
        // Get employee IDs that already have payroll for this month/year
        const existingIds = data.data.map(p => p.employee?._id || p.employee).filter(Boolean)
        setExistingPayrollEmployeeIds(existingIds)
        // Clear selections for employees that already have payroll
        setSelectedEmployees(prev => prev.filter(id => !existingIds.includes(id)))
      }
    } catch (error) {
      console.error('Fetch existing payrolls error:', error)
    }
  }

  // Filter employees to only show those without existing payroll
  const availableEmployees = useMemo(() => {
    return employees.filter(emp => !existingPayrollEmployeeIds.includes(emp._id))
  }, [employees, existingPayrollEmployeeIds])

  const fetchInitialData = async () => {
    try {
      const token = localStorage.getItem('token')

      // Fetch employees, departments, and company settings in parallel
      const [employeesRes, departmentsRes, settingsRes] = await Promise.all([
        fetch('/api/employees?limit=1000&status=active', {
          headers: { 'Authorization': 'Bearer ' + token },
        }),
        fetch('/api/departments', {
          headers: { 'Authorization': 'Bearer ' + token },
        }),
        fetch('/api/settings/company', {
          headers: { 'Authorization': 'Bearer ' + token },
        }),
      ])

      const employeesData = await employeesRes.json()
      const departmentsData = await departmentsRes.json()
      const settingsData = await settingsRes.json()

      if (employeesData.success) {
        setEmployees(employeesData.data.filter(emp => emp.status === 'active'))
      }

      if (departmentsData.success) {
        setDepartments(departmentsData.data || [])
        // Initialize all departments as expanded
        const expanded = {}
        departmentsData.data?.forEach(dept => {
          expanded[dept._id] = true
        })
        setExpandedDepartments(expanded)
      }

      if (settingsData.success) {
        setCompanySettings(settingsData.data || getDefaultSettings())
      } else {
        setCompanySettings(getDefaultSettings())
      }
    } catch (error) {
      console.error('Fetch initial data error:', error)
      toast.error('Failed to fetch data')
      setCompanySettings(getDefaultSettings())
    } finally {
      setLoading(false)
    }
  }

  const getDefaultSettings = () => ({
    checkInTime: '09:00',
    checkOutTime: '18:00',
    lateThreshold: 15,
    halfDayHours: 4,
    fullDayHours: 8,
    // Hour thresholds for determining day status
    fullDayThreshold: 7.5, // 7.5 hours or more = full day (allows 30 min grace)
    halfDayThreshold: 3.5, // 3.5 hours or more but less than fullDayThreshold = half day
    workingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
    payroll: {
      workingDaysPerMonth: 26,
      pfEnabled: true,
      pfPercentage: 12,
      esiEnabled: true,
      esiPercentage: 0.75,
      professionalTax: { enabled: true, amount: 200 },
      tdsEnabled: false,
      tdsPercentage: 0,
    },
  })

  // Fetch holidays for the selected month
  const fetchHolidayData = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch(
        `/api/holidays?year=${formData.year}`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      )
      const data = await response.json()
      
      if (data.success && data.data) {
        // Filter holidays for the selected month
        const monthHolidays = data.data.filter(holiday => {
          const holidayDate = new Date(holiday.date)
          return holidayDate.getMonth() + 1 === formData.month && 
                 holidayDate.getFullYear() === formData.year &&
                 holiday.isActive
        })
        setHolidayData(monthHolidays)
      }
    } catch (error) {
      console.error('Fetch holiday data error:', error)
      setHolidayData([])
    }
  }

  const fetchAttendanceData = async () => {
    try {
      const token = localStorage.getItem('token')
      const attendanceMap = {}

      // Fetch attendance for the selected month
      const response = await fetch(
        '/api/attendance?month=' + formData.month + '&year=' + formData.year + '&limit=5000',
        { headers: { 'Authorization': 'Bearer ' + token } }
      )

      const data = await response.json()

      // Get hour thresholds from company settings
      const settings = companySettings || getDefaultSettings()
      const fullDayThreshold = settings.fullDayThreshold || 7.5 // Default: 7.5 hours = full day

      if (data.success && data.data) {
        // Process attendance data per employee - SIMPLIFIED for addition-based calculation
        // Only count PRESENT days (full days with sufficient hours)
        data.data.forEach(record => {
          const empId = record.employee?._id || record.employee
          if (!empId) return

          if (!attendanceMap[empId]) {
            attendanceMap[empId] = {
              presentDays: 0,      // Full present days (paid)
              halfDays: 0,         // Half days (not paid in new system)
              absentDays: 0,       // Absent days (not paid)
              wfhDays: 0,          // WFH days (not paid unless configured)
              totalWorkHours: 0,
              records: [],
            }
          }

          attendanceMap[empId].records.push(record)

          const status = record.status?.toLowerCase() || ''
          const workHours = record.workHours || 0

          // SIMPLIFIED: Only count full present days
          // Present = status is 'present' AND workHours >= fullDayThreshold
          if (status === 'present' || status === 'approved') {
            if (workHours >= fullDayThreshold) {
              attendanceMap[empId].presentDays++
            } else if (workHours > 0) {
              // Less than full day threshold = half day (NOT paid in new system)
              attendanceMap[empId].halfDays++
            }
            attendanceMap[empId].totalWorkHours += workHours
          } else if (status === 'half-day' || status === 'halfday') {
            attendanceMap[empId].halfDays++
            attendanceMap[empId].totalWorkHours += workHours
          } else if (status === 'absent') {
            attendanceMap[empId].absentDays++
          } else if (status === 'wfh' || status === 'work-from-home') {
            attendanceMap[empId].wfhDays++
          }
          // Note: 'leave', 'on-leave' status is handled separately in leave data
          // 'holiday', 'weekend' are not working days
        })
      }

      setAttendanceData(attendanceMap)
    } catch (error) {
      console.error('Fetch attendance error:', error)
    }
  }

  // Fetch leave data for the selected month
  const fetchLeaveData = async () => {
    try {
      const token = localStorage.getItem('token')
      const leaveMap = {}
      const pendingWarnings = []

      // Calculate start and end of the month
      const startOfMonth = new Date(formData.year, formData.month - 1, 1)
      const endOfMonth = new Date(formData.year, formData.month, 0)

      // Fetch all leaves
      const response = await fetch('/api/leave', {
        headers: { 'Authorization': 'Bearer ' + token }
      })

      const data = await response.json()

      if (data.success && data.data) {
        data.data.forEach(leave => {
          const empId = leave.employee?._id || leave.employee
          if (!empId) return

          // Check if leave overlaps with selected month
          const leaveStart = new Date(leave.startDate)
          const leaveEnd = new Date(leave.endDate)
          
          // Only consider leaves that overlap with the payroll month
          if (leaveEnd < startOfMonth || leaveStart > endOfMonth) return

          if (!leaveMap[empId]) {
            leaveMap[empId] = {
              approvedDays: 0,
              deniedDays: 0,
              pendingDays: 0,
              approvedLeaves: [],
              deniedLeaves: [],
              pendingLeaves: [],
            }
          }

          // Calculate days within this month
          const effectiveStart = leaveStart < startOfMonth ? startOfMonth : leaveStart
          const effectiveEnd = leaveEnd > endOfMonth ? endOfMonth : leaveEnd
          const daysInMonth = Math.ceil((effectiveEnd - effectiveStart) / (1000 * 60 * 60 * 24)) + 1

          if (leave.status === 'approved') {
            leaveMap[empId].approvedDays += leave.isHalfDay ? 0.5 : daysInMonth
            leaveMap[empId].approvedLeaves.push({
              ...leave,
              daysInMonth: leave.isHalfDay ? 0.5 : daysInMonth
            })
          } else if (leave.status === 'rejected') {
            leaveMap[empId].deniedDays += leave.isHalfDay ? 0.5 : daysInMonth
            leaveMap[empId].deniedLeaves.push({
              ...leave,
              daysInMonth: leave.isHalfDay ? 0.5 : daysInMonth
            })
          } else if (leave.status === 'pending') {
            leaveMap[empId].pendingDays += leave.isHalfDay ? 0.5 : daysInMonth
            leaveMap[empId].pendingLeaves.push({
              ...leave,
              daysInMonth: leave.isHalfDay ? 0.5 : daysInMonth
            })

            // Add to pending warnings
            const employee = employees.find(e => e._id === empId)
            if (employee) {
              pendingWarnings.push({
                employeeId: empId,
                employeeName: `${employee.firstName} ${employee.lastName}`,
                employeeCode: employee.employeeCode,
                pendingDays: leave.isHalfDay ? 0.5 : daysInMonth,
                leaveId: leave._id,
                startDate: leave.startDate,
                endDate: leave.endDate,
              })
            }
          }
        })
      }

      setLeaveData(leaveMap)
      setPendingLeavesWarning(pendingWarnings)
    } catch (error) {
      console.error('Fetch leave data error:', error)
    }
  }

  const calculateEmployeePayroll = (employee) => {
    const settings = companySettings || getDefaultSettings()
    const payrollSettings = settings.payroll || getDefaultSettings().payroll
    const attendance = attendanceData[employee._id] || {
      presentDays: 0,
      halfDays: 0,
      absentDays: 0,
      wfhDays: 0,
      totalWorkHours: 0,
    }

    // Get leave data for this employee
    const employeeLeaves = leaveData[employee._id] || {
      approvedDays: 0,
      deniedDays: 0,
      pendingDays: 0,
      approvedLeaves: [],
      deniedLeaves: [],
      pendingLeaves: [],
    }

    // Get employee's salary
    const empSalary = employee.salary || {}
    const grossSalary = empSalary.grossSalary || empSalary.basic || 0
    const workingDays = payrollSettings.workingDaysPerMonth || 26

    // SIMPLIFIED CALCULATION: Per-day salary = gross / working days (rounded UP)
    const perDaySalary = grossSalary > 0 ? Math.ceil(grossSalary / workingDays) : 0

    // Count holidays in this month (all employees get paid for holidays)
    const holidayCount = holidayData.length

    // PAID DAYS CALCULATION:
    // 1. Present days (full attendance with sufficient hours)
    // 2. Approved leaves
    // 3. Holidays (company holidays)
    const paidPresentDays = attendance.presentDays || 0
    const paidApprovedLeaves = employeeLeaves.approvedDays || 0
    const paidHolidays = holidayCount

    // Total paid days = present + approved leaves + holidays
    const totalPaidDays = paidPresentDays + paidApprovedLeaves + paidHolidays

    // UNPAID DAYS (for display only - we don't deduct, just don't add):
    // - Half days, absent days, denied leaves, pending leaves, WFH, no records
    const unpaidHalfDays = attendance.halfDays || 0
    const unpaidAbsentDays = attendance.absentDays || 0
    const unpaidDeniedLeaves = employeeLeaves.deniedDays || 0
    const unpaidPendingLeaves = employeeLeaves.pendingDays || 0
    const unpaidWfhDays = attendance.wfhDays || 0
    
    // Days with no record = working days - all accounted days
    const accountedDays = paidPresentDays + unpaidHalfDays + unpaidAbsentDays + paidApprovedLeaves + 
                          unpaidDeniedLeaves + unpaidPendingLeaves + unpaidWfhDays + paidHolidays
    const noRecordDays = Math.max(0, workingDays - accountedDays)

    // EARNED SALARY = Per-day salary × Total paid days
    const earnedSalary = perDaySalary * totalPaidDays

    // Get salary components for display (proportional to earned)
    const basicSalary = empSalary.basic || 0
    const hra = empSalary.hra || 0
    const conveyanceAllowance = empSalary.conveyance || 0
    const medicalAllowance = empSalary.medical || 0
    const specialAllowance = empSalary.special || 0

    // Proportional breakdown based on earned vs gross ratio
    const earnedRatio = grossSalary > 0 ? earnedSalary / grossSalary : 0
    const earnedBasic = Math.ceil(basicSalary * earnedRatio)
    const earnedHRA = Math.ceil(hra * earnedRatio)
    const earnedConveyance = Math.ceil(conveyanceAllowance * earnedRatio)
    const earnedMedical = Math.ceil(medicalAllowance * earnedRatio)
    const earnedSpecial = Math.ceil(specialAllowance * earnedRatio)

    // STATUTORY DEDUCTIONS (calculated on earned salary)
    // Check employee's statutory enrollment status
    const pfEnrolled = employee.pfEnrollment?.enrolled ?? true
    const esiEnrolled = employee.esiEnrollment?.enrolled ?? true
    const ptApplicable = employee.professionalTax?.applicable ?? true

    let pf = 0
    if (payrollSettings.pfEnabled && pfEnrolled && earnedBasic > 0) {
      const pfPercentage = employee.pfEnrollment?.employeeContribution || payrollSettings.pfPercentage || 12
      pf = Math.ceil(earnedBasic * pfPercentage / 100)
    }

    let esi = 0
    if (payrollSettings.esiEnabled && esiEnrolled && earnedSalary <= 21000 && earnedSalary > 0) {
      esi = Math.ceil(earnedSalary * (payrollSettings.esiPercentage || 0.75) / 100)
    }

    let professionalTax = 0
    if (payrollSettings.professionalTax?.enabled && ptApplicable && earnedSalary > 0) {
      professionalTax = employee.professionalTax?.amount || payrollSettings.professionalTax.amount || 200
    }

    // TDS calculation on earned salary
    let tds = 0
    const employeeTds = employee.tdsConfiguration || {}
    if (employeeTds.enabled && earnedSalary > 0) {
      if (employeeTds.fixedAmount > 0) {
        tds = employeeTds.fixedAmount
      } else if (employeeTds.percentage > 0) {
        tds = Math.ceil(earnedSalary * employeeTds.percentage / 100)
      }
    } else if (payrollSettings.tdsEnabled && payrollSettings.tdsPercentage > 0 && earnedSalary > 0) {
      tds = Math.ceil(earnedSalary * (payrollSettings.tdsPercentage / 100))
    }

    // Total statutory deductions
    const totalDeductions = pf + esi + professionalTax + tds

    // NET SALARY = Earned salary - Statutory deductions
    const netSalary = Math.max(0, earnedSalary - totalDeductions)

    return {
      employee,
      // Attendance summary
      attendance: {
        presentDays: paidPresentDays,
        halfDays: unpaidHalfDays,
        absentDays: unpaidAbsentDays,
        wfhDays: unpaidWfhDays,
        noRecordDays,
        totalWorkHours: attendance.totalWorkHours || 0,
      },
      // Leave summary
      leaves: {
        approvedDays: paidApprovedLeaves,
        deniedDays: unpaidDeniedLeaves,
        pendingDays: unpaidPendingLeaves,
      },
      // Holiday count
      holidays: paidHolidays,
      // Working days configuration
      workingDays,
      // Paid days breakdown
      paidDays: {
        present: paidPresentDays,
        approvedLeaves: paidApprovedLeaves,
        holidays: paidHolidays,
        total: totalPaidDays,
      },
      // Salary calculations
      perDaySalary,
      earnedSalary,
      grossSalary,
      // Earned components (proportional)
      earnedBasic,
      earnedHRA,
      earnedConveyance,
      earnedMedical,
      earnedSpecial,
      // Original components (for reference)
      basicSalary,
      hra,
      conveyanceAllowance,
      medicalAllowance,
      specialAllowance,
      // Deductions
      pf,
      esi,
      professionalTax,
      tds,
      totalDeductions,
      // Final
      netSalary,
      // Enrollment status
      pfEnrolled,
      esiEnrolled,
      ptApplicable,
    }
  }

  const calculatedPayrollData = useMemo(() => {
    if (!showPreview) return []
    return selectedEmployees.map(empId => {
      const employee = employees.find(e => e._id === empId)
      if (!employee) return null
      return calculateEmployeePayroll(employee)
    }).filter(Boolean)
  }, [selectedEmployees, showPreview, employees, attendanceData, leaveData, holidayData, companySettings])

  // Filter and group employees by department
  const filteredEmployees = useMemo(() => {
    let filtered = availableEmployees

    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(emp => 
        emp.firstName?.toLowerCase().includes(query) ||
        emp.lastName?.toLowerCase().includes(query) ||
        emp.employeeCode?.toLowerCase().includes(query) ||
        emp.email?.toLowerCase().includes(query) ||
        formatDepartments(emp).toLowerCase().includes(query) ||
        emp.designation?.title?.toLowerCase().includes(query)
      )
    }

    // Department filter
    if (selectedDepartment !== 'all') {
      filtered = filtered.filter(emp => {
        const empDeptId = emp.department?._id || emp.department
        return empDeptId === selectedDepartment
      })
    }

    return filtered
  }, [availableEmployees, searchQuery, selectedDepartment])

  // Group employees by department for organized display
  const employeesByDepartment = useMemo(() => {
    const grouped = {}
    const noDept = []

    filteredEmployees.forEach(emp => {
      const deptId = emp.department?._id || emp.department
      const deptName = emp.department?.name || 'No Department'
      
      if (!deptId) {
        noDept.push(emp)
      } else {
        if (!grouped[deptId]) {
          grouped[deptId] = {
            id: deptId,
            name: deptName,
            employees: []
          }
        }
        grouped[deptId].employees.push(emp)
      }
    })

    // Convert to array and add "No Department" group if needed
    const result = Object.values(grouped)
    if (noDept.length > 0) {
      result.push({
        id: 'no-dept',
        name: 'No Department',
        employees: noDept
      })
    }

    return result.sort((a, b) => a.name.localeCompare(b.name))
  }, [filteredEmployees])

  const toggleDepartmentExpand = (deptId) => {
    setExpandedDepartments(prev => ({
      ...prev,
      [deptId]: !prev[deptId]
    }))
  }

  const handleSelectDepartment = (deptId, employees) => {
    const empIds = employees.map(e => e._id)
    const allSelected = empIds.every(id => selectedEmployees.includes(id))
    
    if (allSelected) {
      // Deselect all in department
      setSelectedEmployees(prev => prev.filter(id => !empIds.includes(id)))
    } else {
      // Select all in department
      setSelectedEmployees(prev => [...new Set([...prev, ...empIds])])
    }
  }

  const handleSelectAll = (e) => {
    if (e.target.checked) {
      setSelectedEmployees(filteredEmployees.map(emp => emp._id))
    } else {
      setSelectedEmployees([])
    }
  }

  const handleSelectEmployee = (empId) => {
    if (selectedEmployees.includes(empId)) {
      setSelectedEmployees(selectedEmployees.filter(id => id !== empId))
    } else {
      setSelectedEmployees([...selectedEmployees, empId])
    }
  }

  const clearFilters = () => {
    setSearchQuery('')
    setSelectedDepartment('all')
  }

  const handlePreviewPayroll = () => {
    if (selectedEmployees.length === 0) {
      toast.error('Please select at least one employee')
      return
    }
    setShowPreview(true)
  }

  const handleGeneratePayroll = async () => {
    if (selectedEmployees.length === 0) {
      toast.error('Please select at least one employee')
      return
    }

    setGenerating(true)

    try {
      const token = localStorage.getItem('token')

      const promises = calculatedPayrollData.map(async (payroll) => {
        // Build payroll data matching the Payroll model schema - SIMPLIFIED
        const payrollData = {
          employee: payroll.employee._id,
          month: formData.month,
          year: formData.year,
          // Earnings object - using earned (proportional) values
          earnings: {
            basic: payroll.earnedBasic,
            hra: payroll.earnedHRA,
            conveyance: payroll.earnedConveyance,
            medicalAllowance: payroll.earnedMedical,
            specialAllowance: payroll.earnedSpecial,
            overtime: 0, // No overtime in new system
            bonus: 0,
            incentives: 0,
            other: 0,
          },
          // Deductions object - only statutory deductions
          deductions: {
            pf: payroll.pf,
            esi: payroll.esi,
            professionalTax: payroll.professionalTax,
            tds: payroll.tds,
            lateDeduction: 0, // No attendance deductions in new system
            loanRepayment: 0,
            advance: 0,
            other: 0,
          },
          // Required fields
          grossSalary: payroll.earnedSalary, // Use earned salary as gross
          totalDeductions: payroll.totalDeductions,
          netSalary: payroll.netSalary,
          workingDays: payroll.workingDays,
          presentDays: payroll.paidDays.present,
          absentDays: payroll.attendance.absentDays + payroll.attendance.noRecordDays,
          leaveDays: payroll.paidDays.approvedLeaves,
          // Attendance details
          attendanceDetails: {
            lateDays: 0,
            halfDays: payroll.attendance.halfDays,
            overtimeHours: 0,
            holidaysWorked: 0,
            holidaysPaid: payroll.paidDays.holidays,
            deniedLeaveDays: payroll.leaves.deniedDays,
            pendingLeaveDays: payroll.leaves.pendingDays,
            wfhDays: payroll.attendance.wfhDays,
            noRecordDays: payroll.attendance.noRecordDays,
          },
          // Paid days breakdown (new field)
          paidDaysBreakdown: {
            presentDays: payroll.paidDays.present,
            approvedLeaves: payroll.paidDays.approvedLeaves,
            holidays: payroll.paidDays.holidays,
            totalPaidDays: payroll.paidDays.total,
            perDaySalary: payroll.perDaySalary,
          },
          // Pay period
          payPeriod: {
            startDate: new Date(formData.year, formData.month - 1, 1),
            endDate: new Date(formData.year, formData.month, 0),
          },
          paymentDate: formData.paymentDate,
          status: 'draft',
        }

        return fetch('/api/payroll', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + token,
          },
          body: JSON.stringify(payrollData),
        })
      })

      await Promise.all(promises)

      toast.success('Payroll generated for ' + selectedEmployees.length + ' employees!')
      router.push('/dashboard/payroll')
    } catch (error) {
      console.error('Generate payroll error:', error)
      toast.error('Failed to generate payroll')
    } finally {
      setGenerating(false)
    }
  }

  const summaryTotals = useMemo(() => {
    return calculatedPayrollData.reduce((acc, p) => ({
      earnedSalary: acc.earnedSalary + p.earnedSalary,
      grossSalary: acc.grossSalary + p.grossSalary,
      totalDeductions: acc.totalDeductions + p.totalDeductions,
      netSalary: acc.netSalary + p.netSalary,
      pf: acc.pf + p.pf,
      esi: acc.esi + p.esi,
      tds: acc.tds + p.tds,
      professionalTax: acc.professionalTax + p.professionalTax,
      totalPaidDays: acc.totalPaidDays + p.paidDays.total,
      totalPresentDays: acc.totalPresentDays + p.paidDays.present,
      totalApprovedLeaves: acc.totalApprovedLeaves + p.paidDays.approvedLeaves,
      totalHolidays: acc.totalHolidays + p.paidDays.holidays,
    }), {
      earnedSalary: 0,
      grossSalary: 0,
      totalDeductions: 0,
      netSalary: 0,
      pf: 0,
      esi: 0,
      tds: 0,
      professionalTax: 0,
      totalPaidDays: 0,
      totalPresentDays: 0,
      totalApprovedLeaves: 0,
      totalHolidays: 0,
    })
  }, [calculatedPayrollData])

  // Get pending leaves for selected employees
  const selectedEmployeesPendingLeaves = useMemo(() => {
    return pendingLeavesWarning.filter(warning => selectedEmployees.includes(warning.employeeId))
  }, [pendingLeavesWarning, selectedEmployees])

  if (loading) {
    return (
      <div className="flex justify-center items-center h-96">
        <Loader size="lg" />
      </div>
    )
  }

  const payrollConfig = companySettings?.payroll || {}

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">Generate Payroll</h1>
          <p className="text-gray-600 mt-1">Generate salary with attendance-based calculations</p>
        </div>
        <button
          onClick={() => router.push('/dashboard/payroll')}
          className="btn-secondary flex items-center space-x-2"
        >
          <FaArrowLeft />
          <span>Back</span>
        </button>
      </div>

      {/* Company Settings Info Card - Simplified for Addition-Based Calculation */}
      {companySettings && (
        <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-lg shadow-md p-6 mb-6 border border-green-100">
          <div className="flex items-center mb-4">
            <FaInfoCircle className="text-green-600 mr-2" />
            <h2 className="text-lg font-bold text-gray-800">Salary Calculation Method</h2>
            <span className="ml-3 px-2 py-1 bg-green-100 text-green-700 text-xs font-medium rounded-full">
              Addition-Based (Simplified)
            </span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4 text-sm">
            <div className="bg-white p-3 rounded-lg shadow-sm">
              <p className="text-xs text-gray-500 uppercase mb-1">Working Days/Month</p>
              <p className="font-semibold text-gray-800">{payrollConfig.workingDaysPerMonth || 26}</p>
            </div>
            <div className="bg-white p-3 rounded-lg shadow-sm">
              <p className="text-xs text-gray-500 uppercase mb-1">Full Day Threshold</p>
              <p className="font-semibold text-gray-800">{companySettings.fullDayThreshold || 7.5} hrs</p>
            </div>
            <div className="bg-white p-3 rounded-lg shadow-sm">
              <p className="text-xs text-gray-500 uppercase mb-1">Holidays This Month</p>
              <p className="font-semibold text-green-600">{holidayData.length} days</p>
            </div>
            {payrollConfig.pfEnabled && (
              <div className="bg-white p-3 rounded-lg shadow-sm">
                <p className="text-xs text-gray-500 uppercase mb-1">PF Deduction</p>
                <p className="font-semibold text-gray-800">{payrollConfig.pfPercentage || 12}%</p>
              </div>
            )}
            {payrollConfig.professionalTax?.enabled && (
              <div className="bg-white p-3 rounded-lg shadow-sm">
                <p className="text-xs text-gray-500 uppercase mb-1">Professional Tax</p>
                <p className="font-semibold text-gray-800">{formatCurrency(payrollConfig.professionalTax.amount || 200)}</p>
              </div>
            )}
          </div>

          {/* Salary Calculation Rules */}
          <div className="mt-4 p-4 bg-white rounded-lg">
            <p className="text-sm font-medium text-gray-700 mb-3">How Salary is Calculated:</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-medium text-green-600 uppercase mb-2">✓ Paid Days (Salary Added)</p>
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="px-2 py-1 bg-green-100 text-green-700 rounded">Present (Full Day)</span>
                  <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded">Approved Leaves</span>
                  <span className="px-2 py-1 bg-purple-100 text-purple-700 rounded">Company Holidays</span>
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-red-600 uppercase mb-2">✗ Unpaid Days (₹0 Salary)</p>
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="px-2 py-1 bg-red-100 text-red-700 rounded">Absent</span>
                  <span className="px-2 py-1 bg-orange-100 text-orange-700 rounded">Half Days</span>
                  <span className="px-2 py-1 bg-yellow-100 text-yellow-700 rounded">Unapproved Leaves</span>
                  <span className="px-2 py-1 bg-gray-100 text-gray-600 rounded">No Record</span>
                  <span className="px-2 py-1 bg-gray-100 text-gray-600 rounded">WFH</span>
                </div>
              </div>
            </div>
            <div className="mt-3 p-2 bg-green-50 rounded text-xs text-green-700">
              <strong>Formula:</strong> Per-Day Salary = Gross Salary ÷ Working Days (rounded up) | Net Salary = (Per-Day × Paid Days) - Statutory Deductions
            </div>
          </div>
        </div>
      )}

      {/* Payroll Period */}
      <div className="bg-white rounded-lg shadow-md p-6 mb-6">
        <h2 className="text-xl font-bold text-gray-800 mb-4">Payroll Period</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Month *</label>
            <select
              value={formData.month}
              onChange={(e) => {
                setFormData({ ...formData, month: parseInt(e.target.value) })
                setShowPreview(false)
              }}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {new Date(2000, i).toLocaleString('default', { month: 'long' })}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Year *</label>
            <select
              value={formData.year}
              onChange={(e) => {
                setFormData({ ...formData, year: parseInt(e.target.value) })
                setShowPreview(false)
              }}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              {Array.from({ length: 5 }, (_, i) => {
                const year = new Date().getFullYear() - 2 + i
                return <option key={year} value={year}>{year}</option>
              })}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Payment Date *</label>
            <input
              type="date"
              value={formData.paymentDate}
              onChange={(e) => setFormData({ ...formData, paymentDate: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>
        </div>
      </div>

      {/* Employee Selection or Payroll Preview */}
      {!showPreview ? (
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          {/* Header with Search and Filters */}
          <div className="p-4 border-b border-gray-200">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
              <div className="flex items-center space-x-4">
                <h2 className="text-xl font-semibold text-gray-800">Select Employees</h2>
                <span className="text-sm text-gray-600 bg-gray-100 px-3 py-1 rounded-full">
                  {selectedEmployees.length} of {filteredEmployees.length} selected
                </span>
                {existingPayrollEmployeeIds.length > 0 && (
                  <span className="text-sm text-orange-600 bg-orange-100 px-3 py-1 rounded-full">
                    {existingPayrollEmployeeIds.length} already have payroll
                  </span>
                )}
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className={`flex items-center space-x-1 px-3 py-2 rounded-lg text-sm ${showFilters ? 'bg-primary-100 text-primary-700' : 'bg-gray-100 text-gray-600'}`}
                >
                  <FaFilter className="w-3 h-3" />
                  <span>Filters</span>
                </button>
                <button
                  onClick={() => { fetchAttendanceData(); fetchLeaveData(); fetchHolidayData(); }}
                  className="text-primary-600 hover:text-primary-700 flex items-center space-x-1 px-3 py-2 bg-primary-50 rounded-lg text-sm"
                >
                  <FaSync className="w-3 h-3" />
                  <span>Refresh</span>
                </button>
              </div>
            </div>

            {/* Filters Section */}
            {showFilters && (
              <div className="mt-4 p-4 bg-gray-50 rounded-lg">
                <div className="flex flex-col md:flex-row gap-4">
                  {/* Search Box */}
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-gray-600 mb-1">Search</label>
                    <div className="relative">
                      <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                      <input
                        type="text"
                        placeholder="Search by name, code, email, department..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                      />
                      {searchQuery && (
                        <button
                          onClick={() => setSearchQuery('')}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                        >
                          <FaTimes className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Department Filter */}
                  <div className="md:w-64">
                    <label className="block text-xs font-medium text-gray-600 mb-1">Department</label>
                    <select
                      value={selectedDepartment}
                      onChange={(e) => setSelectedDepartment(e.target.value)}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                    >
                      <option value="all">All Departments</option>
                      {departments.map(dept => (
                        <option key={dept._id} value={dept._id}>{dept.name}</option>
                      ))}
                    </select>
                  </div>

                  {/* Clear Filters */}
                  {(searchQuery || selectedDepartment !== 'all') && (
                    <div className="flex items-end">
                      <button
                        onClick={clearFilters}
                        className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 bg-white border border-gray-300 rounded-lg"
                      >
                        Clear Filters
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Department-Based Employee List */}
          <div className="divide-y divide-gray-200">
            {filteredEmployees.length === 0 ? (
              <div className="px-4 py-8 text-center text-gray-500">
                <FaCheckCircle className="w-12 h-12 mx-auto text-green-300 mb-3" />
                <p className="text-lg font-medium">
                  {availableEmployees.length === 0 
                    ? 'All employees have payroll generated'
                    : 'No employees match your filters'}
                </p>
                <p className="text-sm text-gray-400 mt-1">
                  {availableEmployees.length === 0 
                    ? `Payroll for ${new Date(formData.year, formData.month - 1).toLocaleString('default', { month: 'long', year: 'numeric' })} has been generated for all active employees.`
                    : 'Try adjusting your search or filter criteria.'}
                </p>
              </div>
            ) : (
              employeesByDepartment.map((dept) => (
                <div key={dept.id} className="border-b border-gray-100 last:border-b-0">
                  {/* Department Header */}
                  <div 
                    className="flex items-center justify-between px-4 py-3 bg-gray-50 cursor-pointer hover:bg-gray-100"
                    onClick={() => toggleDepartmentExpand(dept.id)}
                  >
                    <div className="flex items-center space-x-3">
                      {expandedDepartments[dept.id] ? <FaChevronUp className="text-gray-400 w-3 h-3" /> : <FaChevronDown className="text-gray-400 w-3 h-3" />}
                      <span className="font-medium text-gray-800">{dept.name}</span>
                      <span className="text-xs text-gray-500 bg-gray-200 px-2 py-0.5 rounded-full">{dept.employees.length} employees</span>
                    </div>
                    <div className="flex items-center space-x-3">
                      <span className="text-xs text-gray-500">
                        {dept.employees.filter(e => selectedEmployees.includes(e._id)).length} selected
                      </span>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleSelectDepartment(dept.id, dept.employees); }}
                        className="text-xs px-3 py-1 bg-primary-100 text-primary-700 rounded hover:bg-primary-200"
                      >
                        {dept.employees.every(e => selectedEmployees.includes(e._id)) ? 'Deselect All' : 'Select All'}
                      </button>
                    </div>
                  </div>

                  {/* Employees in Department */}
                  {expandedDepartments[dept.id] && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 border-b border-gray-200">
                          <tr>
                            <th className="px-4 py-2 text-left w-10">
                              <input
                                type="checkbox"
                                checked={dept.employees.every(e => selectedEmployees.includes(e._id))}
                                onChange={() => handleSelectDepartment(dept.id, dept.employees)}
                                className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                              />
                            </th>
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Employee</th>
                            <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Gross Salary</th>
                            <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Per Day</th>
                            <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase bg-green-50">Present</th>
                            <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase bg-blue-50">Approved Leaves</th>
                            <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase bg-purple-50">Holidays</th>
                            <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase bg-orange-50">Half Days</th>
                            <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase bg-red-50">Absent</th>
                            <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase bg-yellow-50">Pending</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-100">
                          {dept.employees.map((employee) => {
                            const attendance = attendanceData[employee._id] || {}
                            const employeeLeaves = leaveData[employee._id] || {}
                            const grossSalary = employee.salary?.grossSalary || employee.salary?.basic || 0
                            const perDaySalary = grossSalary > 0 ? Math.ceil(grossSalary / (payrollConfig.workingDaysPerMonth || 26)) : 0
                            return (
                              <tr key={employee._id} className="hover:bg-gray-50">
                                <td className="px-4 py-3">
                                  <input
                                    type="checkbox"
                                    checked={selectedEmployees.includes(employee._id)}
                                    onChange={() => handleSelectEmployee(employee._id)}
                                    className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                                  />
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap">
                                  <div className="font-medium text-gray-900">{employee.firstName} {employee.lastName}</div>
                                  <div className="text-xs text-gray-500">{employee.employeeCode} • {employee.designation?.title || 'N/A'}</div>
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap text-right font-semibold text-gray-900">{formatCurrency(grossSalary)}</td>
                                <td className="px-4 py-3 whitespace-nowrap text-right text-gray-600">{formatCurrency(perDaySalary)}</td>
                                <td className="px-4 py-3 whitespace-nowrap text-center bg-green-50">
                                  <span className="px-2 py-1 bg-green-100 text-green-800 text-xs font-medium rounded-full">{attendance.presentDays || 0}</span>
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap text-center bg-blue-50">
                                  <span className={'px-2 py-1 text-xs font-medium rounded-full ' + (employeeLeaves.approvedDays > 0 ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-500')}>{employeeLeaves.approvedDays || 0}</span>
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap text-center bg-purple-50">
                                  <span className="px-2 py-1 bg-purple-100 text-purple-800 text-xs font-medium rounded-full">{holidayData.length}</span>
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap text-center bg-orange-50">
                                  <span className={'px-2 py-1 text-xs font-medium rounded-full ' + (attendance.halfDays > 0 ? 'bg-orange-100 text-orange-800' : 'bg-gray-100 text-gray-500')}>{attendance.halfDays || 0}</span>
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap text-center bg-red-50">
                                  <span className={'px-2 py-1 text-xs font-medium rounded-full ' + (attendance.absentDays > 0 ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-500')}>{attendance.absentDays || 0}</span>
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap text-center bg-yellow-50">
                                  <span className={'px-2 py-1 text-xs font-medium rounded-full ' + (employeeLeaves.pendingDays > 0 ? 'bg-yellow-100 text-yellow-800' : 'bg-gray-100 text-gray-500')}>{employeeLeaves.pendingDays || 0}</span>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          <div className="p-6 bg-gray-50 border-t border-gray-200">
            <button
              onClick={handlePreviewPayroll}
              disabled={selectedEmployees.length === 0}
              className="btn-primary flex items-center space-x-2"
            >
              <FaEye />
              <span>Preview Payroll for {selectedEmployees.length} Employee{selectedEmployees.length !== 1 ? 's' : ''}</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          <div className="p-4 border-b border-gray-200 flex items-center justify-between">
            <h2 className="text-xl font-semibold text-gray-800">
              Payroll Preview - {new Date(formData.year, formData.month - 1).toLocaleString('default', { month: 'long', year: 'numeric' })}
            </h2>
            <button onClick={() => setShowPreview(false)} className="text-gray-600 hover:text-gray-800 text-sm">← Back to Selection</button>
          </div>

          {/* Summary Cards - Simplified Addition-Based */}
          <div className="grid gap-4 p-4 bg-gray-50 border-b grid-cols-2 md:grid-cols-5">
            <div className="bg-white p-4 rounded-lg shadow-sm">
              <p className="text-xs text-gray-500 uppercase">Working Days</p>
              <p className="text-xl font-bold text-gray-800">{formData.workingDays}</p>
            </div>
            <div className="bg-white p-4 rounded-lg shadow-sm">
              <p className="text-xs text-gray-500 uppercase">Total Paid Days</p>
              <p className="text-xl font-bold text-blue-600">{summaryTotals.totalPaidDays}</p>
            </div>
            <div className="bg-white p-4 rounded-lg shadow-sm">
              <p className="text-xs text-gray-500 uppercase">Earned Salary</p>
              <p className="text-xl font-bold text-green-600">{formatCurrency(summaryTotals.earnedSalary)}</p>
            </div>
            <div className="bg-white p-4 rounded-lg shadow-sm">
              <p className="text-xs text-gray-500 uppercase">Total Deductions</p>
              <p className="text-xl font-bold text-red-600">{formatCurrency(summaryTotals.totalDeductions)}</p>
            </div>
            <div className="bg-white p-4 rounded-lg shadow-sm border-2 border-green-200">
              <p className="text-xs text-green-600 uppercase">Net Payable</p>
              <p className="text-xl font-bold text-green-600">{formatCurrency(summaryTotals.netSalary)}</p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-100 border-b border-gray-200">
                <tr>
                  <th className="px-3 py-3 text-left font-semibold text-gray-700 sticky left-0 bg-gray-100 min-w-[180px]">Employee</th>
                  <th className="px-3 py-3 text-right font-semibold text-gray-700 bg-gray-50">Per Day</th>
                  <th className="px-3 py-3 text-center font-semibold text-gray-700 bg-green-50">Present</th>
                  <th className="px-3 py-3 text-center font-semibold text-gray-700 bg-blue-50">Leaves</th>
                  <th className="px-3 py-3 text-center font-semibold text-gray-700 bg-purple-50">Holidays</th>
                  <th className="px-3 py-3 text-center font-semibold text-gray-700 bg-green-100">Paid Days</th>
                  <th className="px-3 py-3 text-right font-semibold text-gray-700 bg-green-100">Earned</th>
                  <th className="px-3 py-3 text-right font-semibold text-gray-700">PF</th>
                  <th className="px-3 py-3 text-right font-semibold text-gray-700">ESI</th>
                  <th className="px-3 py-3 text-right font-semibold text-gray-700">PT</th>
                  <th className="px-3 py-3 text-right font-semibold text-gray-700">TDS</th>
                  <th className="px-3 py-3 text-right font-semibold text-gray-700 bg-red-50">Total Ded.</th>
                  <th className="px-3 py-3 text-right font-semibold text-gray-700 bg-green-100">Net Salary</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {calculatedPayrollData.map((payroll, idx) => (
                  <tr key={payroll.employee._id} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-3 py-3 whitespace-nowrap sticky left-0 bg-inherit min-w-[180px]">
                      <div className="font-medium text-gray-900">{payroll.employee.firstName} {payroll.employee.lastName}</div>
                      <div className="text-gray-500">{payroll.employee.employeeCode}</div>
                      <div className="text-gray-400 text-[10px] mt-1">
                        Gross: {formatCurrency(payroll.grossSalary)} | Half: {payroll.attendance.halfDays || 0} | Absent: {payroll.attendance.absentDays || 0}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right text-gray-900 bg-gray-50">{formatCurrency(payroll.perDaySalary)}</td>
                    <td className="px-3 py-3 text-center bg-green-50">
                      <span className="px-2 py-1 text-xs font-medium rounded-full bg-green-200 text-green-800">{payroll.paidDays.present}</span>
                    </td>
                    <td className="px-3 py-3 text-center bg-blue-50">
                      <span className={'px-2 py-1 text-xs font-medium rounded-full ' + (payroll.paidDays.approvedLeaves > 0 ? 'bg-blue-200 text-blue-800' : 'bg-gray-100 text-gray-500')}>{payroll.paidDays.approvedLeaves}</span>
                    </td>
                    <td className="px-3 py-3 text-center bg-purple-50">
                      <span className={'px-2 py-1 text-xs font-medium rounded-full ' + (payroll.paidDays.holidays > 0 ? 'bg-purple-200 text-purple-800' : 'bg-gray-100 text-gray-500')}>{payroll.paidDays.holidays}</span>
                    </td>
                    <td className="px-3 py-3 text-center bg-green-100">
                      <span className="px-2 py-1 text-xs font-bold rounded-full bg-green-300 text-green-900">{payroll.paidDays.total}</span>
                    </td>
                    <td className="px-3 py-3 text-right font-semibold text-green-700 bg-green-100">{formatCurrency(payroll.earnedSalary)}</td>
                    <td className="px-3 py-3 text-right text-red-600">{formatCurrency(payroll.pf)}</td>
                    <td className="px-3 py-3 text-right text-red-600">{formatCurrency(payroll.esi)}</td>
                    <td className="px-3 py-3 text-right text-red-600">{formatCurrency(payroll.professionalTax)}</td>
                    <td className="px-3 py-3 text-right text-red-600">{formatCurrency(payroll.tds)}</td>
                    <td className="px-3 py-3 text-right font-semibold text-red-700 bg-red-50">{formatCurrency(payroll.totalDeductions)}</td>
                    <td className="px-3 py-3 text-right font-bold text-green-700 bg-green-100">{formatCurrency(payroll.netSalary)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-200 border-t-2 border-gray-400">
                <tr>
                  <td className="px-3 py-3 font-bold text-gray-800 sticky left-0 bg-gray-200">TOTAL ({calculatedPayrollData.length} employees)</td>
                  <td className="px-3 py-3 bg-gray-200"></td>
                  <td className="px-3 py-3 text-center font-bold text-green-700 bg-green-100">{summaryTotals.totalPresentDays}</td>
                  <td className="px-3 py-3 text-center font-bold text-blue-700 bg-blue-100">{summaryTotals.totalApprovedLeaves}</td>
                  <td className="px-3 py-3 text-center font-bold text-purple-700 bg-purple-100">{summaryTotals.totalHolidays}</td>
                  <td className="px-3 py-3 text-center font-bold text-green-700 bg-green-200">{summaryTotals.totalPaidDays}</td>
                  <td className="px-3 py-3 text-right font-bold text-green-700 bg-green-200">{formatCurrency(summaryTotals.earnedSalary)}</td>
                  <td className="px-3 py-3 text-right font-bold text-red-700">{formatCurrency(summaryTotals.pf)}</td>
                  <td className="px-3 py-3 text-right font-bold text-red-700">{formatCurrency(summaryTotals.esi)}</td>
                  <td className="px-3 py-3" colSpan={2}></td>
                  <td className="px-3 py-3 text-right font-bold text-red-700 bg-red-100">{formatCurrency(summaryTotals.totalDeductions)}</td>
                  <td className="px-3 py-3 text-right font-bold text-green-700 bg-green-200">{formatCurrency(summaryTotals.netSalary)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Pending Leaves Warning Section */}
          {selectedEmployeesPendingLeaves.length > 0 && (
            <div className="p-4 bg-yellow-50 border-t border-yellow-200">
              <div className="flex items-start space-x-3">
                <FaExclamationCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-sm font-semibold text-yellow-800">Pending Leave Requests</h3>
                  <p className="text-xs text-yellow-700 mt-1 mb-2">
                    The following employees have pending leave requests for this period. Please approve or reject before finalizing payroll.
                  </p>
                  <div className="space-y-2">
                    {selectedEmployeesPendingLeaves.map((warning, idx) => (
                      <div key={idx} className="flex items-center justify-between bg-white rounded-lg px-3 py-2 border border-yellow-200">
                        <div>
                          <span className="font-medium text-gray-800">{warning.employeeName}</span>
                          <span className="text-gray-500 text-xs ml-2">({warning.employeeCode})</span>
                        </div>
                        <div className="flex items-center space-x-3">
                          <span className="text-yellow-700 text-sm font-medium">{warning.pendingDays} day(s) pending</span>
                          <span className="text-xs text-gray-500">
                            {new Date(warning.startDate).toLocaleDateString()} - {new Date(warning.endDate).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="p-6 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
            <div className="text-sm text-gray-600">
              <FaExclamationTriangle className="inline-block w-4 h-4 text-yellow-500 mr-1" />
              Review the calculated salaries before generating.
            </div>
            <div className="flex items-center space-x-3">
              <button onClick={() => setShowPreview(false)} className="btn-secondary">Back</button>
              <button
                onClick={handleGeneratePayroll}
                disabled={generating}
                className="btn-primary flex items-center space-x-2"
              >
                {generating ? (
                  <>
                    <Loader size="xs" />
                    <span>Generating...</span>
                  </>
                ) : (
                  <>
                    <FaCheckCircle />
                    <span>Generate Payroll</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
