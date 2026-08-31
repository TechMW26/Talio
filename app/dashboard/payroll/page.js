'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import toast from '@/utils/toast'
import { useSocket, REALTIME_EVENTS } from '@/contexts/SocketContext'
import {
  FaDownload, FaEye, FaMoneyBillWave, FaPlus, FaFilter,
  FaCheckCircle, FaClock, FaExclamationTriangle, FaUsers,
  FaFileInvoiceDollar, FaChartLine, FaCalendarAlt, FaFileExcel,
  FaEnvelope, FaCheckSquare, FaSquare, FaCog, FaTrash, FaEdit, FaTimes,
  FaUniversity, FaFileDownload, FaSync
} from 'react-icons/fa'
import { getCurrentUser, getEmployeeId } from '@/utils/userHelper'
import { downloadExcelWorkbook } from '@/lib/client/spreadsheetExport'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import useApiMutation from '@/hooks/useApiMutation'
import LoadingButton from '@/components/ui/LoadingButton'

// Hero UI Components
import {
  HRMSCard,
  HRMSCardHeader,
  HRMSCardBody,
  PrimaryButton,
  SecondaryButton,
  DangerButton,
  SuccessButton,
  GhostButton,
  IconButton,
  HRMSSelect,
  HRMSSelectItem,
  HRMSInput,
  HRMSCheckbox,
  HRMSModal,
  HRMSModalContent,
  HRMSModalHeader,
  HRMSModalBody,
  HRMSModalFooter,
  useDisclosure,
  StatusBadge,
  KPICard,
  PageLoader,
  EmptyState,
  Chip,
  Table,
  TableHeader,
  TableBody,
  TableColumn,
  TableRow,
  TableCell,
  Checkbox,
  Button,
  Select,
  SelectItem,
  Input,
  Divider,
} from '@/components/ui/heroui'

const ADMIN_ROLES = ['admin', 'hr', 'super_admin']

