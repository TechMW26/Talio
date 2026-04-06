'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { Card, CardBody, CardHeader, Button, Skeleton, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Input, Select, SelectItem, Chip, Spinner, Checkbox } from '@heroui/react'
import toast from '@/utils/toast'
import { FaPlus, FaEdit, FaUsers, FaCalendarAlt, FaDownload, FaUpload, FaFileUpload, FaCheckCircle, FaTimesCircle, FaRobot } from 'react-icons/fa'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import useApiMutation from '@/hooks/useApiMutation'
import LoadingButton from '@/components/ui/LoadingButton'
import { DataErrorState } from '@/components/ui/ErrorBoundary'
import BackgroundRefreshIndicator from '@/components/ui/BackgroundRefreshIndicator'

export default function LeaveAllocationsPage() {
  const [showModal, setShowModal] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)
  const [importStep, setImportStep] = useState('upload') // 'upload' | 'preview' | 'applying'
  const [importFile, setImportFile] = useState(null)
  const [importYear, setImportYear] = useState(new Date().getFullYear())
  const [importParsing, setImportParsing] = useState(false)
  const [importPreviewData, setImportPreviewData] = useState([])
  const [importSummary, setImportSummary] = useState(null)
  const [selectedImportRows, setSelectedImportRows] = useState([])
  const [importApplying, setImportApplying] = useState(false)
  const fileInputRef = useRef(null)
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())
  const [bulkMode, setBulkMode] = useState(false)

  const [formData, setFormData] = useState({
    employee: '',
    leaveType: '',
    totalDays: '',
    year: new Date().getFullYear(),
  })

  // User from localStorage
  const user = useMemo(() => {
    if (typeof window === 'undefined') return null
    const userData = localStorage.getItem('user')
    return userData ? JSON.parse(userData) : null
  }, [])

  // Permission check
  useEffect(() => {
    if (user && !['hr', 'admin'].includes(user.role)) {
      toast.error('Access denied. Only HR and Admin can manage leave allocations.')
      window.location.href = '/dashboard'
    }
  }, [user])

  // SWR data fetching
  const { data: employeesRes, error: employeesError, isLoading: employeesLoading, isValidating: employeesValidating } = useAuthedSWR('/api/employees?limit=1000')
  const { data: leaveTypesRes, error: leaveTypesError, isLoading: leaveTypesLoading, isValidating: leaveTypesValidating } = useAuthedSWR('/api/leave/types')
  const { data: balancesRes, error: balancesError, isLoading: balancesLoading, isValidating: balancesValidating, mutate: refreshBalances } = useAuthedSWR(`/api/leave/balance?year=${selectedYear}`)

  const employees = employeesRes?.data || []
  const leaveTypes = useMemo(() => (leaveTypesRes?.data || []).filter(type => type.isActive), [leaveTypesRes])
  const leaveBalances = balancesRes?.data || []
  const loading = employeesLoading || leaveTypesLoading || balancesLoading
  const isValidating = employeesValidating || leaveTypesValidating || balancesValidating
  const error = employeesError || leaveTypesError || balancesError

  // Mutations
  const createAllocation = useApiMutation({
    method: 'POST',
    invalidateKeys: [`/api/leave/balance?year=${selectedYear}`],
    onSuccess: () => {
      toast.success('Leave allocation created successfully')
      setShowModal(false)
      resetForm()
    },
    onError: (err) => toast.error(err.message || 'Failed to create leave allocation'),
  })

  const bulkAllocation = useApiMutation({
    method: 'POST',
    invalidateKeys: [`/api/leave/balance?year=${selectedYear}`],
    onSuccess: (data) => {
      toast.success(`Bulk allocation completed for ${data.allocated || 0} employees`)
    },
    onError: (err) => toast.error(err.message || 'Failed to perform bulk allocation'),
  })

  const handleSubmit = async (e) => {
    e.preventDefault()
    await createAllocation.execute('/api/leave/balance', {
      ...formData,
      totalDays: parseInt(formData.totalDays),
      usedDays: 0,
      remainingDays: parseInt(formData.totalDays),
    })
  }

  const handleBulkAllocation = async () => {
    if (!confirm('This will allocate leave for all employees based on their leave types. Continue?')) {
      return
    }
    await bulkAllocation.execute('/api/leave/balance/bulk-allocate', { year: selectedYear })
  }

  const resetForm = () => {
    setFormData({
      employee: '',
      leaveType: '',
      totalDays: '',
      year: selectedYear,
    })
  }

  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: value
    }))
  }

  const getEmployeeBalance = (employeeId, leaveTypeId) => {
    return leaveBalances.find(balance =>
      balance.employee?._id === employeeId && balance.leaveType?._id === leaveTypeId
    )
  }

  const exportBalances = () => {
    const csvData = []
    csvData.push(['Employee Code', 'Employee Name', 'Leave Type', 'Total Days', 'Used Days', 'Remaining Days'])

    leaveBalances.forEach(balance => {
      if (balance.employee && balance.leaveType) {
        csvData.push([
          balance.employee.employeeCode || 'N/A',
          `${balance.employee.firstName || ''} ${balance.employee.lastName || ''}`,
          balance.leaveType.name || 'N/A',
          balance.totalDays || 0,
          balance.usedDays || 0,
          balance.remainingDays || 0
        ])
      }
    })

    const csvContent = csvData.map(row => row.join(',')).join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `leave-balances-${selectedYear}.csv`
    a.click()
    window.URL.revokeObjectURL(url)
  }

  // Bulk Import handlers
  const resetImport = () => {
    setImportStep('upload')
    setImportFile(null)
    setImportParsing(false)
    setImportPreviewData([])
    setImportSummary(null)
    setSelectedImportRows([])
    setImportApplying(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleImportFileChange = (e) => {
    const file = e.target.files?.[0]
    if (file) {
      const validTypes = ['text/csv', 'text/plain', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
      const validExtensions = ['.csv', '.txt', '.xls', '.xlsx']
      const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase()

      if (!validTypes.includes(file.type) && !validExtensions.includes(ext)) {
        toast.error('Please upload a CSV or text file')
        return
      }
      setImportFile(file)
    }
  }

  const handleImportParse = async () => {
    if (!importFile) {
      toast.error('Please select a file first')
      return
    }
    setImportParsing(true)
    try {
      const fd = new FormData()
      fd.append('file', importFile)
      fd.append('year', String(importYear))
      fd.append('mode', 'preview')

      const token = localStorage.getItem('token')
      const res = await fetch('/api/leave/balance/bulk-import', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        toast.error(data.message || 'Failed to parse file')
        return
      }
      setImportPreviewData(data.data)
      setImportSummary(data.summary)
      // Auto-select all matched rows
      setSelectedImportRows(
        data.data
          .map((row, idx) => (row.matched ? idx : null))
          .filter(idx => idx !== null)
      )
      setImportStep('preview')
      toast.success(`AI detected ${data.summary.matched} allocations from the file`)
    } catch (err) {
      toast.error('Failed to parse file: ' + (err.message || 'Unknown error'))
    } finally {
      setImportParsing(false)
    }
  }

  const handleImportApply = async () => {
    const allocationsToApply = selectedImportRows.map(idx => importPreviewData[idx]).filter(Boolean)
    if (allocationsToApply.length === 0) {
      toast.error('No allocations selected')
      return
    }
    setImportApplying(true)
    try {
      const fd = new FormData()
      fd.append('file', importFile)
      fd.append('year', String(importYear))
      fd.append('mode', 'apply')
      fd.append('allocations', JSON.stringify(allocationsToApply))

      const token = localStorage.getItem('token')
      const res = await fetch('/api/leave/balance/bulk-import', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        toast.error(data.message || 'Failed to apply import')
        return
      }
      toast.success(data.message)
      setShowImportModal(false)
      resetImport()
      refreshBalances()
    } catch (err) {
      toast.error('Failed to apply import: ' + (err.message || 'Unknown error'))
    } finally {
      setImportApplying(false)
    }
  }

  const toggleImportRow = (idx) => {
    setSelectedImportRows(prev =>
      prev.includes(idx) ? prev.filter(i => i !== idx) : [...prev, idx]
    )
  }

  if (error && !leaveBalances.length) {
    return <DataErrorState error={error} onRetry={() => refreshBalances()} />
  }

  if (loading && leaveBalances.length === 0) {
    return (
      <div className="p-6 pb-24 md:pb-6 space-y-6">
        <Skeleton className="h-10 w-1/3 rounded-lg" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-lg" />)}
        </div>
        <Skeleton className="h-96 rounded-lg" />
      </div>
    )
  }

  return (
    <div className="p-6 pb-24 md:pb-6">
      <BackgroundRefreshIndicator isRefreshing={isValidating && !loading} />
      {/* Header */}
      <div className="flex md:justify-between md:items-center md:flex-row flex-col mb-6">
        <div>
          <h1 className="text-3xl font-bold text-default-800">Leave Allocations</h1>
          <p className="text-default-500 mt-1">Manage employee leave balances and allocations</p>
        </div>
        <div className="flex gap-2 md:gap-3 items-center mt-4 md:mt-0 flex-nowrap">
          <Select
            selectedKeys={[String(selectedYear)]}
            onSelectionChange={(keys) => setSelectedYear(parseInt(Array.from(keys)[0]))}
            className="w-[100px] min-w-[100px]"
            size="sm"
            aria-label="Select Year"
          >
            {[2024, 2025, 2026, 2027].map(year => (
              <SelectItem key={String(year)}>{String(year)}</SelectItem>
            ))}
          </Select>

          <Button
            variant="flat"
            startContent={<FaDownload className="w-4 h-4" />}
            onPress={exportBalances}
          >
            Export
          </Button>

          <Button
            color="primary"
            variant="flat"
            startContent={<FaUsers className="w-4 h-4" />}
            onPress={handleBulkAllocation}
          >
            Bulk Allocate
          </Button>

          <Button
            color="secondary"
            variant="flat"
            startContent={<FaFileUpload className="w-4 h-4" />}
            onPress={() => {
              resetImport()
              setShowImportModal(true)
            }}
          >
            Bulk Import
          </Button>

          <Button
            color="primary"
            startContent={<FaPlus className="w-4 h-4" />}
            onPress={() => {
              resetForm()
              setShowModal(true)
            }}
          >
            Add Allocation
          </Button>
        </div>

      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
        {[
          { title: 'Total Employees', value: employees.length, color: 'primary', icon: FaUsers },
          { title: 'Leave Types', value: leaveTypes.length, color: 'success', icon: FaCalendarAlt },
          { title: 'Total Allocations', value: leaveBalances.length, color: 'secondary', icon: FaPlus },
          { title: 'Pending Allocations', value: Math.max(0, employees.length * leaveTypes.length - leaveBalances.length), color: 'warning', icon: FaEdit },
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

      {/* Leave Balances Table */}
      <Card shadow="sm">
        <CardHeader className="px-6 py-4 border-b border-default-200">
          <h2 className="text-lg font-semibold text-default-800">Employee Leave Balances - {selectedYear}</h2>
        </CardHeader>
        <CardBody className="p-0">
          {employees.length === 0 ? (
            <div className="p-8 text-center text-default-500">
              <FaUsers className="w-12 h-12 mx-auto mb-4 text-default-300" />
              <p>No employees found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-default-200">
                <thead className="bg-default-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">
                      Employee
                    </th>
                    {leaveTypes.map(leaveType => (
                      <th key={leaveType._id} className="px-6 py-3 text-center text-xs font-medium text-default-500 uppercase tracking-wider">
                        {leaveType.name}
                        <br />
                        <span className="text-xs text-default-400">({leaveType.code})</span>
                      </th>
                    ))}
                    <th className="px-6 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-content1 divide-y divide-default-200">
                  {employees.map((employee) => (
                    <tr key={employee._id} className="hover:bg-default-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className="w-10 h-10 bg-primary rounded-full flex items-center justify-center text-white font-semibold text-sm">
                            {employee.firstName?.charAt(0)}{employee.lastName?.charAt(0)}
                          </div>
                          <div className="ml-3">
                            <div className="text-sm font-medium text-default-800">
                              {employee.firstName} {employee.lastName}
                            </div>
                            <div className="text-sm text-default-500">{employee.employeeCode}</div>
                          </div>
                        </div>
                      </td>
                      {leaveTypes.map(leaveType => {
                        const balance = getEmployeeBalance(employee._id, leaveType._id)
                        return (
                          <td key={leaveType._id} className="px-6 py-4 whitespace-nowrap text-center">
                            {balance ? (
                              <div className="text-sm">
                                <div className="font-medium text-default-800">
                                  {balance.remainingDays}/{balance.totalDays}
                                </div>
                                <div className="text-xs text-default-500">
                                  Used: {balance.usedDays}
                                </div>
                              </div>
                            ) : (
                              <span className="text-default-400 text-sm">Not allocated</span>
                            )}
                          </td>
                        )
                      })}
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <Button
                          size="sm"
                          variant="light"
                          color="primary"
                          onPress={() => {
                            setFormData({
                              employee: employee._id,
                              leaveType: '',
                              totalDays: '',
                              year: selectedYear,
                            })
                            setShowModal(true)
                          }}
                        >
                          Allocate
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Modal */}
      <Modal isOpen={showModal} onOpenChange={(open) => { if (!open) { setShowModal(false); resetForm(); } }} size="lg">
        <ModalContent>
          {(onClose) => (
            <form onSubmit={(e) => { e.preventDefault(); handleSubmit(e); }}>
              <ModalHeader>
                <h2 className="text-xl font-bold text-default-800">Add Leave Allocation</h2>
              </ModalHeader>
              <ModalBody>
                <div className="space-y-4">
                  <Select
                    label="Employee"
                    placeholder="Select Employee"
                    selectedKeys={formData.employee ? [formData.employee] : []}
                    onSelectionChange={(keys) => setFormData({ ...formData, employee: Array.from(keys)[0] || '' })}
                    isRequired
                  >
                    {employees.map((employee) => (
                      <SelectItem key={employee._id}>
                        {employee.firstName} {employee.lastName} ({employee.employeeCode})
                      </SelectItem>
                    ))}
                  </Select>

                  <Select
                    label="Leave Type"
                    placeholder="Select Leave Type"
                    selectedKeys={formData.leaveType ? [formData.leaveType] : []}
                    onSelectionChange={(keys) => setFormData({ ...formData, leaveType: Array.from(keys)[0] || '' })}
                    isRequired
                  >
                    {leaveTypes.map((type) => (
                      <SelectItem key={type._id}>
                        {type.name} ({type.code}) - Max: {type.maxDaysPerYear} days
                      </SelectItem>
                    ))}
                  </Select>

                  <Input
                    type="number"
                    label="Total Days"
                    name="totalDays"
                    value={formData.totalDays}
                    onChange={handleChange}
                    min={1}
                    placeholder="Enter number of days"
                    isRequired
                  />

                  <Input
                    type="number"
                    label="Year"
                    name="year"
                    value={formData.year}
                    onChange={handleChange}
                    min={2024}
                    max={2030}
                  />
                </div>
              </ModalBody>
              <ModalFooter>
                <Button variant="flat" onPress={onClose}>
                  Cancel
                </Button>
                <LoadingButton color="primary" type="submit" isLoading={createAllocation.isLoading}>
                  {createAllocation.isLoading ? 'Creating...' : 'Create Allocation'}
                </LoadingButton>
              </ModalFooter>
            </form>
          )}
        </ModalContent>
      </Modal>

      {/* Bulk Import Modal */}
      <Modal
        isOpen={showImportModal}
        onOpenChange={(open) => {
          if (!open) {
            setShowImportModal(false)
            resetImport()
          }
        }}
        size="3xl"
        scrollBehavior="inside"
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex flex-col gap-1">
                <h2 className="text-xl font-bold text-default-800 flex items-center gap-2">
                  <FaRobot className="text-secondary" />
                  AI-Powered Bulk Import
                </h2>
                <p className="text-sm text-default-500 font-normal">
                  Upload a CSV/text file and AI will detect employee names, leave types, and days
                </p>
              </ModalHeader>
              <ModalBody>
                {importStep === 'upload' && (
                  <div className="space-y-6">
                    <Select
                      label="Year"
                      selectedKeys={[String(importYear)]}
                      onSelectionChange={(keys) => setImportYear(parseInt(Array.from(keys)[0]))}
                      size="sm"
                    >
                      {[2024, 2025, 2026, 2027].map(year => (
                        <SelectItem key={String(year)} textValue={String(year)}>{String(year)}</SelectItem>
                      ))}
                    </Select>

                    <div
                      className="border-2 border-dashed border-default-300 rounded-xl p-8 text-center cursor-pointer hover:border-secondary transition-colors"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".csv,.txt,.xls,.xlsx"
                        onChange={handleImportFileChange}
                        className="hidden"
                      />
                      <FaUpload className="w-10 h-10 text-default-400 mx-auto mb-3" />
                      {importFile ? (
                        <div>
                          <p className="text-default-800 font-medium">{importFile.name}</p>
                          <p className="text-default-500 text-sm mt-1">{(importFile.size / 1024).toFixed(1)} KB</p>
                        </div>
                      ) : (
                        <div>
                          <p className="text-default-800 font-medium">Click to upload or drag & drop</p>
                          <p className="text-default-500 text-sm mt-1">Supports CSV, TXT files</p>
                        </div>
                      )}
                    </div>

                    <div className="bg-default-100 rounded-lg p-4">
                      <p className="text-sm font-medium text-default-700 mb-2">Supported formats:</p>
                      <ul className="text-sm text-default-500 space-y-1">
                        <li>• CSV with columns like: Employee Name/Code, Leave Type, Days</li>
                        <li>• Any tabular text format — AI will auto-detect the structure</li>
                        <li>• Exported sheets from other HR systems</li>
                      </ul>
                    </div>
                  </div>
                )}

                {importStep === 'preview' && importPreviewData.length > 0 && (
                  <div className="space-y-4">
                    {/* Summary */}
                    <div className="flex gap-3">
                      <Chip color="success" variant="flat" startContent={<FaCheckCircle />}>
                        {importSummary?.matched || 0} matched
                      </Chip>
                      <Chip color="danger" variant="flat" startContent={<FaTimesCircle />}>
                        {importSummary?.unmatched || 0} unmatched
                      </Chip>
                      <Chip color="default" variant="flat">
                        {selectedImportRows.length} selected to import
                      </Chip>
                    </div>

                    {/* Preview Table */}
                    <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                      <table className="min-w-full divide-y divide-default-200 text-sm">
                        <thead className="bg-default-50 sticky top-0">
                          <tr>
                            <th className="px-3 py-2 text-left">
                              <Checkbox
                                isSelected={selectedImportRows.length === importPreviewData.filter(d => d.matched).length}
                                onValueChange={(checked) => {
                                  if (checked) {
                                    setSelectedImportRows(importPreviewData.map((d, i) => d.matched ? i : null).filter(i => i !== null))
                                  } else {
                                    setSelectedImportRows([])
                                  }
                                }}
                                size="sm"
                              />
                            </th>
                            <th className="px-3 py-2 text-left text-default-500 font-medium">Employee</th>
                            <th className="px-3 py-2 text-left text-default-500 font-medium">Leave Type</th>
                            <th className="px-3 py-2 text-center text-default-500 font-medium">Days</th>
                            <th className="px-3 py-2 text-center text-default-500 font-medium">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-default-100">
                          {importPreviewData.map((row, idx) => (
                            <tr key={idx} className={`${!row.matched ? 'bg-danger-50/50' : selectedImportRows.includes(idx) ? 'bg-success-50/30' : ''}`}>
                              <td className="px-3 py-2">
                                <Checkbox
                                  isSelected={selectedImportRows.includes(idx)}
                                  onValueChange={() => toggleImportRow(idx)}
                                  isDisabled={!row.matched}
                                  size="sm"
                                />
                              </td>
                              <td className="px-3 py-2">
                                {row.matched ? (
                                  <div>
                                    <span className="font-medium text-default-800">{row.employeeName}</span>
                                    {row.employeeCode && (
                                      <span className="text-default-500 ml-1">({row.employeeCode})</span>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-danger">{row.unmatchedEmployee || 'Unknown'}</span>
                                )}
                              </td>
                              <td className="px-3 py-2">
                                {row.matched ? (
                                  <span className="text-default-800">{row.leaveTypeName}</span>
                                ) : (
                                  <span className="text-danger">{row.unmatchedLeaveType || 'Unknown'}</span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-center font-medium text-default-800">{row.totalDays}</td>
                              <td className="px-3 py-2 text-center">
                                {row.matched ? (
                                  <Chip size="sm" color="success" variant="flat">Matched</Chip>
                                ) : (
                                  <Chip size="sm" color="danger" variant="flat">Unmatched</Chip>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </ModalBody>
              <ModalFooter>
                {importStep === 'upload' && (
                  <>
                    <Button variant="flat" onPress={onClose}>Cancel</Button>
                    <Button
                      color="secondary"
                      startContent={importParsing ? <Spinner size="sm" color="white" /> : <FaRobot />}
                      onPress={handleImportParse}
                      isDisabled={!importFile || importParsing}
                    >
                      {importParsing ? 'AI Detecting...' : 'Detect with AI'}
                    </Button>
                  </>
                )}
                {importStep === 'preview' && (
                  <>
                    <Button variant="flat" onPress={() => { setImportStep('upload'); setImportPreviewData([]); setImportSummary(null) }}>
                      Back
                    </Button>
                    <Button
                      color="primary"
                      startContent={importApplying ? <Spinner size="sm" color="white" /> : <FaCheckCircle />}
                      onPress={handleImportApply}
                      isDisabled={selectedImportRows.length === 0 || importApplying}
                    >
                      {importApplying ? 'Applying...' : `Import ${selectedImportRows.length} Allocations`}
                    </Button>
                  </>
                )}
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  )
}
