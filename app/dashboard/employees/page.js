'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import toast from '@/utils/toast'
import { useSocket, REALTIME_EVENTS } from '@/contexts/SocketContext'
import {
  FaPlus, FaSearch, FaEdit, FaTrash, FaEye, FaFilter, FaSortAmountDown, FaSortAmountUp,
  FaExclamationTriangle, FaCheckSquare, FaSquare, FaTimes, FaBuilding, FaBriefcase,
  FaLayerGroup, FaSave, FaUndo
} from 'react-icons/fa'
import { formatDesignation, formatDepartments, getLevelNameFromNumber } from '@/lib/formatters'
import { Card, CardBody, CardHeader, Button, Chip, Skeleton, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Select, SelectItem, Input, Checkbox } from '@heroui/react'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import useApiMutation from '@/hooks/useApiMutation'
import LoadingButton from '@/components/ui/LoadingButton'
import { DataErrorState } from '@/components/ui/ErrorBoundary'
import BackgroundRefreshIndicator from '@/components/ui/BackgroundRefreshIndicator'

// Status options with Hero UI colors
const STATUS_OPTIONS = [
  { value: 'active', label: 'Active', color: 'success' },
  { value: 'inactive', label: 'Inactive', color: 'default' },
  { value: 'probation', label: 'Probation', color: 'primary' },
  { value: 'on_leave', label: 'On Leave', color: 'warning' },
  { value: 'resigned', label: 'Resigned', color: 'warning' },
  { value: 'terminated', label: 'Terminated', color: 'danger' },
]

// Level options
const LEVEL_OPTIONS = [
  { value: 1, label: 'Level 1 - Entry' },
  { value: 2, label: 'Level 2 - Junior' },
  { value: 3, label: 'Level 3 - Mid' },
  { value: 4, label: 'Level 4 - Senior' },
  { value: 5, label: 'Level 5 - Lead' },
  { value: 6, label: 'Level 6 - Manager' },
  { value: 7, label: 'Level 7 - Director' },
  { value: 8, label: 'Level 8 - VP' },
  { value: 9, label: 'Level 9 - C-Level' },
  { value: 10, label: 'Level 10 - Executive' },
]

