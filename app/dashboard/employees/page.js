'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import { FaPlus, FaSearch, FaEdit, FaTrash, FaEye, FaFilter, FaSortAmountDown, FaSortAmountUp, FaExclamationTriangle } from 'react-icons/fa'
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

export default function EmployeesPage() {
  const router = useRouter()
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [user, setUser] = useState(null)
  const [sortBy, setSortBy] = useState('createdAt')
  const [sortOrder, setSortOrder] = useState('desc')
  const [showFilters, setShowFilters] = useState(false)
  const [deleteModal, setDeleteModal] = useState({ show: false, employee: null })
  const [statusUpdating, setStatusUpdating] = useState(null) // Track which employee's status is being updated

  // Use imported getLevelNameFromNumber for level name lookup
  const getLevelName = getLevelNameFromNumber

  useEffect(() => {
    const userData = localStorage.getItem('user')
    if (userData) {
      const parsedUser = JSON.parse(userData)
      setUser(parsedUser)
    }
    fetchEmployees()
  }, [page, search, sortBy, sortOrder])

  const fetchEmployees = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch(
        `/api/employees?page=${page}&limit=10&search=${search}&sortBy=${sortBy}&sortOrder=${sortOrder}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        }
      )

      const data = await response.json()

      if (data.success) {
        setEmployees(data.data)
        setTotalPages(data.pagination.pages)
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

    // Show confirmation modal
    setDeleteModal({ show: true, employee })
  }

  const confirmDelete = async () => {
    const employee = deleteModal.employee
    if (!employee) return

    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/employees/${employee._id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      })

      const data = await response.json()

      if (data.success) {
        toast.success(`${employee.firstName} ${employee.lastName} has been permanently deleted`)
        fetchEmployees()
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
        // Update local state
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

  // Debounced search effect
  useEffect(() => {
    const timer = setTimeout(() => {
      if (search !== undefined) {
        fetchEmployees()
      }
    }, 300) // 300ms delay

    return () => clearTimeout(timer)
  }, [search])

  return (
    <div className="page-container">
      {/* Header */}
      <div className="flex md:justify-between md:items-center md:flex-row flex-col mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">Employees</h1>
          <p className="text-gray-600 mt-1">
            {canManageEmployees() ? 'Manage your organization\'s employees' : 'View organization employees'}
          </p>
        </div>
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

      {/* Search and Filters */}
      <div className="bg-white rounded-lg shadow-md p-4 mb-6">
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
            <button className="btn-secondary flex items-center space-x-2">
              <FaFilter />
              <span>Filters</span>
            </button>
          </div>
        </div>
      </div>

      {/* Employee Table */}
      <div className="bg-white rounded-lg shadow-md overflow-hidden">
        {loading ? (
          <div className="p-8 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500 mx-auto"></div>
            <p className="mt-4 text-gray-600">Loading employees...</p>
          </div>
        ) : employees.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-gray-600">No employees found</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Employee
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Code
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Department
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Designation
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {employees.map((employee) => (
                    <tr key={employee._id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className="flex-shrink-0 h-10 w-10">
                            <div className="h-10 w-10 rounded-full bg-primary-500 flex items-center justify-center text-white font-semibold overflow-hidden">
                              {employee.profilePicture ? (
                                <img
                                  src={employee.profilePicture}
                                  alt={`${employee.firstName} ${employee.lastName}`}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <span>{employee.firstName?.[0]}{employee.lastName?.[0]}</span>
                              )}
                            </div>
                          </div>
                          <div className="ml-4">
                            <div className="text-sm font-medium text-gray-900">
                              {employee.firstName} {employee.lastName}
                            </div>
                            <div className="text-sm text-gray-500">{employee.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {employee.employeeCode}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {formatDepartments(employee)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {formatDesignation(employee.designation, employee)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {canManageEmployees() ? (
                          <select
                            value={employee.status || 'active'}
                            onChange={(e) => handleStatusChange(employee._id, e.target.value)}
                            disabled={statusUpdating === employee._id}
                            className={`px-2 py-1 text-xs font-semibold rounded-full border-0 cursor-pointer focus:ring-2 focus:ring-primary-500 ${
                              statusUpdating === employee._id ? 'opacity-50' : ''
                            } ${
                              STATUS_OPTIONS.find(s => s.value === employee.status)?.color || 'bg-gray-100 text-gray-800'
                            }`}
                          >
                            {STATUS_OPTIONS.map(option => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                            STATUS_OPTIONS.find(s => s.value === employee.status)?.color || 'bg-gray-100 text-gray-800'
                          }`}>
                            {STATUS_OPTIONS.find(s => s.value === employee.status)?.label || employee.status}
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <div className="flex space-x-2">
                          {canViewEmployeeDetails() && (
                            <button
                              onClick={() => router.push(`/dashboard/employees/${employee._id}`)}
                              className="text-blue-600 hover:text-blue-900 p-2 rounded-lg hover:bg-blue-50 transition-colors"
                              title="View Details"
                            >
                              <FaEye />
                            </button>
                          )}
                          {canManageEmployees() && (
                            <>
                              <button
                                onClick={() => router.push(`/dashboard/employees/edit/${employee._id}`)}
                                className="text-green-600 hover:text-green-900 p-2 rounded-lg hover:bg-green-50 transition-colors"
                                title="Edit Employee"
                              >
                                <FaEdit />
                              </button>
                              <button
                                onClick={() => handleDelete(employee)}
                                className="text-red-600 hover:text-red-900 p-2 rounded-lg hover:bg-red-50 transition-colors"
                                title="Permanently Delete Employee"
                              >
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

            {/* Pagination */}
            <div className="bg-white px-4 py-3 flex items-center justify-between border-t border-gray-200 sm:px-6">
              <div className="flex-1 flex justify-between sm:hidden">
                <button
                  onClick={() => setPage(page - 1)}
                  disabled={page === 1}
                  className="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage(page + 1)}
                  disabled={page === totalPages}
                  className="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
                >
                  Next
                </button>
              </div>
              <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm text-gray-700">
                    Page <span className="font-medium">{page}</span> of{' '}
                    <span className="font-medium">{totalPages}</span>
                  </p>
                </div>
                <div>
                  <nav className="z-0 inline-flex rounded-md shadow-sm -space-x-px">
                    <button
                      onClick={() => setPage(page - 1)}
                      disabled={page === 1}
                      className="inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                    >
                      Previous
                    </button>
                    <button
                      onClick={() => setPage(page + 1)}
                      disabled={page === totalPages}
                      className="inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                    >
                      Next
                    </button>
                  </nav>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Delete Confirmation Modal */}
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
              <p className="text-gray-700 mb-4">
                Are you sure you want to <span className="font-semibold text-red-600">permanently delete</span> this employee?
              </p>
              {deleteModal.employee && (
                <div className="bg-gray-50 rounded-lg p-4 mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-primary-500 flex items-center justify-center text-white font-semibold overflow-hidden">
                      {deleteModal.employee.profilePicture ? (
                        <img
                          src={deleteModal.employee.profilePicture}
                          alt={`${deleteModal.employee.firstName} ${deleteModal.employee.lastName}`}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span>{deleteModal.employee.firstName?.[0]}{deleteModal.employee.lastName?.[0]}</span>
                      )}
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">
                        {deleteModal.employee.firstName} {deleteModal.employee.lastName}
                      </p>
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
              <button
                onClick={() => setDeleteModal({ show: false, employee: null })}
                className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                className="px-4 py-2 text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors flex items-center gap-2"
              >
                <FaTrash className="text-sm" />
                Delete Permanently
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