export default function PayrollPage() {
  const router = useRouter()
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1)
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())
  const [statusFilter, setStatusFilter] = useState('all')
  const [selectedVenture, setSelectedVenture] = useState('all')
  const [selectedPayrolls, setSelectedPayrolls] = useState([])
  const [bulkProcessing, setBulkProcessing] = useState(false)
  const [sendEmailsOnProcess, setSendEmailsOnProcess] = useState(true)
  const [editingPayroll, setEditingPayroll] = useState(null)
  const [editFormData, setEditFormData] = useState({})
  const [selectedBank, setSelectedBank] = useState('')

  // Hero UI Modal disclosures
  const editModal = useDisclosure()
  const bankSheetModal = useDisclosure()

  // Real-time updates
  const { socket, isConnected, subscribe, onPayrollUpdate } = useSocket()

  // User from localStorage (memoized)
  const user = useMemo(() => getCurrentUser(), [])
  const isAdmin = useMemo(() => user ? ADMIN_ROLES.includes(user.role) : false, [user])

  // --- SWR Data Fetching ---

  // Payroll data (depends on user role + month/year)
  const payrollParams = useMemo(() => {
    if (!user) return null
    if (isAdmin) {
      const params = new URLSearchParams()
      if (selectedMonth) params.append('month', selectedMonth)
      if (selectedYear) params.append('year', selectedYear)
      return `/api/payroll?${params.toString()}`
    } else {
      const empId = getEmployeeId(user)
      return empId ? `/api/payroll?employeeId=${empId}` : null
    }
  }, [user, isAdmin, selectedMonth, selectedYear])

  const { data: payrollsRes, isLoading: loading, mutate: refreshPayrolls } = useAuthedSWR(payrollParams)
  const payrolls = payrollsRes?.data || []

  // Ventures (admin only)
  const { data: venturesRes } = useAuthedSWR(isAdmin ? '/api/companies' : null)
  const ventures = venturesRes?.data || []

  // Subscribe to real-time payroll updates
  useEffect(() => {
    if (!socket || !isConnected || !user) return

    const handlePayrollUpdate = (data) => {
      console.log('🔄 [Payroll] Real-time update received:', data)
      refreshPayrolls()
    }

    const unsub1 = onPayrollUpdate?.(handlePayrollUpdate)
    const unsub2 = subscribe?.(REALTIME_EVENTS.PAYROLL_UPDATE, handlePayrollUpdate)

    return () => {
      unsub1?.()
      unsub2?.()
    }
  }, [socket, isConnected, user, isAdmin, selectedMonth, selectedYear])

  const filteredPayrolls = useMemo(() => {
    let filtered = payrolls

    // Filter by status
    if (statusFilter !== 'all') {
      filtered = filtered.filter(p => p.status === statusFilter)
    }

    // Filter by venture/company
    if (selectedVenture !== 'all') {
      filtered = filtered.filter(p => p.employee?.company?._id === selectedVenture)
    }

    // Sort by hierarchy (higher designationLevel = higher hierarchy = comes first)
    // Then by designation title to group same designations together
    filtered = [...filtered].sort((a, b) => {
      const levelA = a.employee?.designationLevel || a.employee?.designation?.level || 0
      const levelB = b.employee?.designationLevel || b.employee?.designation?.level || 0

      // First sort by level (higher = higher hierarchy, so descending)
      if (levelA !== levelB) {
        return levelB - levelA
      }

      // Within same level, group by designation title
      const titleA = a.employee?.designation?.title || ''
      const titleB = b.employee?.designation?.title || ''
      return titleA.localeCompare(titleB)
    })

    return filtered
  }, [payrolls, statusFilter, selectedVenture])

  const stats = useMemo(() => {
    const monthPayrolls = payrolls.filter(p =>
      p.month === selectedMonth && p.year === selectedYear
    )
    return {
      total: monthPayrolls.length,
      totalGross: monthPayrolls.reduce((sum, p) => sum + (p.grossSalary || 0), 0),
      totalDeductions: monthPayrolls.reduce((sum, p) => sum + (p.totalDeductions || 0), 0),
      totalNet: monthPayrolls.reduce((sum, p) => sum + (p.netSalary || 0), 0),
      draft: monthPayrolls.filter(p => p.status === 'draft').length,
      processed: monthPayrolls.filter(p => p.status === 'processed').length,
      paid: monthPayrolls.filter(p => p.status === 'paid').length,
      onHold: monthPayrolls.filter(p => p.status === 'on-hold').length,
    }
  }, [payrolls, selectedMonth, selectedYear])

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(amount || 0)
  }

  const getMonthName = (month) => {
    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ]
    return months[month - 1]
  }

  const getStatusBadge = (status) => {
    const statusMap = {
      'draft': 'default',
      'processed': 'primary',
      'paid': 'success',
      'on-hold': 'warning',
      'pending': 'warning',
    }
    const labelMap = {
      'draft': 'Draft',
      'processed': 'Processed',
      'paid': 'Paid',
      'on-hold': 'On Hold',
      'pending': 'Pending',
    }
    return (
      <StatusBadge
        status={statusMap[status] || 'default'}
        label={labelMap[status] || 'Unknown'}
      />
    )
  }

  // --- Status update mutation ---
  const statusMutation = useApiMutation({
    method: 'PATCH',
    onSuccess: (data) => {
      toast.success(`Payroll status updated`)
      refreshPayrolls()
    },
    onError: (msg) => toast.error(msg || 'Failed to update status'),
  })

  const handleUpdateStatus = async (payrollId, newStatus) => {
    await statusMutation.execute(`/api/payroll/${payrollId}`, { status: newStatus })
  }

  // Bulk selection handlers
  const handleSelectAll = (e) => {
    if (e.target.checked) {
      setSelectedPayrolls(filteredPayrolls.map(p => p._id))
    } else {
      setSelectedPayrolls([])
    }
  }

  const handleSelectPayroll = (payrollId) => {
    setSelectedPayrolls(prev => {
      if (prev.includes(payrollId)) {
        return prev.filter(id => id !== payrollId)
      } else {
        return [...prev, payrollId]
      }
    })
  }

  // Bulk process handler
  const handleBulkProcess = async (action) => {
    if (selectedPayrolls.length === 0) {
      toast.error('Please select at least one payroll')
      return
    }

    setBulkProcessing(true)
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/payroll/bulk', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          payrollIds: selectedPayrolls,
          action,
          sendEmails: sendEmailsOnProcess,
        }),
      })

      const data = await response.json()
      if (data.success) {
        let message = `${data.data.updated} payroll(s) updated`
        if (data.data.emailsSent > 0) {
          message += `, ${data.data.emailsSent} email(s) sent`
        }
        if (data.data.emailsFailed > 0) {
          message += `, ${data.data.emailsFailed} email(s) failed`
        }
        toast.success(message)
        setSelectedPayrolls([])
        refreshPayrolls()
      } else {
        toast.error(data.message || 'Failed to process payrolls')
      }
    } catch (error) {
      console.error('Bulk process error:', error)
      toast.error('Failed to process payrolls')
    } finally {
      setBulkProcessing(false)
    }
  }

  // Export to Excel
  const exportToExcel = async () => {
    if (filteredPayrolls.length === 0) {
      toast.error('No payroll records to export')
      return
    }

    const exportData = filteredPayrolls.map(p => ({
      'Employee Name': `${p.employee?.firstName || ''} ${p.employee?.lastName || ''}`,
      'Employee Code': p.employee?.employeeCode || '',
      'Venture': p.employee?.company?.name || '',
      'Month': getMonthName(p.month),
      'Year': p.year,
      'Basic Salary': p.earnings?.basic || 0,
      'HRA': p.earnings?.hra || 0,
      'Conveyance': p.earnings?.conveyance || 0,
      'Medical': p.earnings?.medicalAllowance || 0,
      'Special Allowance': p.earnings?.specialAllowance || 0,
      'Overtime': p.earnings?.overtime || 0,
      'Gross Salary': p.grossSalary || 0,
      'PF': p.deductions?.pf || 0,
      'ESI': p.deductions?.esi || 0,
      'Professional Tax': p.deductions?.professionalTax || 0,
      'TDS': p.deductions?.tds || 0,
      'Late Deduction': p.deductions?.lateDeduction || 0,
      'Other Deductions': p.deductions?.other || 0,
      'Total Deductions': p.totalDeductions || 0,
      'Net Salary': p.netSalary || 0,
      'Present Days': p.presentDays || 0,
      'Absent Days': p.absentDays || 0,
      'Leave Days': p.leaveDays || 0,
      'Status': p.status || 'draft',
    }))

    // Include venture code in filename if a specific venture is selected
    const selectedVentureData = ventures.find(v => v._id === selectedVenture)
    const ventureCode = selectedVentureData?.code ? `_${selectedVentureData.code}` : ''
    const fileName = `Payroll_${getMonthName(selectedMonth)}_${selectedYear}${ventureCode}.xlsx`
    try {
      await downloadExcelWorkbook(fileName, [{ name: 'Payroll', records: exportData }])
      toast.success('Excel file downloaded!')
    } catch (error) {
      toast.error(error?.message || 'Could not export payroll')
    }
  }

  // Bank formats for different Indian banks
  const bankFormats = [
    { id: 'hdfc', name: 'HDFC Bank', format: 'HDFC' },
    { id: 'icici', name: 'ICICI Bank', format: 'ICICI' },
    { id: 'sbi', name: 'State Bank of India', format: 'SBI' },
    { id: 'axis', name: 'Axis Bank', format: 'AXIS' },
    { id: 'kotak', name: 'Kotak Mahindra Bank', format: 'KOTAK' },
    { id: 'pnb', name: 'Punjab National Bank', format: 'PNB' },
    { id: 'bob', name: 'Bank of Baroda', format: 'BOB' },
    { id: 'canara', name: 'Canara Bank', format: 'CANARA' },
    { id: 'union', name: 'Union Bank of India', format: 'UNION' },
    { id: 'idbi', name: 'IDBI Bank', format: 'IDBI' },
    { id: 'yes', name: 'Yes Bank', format: 'YES' },
    { id: 'indusind', name: 'IndusInd Bank', format: 'INDUSIND' },
    { id: 'federal', name: 'Federal Bank', format: 'FEDERAL' },
    { id: 'rbl', name: 'RBL Bank', format: 'RBL' },
    { id: 'generic', name: 'Generic Format (All Banks)', format: 'GENERIC' },
  ]

  // Export bank sheet based on selected bank format
  const exportBankSheet = async () => {
    if (!selectedBank) {
      toast.error('Please select a bank')
      return
    }


    // Use all selected payrolls for bank sheet
    const bankPayrolls = filteredPayrolls.filter(p => selectedPayrolls.includes(p._id));

    if (bankPayrolls.length === 0) {
      toast.error('No selected payrolls to export. Please select at least one payroll.')
      return;
    }

    let exportData = []
    const bankFormat = bankFormats.find(b => b.id === selectedBank)

    // Generate data based on bank format
    switch (selectedBank) {
      case 'hdfc':
        exportData = bankPayrolls.map((p, idx) => ({
          'Sr No': idx + 1,
          'Beneficiary Code': p.employee?.employeeCode || '',
          'Beneficiary Name': `${p.employee?.firstName || ''} ${p.employee?.lastName || ''}`.trim(),
          'Account Number': p.employee?.bankDetails?.accountNumber || '',
          'IFSC Code': p.employee?.bankDetails?.ifscCode || '',
          'Amount': p.netSalary || 0,
          'Payment Mode': 'NEFT',
          'Narration': `Salary ${getMonthName(p.month)} ${p.year}`,
          'Email': p.employee?.email || '',
        }))
        break

      case 'icici':
        exportData = bankPayrolls.map((p, idx) => ({
          'Sl No': idx + 1,
          'Beneficiary Name': `${p.employee?.firstName || ''} ${p.employee?.lastName || ''}`.trim(),
          'Beneficiary Account No': p.employee?.bankDetails?.accountNumber || '',
          'IFSC': p.employee?.bankDetails?.ifscCode || '',
          'Amount': p.netSalary || 0,
          'Payment Type': 'NEFT',
          'Remarks': `SAL ${getMonthName(p.month).substring(0, 3).toUpperCase()} ${p.year}`,
        }))
        break

      case 'sbi':
        exportData = bankPayrolls.map((p, idx) => ({
          'Sr. No.': idx + 1,
          'Beneficiary Name': `${p.employee?.firstName || ''} ${p.employee?.lastName || ''}`.trim(),
          'Account Number': p.employee?.bankDetails?.accountNumber || '',
          'Bank Name': p.employee?.bankDetails?.bankName || '',
          'Branch': p.employee?.bankDetails?.branch || '',
          'IFSC Code': p.employee?.bankDetails?.ifscCode || '',
          'Amount (Rs.)': p.netSalary || 0,
          'Transfer Type': 'NEFT',
          'Purpose': `Salary Payment - ${getMonthName(p.month)} ${p.year}`,
        }))
        break

      case 'axis':
        exportData = bankPayrolls.map((p, idx) => ({
          'Serial No': idx + 1,
          'Payee Name': `${p.employee?.firstName || ''} ${p.employee?.lastName || ''}`.trim(),
          'Account No': p.employee?.bankDetails?.accountNumber || '',
          'IFSC Code': p.employee?.bankDetails?.ifscCode || '',
          'Amount': p.netSalary || 0,
          'Mode': 'N', // N for NEFT
          'Narration': `Salary ${getMonthName(p.month).substring(0, 3)} ${p.year}`,
          'Employee Code': p.employee?.employeeCode || '',
        }))
        break

      case 'kotak':
        exportData = bankPayrolls.map((p, idx) => ({
          'S.No': idx + 1,
          'Beneficiary Name': `${p.employee?.firstName || ''} ${p.employee?.lastName || ''}`.trim(),
          'Beneficiary A/c No': p.employee?.bankDetails?.accountNumber || '',
          'IFSC': p.employee?.bankDetails?.ifscCode || '',
          'Amount': p.netSalary || 0,
          'Payment Mode': 'NEFT',
          'Remarks': `SALARY ${getMonthName(p.month).toUpperCase()} ${p.year}`,
        }))
        break

      default: // Generic format that works with most banks
        exportData = bankPayrolls.map((p, idx) => ({
          'S.No': idx + 1,
          'Employee Code': p.employee?.employeeCode || '',
          'Employee Name': `${p.employee?.firstName || ''} ${p.employee?.lastName || ''}`.trim(),
          'Bank Name': p.employee?.bankDetails?.bankName || '',
          'Branch': p.employee?.bankDetails?.branch || '',
          'Account Number': p.employee?.bankDetails?.accountNumber || '',
          'IFSC Code': p.employee?.bankDetails?.ifscCode || '',
          'Net Salary': p.netSalary || 0,
          'Payment Mode': 'NEFT',
          'Purpose': `Salary - ${getMonthName(p.month)} ${p.year}`,
          'Month': getMonthName(p.month),
          'Year': p.year,
        }))
    }

    // Calculate total
    const totalAmount = bankPayrolls.reduce((sum, p) => sum + (p.netSalary || 0), 0)

    // Add summary row
    if (selectedBank === 'generic') {
      exportData.push({
        'S.No': '',
        'Employee Code': '',
        'Employee Name': 'TOTAL',
        'Bank Name': '',
        'Branch': '',
        'Account Number': '',
        'IFSC Code': '',
        'Net Salary': totalAmount,
        'Payment Mode': '',
        'Purpose': `${bankPayrolls.length} employees`,
        'Month': '',
        'Year': '',
      })
    }

    // Include venture code in filename if a specific venture is selected
    const selectedVentureData = ventures.find(v => v._id === selectedVenture)
    const ventureCode = selectedVentureData?.code ? `_${selectedVentureData.code}` : ''
    const fileName = `BankSheet_${bankFormat?.format || 'GENERIC'}_${getMonthName(selectedMonth)}_${selectedYear}${ventureCode}.xlsx`
    try {
      await downloadExcelWorkbook(fileName, [{ name: 'Bank Sheet', records: exportData }])
      toast.success(`Bank sheet downloaded for ${bankFormat?.name || 'Generic'}!`)
      bankSheetModal.onClose()
      setSelectedBank('')
    } catch (error) {
      toast.error(error?.message || 'Could not export the bank sheet')
    }
  }

  // Delete single payroll
  // Delete single payroll
  const deleteMutation = useApiMutation({
    method: 'DELETE',
    onSuccess: () => {
      toast.success('Payroll deleted successfully')
      refreshPayrolls()
    },
    onError: (msg) => toast.error(msg || 'Failed to delete payroll'),
  })

  const handleDeletePayroll = async (payrollId) => {
    if (!confirm('Are you sure you want to delete this payroll record? This action cannot be undone.')) return
    await deleteMutation.execute(`/api/payroll/${payrollId}`)
  }

  // Bulk delete payrolls
  const handleBulkDelete = async () => {
    if (selectedPayrolls.length === 0) {
      toast.error('Please select at least one payroll')
      return
    }

    if (!confirm(`Are you sure you want to delete ${selectedPayrolls.length} payroll record(s)? This action cannot be undone.`)) return

    setBulkProcessing(true)
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/payroll/bulk', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ payrollIds: selectedPayrolls }),
      })

      const data = await response.json()
      if (data.success) {
        toast.success(`${data.data.deleted} payroll(s) deleted successfully`)
        setSelectedPayrolls([])
        refreshPayrolls()
      } else {
        toast.error(data.message || 'Failed to delete payrolls')
      }
    } catch (error) {
      console.error('Bulk delete error:', error)
      toast.error('Failed to delete payrolls')
    } finally {
      setBulkProcessing(false)
    }
  }

  // Open edit modal
  const openEditModal = (payroll) => {
    setEditingPayroll(payroll)
    setEditFormData({
      grossSalary: payroll.grossSalary || 0,
      totalDeductions: payroll.totalDeductions || 0,
      netSalary: payroll.netSalary || 0,
      earnings: {
        basic: payroll.earnings?.basic || 0,
        hra: payroll.earnings?.hra || 0,
        conveyance: payroll.earnings?.conveyance || 0,
        medicalAllowance: payroll.earnings?.medicalAllowance || 0,
        specialAllowance: payroll.earnings?.specialAllowance || 0,
        overtime: payroll.earnings?.overtime || 0,
        bonus: payroll.earnings?.bonus || 0,
      },
      deductions: {
        pf: payroll.deductions?.pf || 0,
        esi: payroll.deductions?.esi || 0,
        professionalTax: payroll.deductions?.professionalTax || 0,
        tds: payroll.deductions?.tds || 0,
        lateDeduction: payroll.deductions?.lateDeduction || 0,
        other: payroll.deductions?.other || 0,
      },
      status: payroll.status || 'draft',
      presentDays: payroll.presentDays || 0,
      absentDays: payroll.absentDays || 0,
      leaveDays: payroll.leaveDays || 0,
    })
    editModal.onOpen()
  }

  // Close edit modal
  const closeEditModal = () => {
    editModal.onClose()
    setEditingPayroll(null)
    setEditFormData({})
  }

  // Recalculate totals when earnings/deductions change
  const recalculateTotals = (data) => {
    const earnings = data.earnings || editFormData.earnings
    const deductions = data.deductions || editFormData.deductions

    const grossSalary = Object.values(earnings).reduce((sum, val) => sum + (parseFloat(val) || 0), 0)
    const totalDeductions = Object.values(deductions).reduce((sum, val) => sum + (parseFloat(val) || 0), 0)
    const netSalary = grossSalary - totalDeductions

    return { grossSalary, totalDeductions, netSalary }
  }

  // Handle edit form field change
  const handleEditFieldChange = (category, field, value) => {
    const numValue = parseFloat(value) || 0
    let newFormData

    if (category === 'earnings' || category === 'deductions') {
      newFormData = {
        ...editFormData,
        [category]: {
          ...editFormData[category],
          [field]: numValue
        }
      }
    } else {
      newFormData = {
        ...editFormData,
        [field]: category === 'status' ? value : numValue
      }
    }

    // Recalculate totals
    const totals = recalculateTotals(newFormData)
    setEditFormData({
      ...newFormData,
      ...totals
    })
  }

  // --- Save edit mutation ---
  const saveEditMutation = useApiMutation({
    method: 'PUT',
    onSuccess: () => {
      toast.success('Payroll updated successfully')
      closeEditModal()
      refreshPayrolls()
    },
    onError: (msg) => toast.error(msg || 'Failed to update payroll'),
  })

  // Save edited payroll
  const handleSaveEdit = async () => {
    if (!editingPayroll) return
    await saveEditMutation.execute(`/api/payroll/${editingPayroll._id}`, editFormData)
  }

  const months = Array.from({ length: 12 }, (_, i) => ({
    value: i + 1,
    label: getMonthName(i + 1)
  }))

  const years = Array.from({ length: 5 }, (_, i) => ({
    value: new Date().getFullYear() - 2 + i,
    label: (new Date().getFullYear() - 2 + i).toString()
  }))

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">
            {isAdmin ? 'Process Payroll' : 'My Payroll'}
          </h1>
          <p className="text-sm sm:text-base text-default-500 mt-1">
            {isAdmin
              ? 'Manage and process employee payrolls'
              : 'View your salary slips and payment history'}
          </p>
        </div>
        {isAdmin && (
          <PrimaryButton
            onPress={() => router.push('/dashboard/payroll/generate')}
            startContent={<FaPlus />}
            className="w-full sm:w-auto"
          >
            Generate Payroll
          </PrimaryButton>
        )}
      </div>

      {/* Filters */}
      <HRMSCard>
        <HRMSCardBody className="p-3 sm:p-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
            <div className="flex items-center gap-2 flex-wrap flex-1">
              <FaCalendarAlt className="text-default-400 flex-shrink-0" />
              <Select
                selectedKeys={[String(selectedMonth)]}
                onSelectionChange={(keys) => setSelectedMonth(parseInt(Array.from(keys)[0]))}
                size="sm"
                className="min-w-[120px] max-w-[150px]"
                aria-label="Select month"
              >
                {months.map(m => (
                  <SelectItem key={String(m.value)} textValue={m.label}>
                    {m.label}
                  </SelectItem>
                ))}
              </Select>
              <Select
                selectedKeys={[String(selectedYear)]}
                onSelectionChange={(keys) => setSelectedYear(parseInt(Array.from(keys)[0]))}
                size="sm"
                className="min-w-[100px] max-w-[120px]"
                aria-label="Select year"
              >
                {years.map(y => (
                  <SelectItem key={String(y.value)} textValue={y.label}>
                    {y.label}
                  </SelectItem>
                ))}
              </Select>

              {isAdmin && (
                <>
                  <FaFilter className="text-default-400 flex-shrink-0 ml-2" />
                  <Select
                    selectedKeys={[statusFilter]}
                    onSelectionChange={(keys) => setStatusFilter(Array.from(keys)[0])}
                    size="sm"
                    className="min-w-[120px] max-w-[150px]"
                    aria-label="Filter by status"
                  >
                    <SelectItem key="all">All Status</SelectItem>
                    <SelectItem key="draft">Draft</SelectItem>
                    <SelectItem key="processed">Processed</SelectItem>
                    <SelectItem key="paid">Paid</SelectItem>
                    <SelectItem key="on-hold">On Hold</SelectItem>
                  </Select>

                  {ventures.length > 0 && (
                    <Select
                      selectedKeys={[selectedVenture]}
                      onSelectionChange={(keys) => setSelectedVenture(Array.from(keys)[0])}
                      size="sm"
                      className="min-w-[180px] max-w-[280px]"
                      aria-label="Filter by venture"
                      popoverProps={{ className: "min-w-[250px]" }}
                    >
                      <SelectItem key="all">All Ventures</SelectItem>
                      {ventures.map(v => (
                        <SelectItem key={v._id} textValue={v.name}>
                          {v.name}
                        </SelectItem>
                      ))}
                    </Select>
                  )}
                </>
              )}
            </div>

            <SecondaryButton
              onPress={() => refreshPayrolls()}
              size="sm"
              startContent={<FaSync />}
              className="w-full sm:w-auto"
            >
              Refresh
            </SecondaryButton>
          </div>
        </HRMSCardBody>
      </HRMSCard>

      {/* Admin Stats Cards */}
      {isAdmin && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
          <KPICard
            title="Employees"
            value={stats.total}
            icon={<FaUsers className="w-5 h-5" />}
            color="primary"
          />
          <KPICard
            title="Total Gross"
            value={formatCurrency(stats.totalGross)}
            icon={<FaChartLine className="w-5 h-5" />}
            color="primary"
          />
          <KPICard
            title="Deductions"
            value={formatCurrency(stats.totalDeductions)}
            icon={<FaMoneyBillWave className="w-5 h-5" />}
            color="danger"
          />
          <KPICard
            title="Net Payable"
            value={formatCurrency(stats.totalNet)}
            icon={<FaFileInvoiceDollar className="w-5 h-5" />}
            color="success"
          />
          <KPICard
            title="Draft"
            value={stats.draft}
            icon={<FaClock className="w-5 h-5" />}
            color="default"
          />
          <KPICard
            title="Paid"
            value={stats.paid}
            icon={<FaCheckCircle className="w-5 h-5" />}
            color="success"
          />
        </div>
      )}

      {/* Employee Summary Cards */}
      {!isAdmin && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          <KPICard
            title="Latest Net Salary"
            value={payrolls.length > 0 ? formatCurrency(payrolls[0]?.netSalary) : '₹0'}
            icon={<FaMoneyBillWave className="w-5 h-5" />}
            color="success"
          />
          <KPICard
            title="Total Earnings"
            value={payrolls.length > 0 ? formatCurrency(payrolls[0]?.grossSalary) : '₹0'}
            icon={<FaMoneyBillWave className="w-5 h-5" />}
            color="primary"
          />
          <KPICard
            title="Total Deductions"
            value={payrolls.length > 0 ? formatCurrency(payrolls[0]?.totalDeductions) : '₹0'}
            icon={<FaMoneyBillWave className="w-5 h-5" />}
            color="danger"
            className="sm:col-span-2 lg:col-span-1"
          />
        </div>
      )}

      {/* Bulk Action Bar - Admin Only */}
      {isAdmin && (
        <HRMSCard>
          <HRMSCardBody className="p-3 sm:p-4">
            <div className="flex flex-col gap-3">
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <span className="text-xs sm:text-sm font-medium text-default-700">
                  {selectedPayrolls.length} of {filteredPayrolls.length} selected
                </span>
                <Checkbox
                  isSelected={sendEmailsOnProcess}
                  onValueChange={setSendEmailsOnProcess}
                  size="sm"
                  className="text-xs sm:text-sm"
                >
                  Send email payslips
                </Checkbox>
              </div>
              <div className="flex flex-wrap gap-2">
                <PrimaryButton
                  onPress={() => handleBulkProcess('processed')}
                  isDisabled={selectedPayrolls.length === 0 || bulkProcessing}
                  isLoading={bulkProcessing}
                  size="sm"
                  startContent={!bulkProcessing && <FaCheckCircle className="w-3 h-3" />}
                >
                  Process Selected
                </PrimaryButton>
                <SuccessButton
                  onPress={() => handleBulkProcess('paid')}
                  isDisabled={selectedPayrolls.length === 0 || bulkProcessing}
                  size="sm"
                  startContent={<FaMoneyBillWave className="w-3 h-3" />}
                >
                  Mark Paid
                </SuccessButton>
                <DangerButton
                  onPress={handleBulkDelete}
                  isDisabled={selectedPayrolls.length === 0 || bulkProcessing}
                  size="sm"
                  startContent={<FaTrash className="w-3 h-3" />}
                >
                  Delete Selected
                </DangerButton>
                <Button
                  onPress={bankSheetModal.onOpen}
                  isDisabled={selectedPayrolls.length === 0}
                  size="sm"
                  color="secondary"
                  startContent={<FaUniversity className="w-3 h-3" />}
                >
                  Bank Sheet
                </Button>
                <SecondaryButton
                  onPress={exportToExcel}
                  isDisabled={filteredPayrolls.length === 0}
                  size="sm"
                  startContent={<FaDownload className="w-3 h-3" />}
                >
                  Export Excel
                </SecondaryButton>
              </div>
            </div>
          </HRMSCardBody>
        </HRMSCard>
      )}

      {/* Payroll Table */}
      <HRMSCard>
        <HRMSCardHeader className="flex justify-between items-center">
          <h2 className="text-base sm:text-xl font-semibold text-foreground">
            {isAdmin ? `Payroll Records - ${getMonthName(selectedMonth)} ${selectedYear}` : 'Salary Slips'}
          </h2>
        </HRMSCardHeader>
        <Divider />
        <HRMSCardBody className="p-0">
          {loading ? (
            <div className="p-8">
              <PageLoader message="Loading payroll records..." />
            </div>
          ) : filteredPayrolls.length === 0 ? (
            <EmptyState
              icon={<FaFileInvoiceDollar className="w-12 h-12" />}
              title="No payroll records found"
              description={isAdmin
                ? 'Generate payroll for employees to see records here'
                : 'Your payroll records will appear here once processed'}
              action={isAdmin && (
                <PrimaryButton
                  onPress={() => router.push('/dashboard/payroll/generate')}
                  startContent={<FaPlus />}
                >
                  Generate Payroll
                </PrimaryButton>
              )}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table
                aria-label="Payroll records table"
                selectionMode={isAdmin ? "multiple" : "none"}
                selectedKeys={new Set(selectedPayrolls)}
                onSelectionChange={(keys) => {
                  if (keys === "all") {
                    setSelectedPayrolls(filteredPayrolls.map(p => p._id))
                  } else {
                    setSelectedPayrolls(Array.from(keys))
                  }
                }}
                classNames={{
                  wrapper: "min-h-[200px]",
                }}
              >
                <TableHeader>
                  {isAdmin && <TableColumn>EMPLOYEE</TableColumn>}
                  {isAdmin && <TableColumn>VENTURE</TableColumn>}
                  <TableColumn>MONTH/YEAR</TableColumn>
                  <TableColumn align="end">GROSS</TableColumn>
                  <TableColumn align="end">DEDUCTIONS</TableColumn>
                  <TableColumn align="end">NET SALARY</TableColumn>
                  <TableColumn align="center">STATUS</TableColumn>
                  <TableColumn align="center">ACTIONS</TableColumn>
                </TableHeader>
                <TableBody items={filteredPayrolls}>
                  {(payroll) => (
                    <TableRow key={payroll._id}>
                      {isAdmin && (
                        <TableCell>
                          <div className="font-medium text-foreground text-xs sm:text-sm">
                            {payroll.employee?.firstName} {payroll.employee?.lastName}
                          </div>
                          <div className="text-xs text-default-400">
                            {payroll.employee?.employeeCode}
                          </div>
                        </TableCell>
                      )}
                      {isAdmin && (
                        <TableCell className="text-xs sm:text-sm">
                          {payroll.employee?.company?.name || '-'}
                        </TableCell>
                      )}
                      <TableCell className="text-xs sm:text-sm">
                        {getMonthName(payroll.month)} {payroll.year}
                      </TableCell>
                      <TableCell className="text-xs sm:text-sm text-right">
                        {formatCurrency(payroll.grossSalary)}
                      </TableCell>
                      <TableCell className="text-xs sm:text-sm text-right text-danger">
                        {formatCurrency(payroll.totalDeductions)}
                      </TableCell>
                      <TableCell className="text-xs sm:text-sm text-right font-semibold text-success">
                        {formatCurrency(payroll.netSalary)}
                      </TableCell>
                      <TableCell className="text-center">
                        {getStatusBadge(payroll.status)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-center gap-1">
                          <IconButton
                            onPress={() => router.push(`/dashboard/payroll/payslips/${payroll._id}`)}
                            color="primary"
                            variant="light"
                            size="sm"
                            aria-label="View Payslip"
                          >
                            <FaEye className="w-3 h-3" />
                          </IconButton>
                          <IconButton
                            color="success"
                            variant="light"
                            size="sm"
                            aria-label="Download Payslip"
                          >
                            <FaDownload className="w-3 h-3" />
                          </IconButton>
                          {isAdmin && (
                            <>
                              <IconButton
                                onPress={() => openEditModal(payroll)}
                                color="warning"
                                variant="light"
                                size="sm"
                                aria-label="Edit Payroll"
                              >
                                <FaEdit className="w-3 h-3" />
                              </IconButton>
                              <IconButton
                                onPress={() => handleDeletePayroll(payroll._id)}
                                isDisabled={deleteMutation.isLoading}
                                color="danger"
                                variant="light"
                                size="sm"
                                aria-label="Delete Payroll"
                              >
                                <FaTrash className="w-3 h-3" />
                              </IconButton>
                            </>
                          )}
                          {isAdmin && payroll.status === 'draft' && (
                            <Button
                              onPress={() => handleUpdateStatus(payroll._id, 'processed')}
                              size="sm"
                              color="primary"
                            >
                              Process
                            </Button>
                          )}
                          {isAdmin && payroll.status === 'processed' && (
                            <Button
                              onPress={() => handleUpdateStatus(payroll._id, 'paid')}
                              size="sm"
                              color="success"
                            >
                              Mark Paid
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </HRMSCardBody>
      </HRMSCard>

      {/* Edit Payroll Modal */}
      <HRMSModal
        isOpen={editModal.isOpen}
        onOpenChange={editModal.onOpenChange}
        size="3xl"
        scrollBehavior="inside"
      >
        <HRMSModalContent>
          {(onClose) => (
            <>
              <HRMSModalHeader className="flex flex-col gap-1">
                Edit Payroll - {editingPayroll?.employee?.firstName} {editingPayroll?.employee?.lastName}
              </HRMSModalHeader>
              <HRMSModalBody>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Earnings Section */}
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold text-foreground border-b border-divider pb-2">Earnings</h3>
                    <HRMSInput
                      type="number"
                      label="Basic Salary"
                      value={editFormData.earnings?.basic || 0}
                      onChange={(e) => handleEditFieldChange('earnings', 'basic', e.target.value)}
                    />
                    <HRMSInput
                      type="number"
                      label="HRA"
                      value={editFormData.earnings?.hra || 0}
                      onChange={(e) => handleEditFieldChange('earnings', 'hra', e.target.value)}
                    />
                    <HRMSInput
                      type="number"
                      label="Conveyance"
                      value={editFormData.earnings?.conveyance || 0}
                      onChange={(e) => handleEditFieldChange('earnings', 'conveyance', e.target.value)}
                    />
                    <HRMSInput
                      type="number"
                      label="Medical Allowance"
                      value={editFormData.earnings?.medicalAllowance || 0}
                      onChange={(e) => handleEditFieldChange('earnings', 'medicalAllowance', e.target.value)}
                    />
                    <HRMSInput
                      type="number"
                      label="Special Allowance"
                      value={editFormData.earnings?.specialAllowance || 0}
                      onChange={(e) => handleEditFieldChange('earnings', 'specialAllowance', e.target.value)}
                    />
                    <HRMSInput
                      type="number"
                      label="Overtime"
                      value={editFormData.earnings?.overtime || 0}
                      onChange={(e) => handleEditFieldChange('earnings', 'overtime', e.target.value)}
                    />
                    <HRMSInput
                      type="number"
                      label="Bonus"
                      value={editFormData.earnings?.bonus || 0}
                      onChange={(e) => handleEditFieldChange('earnings', 'bonus', e.target.value)}
                    />
                  </div>

                  {/* Deductions Section */}
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold text-foreground border-b border-divider pb-2">Deductions</h3>
                    <HRMSInput
                      type="number"
                      label="PF"
                      value={editFormData.deductions?.pf || 0}
                      onChange={(e) => handleEditFieldChange('deductions', 'pf', e.target.value)}
                    />
                    <HRMSInput
                      type="number"
                      label="ESI"
                      value={editFormData.deductions?.esi || 0}
                      onChange={(e) => handleEditFieldChange('deductions', 'esi', e.target.value)}
                    />
                    <HRMSInput
                      type="number"
                      label="Professional Tax"
                      value={editFormData.deductions?.professionalTax || 0}
                      onChange={(e) => handleEditFieldChange('deductions', 'professionalTax', e.target.value)}
                    />
                    <HRMSInput
                      type="number"
                      label="TDS"
                      value={editFormData.deductions?.tds || 0}
                      onChange={(e) => handleEditFieldChange('deductions', 'tds', e.target.value)}
                    />
                    <HRMSInput
                      type="number"
                      label="Late Deduction"
                      value={editFormData.deductions?.lateDeduction || 0}
                      onChange={(e) => handleEditFieldChange('deductions', 'lateDeduction', e.target.value)}
                    />
                    <HRMSInput
                      type="number"
                      label="Other Deductions"
                      value={editFormData.deductions?.other || 0}
                      onChange={(e) => handleEditFieldChange('deductions', 'other', e.target.value)}
                    />
                  </div>
                </div>

                {/* Attendance Section */}
                <div className="mt-6 grid grid-cols-3 gap-4">
                  <HRMSInput
                    type="number"
                    label="Present Days"
                    value={editFormData.presentDays || 0}
                    onChange={(e) => handleEditFieldChange('attendance', 'presentDays', e.target.value)}
                  />
                  <HRMSInput
                    type="number"
                    label="Absent Days"
                    value={editFormData.absentDays || 0}
                    onChange={(e) => handleEditFieldChange('attendance', 'absentDays', e.target.value)}
                  />
                  <HRMSInput
                    type="number"
                    label="Leave Days"
                    value={editFormData.leaveDays || 0}
                    onChange={(e) => handleEditFieldChange('attendance', 'leaveDays', e.target.value)}
                  />
                </div>

                {/* Status */}
                <div className="mt-6">
                  <HRMSSelect
                    label="Status"
                    selectedKeys={[editFormData.status || 'draft']}
                    onSelectionChange={(keys) => handleEditFieldChange('status', 'status', Array.from(keys)[0])}
                  >
                    <HRMSSelectItem key="draft">Draft</HRMSSelectItem>
                    <HRMSSelectItem key="processed">Processed</HRMSSelectItem>
                    <HRMSSelectItem key="paid">Paid</HRMSSelectItem>
                    <HRMSSelectItem key="on-hold">On Hold</HRMSSelectItem>
                  </HRMSSelect>
                </div>

                {/* Summary */}
                <HRMSCard className="mt-6 bg-default-50">
                  <HRMSCardBody>
                    <h3 className="text-lg font-semibold text-foreground mb-4">Summary</h3>
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <p className="text-sm text-default-500">Gross Salary</p>
                        <p className="text-xl font-bold text-foreground">{formatCurrency(editFormData.grossSalary)}</p>
                      </div>
                      <div>
                        <p className="text-sm text-default-500">Total Deductions</p>
                        <p className="text-xl font-bold text-danger">{formatCurrency(editFormData.totalDeductions)}</p>
                      </div>
                      <div>
                        <p className="text-sm text-default-500">Net Salary</p>
                        <p className="text-xl font-bold text-success">{formatCurrency(editFormData.netSalary)}</p>
                      </div>
                    </div>
                  </HRMSCardBody>
                </HRMSCard>
              </HRMSModalBody>
              <HRMSModalFooter>
                <SecondaryButton onPress={onClose}>
                  Cancel
                </SecondaryButton>
                <PrimaryButton
                  onPress={handleSaveEdit}
                  isLoading={saveEditMutation.isLoading}
                >
                  {saveEditMutation.isLoading ? 'Saving...' : 'Save Changes'}
                </PrimaryButton>
              </HRMSModalFooter>
            </>
          )}
        </HRMSModalContent>
      </HRMSModal>

      {/* Bank Sheet Export Modal */}
      <HRMSModal
        isOpen={bankSheetModal.isOpen}
        onOpenChange={bankSheetModal.onOpenChange}
        size="lg"
      >
        <HRMSModalContent>
          {(onClose) => (
            <>
              <HRMSModalHeader className="flex items-center gap-2">
                <FaUniversity className="text-secondary" />
                <span>Export Bank Sheet</span>
              </HRMSModalHeader>
              <HRMSModalBody>
                <div className="mb-6">
                  <p className="text-sm text-default-600 mb-4">
                    Select your bank to download the salary sheet in the correct format for bulk salary transfers.
                    Only <span className="font-medium text-primary">processed</span> or <span className="font-medium text-success">paid</span> payrolls will be included.
                  </p>

                  <HRMSCard className="bg-primary-50 border border-primary-200">
                    <HRMSCardBody className="py-3">
                      <p className="text-sm text-primary-800">
                        <strong>Ready for transfer:</strong> {filteredPayrolls.filter(p => p.status === 'processed' || p.status === 'paid').length} payroll(s)
                      </p>
                      <p className="text-xs text-primary-600 mt-1">
                        Total Amount: {formatCurrency(filteredPayrolls.filter(p => p.status === 'processed' || p.status === 'paid').reduce((sum, p) => sum + (p.netSalary || 0), 0))}
                      </p>
                    </HRMSCardBody>
                  </HRMSCard>
                </div>

                <HRMSSelect
                  label="Select Bank"
                  placeholder="-- Select Bank --"
                  isRequired
                  selectedKeys={selectedBank ? [selectedBank] : []}
                  onSelectionChange={(keys) => setSelectedBank(Array.from(keys)[0] || '')}
                  description="The sheet will be formatted according to the selected bank's bulk upload requirements."
                >
                  <HRMSSelectItem key="hdfc" textValue="HDFC Bank">HDFC Bank</HRMSSelectItem>
                  <HRMSSelectItem key="icici" textValue="ICICI Bank">ICICI Bank</HRMSSelectItem>
                  <HRMSSelectItem key="axis" textValue="Axis Bank">Axis Bank</HRMSSelectItem>
                  <HRMSSelectItem key="kotak" textValue="Kotak Mahindra Bank">Kotak Mahindra Bank</HRMSSelectItem>
                  <HRMSSelectItem key="yes" textValue="Yes Bank">Yes Bank</HRMSSelectItem>
                  <HRMSSelectItem key="indusind" textValue="IndusInd Bank">IndusInd Bank</HRMSSelectItem>
                  <HRMSSelectItem key="sbi" textValue="State Bank of India">State Bank of India</HRMSSelectItem>
                  <HRMSSelectItem key="pnb" textValue="Punjab National Bank">Punjab National Bank</HRMSSelectItem>
                  <HRMSSelectItem key="bob" textValue="Bank of Baroda">Bank of Baroda</HRMSSelectItem>
                  <HRMSSelectItem key="canara" textValue="Canara Bank">Canara Bank</HRMSSelectItem>
                  <HRMSSelectItem key="union" textValue="Union Bank of India">Union Bank of India</HRMSSelectItem>
                  <HRMSSelectItem key="idbi" textValue="IDBI Bank">IDBI Bank</HRMSSelectItem>
                  <HRMSSelectItem key="federal" textValue="Federal Bank">Federal Bank</HRMSSelectItem>
                  <HRMSSelectItem key="rbl" textValue="RBL Bank">RBL Bank</HRMSSelectItem>
                  <HRMSSelectItem key="generic" textValue="Generic Format (All Banks)">Generic Format (All Banks)</HRMSSelectItem>
                </HRMSSelect>

                {selectedBank && (
                  <HRMSCard className="mt-4 bg-default-50">
                    <HRMSCardBody>
                      <h4 className="text-sm font-medium text-foreground mb-2">Sheet will include:</h4>
                      <ul className="text-xs text-default-600 space-y-1">
                        <li>• Employee Name & Code</li>
                        <li>• Bank Account Number</li>
                        <li>• IFSC Code</li>
                        <li>• Net Salary Amount</li>
                        <li>• Payment Narration/Purpose</li>
                      </ul>
                    </HRMSCardBody>
                  </HRMSCard>
                )}
              </HRMSModalBody>
              <HRMSModalFooter>
                <SecondaryButton
                  onPress={() => {
                    onClose()
                    setSelectedBank('')
                  }}
                >
                  Cancel
                </SecondaryButton>
                <PrimaryButton
                  onPress={exportBankSheet}
                  isDisabled={!selectedBank}
                  startContent={<FaFileDownload />}
                  color="secondary"
                >
                  Download Bank Sheet
                </PrimaryButton>
              </HRMSModalFooter>
            </>
          )}
        </HRMSModalContent>
      </HRMSModal>
    </div>
  )
}