export default function EmployeesPage() {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page, setPage] = useState(1)
  const [sortBy, setSortBy] = useState('createdAt')
  const [sortOrder, setSortOrder] = useState('desc')
  const [showFilters, setShowFilters] = useState(false)
  const [deleteModal, setDeleteModal] = useState({ show: false, employee: null })
  const [statusUpdating, setStatusUpdating] = useState(null)

  // Filter states
  const [selectedDepartment, setSelectedDepartment] = useState('')
  const [selectedDesignation, setSelectedDesignation] = useState('')
  const [selectedLevel, setSelectedLevel] = useState('')
  const [selectedStatus, setSelectedStatus] = useState('')

  // Bulk selection states
  const [selectedEmployees, setSelectedEmployees] = useState([])
  const [showBulkEditModal, setShowBulkEditModal] = useState(false)
  const [bulkEditData, setBulkEditData] = useState({
    department: '',
    designation: '',
    level: '',
    status: '',
    reportingManager: '',
  })
  const [bulkUpdating, setBulkUpdating] = useState(false)

  // Auth
  const user = useMemo(() => { try { return JSON.parse(localStorage.getItem('user')) } catch { return null } }, [])
  const accessDenied = user ? !['admin', 'hr'].includes(user.role) : false

  // Real-time updates
  const { socket, isConnected, onEmployeeCreated, onEmployeeUpdated, subscribe } = useSocket()

  const getLevelName = getLevelNameFromNumber

  // Search debounce
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(timer)
  }, [search])

  // SWR data fetching
  const employeeParams = useMemo(() => {
    const params = new URLSearchParams({ page, limit: 20 })
    if (debouncedSearch) params.set('search', debouncedSearch)
    if (sortBy) params.set('sortBy', sortBy)
    if (sortOrder) params.set('sortOrder', sortOrder)
    if (selectedDepartment) params.set('department', selectedDepartment)
    if (selectedDesignation) params.set('designation', selectedDesignation)
    if (selectedLevel) params.set('level', selectedLevel)
    if (selectedStatus) params.set('status', selectedStatus)
    return params.toString()
  }, [page, debouncedSearch, sortBy, sortOrder, selectedDepartment, selectedDesignation, selectedLevel, selectedStatus])

  const { data: employeesRes, error, isLoading, isValidating, mutate: refreshEmployees } = useAuthedSWR(
    accessDenied ? null : `/api/employees?${employeeParams}`
  )
  const employees = employeesRes?.data || []
  const totalPages = employeesRes?.pagination?.pages || 1
  const totalEmployees = employeesRes?.pagination?.total || employees.length

  const { data: deptsRes } = useAuthedSWR(accessDenied ? null : '/api/departments')
  const departments = deptsRes?.data || []

  const { data: desigsRes } = useAuthedSWR(accessDenied ? null : '/api/designations')
  const designations = desigsRes?.data || []

  const { data: managersRes } = useAuthedSWR(showBulkEditModal ? '/api/employees/managers' : null)
  const managers = managersRes?.data || []

  // Mutations
  const deleteMutation = useApiMutation({ method: 'DELETE' })
  const statusMutation = useApiMutation({ method: 'PATCH' })

  // Subscribe to real-time employee updates
  useEffect(() => {
    if (!socket || !isConnected) return

    const handleEmployeeUpdate = (data) => {
      console.log('🔄 [Employees] Real-time update received:', data)
      refreshEmployees()
    }

    const unsub1 = onEmployeeCreated?.(handleEmployeeUpdate)
    const unsub2 = onEmployeeUpdated?.(handleEmployeeUpdate)
    const unsub3 = subscribe?.(REALTIME_EVENTS.EMPLOYEE_DELETED, handleEmployeeUpdate)

    return () => {
      unsub1?.()
      unsub2?.()
      unsub3?.()
    }
  }, [socket, isConnected, refreshEmployees])

  const handleDelete = async (employee) => {
    if (!canManageEmployees()) {
      toast.error('You do not have permission to delete employees')
      return
    }
    setDeleteModal({ show: true, employee })
  }

  const confirmDelete = async () => {
    const employee = deleteModal.employee
    if (!employee) return

    const result = await deleteMutation.execute(`/api/employees/${employee._id}`, null, {
      invalidateKeys: [/^\/api\/employees/],
    })
    if (result) {
      toast.success(`${employee.firstName} ${employee.lastName} has been permanently deleted`)
      setSelectedEmployees(prev => prev.filter(id => id !== employee._id))
    } else {
      toast.error(deleteMutation.error || 'Failed to delete employee')
    }
    setDeleteModal({ show: false, employee: null })
  }

  const handleStatusChange = async (employeeId, newStatus) => {
    if (!canManageEmployees()) {
      toast.error('You do not have permission to change employee status')
      return
    }

    setStatusUpdating(employeeId)

    const result = await statusMutation.execute(`/api/employees/${employeeId}`, { status: newStatus }, {
      invalidateKeys: [/^\/api\/employees/],
    })
    if (result) {
      toast.success(result.message || 'Status updated successfully')
    } else {
      toast.error('Failed to update status')
    }
    setStatusUpdating(null)
  }

  const canManageEmployees = () => {
    return user && ['admin', 'hr'].includes(user.role)
  }

  const canViewEmployeeDetails = () => {
    return user && ['admin', 'hr', 'manager'].includes(user.role)
  }

  const handleSearch = (e) => {
    const value = e.target.value
    setSearch(value)
    setPage(1)
  }

  const clearFilters = () => {
    setSelectedDepartment('')
    setSelectedDesignation('')
    setSelectedLevel('')
    setSelectedStatus('')
    setSearch('')
    setPage(1)
  }

  const hasActiveFilters = selectedDepartment || selectedDesignation || selectedLevel || selectedStatus

  const handleSelectAll = (e) => {
    if (e.target.checked) {
      setSelectedEmployees(employees.map(emp => emp._id))
    } else {
      setSelectedEmployees([])
    }
  }

  const handleSelectEmployee = (employeeId) => {
    setSelectedEmployees(prev => {
      if (prev.includes(employeeId)) {
        return prev.filter(id => id !== employeeId)
      }
      return [...prev, employeeId]
    })
  }

  const isAllSelected = employees.length > 0 && selectedEmployees.length === employees.length

  const handleBulkEdit = async () => {
    if (selectedEmployees.length === 0) {
      toast.error('Please select at least one employee')
      return
    }

    if (!bulkEditData.department && !bulkEditData.designation && !bulkEditData.level &&
      !bulkEditData.status && !bulkEditData.reportingManager) {
      toast.error('Please select at least one field to update')
      return
    }

    setBulkUpdating(true)

    try {
      const token = localStorage.getItem('token')

      const updatePayload = {}
      if (bulkEditData.department) {
        updatePayload.department = bulkEditData.department
        updatePayload.departments = [bulkEditData.department]
      }
      if (bulkEditData.designation) updatePayload.designation = bulkEditData.designation
      if (bulkEditData.level) updatePayload.designationLevel = parseInt(bulkEditData.level)
      if (bulkEditData.status) updatePayload.status = bulkEditData.status
      if (bulkEditData.reportingManager) updatePayload.reportingManager = bulkEditData.reportingManager

      const updatePromises = selectedEmployees.map(empId =>
        fetch(`/api/employees/${empId}`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(updatePayload),
        })
      )

      const results = await Promise.all(updatePromises)
      const successCount = results.filter(r => r.ok).length
      const failCount = results.length - successCount

      if (successCount > 0) {
        toast.success(`Successfully updated ${successCount} employee(s)`)
        refreshEmployees()
        setSelectedEmployees([])
        setShowBulkEditModal(false)
        setBulkEditData({
          department: '',
          designation: '',
          level: '',
          status: '',
          reportingManager: '',
        })
      }

      if (failCount > 0) {
        toast.error(`Failed to update ${failCount} employee(s)`)
      }
    } catch (error) {
      console.error('Bulk update error:', error)
      toast.error('An error occurred while updating employees')
    } finally {
      setBulkUpdating(false)
    }
  }

  // Access denied screen for non-admin/non-hr users
  if (accessDenied) {
    return (
      <div className="page-container">
        <div className="flex flex-col items-center justify-center min-h-[60vh]">
          <div className="bg-danger-50 rounded-full p-6 mb-6">
            <FaExclamationTriangle className="w-16 h-16 text-danger" />
          </div>
          <h1 className="text-2xl font-bold text-default-800 mb-2">Access Denied</h1>
          <p className="text-default-500 text-center max-w-md mb-6">
            You don't have permission to access the Employees section.
            This page is restricted to Admin and HR users only.
          </p>
          <Button
            color="primary"
            onPress={() => router.push('/dashboard')}
          >
            Go to Dashboard
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="page-container">
      {/* Header */}
      <div className="flex md:justify-between md:items-center md:flex-row flex-col mb-6">
        <div>
          <h1 className="text-3xl font-bold text-default-800">Employees</h1>
          <p className="text-default-500 mt-1">
            {canManageEmployees() ? "Manage your organization's employees" : 'View organization employees'}
            {totalEmployees > 0 && <span className="ml-2 text-primary font-medium">({totalEmployees} total)</span>}
            <BackgroundRefreshIndicator isValidating={isValidating} />
          </p>
        </div>
        <div className="flex items-center space-x-3 mt-4 md:mt-0">
          {selectedEmployees.length > 0 && canManageEmployees() && (
            <Button
              color="secondary"
              variant="flat"
              onPress={() => setShowBulkEditModal(true)}
              startContent={<FaEdit />}
            >
              Bulk Edit ({selectedEmployees.length})
            </Button>
          )}
          {canManageEmployees() && (
            <Button
              color="primary"
              onPress={() => router.push('/dashboard/employees/add')}
              startContent={<FaPlus />}
            >
              Add Employee
            </Button>
          )}
        </div>
      </div>

      {/* Search and Filters */}
      <Card shadow="sm" className="mb-6">
        <CardBody>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col md:flex-row gap-4">
              <div className="input-with-icon flex-1">
                <FaSearch className="input-icon" />
                <input
                  type="text"
                  placeholder="Search by name, email, or employee code..."
                  value={search}
                  onChange={handleSearch}
                  className="input input-search"
                />
              </div>
              <div className="flex items-center space-x-2">
                <Select
                  selectedKeys={[`${sortBy}-${sortOrder}`]}
                  onSelectionChange={(keys) => {
                    const val = Array.from(keys)[0] || 'createdAt-desc'
                    const [field, order] = val.split('-')
                    setSortBy(field)
                    setSortOrder(order)
                    setPage(1)
                  }}
                  className="w-48"
                  size="sm"
                  aria-label="Sort by"
                >
                  <SelectItem key="firstName-asc">Name A-Z</SelectItem>
                  <SelectItem key="firstName-desc">Name Z-A</SelectItem>
                  <SelectItem key="createdAt-desc">Newest First</SelectItem>
                  <SelectItem key="createdAt-asc">Oldest First</SelectItem>
                  <SelectItem key="dateOfJoining-desc">Recently Joined</SelectItem>
                  <SelectItem key="dateOfJoining-asc">Earliest Joined</SelectItem>
                </Select>
                <Button
                  variant={showFilters || hasActiveFilters ? 'flat' : 'bordered'}
                  color={showFilters || hasActiveFilters ? 'primary' : 'default'}
                  onPress={() => setShowFilters(!showFilters)}
                  startContent={<FaFilter />}
                >
                  Filters
                  {hasActiveFilters && (
                    <Chip size="sm" color="primary" className="ml-1">
                      {[selectedDepartment, selectedDesignation, selectedLevel, selectedStatus].filter(Boolean).length}
                    </Chip>
                  )}
                </Button>
              </div>
            </div>

            {showFilters && (
              <div className="flex flex-col md:flex-row gap-3 pt-3 border-t border-default-200">
                <div className="flex-1">
                  <Select
                    label="Department"
                    labelPlacement="outside"
                    selectedKeys={selectedDepartment ? [selectedDepartment] : []}
                    onSelectionChange={(keys) => { setSelectedDepartment(Array.from(keys)[0] || ''); setPage(1); }}
                    size="sm"
                    placeholder="All Departments"
                    startContent={<FaBuilding className="text-default-400" />}
                  >
                    {departments.map(dept => (
                      <SelectItem key={dept._id}>{dept.name}</SelectItem>
                    ))}
                  </Select>
                </div>

                <div className="flex-1">
                  <Select
                    label="Designation"
                    labelPlacement="outside"
                    selectedKeys={selectedDesignation ? [selectedDesignation] : []}
                    onSelectionChange={(keys) => { setSelectedDesignation(Array.from(keys)[0] || ''); setPage(1); }}
                    size="sm"
                    placeholder="All Designations"
                    startContent={<FaBriefcase className="text-default-400" />}
                  >
                    {designations.map(des => (
                      <SelectItem key={des._id}>{des.title}</SelectItem>
                    ))}
                  </Select>
                </div>

                <div className="flex-1">
                  <Select
                    label="Level"
                    labelPlacement="outside"
                    selectedKeys={selectedLevel ? [String(selectedLevel)] : []}
                    onSelectionChange={(keys) => { setSelectedLevel(Array.from(keys)[0] || ''); setPage(1); }}
                    size="sm"
                    placeholder="All Levels"
                    startContent={<FaLayerGroup className="text-default-400" />}
                  >
                    {LEVEL_OPTIONS.map(level => (
                      <SelectItem key={String(level.value)}>{level.label}</SelectItem>
                    ))}
                  </Select>
                </div>

                <div className="flex-1">
                  <Select
                    label="Status"
                    labelPlacement="outside"
                    selectedKeys={selectedStatus ? [selectedStatus] : []}
                    onSelectionChange={(keys) => { setSelectedStatus(Array.from(keys)[0] || ''); setPage(1); }}
                    size="sm"
                    placeholder="All Statuses"
                  >
                    {STATUS_OPTIONS.map(status => (
                      <SelectItem key={status.value}>{status.label}</SelectItem>
                    ))}
                  </Select>
                </div>

                {hasActiveFilters && (
                  <div className="flex items-end">
                    <Button
                      variant="light"
                      color="default"
                      onPress={clearFilters}
                      startContent={<FaTimes />}
                      size="sm"
                    >
                      Clear
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        </CardBody>
      </Card>

      {selectedEmployees.length > 0 && (
        <Card shadow="sm" className="mb-4 bg-primary-50 border border-primary-200">
          <CardBody className="py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <FaCheckSquare className="text-primary" />
                <span className="text-primary-800 font-medium">
                  {selectedEmployees.length} employee{selectedEmployees.length !== 1 ? 's' : ''} selected
                </span>
              </div>
              <Button
                variant="light"
                color="primary"
                size="sm"
                onPress={() => setSelectedEmployees([])}
                startContent={<FaUndo className="text-xs" />}
              >
                Clear Selection
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {error && !isLoading && (
        <DataErrorState message={error.message || 'Failed to load employees'} onRetry={() => refreshEmployees()} className="mb-6" />
      )}

      <Card shadow="sm">
        <CardBody className="p-0">
          {isLoading ? (
            <div className="p-8 text-center">
              <div className="space-y-4">
                <Skeleton className="h-12 w-full rounded-lg" />
                <Skeleton className="h-12 w-full rounded-lg" />
                <Skeleton className="h-12 w-full rounded-lg" />
                <Skeleton className="h-12 w-full rounded-lg" />
                <Skeleton className="h-12 w-full rounded-lg" />
              </div>
              <p className="mt-4 text-default-500">Loading employees...</p>
            </div>
          ) : employees.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-default-500">No employees found</p>
              {hasActiveFilters && (
                <Button variant="light" color="primary" onPress={clearFilters} className="mt-2">
                  Clear filters to see all employees
                </Button>
              )}
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-default-50 border-b border-default-200">
                    <tr>
                      {canManageEmployees() && (
                        <th className="px-4 py-3 text-left">
                          <input
                            type="checkbox"
                            checked={isAllSelected}
                            onChange={handleSelectAll}
                            className="w-4 h-4 text-primary border-default-300 rounded focus:ring-primary"
                          />
                        </th>
                      )}
                      <th className="px-6 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">Employee</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">Code</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">Department</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">Designation</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">Level</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">Status</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-default-500 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-content1 divide-y divide-default-200">
                    {employees.map((employee) => (
                      <tr key={employee._id} className={`hover:bg-default-50 ${selectedEmployees.includes(employee._id) ? 'bg-primary-50' : ''}`}>
                        {canManageEmployees() && (
                          <td className="px-4 py-4">
                            <input
                              type="checkbox"
                              checked={selectedEmployees.includes(employee._id)}
                              onChange={() => handleSelectEmployee(employee._id)}
                              className="w-4 h-4 text-primary border-default-300 rounded focus:ring-primary"
                            />
                          </td>
                        )}
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="flex-shrink-0 h-10 w-10">
                              <div className="h-10 w-10 rounded-full bg-primary flex items-center justify-center text-white font-semibold overflow-hidden">
                                {employee.profilePicture ? (
                                  <img src={employee.profilePicture} alt={`${employee.firstName} ${employee.lastName}`} className="w-full h-full object-cover" />
                                ) : (
                                  <span>{employee.firstName?.[0]}{employee.lastName?.[0]}</span>
                                )}
                              </div>
                            </div>
                            <div className="ml-4">
                              <div className="text-sm font-medium text-default-800">{employee.firstName} {employee.lastName}</div>
                              <div className="text-sm text-default-500">{employee.email}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-default-800">{employee.employeeCode}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-default-800">{formatDepartments(employee)}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-default-800">{formatDesignation(employee.designation, employee)}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-default-800">
                          <Chip size="sm" variant="flat" color="default">L{employee.designationLevel || 1}</Chip>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {canManageEmployees() ? (
                            <Select
                              selectedKeys={[employee.status || 'active']}
                              onChange={(e) => handleStatusChange(employee._id, e.target.value)}
                              isDisabled={statusUpdating === employee._id}
                              aria-label="Employee Status"
                              size="sm"
                              className="min-w-[140px]"
                              classNames={{ trigger: `bg-content1 ${statusUpdating === employee._id ? 'opacity-50' : ''}` }}
                            >
                              {STATUS_OPTIONS.map(option => (
                                <SelectItem key={option.value}>{option.label}</SelectItem>
                              ))}
                            </Select>
                          ) : (
                            <Chip size="sm" color={STATUS_OPTIONS.find(s => s.value === employee.status)?.color || 'default'} variant="flat">
                              {STATUS_OPTIONS.find(s => s.value === employee.status)?.label || employee.status}
                            </Chip>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                          <div className="flex space-x-2">
                            {canViewEmployeeDetails() && (
                              <Button isIconOnly variant="light" color="primary" size="sm" onPress={() => router.push(`/dashboard/employees/${employee._id}`)} title="View Details">
                                <FaEye />
                              </Button>
                            )}
                            {canManageEmployees() && (
                              <>
                                <Button isIconOnly variant="light" color="success" size="sm" onPress={() => router.push(`/dashboard/employees/edit/${employee._id}`)} title="Edit Employee">
                                  <FaEdit />
                                </Button>
                                <Button isIconOnly variant="light" color="danger" size="sm" onPress={() => handleDelete(employee)} title="Permanently Delete Employee">
                                  <FaTrash />
                                </Button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="bg-content1 px-4 py-3 flex items-center justify-between border-t border-default-200 sm:px-6">
                <div className="flex-1 flex justify-between sm:hidden">
                  <Button variant="bordered" size="sm" isDisabled={page === 1} onPress={() => setPage(page - 1)}>Previous</Button>
                  <Button variant="bordered" size="sm" isDisabled={page === totalPages} onPress={() => setPage(page + 1)}>Next</Button>
                </div>
                <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm text-default-600">
                      Showing <span className="font-medium">{((page - 1) * 20) + 1}</span> to <span className="font-medium">{Math.min(page * 20, totalEmployees)}</span> of <span className="font-medium">{totalEmployees}</span> employees
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="bordered" size="sm" isDisabled={page === 1} onPress={() => setPage(page - 1)}>Previous</Button>
                    <Button variant="bordered" size="sm" isDisabled={page === totalPages} onPress={() => setPage(page + 1)}>Next</Button>
                  </div>
                </div>
              </div>
            </>
          )}
        </CardBody>
      </Card>

      <Modal isOpen={deleteModal.show} onOpenChange={(open) => !open && setDeleteModal({ show: false, employee: null })} size="md">
        <ModalContent>
          <ModalHeader className="bg-danger-50 border-b border-danger-100">
            <div className="flex items-center gap-3">
              <div className="flex-shrink-0 w-10 h-10 bg-danger-100 rounded-full flex items-center justify-center">
                <FaExclamationTriangle className="text-danger text-lg" />
              </div>
              <h3 className="text-lg font-semibold text-danger-800">Permanently Delete Employee</h3>
            </div>
          </ModalHeader>
          <ModalBody className="py-4">
            <p className="text-default-700 mb-4">Are you sure you want to <span className="font-semibold text-danger">permanently delete</span> this employee?</p>
            {deleteModal.employee && (
              <div className="bg-default-50 rounded-lg p-4 mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-primary flex items-center justify-center text-white font-semibold overflow-hidden">
                    {deleteModal.employee.profilePicture ? (
                      <img src={deleteModal.employee.profilePicture} alt={`${deleteModal.employee.firstName} ${deleteModal.employee.lastName}`} className="w-full h-full object-cover" />
                    ) : (
                      <span>{deleteModal.employee.firstName?.[0]}{deleteModal.employee.lastName?.[0]}</span>
                    )}
                  </div>
                  <div>
                    <p className="font-medium text-default-800">{deleteModal.employee.firstName} {deleteModal.employee.lastName}</p>
                    <p className="text-sm text-default-500">{deleteModal.employee.email}</p>
                    <p className="text-xs text-default-400">{deleteModal.employee.employeeCode}</p>
                  </div>
                </div>
              </div>
            )}
            <div className="bg-warning-50 border border-warning-200 rounded-lg p-3 text-sm text-warning-800">
              <strong>Warning:</strong> This action cannot be undone. The employee and their user account will be permanently removed from the system.
            </div>
          </ModalBody>
          <ModalFooter className="bg-default-50">
            <Button variant="bordered" onPress={() => setDeleteModal({ show: false, employee: null })}>Cancel</Button>
            <LoadingButton color="danger" onPress={confirmDelete} isLoading={deleteMutation.isLoading} loadingText="Deleting..." startContent={<FaTrash className="text-sm" />}>
              Delete Permanently
            </LoadingButton>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal isOpen={showBulkEditModal} onOpenChange={(open) => !open && setShowBulkEditModal(false)} size="lg">
        <ModalContent>
          <ModalHeader className="bg-secondary-50 border-b border-secondary-100">
            <div className="flex items-center gap-3">
              <div className="flex-shrink-0 w-10 h-10 bg-secondary-100 rounded-full flex items-center justify-center">
                <FaEdit className="text-secondary text-lg" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-secondary-800">Bulk Edit Employees</h3>
                <p className="text-sm text-secondary-600">{selectedEmployees.length} employee(s) selected</p>
              </div>
            </div>
          </ModalHeader>
          <ModalBody className="py-4 space-y-4">
            <p className="text-sm text-default-500 mb-4">Only fill in the fields you want to update. Empty fields will be left unchanged.</p>

            <Select
              label="Department"
              placeholder="-- Don't change --"
              selectedKeys={bulkEditData.department ? [bulkEditData.department] : []}
              onSelectionChange={(keys) => setBulkEditData(prev => ({ ...prev, department: Array.from(keys)[0] || '' }))}
              startContent={<FaBuilding className="text-default-400" />}
            >
              {departments.map(dept => (<SelectItem key={dept._id}>{dept.name}</SelectItem>))}
            </Select>

            <Select
              label="Designation"
              placeholder="-- Don't change --"
              selectedKeys={bulkEditData.designation ? [bulkEditData.designation] : []}
              onSelectionChange={(keys) => setBulkEditData(prev => ({ ...prev, designation: Array.from(keys)[0] || '' }))}
              startContent={<FaBriefcase className="text-default-400" />}
            >
              {designations.map(des => (<SelectItem key={des._id}>{des.name}</SelectItem>))}
            </Select>

            <Select
              label="Level"
              placeholder="-- Don't change --"
              selectedKeys={bulkEditData.level ? [String(bulkEditData.level)] : []}
              onSelectionChange={(keys) => setBulkEditData(prev => ({ ...prev, level: Array.from(keys)[0] || '' }))}
              startContent={<FaLayerGroup className="text-default-400" />}
            >
              {LEVEL_OPTIONS.map(level => (<SelectItem key={String(level.value)}>{level.label}</SelectItem>))}
            </Select>

            <Select
              label="Status"
              placeholder="-- Don't change --"
              selectedKeys={bulkEditData.status ? [bulkEditData.status] : []}
              onSelectionChange={(keys) => setBulkEditData(prev => ({ ...prev, status: Array.from(keys)[0] || '' }))}
            >
              {STATUS_OPTIONS.map(status => (<SelectItem key={status.value}>{status.label}</SelectItem>))}
            </Select>

            <Select
              label="Reporting Manager"
              placeholder="-- Don't change --"
              selectedKeys={bulkEditData.reportingManager ? [bulkEditData.reportingManager] : []}
              onSelectionChange={(keys) => setBulkEditData(prev => ({ ...prev, reportingManager: Array.from(keys)[0] || '' }))}
            >
              {managers.map(manager => (<SelectItem key={manager._id}>{manager.firstName} {manager.lastName} ({manager.employeeCode})</SelectItem>))}
            </Select>
          </ModalBody>
          <ModalFooter className="bg-default-50">
            <Button variant="bordered" onPress={() => { setShowBulkEditModal(false); setBulkEditData({ department: '', designation: '', level: '', status: '', reportingManager: '' }); }}>Cancel</Button>
            <Button color="secondary" onPress={handleBulkEdit} isLoading={bulkUpdating} startContent={!bulkUpdating && <FaSave className="text-sm" />}>
              {bulkUpdating ? 'Updating...' : `Update ${selectedEmployees.length} Employee(s)`}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  )
}
