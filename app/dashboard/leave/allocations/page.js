'use client'

import { useState, useEffect, useMemo } from 'react'
import { Card, CardBody, CardHeader, Button, Skeleton, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Input, Select, SelectItem } from '@heroui/react'
import toast from '@/utils/toast'
import { FaPlus, FaEdit, FaUsers, FaCalendarAlt, FaDownload, FaUpload } from 'react-icons/fa'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import useApiMutation from '@/hooks/useApiMutation'
import LoadingButton from '@/components/ui/LoadingButton'
import { DataErrorState } from '@/components/ui/ErrorBoundary'
import BackgroundRefreshIndicator from '@/components/ui/BackgroundRefreshIndicator'

export default function LeaveAllocationsPage() {
  const [showModal, setShowModal] = useState(false)
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
        <div className="grid grid-cols-2 md:flex md:gap-3 md:items-center md:flex-row flex-col gap-2 mt-4 md:mt-0">
          <Select
            selectedKeys={[String(selectedYear)]}
            onSelectionChange={(keys) => setSelectedYear(parseInt(Array.from(keys)[0]))}
            className="min-w-[120px]"
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
          { title: 'Pending Allocations', value: employees.length * leaveTypes.length - leaveBalances.length, color: 'warning', icon: FaEdit },
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
    </div>
  )
}
