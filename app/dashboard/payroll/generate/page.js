'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import toast from '@/utils/toast'
import {
  FaMoneyBillWave, FaArrowLeft, FaCalculator, FaEye, FaDownload,
  FaFilter, FaSync, FaExclamationTriangle, FaCheckCircle, FaClock,
  FaUserClock, FaCalendarCheck, FaInfoCircle, FaToggleOn, FaToggleOff,
  FaExclamationCircle
} from 'react-icons/fa'
import Loader from '@/components/ui/Loader'
import { formatDepartments } from '@/lib/formatters'

export default function GeneratePayrollPage() {
  const router = useRouter()
  const [employees, setEmployees] = useState([])
  const [existingPayrollEmployeeIds, setExistingPayrollEmployeeIds] = useState([])
  const [attendanceData, setAttendanceData] = useState({})
  const [leaveData, setLeaveData] = useState({}) // Leave data per employee
  const [companySettings, setCompanySettings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [selectedEmployees, setSelectedEmployees] = useState([])
  const [employeeOvertimeGrace, setEmployeeOvertimeGrace] = useState({}) // Per-employee overtime grace toggle
  const [pendingLeavesWarning, setPendingLeavesWarning] = useState([]) // Employees with pending leaves
  const [formData, setFormData] = useState({
    month: new Date().getMonth() + 1,
    year: new Date().getFullYear(),
    paymentDate: new Date().toISOString().split('T')[0],
    enableOvertimeGrace: false, // Global HR/Admin toggle for overtime grace
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

      // Fetch employees and company settings in parallel
      const [employeesRes, settingsRes] = await Promise.all([
        fetch('/api/employees?limit=1000&status=active', {
          headers: { 'Authorization': 'Bearer ' + token },
        }),
        fetch('/api/settings/company', {
          headers: { 'Authorization': 'Bearer ' + token },
        }),
      ])

      const employeesData = await employeesRes.json()
      const settingsData = await settingsRes.json()

      if (employeesData.success) {
        setEmployees(employeesData.data.filter(emp => emp.status === 'active'))
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
      lateDeduction: { enabled: true, type: 'fixed', value: 100, graceLatesPerMonth: 3 },
      halfDayDeduction: { enabled: true, type: 'half-day-salary', value: 50 },
      absentDeduction: { enabled: true, type: 'full-day-salary', value: 100 },
      overtime: { enabled: true, rateMultiplier: 1.5, minHoursForOvertime: 1 },
      pfEnabled: true,
      pfPercentage: 12,
      esiEnabled: true,
      esiPercentage: 0.75,
      professionalTax: { enabled: true, amount: 200 },
      tdsEnabled: false, // TDS disabled by default - must be configured manually
      tdsPercentage: 0,
    },
  })

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
      const halfDayThreshold = settings.halfDayThreshold || 3.5 // Default: 3.5 hours = half day

      if (data.success && data.data) {
        // Process attendance data per employee with detailed tracking
        data.data.forEach(record => {
          const empId = record.employee?._id || record.employee
          if (!empId) return

          if (!attendanceMap[empId]) {
            attendanceMap[empId] = {
              presentDays: 0,
              absentDays: 0,
              halfDays: 0,
              lateDays: 0,
              earlyCheckIns: 0,
              earlyCheckOuts: 0,
              onTimeCheckIns: 0,
              overtimeHours: 0,
              overtimeDays: 0,
              leaveDays: 0,
              totalWorkHours: 0,
              records: [],
            }
          }

          attendanceMap[empId].records.push(record)

          const status = record.status?.toLowerCase() || ''
          const checkInStatus = record.checkInStatus?.toLowerCase() || ''
          const checkOutStatus = record.checkOutStatus?.toLowerCase() || ''
          const workHours = record.workHours || 0

          // Use hour-based threshold to determine day type
          // This allows grace period - e.g., 7.5 hours counts as full day even if 8 hours expected
          if (status === 'present' || status === 'approved' || status === 'in-progress') {
            // Check if work hours meet full day threshold
            if (workHours >= fullDayThreshold) {
              attendanceMap[empId].presentDays++
            } else if (workHours >= halfDayThreshold) {
              // Between half day and full day threshold = half day
              attendanceMap[empId].halfDays++
            } else if (workHours > 0) {
              // Less than half day threshold but some hours worked = half day (benefit of doubt)
              attendanceMap[empId].halfDays++
            } else {
              // No hours recorded but status is present - count as present
              attendanceMap[empId].presentDays++
            }
            attendanceMap[empId].totalWorkHours += workHours

            if (checkInStatus === 'early') {
              attendanceMap[empId].earlyCheckIns++
            } else if (checkInStatus === 'late') {
              attendanceMap[empId].lateDays++
            } else if (checkInStatus === 'on-time') {
              attendanceMap[empId].onTimeCheckIns++
            }

            if (checkOutStatus === 'early') {
              attendanceMap[empId].earlyCheckOuts++
            } else if (checkOutStatus === 'late') {
              if (record.overtime && record.overtime > 0) {
                attendanceMap[empId].overtimeHours += record.overtime
                attendanceMap[empId].overtimeDays++
              }
            }
          } else if (status === 'half-day' || status === 'halfday') {
            attendanceMap[empId].halfDays++
            attendanceMap[empId].totalWorkHours += workHours
          } else if (status === 'absent') {
            attendanceMap[empId].absentDays++
          } else if (status === 'leave' || status === 'on-leave') {
            attendanceMap[empId].leaveDays++
          }
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
      presentDays: 0, // No assumption - use actual attendance data only
      absentDays: 0,
      halfDays: 0,
      lateDays: 0,
      earlyCheckIns: 0,
      earlyCheckOuts: 0,
      overtimeHours: 0,
      overtimeDays: 0,
      leaveDays: 0,
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

    // Use employee's salary fields if available, otherwise fallback to zero (no demo data)
    const empSalary = employee.salary || {}
    const basicSalary = empSalary.basic || employee.basicSalary || 0
    const workingDays = payrollSettings.workingDaysPerMonth || 26
    const perDaySalary = basicSalary > 0 ? basicSalary / workingDays : 0
    const perHourSalary = perDaySalary > 0 ? perDaySalary / (settings.fullDayHours || 8) : 0

    // ATTENDANCE-BASED PAYROLL CALCULATION
    // Calculate effective present days and absent days based on actual attendance
    // Present days = days with 'present' status in attendance
    // Approved leaves = count as paid leave (not deducted)
    // Half days = count as 0.5 day salary deduction
    // Absent days = working days - present - halfDays - approved leaves (no record days are treated as absent)
    const effectivePresentDays = attendance.presentDays || 0
    const effectiveHalfDays = attendance.halfDays || 0
    const effectiveApprovedLeaves = employeeLeaves.approvedDays || 0
    const effectiveDeniedLeaves = employeeLeaves.deniedDays || 0
    const effectivePendingLeaves = employeeLeaves.pendingDays || 0
    
    // Calculate actual absent days: total working days minus (present + half days counted as 0.5 + approved leaves)
    // Days with no attendance record are counted as absent
    const accountedDays = effectivePresentDays + effectiveHalfDays + effectiveApprovedLeaves + (attendance.leaveDays || 0)
    const calculatedAbsentDays = Math.max(0, workingDays - accountedDays)
    // Use actual attendance-based absent days if available, otherwise use calculated
    const effectiveAbsentDays = attendance.absentDays > 0 ? attendance.absentDays : calculatedAbsentDays

    // Use employee's allowances if available, otherwise zero (no auto-calculation)
    const hra = empSalary.hra || 0
    const conveyanceAllowance = empSalary.conveyance || 0
    const medicalAllowance = empSalary.medical || 0
    const specialAllowance = empSalary.special || 0

    let overtimeEarnings = 0
    if (payrollSettings.overtime?.enabled && attendance.overtimeHours > 0) {
      const minHours = payrollSettings.overtime.minHoursForOvertime || 1
      if (attendance.overtimeHours >= minHours) {
        const rateMultiplier = payrollSettings.overtime.rateMultiplier || 1.5
        overtimeEarnings = perHourSalary * attendance.overtimeHours * rateMultiplier
      }
    }

    // Use employee's gross salary if available, otherwise calculate from components (will be zero if no data)
    const grossSalary = empSalary.grossSalary || (basicSalary + hra + conveyanceAllowance + medicalAllowance + specialAllowance)

    // Check employee's statutory enrollment status - use correct field paths
    const pfEnrolled = employee.pfEnrollment?.enrolled ?? true // Default to enrolled if not set
    const esiEnrolled = employee.esiEnrollment?.enrolled ?? true // Default to enrolled if not set
    const ptApplicable = employee.professionalTax?.applicable ?? true // Default to applicable

    let pf = 0
    // Only calculate PF if both company setting is enabled AND employee is enrolled
    if (payrollSettings.pfEnabled && pfEnrolled) {
      const pfPercentage = employee.pfEnrollment?.employeeContribution || payrollSettings.pfPercentage || 12
      pf = basicSalary * pfPercentage / 100
    }

    let esi = 0
    // Only calculate ESI if both company setting is enabled AND employee is enrolled AND gross <= 21000
    if (payrollSettings.esiEnabled && esiEnrolled && grossSalary <= 21000) {
      esi = grossSalary * (payrollSettings.esiPercentage || 0.75) / 100
    }

    let professionalTax = 0
    if (payrollSettings.professionalTax?.enabled && ptApplicable) {
      professionalTax = employee.professionalTax?.amount || payrollSettings.professionalTax.amount || 200
    }

    // TDS calculation - Use employee's TDS configuration if available, otherwise 0
    // TDS must be manually configured for each employee - no auto-calculation
    let tds = 0
    const employeeTds = employee.tdsConfiguration || {}
    if (employeeTds.enabled) {
      // Employee has TDS manually configured
      if (employeeTds.fixedAmount > 0) {
        tds = employeeTds.fixedAmount
      } else if (employeeTds.percentage > 0) {
        tds = grossSalary * employeeTds.percentage / 100
      }
    } else if (payrollSettings.tdsEnabled && payrollSettings.tdsPercentage > 0) {
      // Fall back to company settings if employee TDS not configured but company TDS is enabled
      tds = grossSalary * (payrollSettings.tdsPercentage / 100)
    }
    // If neither employee nor company TDS is configured, TDS remains 0

    let lateDeduction = 0
    let chargeableLates = 0
    if (payrollSettings.lateDeduction?.enabled) {
      const graceLates = payrollSettings.lateDeduction.graceLatesPerMonth || 0
      chargeableLates = Math.max(0, attendance.lateDays - graceLates)

      if (chargeableLates > 0) {
        const deductionType = payrollSettings.lateDeduction.type
        const deductionValue = payrollSettings.lateDeduction.value || 0

        if (deductionType === 'fixed') {
          lateDeduction = chargeableLates * deductionValue
        } else if (deductionType === 'percentage' || deductionType === 'per-day-salary') {
          lateDeduction = perDaySalary * chargeableLates * (deductionValue / 100)
        }
      }
    }

    let halfDayDeduction = 0
    if (payrollSettings.halfDayDeduction?.enabled && effectiveHalfDays > 0) {
      const deductionType = payrollSettings.halfDayDeduction.type
      const deductionValue = payrollSettings.halfDayDeduction.value || 50

      if (deductionType === 'fixed') {
        halfDayDeduction = effectiveHalfDays * deductionValue
      } else if (deductionType === 'percentage' || deductionType === 'half-day-salary') {
        halfDayDeduction = perDaySalary * effectiveHalfDays * (deductionValue / 100)
      }
    }

    // ABSENT DEDUCTION - Uses calculated absent days (days with no record or marked absent)
    let absentDeduction = 0
    if (payrollSettings.absentDeduction?.enabled && effectiveAbsentDays > 0) {
      const deductionType = payrollSettings.absentDeduction.type
      const deductionValue = payrollSettings.absentDeduction.value || 100

      if (deductionType === 'fixed') {
        absentDeduction = effectiveAbsentDays * deductionValue
      } else if (deductionType === 'percentage' || deductionType === 'full-day-salary') {
        absentDeduction = perDaySalary * effectiveAbsentDays * (deductionValue / 100)
      }
    }

    // DENIED LEAVE DEDUCTION - Deduct salary for days where leave was denied
    // These are days employee took leave but it was rejected, so salary should be deducted
    let deniedLeaveDeduction = 0
    if (effectiveDeniedLeaves > 0) {
      deniedLeaveDeduction = perDaySalary * effectiveDeniedLeaves
    }

    let earlyCheckOutDeduction = 0

    const attendanceDeductions = lateDeduction + halfDayDeduction + absentDeduction + deniedLeaveDeduction + earlyCheckOutDeduction
    const totalDeductions = pf + esi + professionalTax + tds + attendanceDeductions
    
    // Calculate net salary with overtime grace logic
    let netSalary = grossSalary + overtimeEarnings - totalDeductions
    
    // Overtime Grace Logic:
    // If deductions cause net salary to go negative, and either global or per-employee overtime grace is enabled,
    // apply grace amount to bring salary up (but cannot exceed gross salary)
    let overtimeGrace = {
      enabled: false,
      appliedAmount: 0,
      maxGraceAmount: 0,
      reason: null,
    }
    
    // Check both global toggle AND per-employee toggle
    const isOvertimeGraceEnabled = formData.enableOvertimeGrace || employeeOvertimeGrace[employee._id]
    
    if (isOvertimeGraceEnabled && netSalary < 0) {
      // Calculate how much grace is needed to bring net salary to 0
      const shortfall = Math.abs(netSalary)
      // Max grace amount is limited to what would bring net salary up to gross salary
      // (i.e., covering all deductions but not exceeding original gross)
      const maxPossibleGrace = totalDeductions - overtimeEarnings
      
      overtimeGrace.enabled = true
      overtimeGrace.maxGraceAmount = Math.max(0, maxPossibleGrace)
      overtimeGrace.appliedAmount = Math.min(shortfall, overtimeGrace.maxGraceAmount)
      overtimeGrace.reason = 'Salary shortfall due to deductions'
      
      // Apply the grace to net salary (cannot make net salary exceed gross salary)
      netSalary = Math.min(grossSalary, netSalary + overtimeGrace.appliedAmount)
    }

    return {
      employee,
      attendance: { 
        ...attendance, 
        chargeableLates,
        effectivePresentDays,
        effectiveAbsentDays,
        effectiveHalfDays,
      },
      // Leave data for display
      leaves: {
        approvedDays: effectiveApprovedLeaves,
        deniedDays: effectiveDeniedLeaves,
        pendingDays: effectivePendingLeaves,
      },
      basicSalary,
      perDaySalary,
      perHourSalary,
      hra,
      conveyanceAllowance,
      medicalAllowance,
      specialAllowance,
      overtimeEarnings,
      grossSalary,
      pf,
      esi,
      professionalTax,
      tds,
      lateDeduction,
      halfDayDeduction,
      absentDeduction,
      deniedLeaveDeduction,
      earlyCheckOutDeduction,
      attendanceDeductions,
      totalDeductions,
      netSalary,
      overtimeGrace,
      workingDays,
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
  }, [selectedEmployees, showPreview, employees, attendanceData, leaveData, companySettings, formData.enableOvertimeGrace, employeeOvertimeGrace])

  const handleSelectAll = (e) => {
    if (e.target.checked) {
      setSelectedEmployees(availableEmployees.map(emp => emp._id))
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

  const toggleEmployeeOvertimeGrace = (empId) => {
    setEmployeeOvertimeGrace(prev => ({
      ...prev,
      [empId]: !prev[empId]
    }))
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
        // Build payroll data matching the Payroll model schema
        const payrollData = {
          employee: payroll.employee._id,
          month: formData.month,
          year: formData.year,
          // Earnings object - matches Payroll model schema
          earnings: {
            basic: payroll.basicSalary,
            hra: payroll.hra,
            conveyance: payroll.conveyanceAllowance,
            medicalAllowance: payroll.medicalAllowance,
            specialAllowance: payroll.specialAllowance,
            overtime: payroll.overtimeEarnings,
            bonus: 0,
            incentives: 0,
            other: 0,
          },
          // Deductions object - matches Payroll model schema
          deductions: {
            pf: payroll.pf,
            esi: payroll.esi,
            professionalTax: payroll.professionalTax,
            tds: payroll.tds,
            lateDeduction: payroll.lateDeduction + payroll.halfDayDeduction + payroll.absentDeduction + payroll.deniedLeaveDeduction + payroll.earlyCheckOutDeduction,
            loanRepayment: 0,
            advance: 0,
            other: 0,
          },
          // Required fields
          grossSalary: payroll.grossSalary,
          totalDeductions: payroll.totalDeductions,
          netSalary: payroll.netSalary,
          workingDays: payroll.workingDays || 26,
          presentDays: payroll.attendance.effectivePresentDays || payroll.attendance.presentDays || 0,
          absentDays: payroll.attendance.effectiveAbsentDays || payroll.attendance.absentDays || 0,
          leaveDays: payroll.leaves?.approvedDays || payroll.attendance.leaveDays || 0,
          // Attendance details
          attendanceDetails: {
            lateDays: payroll.attendance.lateDays || 0,
            halfDays: payroll.attendance.effectiveHalfDays || payroll.attendance.halfDays || 0,
            overtimeHours: payroll.attendance.overtimeHours || 0,
            holidaysWorked: 0,
            deniedLeaveDays: payroll.leaves?.deniedDays || 0,
            pendingLeaveDays: payroll.leaves?.pendingDays || 0,
          },
          // Overtime grace tracking
          overtimeGrace: {
            enabled: payroll.overtimeGrace?.enabled || false,
            appliedAmount: payroll.overtimeGrace?.appliedAmount || 0,
            originalOvertimeEarnings: payroll.overtimeEarnings,
            cappedOvertimeEarnings: payroll.overtimeEarnings,
            totalDeductionsBeforeGrace: payroll.totalDeductions,
            graceReason: payroll.overtimeGrace?.reason || '',
          },
          // Salary cap tracking
          salaryCap: {
            grossSalary: payroll.grossSalary,
            netSalaryBeforeCap: payroll.netSalary,
            cappedToGross: false,
          },
          // Pay period
          payPeriod: {
            startDate: new Date(formData.year, formData.month - 1, 1),
            endDate: new Date(formData.year, formData.month, 0),
          },
          paymentDate: formData.paymentDate,
          status: 'draft', // Use valid enum value
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
      grossSalary: acc.grossSalary + p.grossSalary,
      totalDeductions: acc.totalDeductions + p.totalDeductions,
      netSalary: acc.netSalary + p.netSalary,
      pf: acc.pf + p.pf,
      esi: acc.esi + p.esi,
      tds: acc.tds + p.tds,
      overtimeEarnings: acc.overtimeEarnings + p.overtimeEarnings,
      attendanceDeductions: acc.attendanceDeductions + p.attendanceDeductions,
      deniedLeaveDeductions: acc.deniedLeaveDeductions + (p.deniedLeaveDeduction || 0),
      overtimeGraceApplied: acc.overtimeGraceApplied + (p.overtimeGrace?.appliedAmount || 0),
    }), {
      grossSalary: 0,
      totalDeductions: 0,
      netSalary: 0,
      pf: 0,
      esi: 0,
      tds: 0,
      overtimeEarnings: 0,
      attendanceDeductions: 0,
      deniedLeaveDeductions: 0,
      overtimeGraceApplied: 0,
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

      {/* Company Settings Info Card */}
      {companySettings && (
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg shadow-md p-6 mb-6 border border-blue-100">
          <div className="flex items-center mb-4">
            <FaInfoCircle className="text-blue-600 mr-2" />
            <h2 className="text-lg font-bold text-gray-800">Company Payroll Structure</h2>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 text-sm">
            <div className="bg-white p-3 rounded-lg shadow-sm">
              <p className="text-xs text-gray-500 uppercase mb-1">Check-In Time</p>
              <p className="font-semibold text-gray-800">{formatTime(companySettings.checkInTime)}</p>
            </div>
            <div className="bg-white p-3 rounded-lg shadow-sm">
              <p className="text-xs text-gray-500 uppercase mb-1">Check-Out Time</p>
              <p className="font-semibold text-gray-800">{formatTime(companySettings.checkOutTime)}</p>
            </div>
            <div className="bg-white p-3 rounded-lg shadow-sm">
              <p className="text-xs text-gray-500 uppercase mb-1">Late Threshold</p>
              <p className="font-semibold text-gray-800">{companySettings.lateThreshold || 15} mins</p>
            </div>
            <div className="bg-white p-3 rounded-lg shadow-sm">
              <p className="text-xs text-gray-500 uppercase mb-1">Full Day Hours</p>
              <p className="font-semibold text-gray-800">{companySettings.fullDayHours || 8} hrs</p>
            </div>
            <div className="bg-white p-3 rounded-lg shadow-sm">
              <p className="text-xs text-gray-500 uppercase mb-1">Half Day Hours</p>
              <p className="font-semibold text-gray-800">{companySettings.halfDayHours || 4} hrs</p>
            </div>
            <div className="bg-white p-3 rounded-lg shadow-sm">
              <p className="text-xs text-gray-500 uppercase mb-1">Working Days/Month</p>
              <p className="font-semibold text-gray-800">{payrollConfig.workingDaysPerMonth || 26}</p>
            </div>
          </div>

          {/* Attendance Timing Rules */}
          <div className="mt-4 p-3 bg-white rounded-lg">
            <p className="text-xs font-medium text-gray-600 mb-2">Attendance Status Rules:</p>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="px-2 py-1 bg-green-100 text-green-700 rounded-full flex items-center">
                <FaClock className="mr-1" /> Early Check-in: Before {formatTime(companySettings.checkInTime)}
              </span>
              <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded-full flex items-center">
                <FaClock className="mr-1" /> On-Time: Within {companySettings.lateThreshold || 15} mins grace
              </span>
              <span className="px-2 py-1 bg-yellow-100 text-yellow-700 rounded-full flex items-center">
                <FaClock className="mr-1" /> Late: After {companySettings.lateThreshold || 15} mins grace
              </span>
              <span className="px-2 py-1 bg-orange-100 text-orange-700 rounded-full flex items-center">
                <FaClock className="mr-1" /> Early Checkout: Before {formatTime(companySettings.checkOutTime)}
              </span>
              <span className="px-2 py-1 bg-purple-100 text-purple-700 rounded-full flex items-center">
                <FaClock className="mr-1" /> Overtime: After {formatTime(companySettings.checkOutTime)}
              </span>
            </div>
          </div>

          {/* Active Deduction Rules */}
          <div className="mt-4 p-3 bg-white rounded-lg">
            <p className="text-xs font-medium text-gray-600 mb-2">Active Deduction Rules:</p>
            <div className="flex flex-wrap gap-2 text-xs">
              {payrollConfig.lateDeduction?.enabled && (
                <span className="px-2 py-1 bg-yellow-100 text-yellow-700 rounded">
                  Late: {payrollConfig.lateDeduction.type === 'fixed'
                    ? formatCurrency(payrollConfig.lateDeduction.value)
                    : payrollConfig.lateDeduction.value + '% per day'}
                  {(payrollConfig.lateDeduction.graceLatesPerMonth || 0) > 0 &&
                    ' (' + payrollConfig.lateDeduction.graceLatesPerMonth + ' grace/month)'}
                </span>
              )}
              {payrollConfig.halfDayDeduction?.enabled && (
                <span className="px-2 py-1 bg-orange-100 text-orange-700 rounded">
                  Half-Day: {payrollConfig.halfDayDeduction.type === 'fixed'
                    ? formatCurrency(payrollConfig.halfDayDeduction.value)
                    : payrollConfig.halfDayDeduction.value + '% per day'}
                </span>
              )}
              {payrollConfig.absentDeduction?.enabled && (
                <span className="px-2 py-1 bg-red-100 text-red-700 rounded">
                  Absent: {payrollConfig.absentDeduction.type === 'fixed'
                    ? formatCurrency(payrollConfig.absentDeduction.value)
                    : payrollConfig.absentDeduction.value + '% per day'}
                </span>
              )}
              {payrollConfig.overtime?.enabled && (
                <span className="px-2 py-1 bg-green-100 text-green-700 rounded">
                  Overtime: {payrollConfig.overtime.rateMultiplier || 1.5}x hourly rate
                </span>
              )}
              {payrollConfig.pfEnabled && (
                <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded">
                  PF: {payrollConfig.pfPercentage || 12}%
                </span>
              )}
              {payrollConfig.professionalTax?.enabled && (
                <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded">
                  PT: {formatCurrency(payrollConfig.professionalTax.amount || 200)}
                </span>
              )}
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
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Overtime Grace</label>
            <div className="flex items-center h-[42px]">
              <button
                type="button"
                onClick={() => {
                  setFormData({ ...formData, enableOvertimeGrace: !formData.enableOvertimeGrace })
                  setShowPreview(false)
                }}
                className={'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ' + (formData.enableOvertimeGrace ? 'bg-green-500' : 'bg-red-400')}
              >
                <span className={'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ' + (formData.enableOvertimeGrace ? 'translate-x-5' : 'translate-x-0')} />
              </button>
              <span className="ml-3 text-sm text-gray-600">{formData.enableOvertimeGrace ? 'Enabled' : 'Disabled'}</span>
            </div>
            <p className="text-xs text-gray-500 mt-1">Apply grace if deductions exceed salary</p>
          </div>
        </div>
      </div>

      {/* Employee Selection or Payroll Preview */}
      {!showPreview ? (
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          <div className="p-4 border-b border-gray-200 flex items-center justify-between">
            <h2 className="text-xl font-semibold text-gray-800">Select Employees</h2>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-600">
                {selectedEmployees.length} of {availableEmployees.length} selected
                {existingPayrollEmployeeIds.length > 0 && (
                  <span className="text-orange-600 ml-2">
                    ({existingPayrollEmployeeIds.length} already have payroll)
                  </span>
                )}
              </span>
              <button
                onClick={fetchAttendanceData}
                className="text-primary-600 hover:text-primary-700 flex items-center space-x-1 text-sm"
              >
                <FaSync className="w-3 h-3" />
                <span>Refresh</span>
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left">
                    <input
                      type="checkbox"
                      checked={selectedEmployees.length === availableEmployees.length && availableEmployees.length > 0}
                      onChange={handleSelectAll}
                      className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                    />
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Employee</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Department</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Gross Salary</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase bg-blue-50">OT Grace</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase bg-green-50">Present</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase bg-yellow-50">Late</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase bg-purple-50">Overtime</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase bg-blue-50">Half-Day</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase bg-red-50">Absent</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase bg-green-100">Approved Leaves</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase bg-pink-50">Denied Leaves</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase bg-yellow-100">Pending Leaves</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {availableEmployees.length === 0 ? (
                  <tr>
                    <td colSpan={13} className="px-4 py-8 text-center text-gray-500">
                      <FaCheckCircle className="w-12 h-12 mx-auto text-green-300 mb-3" />
                      <p className="text-lg font-medium">All employees have payroll generated</p>
                      <p className="text-sm text-gray-400 mt-1">
                        Payroll for {new Date(formData.year, formData.month - 1).toLocaleString('default', { month: 'long', year: 'numeric' })} has been generated for all active employees.
                      </p>
                    </td>
                  </tr>
                ) : (
                  availableEmployees.map((employee) => {
                    const attendance = attendanceData[employee._id] || {}
                    const employeeLeaves = leaveData[employee._id] || {}
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
                          <div className="text-xs text-gray-500">{employee.employeeCode}</div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-gray-600">{formatDepartments(employee)}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-right font-semibold text-gray-900">{formatCurrency(employee.salary?.grossSalary || employee.salary?.basic || 0)}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-center bg-blue-50">
                          <button
                            type="button"
                            onClick={() => toggleEmployeeOvertimeGrace(employee._id)}
                            className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${employeeOvertimeGrace[employee._id] || formData.enableOvertimeGrace ? 'bg-green-500' : 'bg-gray-300'}`}
                            title={employeeOvertimeGrace[employee._id] || formData.enableOvertimeGrace ? 'OT Grace Enabled' : 'OT Grace Disabled'}
                          >
                            <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${employeeOvertimeGrace[employee._id] || formData.enableOvertimeGrace ? 'translate-x-4' : 'translate-x-0'}`} />
                          </button>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-center bg-green-50">
                          <span className="px-2 py-1 bg-green-100 text-green-800 text-xs font-medium rounded-full">{attendance.presentDays || 0}</span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-center bg-yellow-50">
                          <span className={'px-2 py-1 text-xs font-medium rounded-full ' + (attendance.lateDays > 0 ? 'bg-yellow-100 text-yellow-800' : 'bg-gray-100 text-gray-500')}>{attendance.lateDays || 0}</span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-center bg-purple-50">
                          <span className={'px-2 py-1 text-xs font-medium rounded-full ' + (attendance.overtimeHours > 0 ? 'bg-purple-100 text-purple-800' : 'bg-gray-100 text-gray-500')}>{attendance.overtimeHours ? attendance.overtimeHours.toFixed(1) + 'h' : '0'}</span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-center bg-blue-50">
                          <span className={'px-2 py-1 text-xs font-medium rounded-full ' + (attendance.halfDays > 0 ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-500')}>{attendance.halfDays || 0}</span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-center bg-red-50">
                          <span className={'px-2 py-1 text-xs font-medium rounded-full ' + (attendance.absentDays > 0 ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-500')}>{attendance.absentDays || 0}</span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-center bg-green-100">
                          <span className={'px-2 py-1 text-xs font-medium rounded-full ' + (employeeLeaves.approvedDays > 0 ? 'bg-green-200 text-green-800' : 'bg-gray-100 text-gray-500')}>{employeeLeaves.approvedDays || 0}</span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-center bg-pink-50">
                          <span className={'px-2 py-1 text-xs font-medium rounded-full ' + (employeeLeaves.deniedDays > 0 ? 'bg-pink-200 text-pink-800' : 'bg-gray-100 text-gray-500')}>{employeeLeaves.deniedDays || 0}</span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-center bg-yellow-100">
                          <span className={'px-2 py-1 text-xs font-medium rounded-full ' + (employeeLeaves.pendingDays > 0 ? 'bg-yellow-200 text-yellow-800' : 'bg-gray-100 text-gray-500')}>{employeeLeaves.pendingDays || 0}</span>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
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

          <div className={'grid gap-4 p-4 bg-gray-50 border-b ' + (formData.enableOvertimeGrace && summaryTotals.overtimeGraceApplied > 0 ? 'grid-cols-2 md:grid-cols-6' : 'grid-cols-2 md:grid-cols-5')}>
            <div className="bg-white p-4 rounded-lg shadow-sm">
              <p className="text-xs text-gray-500 uppercase">Total Gross</p>
              <p className="text-xl font-bold text-gray-800">{formatCurrency(summaryTotals.grossSalary)}</p>
            </div>
            <div className="bg-white p-4 rounded-lg shadow-sm">
              <p className="text-xs text-gray-500 uppercase">Overtime Earnings</p>
              <p className="text-xl font-bold text-green-600">{formatCurrency(summaryTotals.overtimeEarnings)}</p>
            </div>
            <div className="bg-white p-4 rounded-lg shadow-sm">
              <p className="text-xs text-gray-500 uppercase">Attendance Ded.</p>
              <p className="text-xl font-bold text-orange-600">{formatCurrency(summaryTotals.attendanceDeductions)}</p>
            </div>
            <div className="bg-white p-4 rounded-lg shadow-sm">
              <p className="text-xs text-gray-500 uppercase">Total Deductions</p>
              <p className="text-xl font-bold text-red-600">{formatCurrency(summaryTotals.totalDeductions)}</p>
            </div>
            {formData.enableOvertimeGrace && summaryTotals.overtimeGraceApplied > 0 && (
              <div className="bg-white p-4 rounded-lg shadow-sm border-2 border-blue-200">
                <p className="text-xs text-blue-600 uppercase">Overtime Grace Applied</p>
                <p className="text-xl font-bold text-blue-600">+{formatCurrency(summaryTotals.overtimeGraceApplied)}</p>
              </div>
            )}
            <div className="bg-white p-4 rounded-lg shadow-sm">
              <p className="text-xs text-gray-500 uppercase">Net Payable</p>
              <p className="text-xl font-bold text-green-600">{formatCurrency(summaryTotals.netSalary)}</p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-100 border-b border-gray-200">
                <tr>
                  <th className="px-3 py-3 text-left font-semibold text-gray-700 sticky left-0 bg-gray-100 min-w-[180px]">Employee</th>
                  <th className="px-3 py-3 text-right font-semibold text-gray-700 bg-blue-50">Basic</th>
                  <th className="px-3 py-3 text-right font-semibold text-gray-700 bg-blue-50">HRA</th>
                  <th className="px-3 py-3 text-right font-semibold text-gray-700 bg-blue-50">Allowances</th>
                  <th className="px-3 py-3 text-right font-semibold text-gray-700 bg-green-100">Gross</th>
                  <th className="px-3 py-3 text-right font-semibold text-gray-700 bg-purple-50">Overtime</th>
                  <th className="px-3 py-3 text-right font-semibold text-gray-700">PF</th>
                  <th className="px-3 py-3 text-right font-semibold text-gray-700">ESI</th>
                  <th className="px-3 py-3 text-right font-semibold text-gray-700">PT</th>
                  <th className="px-3 py-3 text-right font-semibold text-gray-700">TDS</th>
                  <th className="px-3 py-3 text-right font-semibold text-gray-700 bg-yellow-50">Late</th>
                  <th className="px-3 py-3 text-right font-semibold text-gray-700 bg-orange-50">Half-Day</th>
                  <th className="px-3 py-3 text-right font-semibold text-gray-700 bg-red-50">Absent</th>
                  <th className="px-3 py-3 text-right font-semibold text-gray-700 bg-pink-50">Denied Leave</th>
                  <th className="px-3 py-3 text-right font-semibold text-gray-700 bg-red-100">Total Ded.</th>
                  {formData.enableOvertimeGrace && (
                    <th className="px-3 py-3 text-right font-semibold text-gray-700 bg-blue-100">Grace</th>
                  )}
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
                        P:{payroll.attendance.effectivePresentDays || payroll.attendance.presentDays} | A:{payroll.attendance.effectiveAbsentDays || 0} | L:{payroll.attendance.lateDays}
                        {payroll.attendance.chargeableLates > 0 && <span className="text-yellow-600"> ({payroll.attendance.chargeableLates} charged)</span>}
                        {payroll.attendance.overtimeHours > 0 && <span className="text-purple-600"> | OT:{payroll.attendance.overtimeHours.toFixed(1)}h</span>}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right text-gray-900 bg-blue-50">{formatCurrency(payroll.basicSalary)}</td>
                    <td className="px-3 py-3 text-right text-gray-900 bg-blue-50">{formatCurrency(payroll.hra)}</td>
                    <td className="px-3 py-3 text-right text-gray-900 bg-blue-50">{formatCurrency(payroll.conveyanceAllowance + payroll.medicalAllowance + payroll.specialAllowance)}</td>
                    <td className="px-3 py-3 text-right font-semibold text-gray-900 bg-green-100">{formatCurrency(payroll.grossSalary)}</td>
                    <td className="px-3 py-3 text-right bg-purple-50">
                      {payroll.overtimeEarnings > 0 ? <span className="text-purple-700 font-medium">+{formatCurrency(payroll.overtimeEarnings)}</span> : <span className="text-gray-400">-</span>}
                    </td>
                    <td className="px-3 py-3 text-right text-red-600">{formatCurrency(payroll.pf)}</td>
                    <td className="px-3 py-3 text-right text-red-600">{formatCurrency(payroll.esi)}</td>
                    <td className="px-3 py-3 text-right text-red-600">{formatCurrency(payroll.professionalTax)}</td>
                    <td className="px-3 py-3 text-right text-red-600">{formatCurrency(payroll.tds)}</td>
                    <td className="px-3 py-3 text-right bg-yellow-50">
                      {payroll.lateDeduction > 0 ? <span className="text-yellow-700 font-medium">{formatCurrency(payroll.lateDeduction)}</span> : <span className="text-gray-400">-</span>}
                    </td>
                    <td className="px-3 py-3 text-right bg-orange-50">
                      {payroll.halfDayDeduction > 0 ? <span className="text-orange-700 font-medium">{formatCurrency(payroll.halfDayDeduction)}</span> : <span className="text-gray-400">-</span>}
                    </td>
                    <td className="px-3 py-3 text-right bg-red-50">
                      {payroll.absentDeduction > 0 ? <span className="text-red-700 font-medium">{formatCurrency(payroll.absentDeduction)}</span> : <span className="text-gray-400">-</span>}
                    </td>
                    <td className="px-3 py-3 text-right bg-pink-50">
                      {payroll.deniedLeaveDeduction > 0 ? <span className="text-pink-700 font-medium">{formatCurrency(payroll.deniedLeaveDeduction)}</span> : <span className="text-gray-400">-</span>}
                    </td>
                    <td className="px-3 py-3 text-right font-semibold text-red-700 bg-red-100">{formatCurrency(payroll.totalDeductions)}</td>
                    {formData.enableOvertimeGrace && (
                      <td className="px-3 py-3 text-right bg-blue-100">
                        {payroll.overtimeGrace?.appliedAmount > 0 
                          ? <span className="text-blue-700 font-medium">+{formatCurrency(payroll.overtimeGrace.appliedAmount)}</span> 
                          : <span className="text-gray-400">-</span>}
                      </td>
                    )}
                    <td className="px-3 py-3 text-right font-bold text-green-700 bg-green-100">{formatCurrency(payroll.netSalary)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-200 border-t-2 border-gray-400">
                <tr>
                  <td className="px-3 py-3 font-bold text-gray-800 sticky left-0 bg-gray-200">TOTAL ({calculatedPayrollData.length} employees)</td>
                  <td className="px-3 py-3 text-right font-bold text-gray-800 bg-blue-100" colSpan={3}></td>
                  <td className="px-3 py-3 text-right font-bold text-gray-800 bg-green-200">{formatCurrency(summaryTotals.grossSalary)}</td>
                  <td className="px-3 py-3 text-right font-bold text-purple-700 bg-purple-100">{formatCurrency(summaryTotals.overtimeEarnings)}</td>
                  <td className="px-3 py-3 text-right font-bold text-red-700">{formatCurrency(summaryTotals.pf)}</td>
                  <td className="px-3 py-3 text-right font-bold text-red-700">{formatCurrency(summaryTotals.esi)}</td>
                  <td className="px-3 py-3" colSpan={2}></td>
                  <td className="px-3 py-3 text-right font-bold text-orange-700 bg-orange-100" colSpan={3}>{formatCurrency(summaryTotals.attendanceDeductions)}</td>
                  <td className="px-3 py-3 text-right font-bold text-pink-700 bg-pink-100">{formatCurrency(summaryTotals.deniedLeaveDeductions)}</td>
                  <td className="px-3 py-3 text-right font-bold text-red-700 bg-red-200">{formatCurrency(summaryTotals.totalDeductions)}</td>
                  {formData.enableOvertimeGrace && (
                    <td className="px-3 py-3 text-right font-bold text-blue-700 bg-blue-200">{formatCurrency(summaryTotals.overtimeGraceApplied)}</td>
                  )}
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
