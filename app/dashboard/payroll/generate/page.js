'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import toast from '@/utils/toast'
import {
  FaMoneyBillWave, FaArrowLeft, FaCalculator, FaEye, FaDownload,
  FaFilter, FaSync, FaExclamationTriangle, FaCheckCircle, FaClock,
  FaUserClock, FaCalendarCheck, FaInfoCircle, FaToggleOn, FaToggleOff,
  FaExclamationCircle, FaSearch, FaChevronDown, FaChevronUp, FaTimes, FaEdit
} from 'react-icons/fa'
import { formatDepartments } from '@/lib/formatters'
import {
  HRMSCard,
  HRMSCardHeader,
  HRMSCardBody,
  PrimaryButton,
  SecondaryButton,
  GhostButton,
  HRMSSelect,
  HRMSSelectItem,
  HRMSInput,
  HRMSCheckbox,
  PageLoader,
  KPICard,
} from '@/components/ui/heroui'
import { Input, Checkbox, Button, Divider, Chip, Progress, Tooltip } from '@heroui/react'
import AttendanceCorrectionModal from '@/components/payroll/AttendanceCorrectionModal'

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

  // Attendance correction modal states
  const [correctionModalOpen, setCorrectionModalOpen] = useState(false)
  const [selectedEmployeeForCorrection, setSelectedEmployeeForCorrection] = useState(null)
  const [correctedEmployees, setCorrectedEmployees] = useState({}) // Track which employees were corrected

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

  // Attendance correction handlers
  const handleOpenCorrectionModal = useCallback((employee) => {
    setSelectedEmployeeForCorrection(employee)
    setCorrectionModalOpen(true)
  }, [])

  const handleCorrectionSaved = useCallback((employeeId) => {
    setCorrectedEmployees(prev => ({ ...prev, [employeeId]: true }))
    // Refresh attendance data to reflect corrections
    fetchAttendanceData()
    fetchLeaveData()
  }, [fetchAttendanceData, fetchLeaveData])

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

      const results = await Promise.all(
        calculatedPayrollData.map(async (payroll) => {
          // Build payroll data matching the tenant Payroll model schema
          // The tenant schema uses simple Number fields, not nested objects
          const payrollData = {
            employee: payroll.employee._id,
            month: formData.month,
            year: formData.year,
            // Basic salary fields (simple numbers for tenant schema)
            basic: payroll.earnedBasic,
            allowances: (payroll.earnedHRA || 0) + (payroll.earnedConveyance || 0) +
              (payroll.earnedMedical || 0) + (payroll.earnedSpecial || 0),
            deductions: payroll.totalDeductions, // Total deductions as a number
            grossSalary: payroll.earnedSalary,
            netSalary: payroll.netSalary,
            status: 'draft',
            // Additional fields stored via strict: false
            workingDays: payroll.workingDays,
            presentDays: payroll.paidDays.present,
            absentDays: payroll.attendance.absentDays + payroll.attendance.noRecordDays,
            leaveDays: payroll.paidDays.approvedLeaves,
            totalDeductions: payroll.totalDeductions,
            // Earnings breakdown (stored as extra field)
            earningsBreakdown: {
              basic: payroll.earnedBasic,
              hra: payroll.earnedHRA,
              conveyance: payroll.earnedConveyance,
              medicalAllowance: payroll.earnedMedical,
              specialAllowance: payroll.earnedSpecial,
              overtime: 0,
              bonus: 0,
              incentives: 0,
              other: 0,
            },
            // Deductions breakdown (stored as extra field)
            deductionsBreakdown: {
              pf: payroll.pf,
              esi: payroll.esi,
              professionalTax: payroll.professionalTax,
              tds: payroll.tds,
              lateDeduction: 0,
              loanRepayment: 0,
              advance: 0,
              other: 0,
            },
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
            // Paid days breakdown
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
          }

          try {
            const response = await fetch('/api/payroll', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token,
              },
              body: JSON.stringify(payrollData),
            })
            const data = await response.json()
            return {
              success: response.ok && data.success,
              employeeName: `${payroll.employee.firstName} ${payroll.employee.lastName}`,
              message: data.message || (response.ok ? 'Success' : 'Failed'),
            }
          } catch (err) {
            return {
              success: false,
              employeeName: `${payroll.employee.firstName} ${payroll.employee.lastName}`,
              message: err.message || 'Network error',
            }
          }
        })
      )

      // Count successes and failures
      const successCount = results.filter(r => r.success).length
      const failures = results.filter(r => !r.success)

      if (successCount > 0 && failures.length === 0) {
        // All succeeded
        toast.success(`Payroll generated for ${successCount} employee${successCount > 1 ? 's' : ''}!`)
        router.push('/dashboard/payroll')
      } else if (successCount > 0 && failures.length > 0) {
        // Partial success
        toast.success(`Payroll generated for ${successCount} employee${successCount > 1 ? 's' : ''}`)
        const failedNames = failures.slice(0, 3).map(f => f.employeeName).join(', ')
        const moreCount = failures.length > 3 ? ` and ${failures.length - 3} more` : ''
        toast.error(`Failed for: ${failedNames}${moreCount}. ${failures[0].message}`)
        router.push('/dashboard/payroll')
      } else {
        // All failed
        const firstError = failures[0]?.message || 'Unknown error'
        toast.error(`Failed to generate payroll: ${firstError}`)
      }
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
        <PageLoader message="Loading payroll data..." />
      </div>
    )
  }

  const payrollConfig = companySettings?.payroll || {}

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Generate Payroll</h1>
          <p className="text-default-500 mt-1">Generate salary with attendance-based calculations</p>
        </div>
        <SecondaryButton
          onPress={() => router.push('/dashboard/payroll')}
          startContent={<FaArrowLeft />}
        >
          Back
        </SecondaryButton>
      </div>

      {/* Company Settings Info Card - Simplified for Addition-Based Calculation */}
      {companySettings && (
        <HRMSCard className="bg-gradient-to-r from-success-50 to-success-100 border border-success-200">
          <HRMSCardBody className="p-6">
            <div className="flex items-center mb-4">
              <FaInfoCircle className="text-success-600 mr-2" />
              <h2 className="text-lg font-bold text-foreground">Salary Calculation Method</h2>
              <Chip size="sm" color="success" variant="flat" className="ml-3">
                Addition-Based (Simplified)
              </Chip>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4 text-sm">
              <div className="bg-content1 p-3 rounded-lg shadow-sm">
                <p className="text-xs text-default-500 uppercase mb-1">Working Days/Month</p>
                <p className="font-semibold text-foreground">{payrollConfig.workingDaysPerMonth || 26}</p>
              </div>
              <div className="bg-content1 p-3 rounded-lg shadow-sm">
                <p className="text-xs text-default-500 uppercase mb-1">Full Day Threshold</p>
                <p className="font-semibold text-foreground">{companySettings.fullDayThreshold || 7.5} hrs</p>
              </div>
              <div className="bg-content1 p-3 rounded-lg shadow-sm">
                <p className="text-xs text-default-500 uppercase mb-1">Holidays This Month</p>
                <p className="font-semibold text-success-600">{holidayData.length} days</p>
              </div>
              {payrollConfig.pfEnabled && (
                <div className="bg-content1 p-3 rounded-lg shadow-sm">
                  <p className="text-xs text-default-500 uppercase mb-1">PF Deduction</p>
                  <p className="font-semibold text-foreground">{payrollConfig.pfPercentage || 12}%</p>
                </div>
              )}
              {payrollConfig.professionalTax?.enabled && (
                <div className="bg-content1 p-3 rounded-lg shadow-sm">
                  <p className="text-xs text-default-500 uppercase mb-1">Professional Tax</p>
                  <p className="font-semibold text-foreground">{formatCurrency(payrollConfig.professionalTax.amount || 200)}</p>
                </div>
              )}
            </div>

            {/* Salary Calculation Rules */}
            <div className="mt-4 p-4 bg-content1 rounded-lg">
              <p className="text-sm font-medium text-foreground mb-3">How Salary is Calculated:</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-medium text-success-600 uppercase mb-2">✓ Paid Days (Salary Added)</p>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <Chip size="sm" color="success" variant="flat">Present (Full Day)</Chip>
                    <Chip size="sm" color="primary" variant="flat">Approved Leaves</Chip>
                    <Chip size="sm" color="secondary" variant="flat">Company Holidays</Chip>
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium text-danger-600 uppercase mb-2">✗ Unpaid Days (₹0 Salary)</p>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <Chip size="sm" color="danger" variant="flat">Absent</Chip>
                    <Chip size="sm" color="warning" variant="flat">Half Days</Chip>
                    <Chip size="sm" color="warning" variant="flat">Unapproved Leaves</Chip>
                    <Chip size="sm" color="default" variant="flat">No Record</Chip>
                    <Chip size="sm" color="default" variant="flat">WFH</Chip>
                  </div>
                </div>
              </div>
              <div className="mt-3 p-2 bg-success-50 rounded text-xs text-success-700">
                <strong>Formula:</strong> Per-Day Salary = Gross Salary ÷ Working Days (rounded up) | Net Salary = (Per-Day × Paid Days) - Statutory Deductions
              </div>
            </div>
          </HRMSCardBody>
        </HRMSCard>
      )}

      {/* Payroll Period */}
      <HRMSCard>
        <HRMSCardHeader>
          <h2 className="text-xl font-bold text-foreground">Payroll Period</h2>
        </HRMSCardHeader>
        <Divider />
        <HRMSCardBody>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <HRMSSelect
              label="Month"
              isRequired
              selectedKeys={[formData.month.toString()]}
              onSelectionChange={(keys) => {
                setFormData({ ...formData, month: parseInt(Array.from(keys)[0]) })
                setShowPreview(false)
              }}
            >
              {Array.from({ length: 12 }, (_, i) => (
                <HRMSSelectItem key={(i + 1).toString()} textValue={new Date(2000, i).toLocaleString('default', { month: 'long' })}>
                  {new Date(2000, i).toLocaleString('default', { month: 'long' })}
                </HRMSSelectItem>
              ))}
            </HRMSSelect>
            <HRMSSelect
              label="Year"
              isRequired
              selectedKeys={[formData.year.toString()]}
              onSelectionChange={(keys) => {
                setFormData({ ...formData, year: parseInt(Array.from(keys)[0]) })
                setShowPreview(false)
              }}
            >
              {Array.from({ length: 5 }, (_, i) => {
                const year = new Date().getFullYear() - 2 + i
                return <HRMSSelectItem key={year.toString()} textValue={year.toString()}>{year}</HRMSSelectItem>
              })}
            </HRMSSelect>
            <HRMSInput
              type="date"
              label="Payment Date"
              isRequired
              value={formData.paymentDate}
              onChange={(e) => setFormData({ ...formData, paymentDate: e.target.value })}
            />
          </div>
        </HRMSCardBody>
      </HRMSCard>

      {/* Employee Selection or Payroll Preview */}
      {!showPreview ? (
        <HRMSCard>
          {/* Header with Search and Filters */}
          <HRMSCardHeader className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div className="flex items-center gap-4 flex-wrap">
              <h2 className="text-xl font-semibold text-foreground">Select Employees</h2>
              <Chip size="sm" variant="flat" color="default">
                {selectedEmployees.length} of {filteredEmployees.length} selected
              </Chip>
              {existingPayrollEmployeeIds.length > 0 && (
                <Chip size="sm" variant="flat" color="warning">
                  {existingPayrollEmployeeIds.length} already have payroll
                </Chip>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant={showFilters ? 'flat' : 'light'}
                color={showFilters ? 'primary' : 'default'}
                onPress={() => setShowFilters(!showFilters)}
                startContent={<FaFilter className="w-3 h-3" />}
              >
                Filters
              </Button>
              <Button
                size="sm"
                variant="flat"
                color="primary"
                onPress={() => { fetchAttendanceData(); fetchLeaveData(); fetchHolidayData(); }}
                startContent={<FaSync className="w-3 h-3" />}
              >
                Refresh
              </Button>
            </div>
          </HRMSCardHeader>
          <Divider />
          <HRMSCardBody>
            {/* Filters Section */}
            {showFilters && (
              <div className="mb-4 p-4 bg-default-50 rounded-lg">
                <div className="flex flex-col md:flex-row gap-4">
                  {/* Search Box */}
                  <div className="flex-1">
                    <Input
                      type="text"
                      label="Search"
                      placeholder="Search by name, code, email, department..."
                      value={searchQuery}
                      onValueChange={setSearchQuery}
                      size="sm"
                      startContent={<FaSearch className="text-default-400 w-4 h-4" />}
                      endContent={searchQuery && (
                        <button
                          onClick={() => setSearchQuery('')}
                          className="text-default-400 hover:text-default-600"
                        >
                          <FaTimes className="w-3 h-3" />
                        </button>
                      )}
                    />
                  </div>

                  {/* Department Filter */}
                  <div className="md:w-64">
                    <HRMSSelect
                      label="Department"
                      size="sm"
                      selectedKeys={[selectedDepartment]}
                      onSelectionChange={(keys) => setSelectedDepartment(Array.from(keys)[0] || 'all')}
                    >
                      <HRMSSelectItem key="all" textValue="All Departments">All Departments</HRMSSelectItem>
                      {departments.map(dept => (
                        <HRMSSelectItem key={dept._id} textValue={dept.name}>{dept.name}</HRMSSelectItem>
                      ))}
                    </HRMSSelect>
                  </div>

                  {/* Clear Filters */}
                  {(searchQuery || selectedDepartment !== 'all') && (
                    <div className="flex items-end">
                      <Button
                        size="sm"
                        variant="bordered"
                        onPress={clearFilters}
                      >
                        Clear Filters
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Department-Based Employee List */}
            <div className="divide-y divide-default-200">
              {filteredEmployees.length === 0 ? (
                <div className="px-4 py-8 text-center text-default-500">
                  <FaCheckCircle className="w-12 h-12 mx-auto text-success-300 mb-3" />
                  <p className="text-lg font-medium text-foreground">
                    {availableEmployees.length === 0
                      ? 'All employees have payroll generated'
                      : 'No employees match your filters'}
                  </p>
                  <p className="text-sm text-default-400 mt-1">
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
                                    <div className="flex items-center gap-2">
                                      <div className="flex-1">
                                        <div className="font-medium text-gray-900 flex items-center gap-2">
                                          {employee.firstName} {employee.lastName}
                                          {correctedEmployees[employee._id] && (
                                            <span className="px-1.5 py-0.5 bg-success-100 text-success-700 text-[10px] font-medium rounded-full">
                                              Corrected
                                            </span>
                                          )}
                                        </div>
                                        <div className="text-xs text-gray-500">{employee.employeeCode} • {employee.designation?.title || 'N/A'}</div>
                                      </div>
                                      <Tooltip content="Edit Attendance">
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            handleOpenCorrectionModal(employee)
                                          }}
                                          className="p-1.5 text-default-400 hover:text-primary-500 hover:bg-primary-50 rounded-lg transition-colors"
                                        >
                                          <FaEdit size={14} />
                                        </button>
                                      </Tooltip>
                                    </div>
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
                                    <span className={'px-2 py-1 text-xs font-medium rounded-full ' + (employeeLeaves.pendingDays > 0 ? 'bg-warning-100 text-warning-800' : 'bg-default-100 text-default-500')}>{employeeLeaves.pendingDays || 0}</span>
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

            <div className="p-6 bg-default-50 border-t border-default-200">
              <PrimaryButton
                onPress={handlePreviewPayroll}
                isDisabled={selectedEmployees.length === 0}
                startContent={<FaEye />}
              >
                Preview Payroll for {selectedEmployees.length} Employee{selectedEmployees.length !== 1 ? 's' : ''}
              </PrimaryButton>
            </div>
          </HRMSCardBody>
        </HRMSCard>
      ) : (
        <HRMSCard>
          <HRMSCardHeader className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-foreground">
              Payroll Preview - {new Date(formData.year, formData.month - 1).toLocaleString('default', { month: 'long', year: 'numeric' })}
            </h2>
            <Button variant="light" onPress={() => setShowPreview(false)}>← Back to Selection</Button>
          </HRMSCardHeader>
          <Divider />
          <HRMSCardBody className="p-0">
            {/* Summary Cards - Simplified Addition-Based */}
            <div className="grid gap-4 p-4 bg-default-50 border-b border-default-200 grid-cols-2 md:grid-cols-5">
              <div className="bg-content1 p-4 rounded-lg shadow-sm">
                <p className="text-xs text-default-500 uppercase">Working Days</p>
                <p className="text-xl font-bold text-foreground">{payrollConfig.workingDaysPerMonth || 26}</p>
              </div>
              <div className="bg-content1 p-4 rounded-lg shadow-sm">
                <p className="text-xs text-default-500 uppercase">Total Paid Days</p>
                <p className="text-xl font-bold text-primary">{summaryTotals.totalPaidDays}</p>
              </div>
              <div className="bg-content1 p-4 rounded-lg shadow-sm">
                <p className="text-xs text-default-500 uppercase">Earned Salary</p>
                <p className="text-xl font-bold text-success">{formatCurrency(summaryTotals.earnedSalary)}</p>
              </div>
              <div className="bg-content1 p-4 rounded-lg shadow-sm">
                <p className="text-xs text-default-500 uppercase">Total Deductions</p>
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
                        <div key={idx} className="flex items-center justify-between bg-content1 rounded-lg px-3 py-2 border border-warning-200">
                          <div>
                            <span className="font-medium text-foreground">{warning.employeeName}</span>
                            <span className="text-default-500 text-xs ml-2">({warning.employeeCode})</span>
                          </div>
                          <div className="flex items-center space-x-3">
                            <span className="text-warning-700 text-sm font-medium">{warning.pendingDays} day(s) pending</span>
                            <span className="text-xs text-default-500">
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

            <div className="p-6 bg-default-50 border-t border-default-200 flex items-center justify-between">
              <div className="text-sm text-default-600">
                <FaExclamationTriangle className="inline-block w-4 h-4 text-warning-500 mr-1" />
                Review the calculated salaries before generating.
              </div>
              <div className="flex items-center gap-3">
                <SecondaryButton onPress={() => setShowPreview(false)}>Back</SecondaryButton>
                <PrimaryButton
                  onPress={handleGeneratePayroll}
                  isDisabled={generating}
                  isLoading={generating}
                  startContent={!generating && <FaCheckCircle />}
                >
                  {generating ? 'Generating...' : 'Generate Payroll'}
                </PrimaryButton>
              </div>
            </div>
          </HRMSCardBody>
        </HRMSCard>
      )}

      {/* Attendance Correction Modal */}
      <AttendanceCorrectionModal
        isOpen={correctionModalOpen}
        onClose={() => setCorrectionModalOpen(false)}
        employee={selectedEmployeeForCorrection}
        month={formData.month}
        year={formData.year}
        onCorrectionSaved={handleCorrectionSaved}
      />
    </div>
  )
}
