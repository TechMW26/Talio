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
  FaUniversity, FaFileDownload
} from 'react-icons/fa'
import { getCurrentUser, getEmployeeId } from '@/utils/userHelper'
import ModalPortal from '@/components/ui/ModalPortal'
import Loader from '@/components/ui/Loader'
import * as XLSX from 'xlsx'

const ADMIN_ROLES = ['admin', 'hr', 'super_admin']

export default function PayrollPage() {
  const router = useRouter()
  const [payrolls, setPayrolls] = useState([])
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1)
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())
  const [statusFilter, setStatusFilter] = useState('all')
  const [selectedPayrolls, setSelectedPayrolls] = useState([])
  const [bulkProcessing, setBulkProcessing] = useState(false)
  const [sendEmailsOnProcess, setSendEmailsOnProcess] = useState(true)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingPayroll, setEditingPayroll] = useState(null)
  const [editFormData, setEditFormData] = useState({})
  const [deleting, setDeleting] = useState(false)
  const [showBankSheetModal, setShowBankSheetModal] = useState(false)
  const [selectedBank, setSelectedBank] = useState('')

  // Real-time updates
  const { socket, isConnected, subscribe, onPayrollUpdate } = useSocket()

  useEffect(() => {
    const parsedUser = getCurrentUser()
    if (parsedUser) {
      setUser(parsedUser)
      const adminCheck = ADMIN_ROLES.includes(parsedUser.role)
      setIsAdmin(adminCheck)
      
      if (adminCheck) {
        // Admin/HR - fetch all payrolls
        fetchAllPayrolls()
      } else {
        // Employee - fetch personal payrolls
        const empId = getEmployeeId(parsedUser)
        if (empId) {
          fetchPayrolls(empId)
        } else {
          toast.error('Employee information not found. Please logout and login again.')
          setLoading(false)
        }
      }
    } else {
      setLoading(false)
    }
  }, [selectedMonth, selectedYear])

  // Subscribe to real-time payroll updates
  useEffect(() => {
    if (!socket || !isConnected || !user) return

    const handlePayrollUpdate = (data) => {
      console.log('🔄 [Payroll] Real-time update received:', data)
      if (isAdmin) {
        fetchAllPayrolls()
      } else {
        const empId = getEmployeeId(user)
        if (empId) fetchPayrolls(empId)
      }
    }

    const unsub1 = onPayrollUpdate?.(handlePayrollUpdate)
    const unsub2 = subscribe?.(REALTIME_EVENTS.PAYROLL_UPDATE, handlePayrollUpdate)

    return () => {
      unsub1?.()
      unsub2?.()
    }
  }, [socket, isConnected, user, isAdmin, selectedMonth, selectedYear])

  const fetchAllPayrolls = async () => {
    try {
      setLoading(true)
      const token = localStorage.getItem('token')
      const params = new URLSearchParams()
      if (selectedMonth) params.append('month', selectedMonth)
      if (selectedYear) params.append('year', selectedYear)
      
      const response = await fetch(
        `/api/payroll?${params.toString()}`,
        {
          headers: { 'Authorization': `Bearer ${token}` },
        }
      )

      const data = await response.json()
      if (data.success) {
        setPayrolls(data.data)
      }
    } catch (error) {
      console.error('Fetch payroll error:', error)
      toast.error('Failed to fetch payroll records')
    } finally {
      setLoading(false)
    }
  }

  const fetchPayrolls = async (employeeId) => {
    try {
      setLoading(true)
      const token = localStorage.getItem('token')
      const response = await fetch(
        `/api/payroll?employeeId=${employeeId}`,
        {
          headers: { 'Authorization': `Bearer ${token}` },
        }
      )

      const data = await response.json()
      if (data.success) {
        setPayrolls(data.data)
      }
    } catch (error) {
      console.error('Fetch payroll error:', error)
      toast.error('Failed to fetch payroll records')
    } finally {
      setLoading(false)
    }
  }

  const filteredPayrolls = useMemo(() => {
    if (statusFilter === 'all') return payrolls
    return payrolls.filter(p => p.status === statusFilter)
  }, [payrolls, statusFilter])

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
    const statusConfig = {
      'draft': { bg: 'bg-gray-100', text: 'text-gray-800', icon: FaClock, label: 'Draft' },
      'processed': { bg: 'bg-blue-100', text: 'text-blue-800', icon: FaCheckCircle, label: 'Processed' },
      'paid': { bg: 'bg-green-100', text: 'text-green-800', icon: FaCheckCircle, label: 'Paid' },
      'on-hold': { bg: 'bg-yellow-100', text: 'text-yellow-800', icon: FaExclamationTriangle, label: 'On Hold' },
      'pending': { bg: 'bg-yellow-100', text: 'text-yellow-800', icon: FaClock, label: 'Pending' },
    }
    const config = statusConfig[status] || statusConfig['draft']
    const Icon = config.icon
    return (
      <span className={`px-2 py-1 inline-flex items-center text-xs leading-5 font-semibold rounded-full ${config.bg} ${config.text}`}>
        <Icon className="w-3 h-3 mr-1" />
        {config.label}
      </span>
    )
  }

  const handleUpdateStatus = async (payrollId, newStatus) => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/payroll/${payrollId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ status: newStatus }),
      })

      const data = await response.json()
      if (data.success) {
        toast.success(`Payroll marked as ${newStatus}`)
        // Refresh payrolls
        if (isAdmin) {
          fetchAllPayrolls()
        } else {
          const empId = getEmployeeId(user)
          if (empId) fetchPayrolls(empId)
        }
      } else {
        toast.error(data.message || 'Failed to update status')
      }
    } catch (error) {
      console.error('Update status error:', error)
      toast.error('Failed to update status')
    }
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
        fetchAllPayrolls()
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
  const exportToExcel = () => {
    if (filteredPayrolls.length === 0) {
      toast.error('No payroll records to export')
      return
    }

    const exportData = filteredPayrolls.map(p => ({
      'Employee Name': `${p.employee?.firstName || ''} ${p.employee?.lastName || ''}`,
      'Employee Code': p.employee?.employeeCode || '',
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

    const ws = XLSX.utils.json_to_sheet(exportData)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Payroll')

    // Auto-size columns
    const colWidths = Object.keys(exportData[0] || {}).map(key => ({
      wch: Math.max(key.length, 15)
    }))
    ws['!cols'] = colWidths

    const fileName = `Payroll_${getMonthName(selectedMonth)}_${selectedYear}.xlsx`
    XLSX.writeFile(wb, fileName)
    toast.success('Excel file downloaded!')
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
  const exportBankSheet = () => {
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

    const ws = XLSX.utils.json_to_sheet(exportData)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Bank Sheet')

    // Auto-size columns
    const colWidths = Object.keys(exportData[0] || {}).map(key => ({
      wch: Math.max(key.length + 2, 18)
    }))
    ws['!cols'] = colWidths

    const fileName = `BankSheet_${bankFormat?.format || 'GENERIC'}_${getMonthName(selectedMonth)}_${selectedYear}.xlsx`
    XLSX.writeFile(wb, fileName)
    toast.success(`Bank sheet downloaded for ${bankFormat?.name || 'Generic'}!`)
    setShowBankSheetModal(false)
    setSelectedBank('')
  }

  // Delete single payroll
  const handleDeletePayroll = async (payrollId) => {
    if (!confirm('Are you sure you want to delete this payroll record? This action cannot be undone.')) return

    setDeleting(true)
    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/payroll/${payrollId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      })

      const data = await response.json()
      if (data.success) {
        toast.success('Payroll deleted successfully')
        fetchAllPayrolls()
      } else {
        toast.error(data.message || 'Failed to delete payroll')
      }
    } catch (error) {
      console.error('Delete payroll error:', error)
      toast.error('Failed to delete payroll')
    } finally {
      setDeleting(false)
    }
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
        fetchAllPayrolls()
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
    setShowEditModal(true)
  }

  // Close edit modal
  const closeEditModal = () => {
    setShowEditModal(false)
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

  // Save edited payroll
  const handleSaveEdit = async () => {
    if (!editingPayroll) return

    setBulkProcessing(true)
    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/payroll/${editingPayroll._id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(editFormData),
      })

      const data = await response.json()
      if (data.success) {
        toast.success('Payroll updated successfully')
        closeEditModal()
        fetchAllPayrolls()
      } else {
        toast.error(data.message || 'Failed to update payroll')
      }
    } catch (error) {
      console.error('Update payroll error:', error)
      toast.error('Failed to update payroll')
    } finally {
      setBulkProcessing(false)
    }
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
    <div className="p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4 sm:mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-800">
            {isAdmin ? 'Process Payroll' : 'My Payroll'}
          </h1>
          <p className="text-sm sm:text-base text-gray-600 mt-1">
            {isAdmin 
              ? 'Manage and process employee payrolls' 
              : 'View your salary slips and payment history'}
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={() => router.push('/dashboard/payroll/generate')}
            className="btn-primary flex items-center justify-center space-x-2 w-full sm:w-auto"
          >
            <FaPlus />
            <span>Generate Payroll</span>
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow-md p-3 sm:p-4 mb-4 sm:mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
          <div className="flex items-center gap-2 flex-wrap">
            <FaCalendarAlt className="text-gray-400 flex-shrink-0" />
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(parseInt(e.target.value))}
              className="border border-gray-300 rounded-md px-2 sm:px-3 py-2 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 flex-1 min-w-[100px]"
            >
              {months.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(parseInt(e.target.value))}
              className="border border-gray-300 rounded-md px-2 sm:px-3 py-2 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 flex-1 min-w-[100px]"
            >
              {years.map(y => (
                <option key={y.value} value={y.value}>{y.label}</option>
              ))}
            </select>
          </div>

          {isAdmin && (
            <div className="flex items-center gap-2">
              <FaFilter className="text-gray-400 flex-shrink-0" />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="border border-gray-300 rounded-md px-2 sm:px-3 py-2 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 w-full sm:w-auto"
              >
                <option value="all">All Status</option>
                <option value="draft">Draft</option>
                <option value="processed">Processed</option>
                <option value="paid">Paid</option>
                <option value="on-hold">On Hold</option>
              </select>
            </div>
          )}

          <button
            onClick={() => isAdmin ? fetchAllPayrolls() : fetchPayrolls(getEmployeeId(user))}
            className="btn-secondary text-xs sm:text-sm w-full sm:w-auto sm:ml-auto"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Admin Stats Cards */}
      {isAdmin && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4 mb-4 sm:mb-6">
          <div className="bg-white rounded-lg shadow-md p-3 sm:p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-medium text-gray-500 uppercase">Employees</h3>
              <FaUsers className="text-blue-500 w-4 h-4" />
            </div>
            <div className="text-xl sm:text-2xl font-bold text-gray-800">{stats.total}</div>
          </div>

          <div className="bg-white rounded-lg shadow-md p-3 sm:p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-medium text-gray-500 uppercase">Total Gross</h3>
              <FaChartLine className="text-blue-500 w-4 h-4" />
            </div>
            <div className="text-base sm:text-xl font-bold text-gray-800">{formatCurrency(stats.totalGross)}</div>
          </div>

          <div className="bg-white rounded-lg shadow-md p-3 sm:p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-medium text-gray-500 uppercase">Deductions</h3>
              <FaMoneyBillWave className="text-red-500 w-4 h-4" />
            </div>
            <div className="text-base sm:text-xl font-bold text-red-600">{formatCurrency(stats.totalDeductions)}</div>
          </div>

          <div className="bg-white rounded-lg shadow-md p-3 sm:p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-medium text-gray-500 uppercase">Net Payable</h3>
              <FaFileInvoiceDollar className="text-green-500 w-4 h-4" />
            </div>
            <div className="text-base sm:text-xl font-bold text-green-600">{formatCurrency(stats.totalNet)}</div>
          </div>

          <div className="bg-white rounded-lg shadow-md p-3 sm:p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-medium text-gray-500 uppercase">Draft</h3>
              <FaClock className="text-gray-500 w-4 h-4" />
            </div>
            <div className="text-xl sm:text-2xl font-bold text-gray-600">{stats.draft}</div>
          </div>

          <div className="bg-white rounded-lg shadow-md p-3 sm:p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-medium text-gray-500 uppercase">Paid</h3>
              <FaCheckCircle className="text-green-500 w-4 h-4" />
            </div>
            <div className="text-xl sm:text-2xl font-bold text-green-600">{stats.paid}</div>
          </div>
        </div>
      )}

      {/* Employee Summary Cards */}
      {!isAdmin && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 mb-4 sm:mb-6">
          <div className="bg-white rounded-lg shadow-md p-4 sm:p-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs sm:text-sm font-medium text-gray-600">Latest Net Salary</h3>
              <FaMoneyBillWave className="text-green-500 w-5 h-5" />
            </div>
            <div className="text-2xl sm:text-3xl font-bold text-gray-800">
              {payrolls.length > 0 ? formatCurrency(payrolls[0]?.netSalary) : '₹0'}
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-md p-4 sm:p-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs sm:text-sm font-medium text-gray-600">Total Earnings</h3>
              <FaMoneyBillWave className="text-blue-500 w-5 h-5" />
            </div>
            <div className="text-2xl sm:text-3xl font-bold text-gray-800">
              {payrolls.length > 0 ? formatCurrency(payrolls[0]?.grossSalary) : '₹0'}
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-md p-4 sm:p-6 sm:col-span-2 lg:col-span-1">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs sm:text-sm font-medium text-gray-600">Total Deductions</h3>
              <FaMoneyBillWave className="text-red-500 w-5 h-5" />
            </div>
            <div className="text-2xl sm:text-3xl font-bold text-gray-800">
              {payrolls.length > 0 ? formatCurrency(payrolls[0]?.totalDeductions) : '₹0'}
            </div>
          </div>
        </div>
      )}

      {/* Bulk Action Bar - Admin Only */}
      {isAdmin && (
        <div className="bg-white rounded-lg shadow-md p-3 sm:p-4 mb-4 sm:mb-6">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <span className="text-xs sm:text-sm font-medium text-gray-700">
                {selectedPayrolls.length} of {filteredPayrolls.length} selected
              </span>
              <label className="flex items-center gap-2 text-xs sm:text-sm text-gray-600">
                <input
                  type="checkbox"
                  checked={sendEmailsOnProcess}
                  onChange={(e) => setSendEmailsOnProcess(e.target.checked)}
                  className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                <span className="whitespace-nowrap">Send email payslips</span>
              </label>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:flex lg:flex-wrap gap-2">
              <button
                onClick={() => handleBulkProcess('processed')}
                disabled={selectedPayrolls.length === 0 || bulkProcessing}
                className="btn-primary text-xs sm:text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1 px-2 sm:px-4 py-2"
              >
                <FaCheckCircle className="w-3 h-3 sm:w-4 sm:h-4" />
                <span className="hidden sm:inline">{bulkProcessing ? 'Processing...' : 'Process Selected'}</span>
                <span className="sm:hidden">Process</span>
              </button>
              <button
                onClick={() => handleBulkProcess('paid')}
                disabled={selectedPayrolls.length === 0 || bulkProcessing}
                className="bg-green-600 hover:bg-green-700 text-white px-2 sm:px-4 py-2 rounded-md text-xs sm:text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1"
              >
                <FaMoneyBillWave className="w-3 h-3 sm:w-4 sm:h-4" />
                <span className="hidden sm:inline">Mark Paid</span>
                <span className="sm:hidden">Paid</span>
              </button>
              <button
                onClick={handleBulkDelete}
                disabled={selectedPayrolls.length === 0 || bulkProcessing}
                className="bg-red-600 hover:bg-red-700 text-white px-2 sm:px-4 py-2 rounded-md text-xs sm:text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1"
              >
                <FaTrash className="w-3 h-3 sm:w-4 sm:h-4" />
                <span className="hidden sm:inline">Delete Selected</span>
                <span className="sm:hidden">Delete</span>
              </button>
              <button
                onClick={() => setShowBankSheetModal(true)}
                disabled={filteredPayrolls.length === 0}
                className="bg-purple-600 hover:bg-purple-700 text-white px-2 sm:px-4 py-2 rounded-md text-xs sm:text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1"
              >
                <FaUniversity className="w-3 h-3 sm:w-4 sm:h-4" />
                <span className="hidden sm:inline">Bank Sheet</span>
                <span className="sm:hidden">Bank</span>
              </button>
              <button
                onClick={exportToExcel}
                disabled={filteredPayrolls.length === 0}
                className="bg-gray-600 hover:bg-gray-700 text-white px-2 sm:px-4 py-2 rounded-md text-xs sm:text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1 col-span-2 sm:col-span-1"
              >
                <FaDownload className="w-3 h-3 sm:w-4 sm:h-4" />
                <span className="hidden sm:inline">Export Excel</span>
                <span className="sm:hidden">Export</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Payroll Table */}
      <div className="bg-white rounded-lg shadow-md overflow-hidden">
        <div className="p-3 sm:p-4 border-b border-gray-200">
          <h2 className="text-base sm:text-xl font-semibold text-gray-800">
            {isAdmin ? `Payroll Records - ${getMonthName(selectedMonth)} ${selectedYear}` : 'Salary Slips'}
          </h2>
        </div>

        {loading ? (
          <div className="p-8 text-center">
            <Loader size="lg" />
            <p className="mt-4 text-sm sm:text-base text-gray-600">Loading payroll records...</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px]">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {isAdmin && (
                    <th className="px-2 sm:px-4 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={selectedPayrolls.length === filteredPayrolls.length && filteredPayrolls.length > 0}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedPayrolls(filteredPayrolls.map(p => p._id));
                          } else {
                            setSelectedPayrolls([]);
                          }
                        }}
                        className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      />
                    </th>
                  )}
                  {isAdmin && (
                    <th className="px-2 sm:px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Employee
                    </th>
                  )}
                  <th className="px-2 sm:px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                    Month/Year
                  </th>
                  <th className="px-2 sm:px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                    Gross
                  </th>
                  <th className="px-2 sm:px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                    Deductions
                  </th>
                  <th className="px-2 sm:px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                    Net Salary
                  </th>
                  <th className="px-2 sm:px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-2 sm:px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredPayrolls.length === 0 ? (
                  <tr>
                    <td colSpan={isAdmin ? 8 : 6} className="px-6 py-8 text-center text-gray-500">
                      <FaFileInvoiceDollar className="w-12 h-12 mx-auto text-gray-300 mb-3" />
                      <p className="text-lg font-medium">No payroll records found</p>
                      <p className="text-sm text-gray-400 mt-1">
                        {isAdmin 
                          ? 'Generate payroll for employees to see records here' 
                          : 'Your payroll records will appear here once processed'}
                      </p>
                      {isAdmin && (
                        <button
                          onClick={() => router.push('/dashboard/payroll/generate')}
                          className="mt-4 btn-primary"
                        >
                          Generate Payroll
                        </button>
                      )}
                    </td>
                  </tr>
                ) : (
                  filteredPayrolls.map((payroll) => (
                    <tr key={payroll._id} className="hover:bg-gray-50">
                      {isAdmin && (
                        <td className="px-2 sm:px-4 py-3 sm:py-4 text-center">
                          <input
                            type="checkbox"
                            checked={selectedPayrolls.includes(payroll._id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedPayrolls([...selectedPayrolls, payroll._id]);
                              } else {
                                setSelectedPayrolls(selectedPayrolls.filter(id => id !== payroll._id));
                              }
                            }}
                            className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                          />
                        </td>
                      )}
                      {isAdmin && (
                        <td className="px-2 sm:px-4 py-3 sm:py-4 whitespace-nowrap">
                          <div className="font-medium text-gray-900 text-xs sm:text-sm">
                            {payroll.employee?.firstName} {payroll.employee?.lastName}
                          </div>
                          <div className="text-xs text-gray-500">
                            {payroll.employee?.employeeCode}
                          </div>
                        </td>
                      )}
                      <td className="px-2 sm:px-4 py-3 sm:py-4 whitespace-nowrap text-xs sm:text-sm text-gray-900">
                        {getMonthName(payroll.month)} {payroll.year}
                      </td>
                      <td className="px-2 sm:px-4 py-3 sm:py-4 whitespace-nowrap text-xs sm:text-sm text-right text-gray-900">
                        {formatCurrency(payroll.grossSalary)}
                      </td>
                      <td className="px-2 sm:px-4 py-3 sm:py-4 whitespace-nowrap text-xs sm:text-sm text-right text-red-600">
                        {formatCurrency(payroll.totalDeductions)}
                      </td>
                      <td className="px-2 sm:px-4 py-3 sm:py-4 whitespace-nowrap text-xs sm:text-sm text-right font-semibold text-green-600">
                        {formatCurrency(payroll.netSalary)}
                      </td>
                      <td className="px-2 sm:px-4 py-3 sm:py-4 whitespace-nowrap text-center">
                        {getStatusBadge(payroll.status)}
                      </td>
                      <td className="px-2 sm:px-4 py-3 sm:py-4 whitespace-nowrap text-center">
                        <div className="flex items-center justify-center gap-1 sm:gap-2">
                          <button
                            onClick={() => router.push(`/dashboard/payroll/payslips/${payroll._id}`)}
                            className="text-blue-600 hover:text-blue-900 p-1 hover:bg-blue-50 rounded"
                            title="View Payslip"
                          >
                            <FaEye className="w-3 h-3 sm:w-4 sm:h-4" />
                          </button>
                          <button
                            className="text-green-600 hover:text-green-900 p-1 hover:bg-green-50 rounded"
                            title="Download Payslip"
                          >
                            <FaDownload className="w-3 h-3 sm:w-4 sm:h-4" />
                          </button>
                          {isAdmin && (
                            <>
                              <button
                                onClick={() => openEditModal(payroll)}
                                className="text-yellow-600 hover:text-yellow-900 p-1 hover:bg-yellow-50 rounded"
                                title="Edit Payroll"
                              >
                                <FaEdit className="w-3 h-3 sm:w-4 sm:h-4" />
                              </button>
                              <button
                                onClick={() => handleDeletePayroll(payroll._id)}
                                disabled={deleting}
                                className="text-red-600 hover:text-red-900 p-1 disabled:opacity-50 hover:bg-red-50 rounded"
                                title="Delete Payroll"
                              >
                                <FaTrash className="w-3 h-3 sm:w-4 sm:h-4" />
                              </button>
                            </>
                          )}
                          {isAdmin && payroll.status === 'draft' && (
                            <button
                              onClick={() => handleUpdateStatus(payroll._id, 'processed')}
                              className="text-xs bg-blue-500 text-white px-2 py-1 rounded hover:bg-blue-600"
                              title="Mark as Processed"
                            >
                              Process
                            </button>
                          )}
                          {isAdmin && payroll.status === 'processed' && (
                            <button
                              onClick={() => handleUpdateStatus(payroll._id, 'paid')}
                              className="text-xs bg-green-500 text-white px-2 py-1 rounded hover:bg-green-600"
                              title="Mark as Paid"
                            >
                              Mark Paid
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Edit Payroll Modal */}
      <ModalPortal isOpen={showEditModal}>
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && closeEditModal()}>
          <div className="modal-backdrop" />
          <div className="modal-container modal-lg">
            <div className="modal-header">
              <h2 className="modal-title">
                Edit Payroll - {editingPayroll?.employee?.firstName} {editingPayroll?.employee?.lastName}
              </h2>
              <button onClick={closeEditModal} className="modal-close-btn">
                <FaTimes className="w-5 h-5" />
              </button>
            </div>
            <div className="modal-body">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Earnings Section */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-gray-800 border-b pb-2">Earnings</h3>
                  <div>
                    <label className="modal-label">Basic Salary</label>
                    <input
                      type="number"
                      value={editFormData.earnings?.basic || 0}
                      onChange={(e) => handleEditFieldChange('earnings', 'basic', e.target.value)}
                      className="modal-input"
                    />
                  </div>
                  <div>
                    <label className="modal-label">HRA</label>
                    <input
                      type="number"
                      value={editFormData.earnings?.hra || 0}
                      onChange={(e) => handleEditFieldChange('earnings', 'hra', e.target.value)}
                      className="modal-input"
                    />
                  </div>
                  <div>
                    <label className="modal-label">Conveyance</label>
                    <input
                      type="number"
                      value={editFormData.earnings?.conveyance || 0}
                      onChange={(e) => handleEditFieldChange('earnings', 'conveyance', e.target.value)}
                      className="modal-input"
                    />
                  </div>
                  <div>
                    <label className="modal-label">Medical Allowance</label>
                    <input
                      type="number"
                      value={editFormData.earnings?.medicalAllowance || 0}
                      onChange={(e) => handleEditFieldChange('earnings', 'medicalAllowance', e.target.value)}
                      className="modal-input"
                    />
                  </div>
                  <div>
                    <label className="modal-label">Special Allowance</label>
                    <input
                      type="number"
                      value={editFormData.earnings?.specialAllowance || 0}
                      onChange={(e) => handleEditFieldChange('earnings', 'specialAllowance', e.target.value)}
                      className="modal-input"
                    />
                  </div>
                  <div>
                    <label className="modal-label">Overtime</label>
                    <input
                      type="number"
                      value={editFormData.earnings?.overtime || 0}
                      onChange={(e) => handleEditFieldChange('earnings', 'overtime', e.target.value)}
                      className="modal-input"
                    />
                  </div>
                  <div>
                    <label className="modal-label">Bonus</label>
                    <input
                      type="number"
                      value={editFormData.earnings?.bonus || 0}
                      onChange={(e) => handleEditFieldChange('earnings', 'bonus', e.target.value)}
                      className="modal-input"
                    />
                  </div>
                </div>

                {/* Deductions Section */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-gray-800 border-b pb-2">Deductions</h3>
                  <div>
                    <label className="modal-label">PF</label>
                    <input
                      type="number"
                      value={editFormData.deductions?.pf || 0}
                      onChange={(e) => handleEditFieldChange('deductions', 'pf', e.target.value)}
                      className="modal-input"
                    />
                  </div>
                  <div>
                    <label className="modal-label">ESI</label>
                    <input
                      type="number"
                      value={editFormData.deductions?.esi || 0}
                      onChange={(e) => handleEditFieldChange('deductions', 'esi', e.target.value)}
                      className="modal-input"
                    />
                  </div>
                  <div>
                    <label className="modal-label">Professional Tax</label>
                    <input
                      type="number"
                      value={editFormData.deductions?.professionalTax || 0}
                      onChange={(e) => handleEditFieldChange('deductions', 'professionalTax', e.target.value)}
                      className="modal-input"
                    />
                  </div>
                  <div>
                    <label className="modal-label">TDS</label>
                    <input
                      type="number"
                      value={editFormData.deductions?.tds || 0}
                      onChange={(e) => handleEditFieldChange('deductions', 'tds', e.target.value)}
                      className="modal-input"
                    />
                  </div>
                  <div>
                    <label className="modal-label">Late Deduction</label>
                    <input
                      type="number"
                      value={editFormData.deductions?.lateDeduction || 0}
                      onChange={(e) => handleEditFieldChange('deductions', 'lateDeduction', e.target.value)}
                      className="modal-input"
                    />
                  </div>
                  <div>
                    <label className="modal-label">Other Deductions</label>
                    <input
                      type="number"
                      value={editFormData.deductions?.other || 0}
                      onChange={(e) => handleEditFieldChange('deductions', 'other', e.target.value)}
                      className="modal-input"
                    />
                  </div>
                </div>
              </div>

              {/* Attendance Section */}
              <div className="mt-6 grid grid-cols-3 gap-4">
                <div>
                  <label className="modal-label">Present Days</label>
                  <input
                    type="number"
                    value={editFormData.presentDays || 0}
                    onChange={(e) => handleEditFieldChange('attendance', 'presentDays', e.target.value)}
                    className="modal-input"
                  />
                </div>
                <div>
                  <label className="modal-label">Absent Days</label>
                  <input
                    type="number"
                    value={editFormData.absentDays || 0}
                    onChange={(e) => handleEditFieldChange('attendance', 'absentDays', e.target.value)}
                    className="modal-input"
                  />
                </div>
                <div>
                  <label className="modal-label">Leave Days</label>
                  <input
                    type="number"
                    value={editFormData.leaveDays || 0}
                    onChange={(e) => handleEditFieldChange('attendance', 'leaveDays', e.target.value)}
                    className="modal-input"
                  />
                </div>
              </div>

              {/* Status */}
              <div className="mt-6">
                <label className="modal-label">Status</label>
                <select
                  value={editFormData.status || 'draft'}
                  onChange={(e) => handleEditFieldChange('status', 'status', e.target.value)}
                  className="modal-input"
                >
                  <option value="draft">Draft</option>
                  <option value="processed">Processed</option>
                  <option value="paid">Paid</option>
                  <option value="on-hold">On Hold</option>
                </select>
              </div>

              {/* Summary */}
              <div className="mt-6 bg-gray-50 rounded-lg p-4">
                <h3 className="text-lg font-semibold text-gray-800 mb-4">Summary</h3>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <p className="text-sm text-gray-500">Gross Salary</p>
                    <p className="text-xl font-bold text-gray-800">{formatCurrency(editFormData.grossSalary)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Total Deductions</p>
                    <p className="text-xl font-bold text-red-600">{formatCurrency(editFormData.totalDeductions)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Net Salary</p>
                    <p className="text-xl font-bold text-green-600">{formatCurrency(editFormData.netSalary)}</p>
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                onClick={closeEditModal}
                className="modal-btn modal-btn-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                disabled={bulkProcessing}
                className="modal-btn modal-btn-primary"
              >
                {bulkProcessing ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      </ModalPortal>

      {/* Bank Sheet Export Modal */}
      <ModalPortal isOpen={showBankSheetModal}>
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setShowBankSheetModal(false)}>
          <div className="modal-backdrop" />
          <div className="modal-container modal-md">
            <div className="modal-header">
              <h2 className="modal-title flex items-center space-x-2">
                <FaUniversity className="text-purple-600" />
                <span>Export Bank Sheet</span>
              </h2>
              <button onClick={() => setShowBankSheetModal(false)} className="modal-close-btn">
                <FaTimes className="w-5 h-5" />
              </button>
            </div>
            <div className="modal-body">
              <div className="mb-6">
                <p className="text-sm text-gray-600 mb-4">
                  Select your bank to download the salary sheet in the correct format for bulk salary transfers.
                  Only <span className="font-medium text-blue-600">processed</span> or <span className="font-medium text-green-600">paid</span> payrolls will be included.
                </p>
                
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
                  <p className="text-sm text-blue-800">
                    <strong>Ready for transfer:</strong> {filteredPayrolls.filter(p => p.status === 'processed' || p.status === 'paid').length} payroll(s)
                  </p>
                  <p className="text-xs text-blue-600 mt-1">
                    Total Amount: {formatCurrency(filteredPayrolls.filter(p => p.status === 'processed' || p.status === 'paid').reduce((sum, p) => sum + (p.netSalary || 0), 0))}
                  </p>
                </div>
              </div>

              <div>
                <label className="modal-label">Select Bank *</label>
                <select
                  value={selectedBank}
                  onChange={(e) => setSelectedBank(e.target.value)}
                  className="modal-input"
                >
                  <option value="">-- Select Bank --</option>
                  <optgroup label="Major Private Banks">
                    <option value="hdfc">HDFC Bank</option>
                    <option value="icici">ICICI Bank</option>
                    <option value="axis">Axis Bank</option>
                    <option value="kotak">Kotak Mahindra Bank</option>
                    <option value="yes">Yes Bank</option>
                    <option value="indusind">IndusInd Bank</option>
                  </optgroup>
                  <optgroup label="Public Sector Banks">
                    <option value="sbi">State Bank of India</option>
                    <option value="pnb">Punjab National Bank</option>
                    <option value="bob">Bank of Baroda</option>
                    <option value="canara">Canara Bank</option>
                    <option value="union">Union Bank of India</option>
                    <option value="idbi">IDBI Bank</option>
                  </optgroup>
                  <optgroup label="Other Banks">
                    <option value="federal">Federal Bank</option>
                    <option value="rbl">RBL Bank</option>
                    <option value="generic">Generic Format (All Banks)</option>
                  </optgroup>
                </select>
                <p className="text-xs text-gray-500 mt-2">
                  The sheet will be formatted according to the selected bank's bulk upload requirements.
                </p>
              </div>

              {selectedBank && (
                <div className="mt-4 bg-gray-50 rounded-lg p-4">
                  <h4 className="text-sm font-medium text-gray-700 mb-2">Sheet will include:</h4>
                  <ul className="text-xs text-gray-600 space-y-1">
                    <li>• Employee Name & Code</li>
                    <li>• Bank Account Number</li>
                    <li>• IFSC Code</li>
                    <li>• Net Salary Amount</li>
                    <li>• Payment Narration/Purpose</li>
                  </ul>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button
                type="button"
                onClick={() => {
                  setShowBankSheetModal(false)
                  setSelectedBank('')
                }}
                className="modal-btn modal-btn-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={exportBankSheet}
                disabled={!selectedBank}
                className="modal-btn bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
              >
                <FaFileDownload />
                <span>Download Bank Sheet</span>
              </button>
            </div>
          </div>
        </div>
      </ModalPortal>
    </div>
  )
}