'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import { 
  FaPlus, FaSearch, FaEdit, FaTrash, FaEye, FaFilter, FaSortAmountDown, FaSortAmountUp, 
  FaExclamationTriangle, FaCheckSquare, FaSquare, FaTimes, FaBuilding, FaBriefcase, 
  FaLayerGroup, FaSave, FaUndo
} from 'react-icons/fa'
import { formatDesignation, formatDepartments, getLevelNameFromNumber } from '@/lib/formatters'

// Status options with colors
const STATUS_OPTIONS = [
  { value: 'active', label: 'Active', color: 'bg-green-100 text-green-800' },
  { value: 'inactive', label: 'Inactive', color: 'bg-gray-100 text-gray-800' },
  { value: 'probation', label: 'Probation', color: 'bg-blue-100 text-blue-800' },
  { value: 'on_leave', label: 'On Leave', color: 'bg-yellow-100 text-yellow-800' },
  { value: 'resigned', label: 'Resigned', color: 'bg-orange-100 text-orange-800' },
  { value: 'terminated', label: 'Terminated', color: 'bg-red-100 text-red-800' },
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
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalEmployees, setTotalEmployees] = useState(0)
  const [user, setUser] = useState(null)
  const [sortBy, setSortBy] = useState('createdAt')
  const [sortOrder, setSortOrder] = useState('desc')
  const [showFilters, setShowFilters] = useState(false)
  const [deleteModal, setDeleteModal] = useState({ show: false, employee: null })
  const [statusUpdating, setStatusUpdating] = useState(null)
  
  // Filter states
  const [departments, setDepartments] = useState([])
  const [designations, setDesignations] = useState([])
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
  const [managers, setManagers] = useState([])

  const getLevelName = getLevelNameFromNumber

  useEffect(() => {
    const userData = localStorage.getItem('user')
    if (userData) {
      const parsedUser = JSON.parse(userData)
      setUser(parsedUser)
    }
    fetchDepartments()
    fetchDesignations()
    fetchManagers()
  }, [])

  useEffect(() => {
    fetchEmployees()
  }, [page, search, sortBy, sortOrder, selectedDepartment, selectedDesignation, selectedLevel, selectedStatus])

  const fetchDepartments = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/departments', {
        headers: { 'Authorization': `Bearer ${token}` },
      })
      const data = await response.json()
      if (data.success) {
        setDepartments(data.data || [])
      }
    } catch (error) {
      console.error('Fetch departments error:', error)
    }
  }

  const fetchDesignations = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/designations', {
        headers: { 'Authorization': `Bearer ${token}` },
      })
      const data = await response.json()
      if (data.success) {
        setDesignations(data.data || [])
      }
    } catch (error) {
      console.error('Fetch designations error:', error)
    }
  }

  const fetchManagers = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/employees?limit=1000&status=active', {
        headers: { 'Authorization': `Bearer ${token}` },
      })
      const data = await response.json()
      if (data.success) {
        const potentialManagers = (data.data || []).filter(emp => (emp.designationLevel || 1) >= 4)
        setManagers(potentialManagers)
      }
    } catch (error) {
      console.error('Fetch managers error:', error)
    }
  }

  const fetchEmployees = async () => {
    try {
      setLoading(true)
      const token = localStorage.getItem('token')
      
      const params = new URLSearchParams({
        page: page.toString(),
        limit: '20',
        search,
        sortBy,
        sortOrder,
      })
      
      if (selectedDepartment) params.append('department', selectedDepartment)
      if (selectedDesignation) params.append('designation', selectedDesignation)
      if (selectedLevel) params.append('level', selectedLevel)
      if (selectedStatus) params.append('status', selectedStatus)
      
      const response = await fetch(`/api/employees?${params.toString()}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      const data = await response.json()

      if (data.success) {
        setEmployees(data.data)
        setTotalPages(data.pagination?.pages || 1)
        setTotalEmployees(data.pagination?.total || data.data.length)
      } else {
        toast.error(data.message || 'Failed to fetch employees')
      }
    } catch (error) {
      console.error('Fetch employees error:', error)
      toast.error('An error occurred while fetching employees')
    } finally {
      setLoading(false)
    }
  }

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

    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/employees/${employee._id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      })

      const data = await response.json()

      if (data.success) {
        toast.success(`${employee.firstName} ${employee.lastName} has been permanently deleted`)
        fetchEmployees()
        setSelectedEmployees(prev => prev.filter(id => id !== employee._id))
      } else {
        toast.error(data.message || 'Failed to delete employee')
      }
    } catch (error) {
      console.error('Delete employee error:', error)
      toast.error('An error occurred while deleting employee')
    } finally {
      setDeleteModal({ show: false, employee: null })
    }
  }

  const handleStatusChange = async (employeeId, newStatus) => {
    if (!canManageEmployees()) {
      toast.error('You do not have permission to change employee status')
      return
    }

    setStatusUpdating(employeeId)

    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/employees/${employeeId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: newStatus }),
      })

      const data = await response.json()

      if (data.success) {
        toast.success(data.message || 'Status updated successfully')
        setEmployees(prev => prev.map(emp => 
          emp._id === employeeId ? { ...emp, status: newStatus } : emp
        ))
      } else {
        toast.error(data.message || 'Failed to update status')
      }
    } catch (error) {
      console.error('Update status error:', error)
      toast.error('An error occurred while updating status')
    } finally {
      setStatusUpdating(null)
    }
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
        fetchEmployees()
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

  useEffect(() => {
    const timer = setTimeout(() => {
      if (search !== undefined) {
        fetchEmployees()
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  return (
    <div className="page-container">
      {/* Header */}
      <div className="flex md:justify-between md:items-center md:flex-row flex-col mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">Employees</h1>
          <p className="text-gray-600 mt-1">
            {canManageEmployees() ? "Manage your organization's employees" : 'View organization employees'}
            {totalEmployees > 0 && <span className="ml-2 text-primary-600 font-medium">({totalEmployees} total)</span>}
          </p>
        </div>
        <div className="flex items-center space-x-3 mt-4 md:mt-0">
          {selectedEmployees.length > 0 && canManageEmployees() && (
            <button
              onClick={() => setShowBulkEditModal(true)}
              className="btn-secondary flex items-center space-x-2 bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100"
            >
              <FaEdit />
              <span>Bulk Edit ({selectedEmployees.length})</span>
            </button>
          )}
          {canManageEmployees() && (
            <button
              onClick={() => router.push('/dashboard/employees/add')}
              className="btn-primary flex items-center space-x-2"
            >
              <FaPlus />
              <span>Add Employee</span>
            </button>
          )}
        </div>
      </div>

      {/* Search and Filters */}
      <div className="bg-white rounded-lg shadow-md p-4 mb-6">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <FaSearch className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search by name, email, or employee code..."
                value={search}
                onChange={handleSearch}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>
            <div className="flex items-center space-x-2">
              <select
                value={`${sortBy}-${sortOrder}`}
                onChange={(e) => {
                  const [field, order] = e.target.value.split('-')
                  setSortBy(field)
                  setSortOrder(order)
                  setPage(1)
                }}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              >
                <option value="firstName-asc">Name A-Z</option>
                <option value="firstName-desc">Name Z-A</option>
                <option value="createdAt-desc">Newest First</option>
                <option value="createdAt-asc">Oldest First</option>
                <option value="dateOfJoining-desc">Recently Joined</option>
                <option value="dateOfJoining-asc">Earliest Joined</option>
              </select>
              <button 
                onClick={() => setShowFilters(!showFilters)}
                className={`btn-secondary flex items-center space-x-2 ${showFilters || hasActiveFilters ? 'bg-primary-50 text-primary-700 border-primary-200' : ''}`}
              >
                <FaFilter />
                <span>Filters</span>
                {hasActiveFilters && (
                  <span className="ml-1 px-2 py-0.5 bg-primary-500 text-white text-xs rounded-full">
                    {[selectedDepartment, selectedDesignation, selectedLevel, selectedStatus].filter(Boolean).length}
                  </span>
                )}
              </button>
            </div>
          </div>

          {showFilters && (
            <div className="flex flex-col md:flex-row gap-3 pt-3 border-t border-gray-200">
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  <FaBuilding className="inline mr-1" /> Department
                </label>
                <select
                  value={selectedDepartment}
                  onChange={(e) => { setSelectedDepartment(e.target.value); setPage(1); }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                >
                  <option value="">All Departments</option>
                  {departments.map(dept => (
                    <option key={dept._id} value={dept._id}>{dept.name}</option>
                  ))}
                </select>
              </div>

              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  <FaBriefcase className="inline mr-1" /> Designation
                </label>
                <select
                  value={selectedDesignation}
                  onChange={(e) => { setSelectedDesignation(e.target.value); setPage(1); }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                >
                  <option value="">All Designations</option>
                  {designations.map(des => (
                    <option key={des._id} value={des._id}>{des.title}</option>
                  ))}
                </select>
              </div>

              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  <FaLayerGroup className="inline mr-1" /> Level
                </label>
                <select
                  value={selectedLevel}
                  onChange={(e) => { setSelectedLevel(e.target.value); setPage(1); }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                >
                  <option value="">All Levels</option>
                  {LEVEL_OPTIONS.map(level => (
                    <option key={level.value} value={level.value}>{level.label}</option>
                  ))}
                </select>
              </div>

              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Status
                </label>
                <select
                  value={selectedStatus}
                  onChange={(e) => { setSelectedStatus(e.target.value); setPage(1); }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                >
                  <option value="">All Statuses</option>
                  {STATUS_OPTIONS.map(status => (
                    <option key={status.value} value={status.value}>{status.label}</option>
                  ))}
                </select>
              </div>

              {hasActiveFilters && (
                <div className="flex items-end">
                  <button
                    onClick={clearFilters}
                    className="px-3 py-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg flex items-center space-x-1 text-sm"
                  >
                    <FaTimes />
                    <span>Clear</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {selectedEmployees.length > 0 && (
        <div className="bg-primary-50 border border-primary-200 rounded-lg p-3 mb-4 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <FaCheckSquare className="text-primary-600" />
            <span className="text-primary-800 font-medium">
              {selectedEmployees.length} employee{selectedEmployees.length !== 1 ? 's' : ''} selected
            </span>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setSelectedEmployees([])}
              className="text-primary-600 hover:text-primary-800 text-sm flex items-center space-x-1"
            >
              <FaUndo className="text-xs" />
              <span>Clear Selection</span>
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg shadow-md overflow-hidden">
        {loading ? (
          <div className="p-8 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500 mx-auto"></div>
            <p className="mt-4 text-gray-600">Loading employees...</p>
          </div>
        ) : employees.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-gray-600">No employees found</p>
            {hasActiveFilters && (
              <button onClick={clearFilters} className="mt-2 text-primary-600 hover:text-primary-800">
                Clear filters to see all employees
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    {canManageEmployees() && (
                      <th className="px-4 py-3 text-left">
                        <input
                          type="checkbox"
                          checked={isAllSelected}
                          onChange={handleSelectAll}
                          className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                        />
                      </th>
                    )}
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Employee</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Code</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Department</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Designation</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Level</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {employees.map((employee) => (
                    <tr key={employee._id} className={`hover:bg-gray-50 ${selectedEmployees.includes(employee._id) ? 'bg-primary-50' : ''}`}>
                      {canManageEmployees() && (
                        <td className="px-4 py-4">
                          <input
                            type="checkbox"
                            checked={selectedEmployees.includes(employee._id)}
                            onChange={() => handleSelectEmployee(employee._id)}
                            className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                          />
                        </td>
                      )}
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className="flex-shrink-0 h-10 w-10">
                            <div className="h-10 w-10 rounded-full bg-primary-500 flex items-center justify-center text-white font-semibold overflow-hidden">
                              {employee.profilePicture ? (
                                <img src={employee.profilePicture} alt={`${employee.firstName} ${employee.lastName}`} className="w-full h-full object-cover" />
                              ) : (
                                <span>{employee.firstName?.[0]}{employee.lastName?.[0]}</span>
                              )}
                            </div>
                          </div>
                          <div className="ml-4">
                            <div className="text-sm font-medium text-gray-900">{employee.firstName} {employee.lastName}</div>
                            <div className="text-sm text-gray-500">{employee.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{employee.employeeCode}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{formatDepartments(employee)}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{formatDesignation(employee.designation, employee)}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded-full text-xs font-medium">L{employee.designationLevel || 1}</span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {canManageEmployees() ? (
                          <select
                            value={employee.status || 'active'}
                            onChange={(e) => handleStatusChange(employee._id, e.target.value)}
                            disabled={statusUpdating === employee._id}
                            className={`px-2 py-1 text-xs font-semibold rounded-full border-0 cursor-pointer focus:ring-2 focus:ring-primary-500 ${statusUpdating === employee._id ? 'opacity-50' : ''} ${STATUS_OPTIONS.find(s => s.value === employee.status)?.color || 'bg-gray-100 text-gray-800'}`}
                          >
                            {STATUS_OPTIONS.map(option => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                        ) : (
                          <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${STATUS_OPTIONS.find(s => s.value === employee.status)?.color || 'bg-gray-100 text-gray-800'}`}>
                            {STATUS_OPTIONS.find(s => s.value === employee.status)?.label || employee.status}
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <div className="flex space-x-2">
                          {canViewEmployeeDetails() && (
                            <button onClick={() => router.push(`/dashboard/employees/${employee._id}`)} className="text-blue-600 hover:text-blue-900 p-2 rounded-lg hover:bg-blue-50 transition-colors" title="View Details">
                              <FaEye />
                            </button>
                          )}
                          {canManageEmployees() && (
                            <>
                              <button onClick={() => router.push(`/dashboard/employees/edit/${employee._id}`)} className="text-green-600 hover:text-green-900 p-2 rounded-lg hover:bg-green-50 transition-colors" title="Edit Employee">
                                <FaEdit />
                              </button>
                              <button onClick={() => handleDelete(employee)} className="text-red-600 hover:text-red-900 p-2 rounded-lg hover:bg-red-50 transition-colors" title="Permanently Delete Employee">
                                <FaTrash />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="bg-white px-4 py-3 flex items-center justify-between border-t border-gray-200 sm:px-6">
              <div className="flex-1 flex justify-between sm:hidden">
                <button onClick={() => setPage(page - 1)} disabled={page === 1} className="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50">Previous</button>
                <button onClick={() => setPage(page + 1)} disabled={page === totalPages} className="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50">Next</button>
              </div>
              <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm text-gray-700">
                    Showing <span className="font-medium">{((page - 1) * 20) + 1}</span> to <span className="font-medium">{Math.min(page * 20, totalEmployees)}</span> of <span className="font-medium">{totalEmployees}</span> employees
                  </p>
                </div>
                <div>
                  <nav className="z-0 inline-flex rounded-md shadow-sm -space-x-px">
                    <button onClick={() => setPage(page - 1)} disabled={page === 1} className="inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50">Previous</button>
                    <button onClick={() => setPage(page + 1)} disabled={page === totalPages} className="inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50">Next</button>
                  </nav>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {deleteModal.show && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 overflow-hidden">
            <div className="bg-red-50 px-6 py-4 border-b border-red-100">
              <div className="flex items-center gap-3">
                <div className="flex-shrink-0 w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
                  <FaExclamationTriangle className="text-red-600 text-lg" />
                </div>
                <h3 className="text-lg font-semibold text-red-800">Permanently Delete Employee</h3>
              </div>
            </div>
            <div className="px-6 py-4">
              <p className="text-gray-700 mb-4">Are you sure you want to <span className="font-semibold text-red-600">permanently delete</span> this employee?</p>
              {deleteModal.employee && (
                <div className="bg-gray-50 rounded-lg p-4 mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-primary-500 flex items-center justify-center text-white font-semibold overflow-hidden">
                      {deleteModal.employee.profilePicture ? (
                        <img src={deleteModal.employee.profilePicture} alt={`${deleteModal.employee.firstName} ${deleteModal.employee.lastName}`} className="w-full h-full object-cover" />
                      ) : (
                        <span>{deleteModal.employee.firstName?.[0]}{deleteModal.employee.lastName?.[0]}</span>
                      )}
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">{deleteModal.employee.firstName} {deleteModal.employee.lastName}</p>
                      <p className="text-sm text-gray-500">{deleteModal.employee.email}</p>
                      <p className="text-xs text-gray-400">{deleteModal.employee.employeeCode}</p>
                    </div>
                  </div>
                </div>
              )}
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800">
                <strong>Warning:</strong> This action cannot be undone. The employee and their user account will be permanently removed from the system.
              </div>
            </div>
            <div className="px-6 py-4 bg-gray-50 flex justify-end gap-3">
              <button onClick={() => setDeleteModal({ show: false, employee: null })} className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">Cancel</button>
              <button onClick={confirmDelete} className="px-4 py-2 text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors flex items-center gap-2">
                <FaTrash className="text-sm" />
                Delete Permanently
              </button>
            </div>
          </div>
        </div>
      )}

      {showBulkEditModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 overflow-hidden">
            <div className="bg-purple-50 px-6 py-4 border-b border-purple-100">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex-shrink-0 w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center">
                    <FaEdit className="text-purple-600 text-lg" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-purple-800">Bulk Edit Employees</h3>
                    <p className="text-sm text-purple-600">{selectedEmployees.length} employee(s) selected</p>
                  </div>
                </div>
                <button onClick={() => setShowBulkEditModal(false)} className="text-gray-400 hover:text-gray-600">
                  <FaTimes />
                </button>
              </div>
            </div>
            <div className="px-6 py-4 space-y-4">
              <p className="text-sm text-gray-600 mb-4">Only fill in the fields you want to update. Empty fields will be left unchanged.</p>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1"><FaBuilding className="inline mr-2 text-gray-400" />Department</label>
                <select value={bulkEditData.department} onChange={(e) => setBulkEditData(prev => ({ ...prev, department: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent">
                  <option value="">-- Don't change --</option>
                  {departments.map(dept => (<option key={dept._id} value={dept._id}>{dept.name}</option>))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1"><FaBriefcase className="inline mr-2 text-gray-400" />Designation</label>
                <select value={bulkEditData.designation} onChange={(e) => setBulkEditData(prev => ({ ...prev, designation: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent">
                  <option value="">-- Don't change --</option>
                  {designations.map(des => (<option key={des._id} value={des._id}>{des.name}</option>))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1"><FaLayerGroup className="inline mr-2 text-gray-400" />Level</label>
                <select value={bulkEditData.level} onChange={(e) => setBulkEditData(prev => ({ ...prev, level: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent">
                  <option value="">-- Don't change --</option>
                  {LEVEL_OPTIONS.map(level => (<option key={level.value} value={level.value}>{level.label}</option>))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                <select value={bulkEditData.status} onChange={(e) => setBulkEditData(prev => ({ ...prev, status: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent">
                  <option value="">-- Don't change --</option>
                  {STATUS_OPTIONS.map(status => (<option key={status.value} value={status.value}>{status.label}</option>))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Reporting Manager</label>
                <select value={bulkEditData.reportingManager} onChange={(e) => setBulkEditData(prev => ({ ...prev, reportingManager: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent">
                  <option value="">-- Don't change --</option>
                  {managers.map(manager => (<option key={manager._id} value={manager._id}>{manager.firstName} {manager.lastName} ({manager.employeeCode})</option>))}
                </select>
              </div>
            </div>
            <div className="px-6 py-4 bg-gray-50 flex justify-end gap-3">
              <button onClick={() => { setShowBulkEditModal(false); setBulkEditData({ department: '', designation: '', level: '', status: '', reportingManager: '' }); }} className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">Cancel</button>
              <button onClick={handleBulkEdit} disabled={bulkUpdating} className="px-4 py-2 text-white bg-purple-600 rounded-lg hover:bg-purple-700 transition-colors flex items-center gap-2 disabled:opacity-50">
                {bulkUpdating ? (<><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div><span>Updating...</span></>) : (<><FaSave className="text-sm" /><span>Update {selectedEmployees.length} Employee(s)</span></>)}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
