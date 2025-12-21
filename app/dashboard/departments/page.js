'use client'

import { useState, useEffect, useRef } from 'react'
import toast from 'react-hot-toast'
import { FaPlus, FaEdit, FaTrash, FaBuilding, FaUsers, FaTimes, FaUserTie, FaSearch } from 'react-icons/fa'

export default function DepartmentsPage() {
  const [departments, setDepartments] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingDept, setEditingDept] = useState(null)
  const [user, setUser] = useState(null)
  const [employees, setEmployees] = useState([])
  const [users, setUsers] = useState([]) // Fallback users list
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    code: '',
    heads: [], // Changed from head to heads array
  })
  const [headSearch, setHeadSearch] = useState('')
  const [showHeadDropdown, setShowHeadDropdown] = useState(false)
  const dropdownRef = useRef(null)

  useEffect(() => {
    const userData = localStorage.getItem('user')
    if (userData) {
      const parsedUser = JSON.parse(userData)
      setUser(parsedUser)

      // Check role-based access
      if (!['admin', 'hr'].includes(parsedUser.role)) {
        // For employees and managers, show read-only view
        fetchDepartments()
      } else {
        // For admin, admin and HR, show full management interface
        fetchDepartments()
        fetchEmployees()
        fetchUsers() // Also fetch users as fallback
      }
    }
  }, [])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowHeadDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const fetchDepartments = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/departments', {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      const data = await response.json()
      if (data.success) {
        setDepartments(data.data)
      } else {
        toast.error(data.message || 'Failed to fetch departments')
      }
    } catch (error) {
      console.error('Fetch departments error:', error)
      toast.error('Failed to fetch departments')
    } finally {
      setLoading(false)
    }
  }

  const fetchEmployees = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/employees?limit=1000', {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      const data = await response.json()
      if (data.success) {
        setEmployees(data.data || [])
      }
    } catch (error) {
      console.error('Fetch employees error:', error)
    }
  }

  const fetchUsers = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/users?limit=1000', {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      const data = await response.json()
      if (data.success) {
        setUsers(data.data || data.users || [])
      }
    } catch (error) {
      console.error('Fetch users error:', error)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    try {
      const token = localStorage.getItem('token')
      const url = editingDept
        ? `/api/departments/${editingDept._id}`
        : '/api/departments'
      const method = editingDept ? 'PUT' : 'POST'

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(formData),
      })

      const data = await response.json()

      if (data.success) {
        toast.success(data.message)
        setShowModal(false)
        setEditingDept(null)
        setFormData({ name: '', description: '', code: '', heads: [] })
        fetchDepartments()
      } else {
        toast.error(data.message)
      }
    } catch (error) {
      console.error('Submit error:', error)
      toast.error('Failed to save department')
    }
  }

  const handleEdit = (dept) => {
    setEditingDept(dept)
    // Combine legacy head with heads array for editing
    const existingHeads = []
    if (dept.heads && dept.heads.length > 0) {
      existingHeads.push(...dept.heads.map(h => h._id || h))
    } else if (dept.head) {
      existingHeads.push(dept.head._id || dept.head)
    }
    setFormData({
      name: dept.name,
      description: dept.description || '',
      code: dept.code || '',
      heads: existingHeads,
    })
    setShowModal(true)
  }

  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to delete this department?')) return

    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/departments/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      })

      const data = await response.json()

      if (data.success) {
        toast.success(data.message)
        fetchDepartments()
      } else {
        toast.error(data.message)
      }
    } catch (error) {
      console.error('Delete error:', error)
      toast.error('Failed to delete department')
    }
  }

  const handleCloseModal = () => {
    setShowModal(false)
    setEditingDept(null)
    setFormData({ name: '', description: '', code: '', heads: [] })
    setHeadSearch('')
    setShowHeadDropdown(false)
  }

  const addHead = (employee) => {
    if (!formData.heads.includes(employee._id)) {
      setFormData({ ...formData, heads: [...formData.heads, employee._id] })
    }
    setHeadSearch('')
    setShowHeadDropdown(false)
  }

  const removeHead = (headId) => {
    setFormData({ ...formData, heads: formData.heads.filter(h => h !== headId) })
  }

  const getHeadDetails = (headId) => {
    // Check employees first
    const emp = employees.find(e => e._id === headId)
    if (emp) return emp
    // Fallback to users
    const usr = users.find(u => u._id === headId || u.employeeId === headId)
    if (usr) return { 
      _id: usr._id, 
      firstName: usr.firstName || usr.email?.split('@')[0] || 'User',
      lastName: usr.lastName || '',
      employeeCode: usr.employeeId?.employeeCode || usr.email
    }
    return null
  }

  // Combine employees and users for selection
  const availablePeople = employees.length > 0 ? employees : users.map(u => ({
    _id: u._id,
    firstName: u.firstName || u.email?.split('@')[0] || 'User',
    lastName: u.lastName || '',
    employeeCode: u.email || u._id,
    email: u.email
  }))

  // Filter out already selected heads (ensure heads is always an array)
  const heads = formData.heads || []
  const unselectedPeople = availablePeople.filter(person => !heads.includes(person._id))

  // When searching, filter by search term; otherwise just show first 10
  const filteredEmployees = headSearch.trim() 
    ? unselectedPeople.filter(person => 
        `${person.firstName} ${person.lastName}`.toLowerCase().includes(headSearch.toLowerCase()) ||
        person.employeeCode?.toLowerCase().includes(headSearch.toLowerCase()) ||
        person.email?.toLowerCase().includes(headSearch.toLowerCase())
      )
    : unselectedPeople.slice(0, 10)

  const canManageDepartments = () => {
    return user && ['admin', 'hr'].includes(user.role)
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex md:justify-between md:items-center md:flex-row flex-col mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">Departments</h1>
          <p className="text-gray-600 mt-1">
            {canManageDepartments() ? 'Manage company departments' : 'View company departments'}
          </p>
        </div>
        {canManageDepartments() && (
          <button
            onClick={() => setShowModal(true)}
            className="btn-primary flex items-center space-x-2"
          >
            <FaPlus />
            <span>Add Department</span>
          </button>
        )}
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4 mb-4 sm:mb-6">
        <div className="bg-white rounded-lg shadow-md p-3 sm:p-6">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs sm:text-sm font-medium text-gray-600 truncate">Total Departments</h3>
            <FaBuilding className="text-primary-500 flex-shrink-0" />
          </div>
          <div className="text-2xl sm:text-3xl font-bold text-gray-800">{departments.length}</div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-3 sm:p-6">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs sm:text-sm font-medium text-gray-600 truncate">Active Departments</h3>
            <FaBuilding className="text-green-500 flex-shrink-0" />
          </div>
          <div className="text-2xl sm:text-3xl font-bold text-gray-800">
            {departments.filter(d => d.isActive !== false).length}
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-3 sm:p-6">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs sm:text-sm font-medium text-gray-600 truncate">Total Employees</h3>
            <FaUsers className="text-blue-500 flex-shrink-0" />
          </div>
          <div className="text-2xl sm:text-3xl font-bold text-gray-800">
            {departments.reduce((sum, d) => sum + (d.employeeCount || 0), 0)}
          </div>
        </div>
      </div>

      {/* Departments Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        {loading ? (
          <div className="col-span-full bg-white rounded-lg shadow-md p-6 sm:p-8 text-center">
            <div className="animate-spin rounded-full h-8 w-8 sm:h-12 sm:w-12 border-b-2 border-primary-500 mx-auto"></div>
            <p className="mt-4 text-gray-600 text-sm sm:text-base">Loading departments...</p>
          </div>
        ) : departments.length === 0 ? (
          <div className="col-span-full bg-white rounded-lg shadow-md p-6 sm:p-8 text-center text-gray-500">
            No departments found
          </div>
        ) : (
          departments.map((dept) => (
            <div
              key={dept._id}
              className="bg-white rounded-lg shadow-md p-3 sm:p-6 hover:shadow-lg transition-shadow"
            >
              <div className="flex items-start justify-between mb-3 sm:mb-4">
                <div className="flex items-center space-x-2 sm:space-x-3 flex-1 min-w-0">
                  <div className="bg-primary-100 p-2 sm:p-3 rounded-lg flex-shrink-0">
                    <FaBuilding className="text-primary-500 text-lg sm:text-xl" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-base sm:text-lg font-bold text-gray-800 truncate">{dept.name}</h3>
                    {dept.code && (
                      <p className="text-xs sm:text-sm text-gray-500 truncate">{dept.code}</p>
                    )}
                  </div>
                </div>
                {canManageDepartments() && (
                  <div className="flex space-x-1 sm:space-x-2 flex-shrink-0">
                    <button
                      onClick={() => handleEdit(dept)}
                      className="text-blue-600 hover:text-blue-800 p-1.5 sm:p-2 rounded-lg hover:bg-blue-50 transition-colors"
                      title="Edit Department"
                    >
                      <FaEdit className="w-3 h-3 sm:w-4 sm:h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(dept._id)}
                      className="text-red-600 hover:text-red-800 p-1.5 sm:p-2 rounded-lg hover:bg-red-50 transition-colors"
                      title="Delete Department"
                    >
                      <FaTrash className="w-3 h-3 sm:w-4 sm:h-4" />
                    </button>
                  </div>
                )}
              </div>

              {dept.description && (
                <p className="text-gray-600 text-xs sm:text-sm mb-3 sm:mb-4 line-clamp-2">{dept.description}</p>
              )}

              <div className="flex items-center justify-between pt-3 sm:pt-4 border-t border-gray-200">
                <div className="flex items-center space-x-1 sm:space-x-2 text-xs sm:text-sm text-gray-600">
                  <FaUsers className="flex-shrink-0" />
                  <span className="truncate">{dept.employeeCount || 0} Employees</span>
                </div>
                <div className="text-xs sm:text-sm text-gray-600">
                  {dept.heads && dept.heads.length > 0 ? (
                    <div className="flex items-center space-x-1">
                      <FaUserTie className="text-primary-500" />
                      <span className="truncate max-w-[100px]">
                        {dept.heads.length === 1 
                          ? `${dept.heads[0].firstName} ${dept.heads[0].lastName}`
                          : `${dept.heads.length} Heads`
                        }
                      </span>
                    </div>
                  ) : dept.head ? (
                    <div className="flex items-center space-x-1">
                      <FaUserTie className="text-primary-500" />
                      <span className="truncate max-w-[100px]">{dept.head.firstName} {dept.head.lastName}</span>
                    </div>
                  ) : null}
                </div>
              </div>
              
              {/* Show all heads if multiple */}
              {dept.heads && dept.heads.length > 1 && (
                <div className="mt-2 pt-2 border-t border-gray-100">
                  <p className="text-xs text-gray-500 mb-1">Department Heads:</p>
                  <div className="flex flex-wrap gap-1">
                    {dept.heads.map(head => (
                      <span key={head._id} className="text-xs bg-primary-50 text-primary-700 px-2 py-0.5 rounded-full">
                        {head.firstName} {head.lastName}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center style={{ zIndex: 99999 }}">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-2xl font-bold text-gray-800 mb-4">
              {editingDept ? 'Edit Department' : 'Add Department'}
            </h2>
            <form onSubmit={handleSubmit}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Department Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    placeholder="e.g., Engineering"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Department Code
                  </label>
                  <input
                    type="text"
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    placeholder="e.g., ENG"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Description
                  </label>
                  <textarea
                    rows="3"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    placeholder="Department description"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Department Heads <span className="text-gray-400 font-normal">(Optional - Multiple allowed)</span>
                  </label>
                  
                  {/* Selected heads */}
                  {formData.heads.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-2">
                      {formData.heads.map(headId => {
                        const head = getHeadDetails(headId)
                        return head ? (
                          <span 
                            key={headId} 
                            className="inline-flex items-center space-x-1 bg-primary-100 text-primary-800 px-3 py-1 rounded-full text-sm"
                          >
                            <span>{head.firstName} {head.lastName}</span>
                            <button 
                              type="button"
                              onClick={() => removeHead(headId)}
                              className="text-primary-600 hover:text-primary-800"
                            >
                              <FaTimes className="w-3 h-3" />
                            </button>
                          </span>
                        ) : null
                      })}
                    </div>
                  )}
                  
                  {/* Search and add heads */}
                  <div className="relative" ref={dropdownRef}>
                    <div className="relative">
                      <FaSearch className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                      <input
                        type="text"
                        value={headSearch}
                        onChange={(e) => {
                          setHeadSearch(e.target.value)
                          setShowHeadDropdown(true)
                        }}
                        onFocus={() => setShowHeadDropdown(true)}
                        placeholder="Search and add department heads..."
                        className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      />
                    </div>
                    
                    {showHeadDropdown && filteredEmployees.length > 0 && (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                        {filteredEmployees.slice(0, 10).map(employee => (
                          <button
                            key={employee._id}
                            type="button"
                            onClick={() => addHead(employee)}
                            className="w-full text-left px-4 py-2 hover:bg-gray-100 flex items-center justify-between text-gray-700"
                          >
                            <span className="text-gray-800">{employee.firstName} {employee.lastName}</span>
                            <span className="text-xs text-gray-500">{employee.employeeCode || employee.email}</span>
                          </button>
                        ))}
                        {!headSearch.trim() && unselectedPeople.length > 10 && (
                          <div className="px-4 py-2 text-xs text-gray-400 text-center border-t border-gray-100 bg-gray-50">
                            Type to search {unselectedPeople.length - 10} more...
                          </div>
                        )}
                      </div>
                    )}
                    
                    {showHeadDropdown && filteredEmployees.length === 0 && headSearch.trim() && (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg p-4 text-center text-gray-500 text-sm">
                        No matches found for "{headSearch}"
                      </div>
                    )}
                    
                    {showHeadDropdown && filteredEmployees.length === 0 && !headSearch.trim() && availablePeople.length === 0 && (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg p-4 text-center text-gray-500 text-sm">
                        No employees or users found. You can create the department without heads and add them later.
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    For larger departments, you can assign multiple heads. Authority is determined by employee role/level.
                  </p>
                </div>
              </div>

              <div className="flex justify-end space-x-4 mt-6">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="btn-secondary"
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary">
                  {editingDept ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

