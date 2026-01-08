'use client'

import { useState, useEffect } from 'react'
import { FaPlus, FaTrash, FaUser, FaUsers, FaSearch, FaCheck, FaTimes, FaChevronDown } from 'react-icons/fa'
import { formatDesignation } from '@/lib/formatters'
import Loader from '@/components/ui/Loader'

const TaskAssignment = ({ taskId, currentAssignees = [], onAssignmentChange, mode = 'create' }) => {
  const [employees, setEmployees] = useState([])
  const [filteredEmployees, setFilteredEmployees] = useState([])
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedEmployees, setSelectedEmployees] = useState(currentAssignees)
  const [loading, setLoading] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const [user, setUser] = useState(null)
  const [currentEmp, setCurrentEmp] = useState(null)
  const [isDepartmentHead, setIsDepartmentHead] = useState(false)
  const [activeTab, setActiveTab] = useState('myDepartment') // 'myDepartment' or 'otherDepartments'
  const [employeePage, setEmployeePage] = useState(1)
  const [employeeHasMore, setEmployeeHasMore] = useState(true)
  const [employeeLoading, setEmployeeLoading] = useState(false)

  useEffect(() => {
    const userData = localStorage.getItem('user')
    if (userData) {
      setUser(JSON.parse(userData))
    }
    fetchEmployees()
    checkDepartmentHead()
  }, [])



  useEffect(() => {
    filterEmployees()
  }, [searchTerm, employees, user, currentEmp, activeTab])

  useEffect(() => {
    if (user && employees.length) {
      const myId = user.employeeId || user.id || user._id
      const me = employees.find(e => e._id === myId)
      setCurrentEmp(me || null)
    }
  }, [user, employees])

  // Enrich currentAssignees with employee data when employees list is loaded
  useEffect(() => {
    if (employees.length > 0 && currentAssignees.length > 0) {
      const enrichedAssignees = currentAssignees.map(assignee => {
        // If assignee already has employeeData, keep it
        if (assignee.employeeData) return assignee

        // Otherwise, find the employee data from employees list
        const employeeId = assignee.employee?._id || assignee.employee
        const employeeData = employees.find(emp => emp._id === employeeId)

        return {
          ...assignee,
          employee: employeeId,
          employeeData: employeeData || assignee.employee // Use existing employee object if no match found
        }
      })

      setSelectedEmployees(enrichedAssignees)
    }
  }, [employees, currentAssignees])

  const checkDepartmentHead = async () => {
    try {
      const token = localStorage.getItem('token')
      if (!token) return

      const response = await fetch('/api/team/check-head', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      const data = await response.json()
      if (data.success && data.isDepartmentHead) {


        setIsDepartmentHead(true)
      }
    } catch (error) {
      console.error('Error checking department head:', error)
    }
  }

  const fetchEmployees = async (page = 1, append = false) => {
    try {
      setEmployeeLoading(true)
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/employees?status=active&limit=50&page=${page}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      if (response.ok) {
        const data = await response.json()
        if (append) {
          setEmployees(prev => [...prev, ...(data.data || [])])
        } else {
          setEmployees(data.data || [])
        }

        // Check if there are more pages
        setEmployeeHasMore(data.pagination.page < data.pagination.pages)
        setEmployeePage(page)
      }
    } catch (error) {
      console.error('Error fetching employees:', error)
    } finally {
      setEmployeeLoading(false)
    }
  }

  const loadMoreEmployees = () => {
    if (!employeeLoading && employeeHasMore) {
      fetchEmployees(employeePage + 1, true)
    }
  }

  const filterEmployees = () => {
    let filtered = employees.filter(emp =>
      !selectedEmployees.some(selected => selected.employee === emp._id)
    )

    // Filter by department tab
    if (activeTab === 'myDepartment' && currentEmp?.department?._id) {
      filtered = filtered.filter(emp => {
        const empDeptId = emp.department?._id || emp.department
        const myDeptId = currentEmp.department._id || currentEmp.department
        return empDeptId && myDeptId && empDeptId.toString() === myDeptId.toString()
      })
    } else if (activeTab === 'otherDepartments' && currentEmp?.department?._id) {
      filtered = filtered.filter(emp => {
        const empDeptId = emp.department?._id || emp.department
        const myDeptId = currentEmp.department._id || currentEmp.department
        return empDeptId && myDeptId && empDeptId.toString() !== myDeptId.toString()
      })
    }

    if (searchTerm) {
      filtered = filtered.filter(emp =>
        `${emp.firstName} ${emp.lastName}`.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (emp.employeeCode || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (emp.designation?.title || '').toLowerCase().includes(searchTerm.toLowerCase())
      )
    }

    // Filter based on assignment permissions
    if (user && currentEmp) {
      filtered = filtered.filter(emp => canAssignTo(emp))
    }

    setFilteredEmployees(filtered)
  }

  const canAssignTo = (employee) => {
    if (!user || !currentEmp) return false
    const myId = user.employeeId || user.id || user._id

    // Self assignment is always allowed
    if (employee._id === myId) return true

    // Admin and HR can assign to anyone
    if (['admin', 'hr'].includes(user.role)) return true

    // Check if in same department
    const empDeptId = employee.department?._id || employee.department
    const myDeptId = currentEmp.department?._id || currentEmp.department
    const sameDepartment = empDeptId && myDeptId && empDeptId.toString() === myDeptId.toString()

    // If not in same department, cannot assign (for now, until other departments feature is implemented)
    if (!sameDepartment) return false

    // Department head can assign to anyone in their department
    if (isDepartmentHead) return true

    // Get hierarchy levels
    const myLevel = currentEmp.designation?.level || 0
    const empLevel = employee.designation?.level || 0

    // Cannot assign to higher hierarchy (lower level number = higher hierarchy)
    if (empLevel < myLevel) return false

    // Can assign to same level or lower hierarchy (higher level number)
    if (empLevel >= myLevel) return true

    return false
  }

  const addAssignee = (employee, role = 'owner') => {
    const newAssignee = {
      employee: employee._id,
      employeeData: employee,
      role,
      status: 'pending'
    }

    const updated = [...selectedEmployees, newAssignee]
    setSelectedEmployees(updated)
    setSearchTerm('')
    setShowDropdown(false)

    if (onAssignmentChange) {
      onAssignmentChange(updated)
    }
  }

  const removeAssignee = async (employeeId) => {
    const updated = selectedEmployees.filter(assignee => assignee.employee !== employeeId)
    setSelectedEmployees(updated)

    // If in manage mode and taskId exists, update the database
    if (mode === 'manage' && taskId) {
      try {
        setLoading(true)
        const token = localStorage.getItem('token')

        const response = await fetch('/api/tasks/assign', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            taskId,
            assignees: updated.map(a => ({
              employee: a.employee,
              role: a.role
            })),
            action: 'reassign', // Use reassign to update the full assignee list
            reason: 'Assignee removed'
          })
        })

        if (response.ok) {
          const data = await response.json()
          console.log('Assignee removed successfully')

          if (onAssignmentChange) {
            onAssignmentChange(data.data?.assignedTo || updated)
          }
        } else {
          const error = await response.json()
          console.error('Failed to remove assignee:', error.message)
          alert('Failed to remove assignee: ' + error.message)
          // Revert the change
          setSelectedEmployees(selectedEmployees)
        }
      } catch (error) {
        console.error('Remove assignee error:', error)
        alert('Failed to remove assignee. Please try again.')
        // Revert the change
        setSelectedEmployees(selectedEmployees)
      } finally {
        setLoading(false)
      }
    } else {
      // In create mode, just update local state
      if (onAssignmentChange) {
        onAssignmentChange(updated)
      }
    }
  }

  const updateAssigneeRole = async (employeeId, newRole) => {
    const updated = selectedEmployees.map(assignee =>
      assignee.employee === employeeId
        ? { ...assignee, role: newRole }
        : assignee
    )
    setSelectedEmployees(updated)

    // If in manage mode and taskId exists, update the database
    if (mode === 'manage' && taskId) {
      try {
        setLoading(true)
        const token = localStorage.getItem('token')

        const response = await fetch('/api/tasks/assign', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            taskId,
            assignees: updated.map(a => ({
              employee: a.employee,
              role: a.role
            })),
            action: 'reassign', // Use reassign to update the full assignee list
            reason: `Role updated to ${newRole}`
          })
        })

        if (response.ok) {
          const data = await response.json()
          console.log('Role updated successfully')

          if (onAssignmentChange) {
            onAssignmentChange(data.data?.assignedTo || updated)
          }
        } else {
          const error = await response.json()
          console.error('Failed to update role:', error.message)
          // Revert the change
          setSelectedEmployees(selectedEmployees)
        }
      } catch (error) {
        console.error('Update role error:', error)
        // Revert the change
        setSelectedEmployees(selectedEmployees)
      } finally {
        setLoading(false)
      }
    } else {
      // In create mode, just update local state
      if (onAssignmentChange) {
        onAssignmentChange(updated)
      }
    }
  }

  const handleAssignmentAction = async (action, reason = '') => {
    if (!taskId) return

    try {
      setLoading(true)
      const token = localStorage.getItem('token')

      const response = await fetch('/api/tasks/assign', {
        method: action === 'accept' || action === 'reject' ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          taskId,
          assignees: selectedEmployees.map(a => ({
            employee: a.employee,
            role: a.role
          })),
          action,
          reason
        })
      })

      if (response.ok) {
        const data = await response.json()
        console.log('Assignment successful:', data.message)

        if (onAssignmentChange) {
          onAssignmentChange(data.data.assignedTo)
        }
      } else {
        const error = await response.json()
        console.error('Assignment failed:', error.message)
      }
    } catch (error) {
      console.error('Assignment error:', error)
    } finally {
      setLoading(false)
    }
  }

  const getAssignmentTypeLabel = (employee) => {
    if (!user || !employee || !currentEmp) return ''
    const myId = user.employeeId || user.id || user._id

    if (employee._id === myId) return 'Self'

    // Check if department head
    if (isDepartmentHead) {

      const empDeptId = employee.department?._id || employee.department
      const myDeptId = currentEmp.department?._id || currentEmp.department
      if (empDeptId && myDeptId && empDeptId.toString() === myDeptId.toString()) {
        return 'Dept Head'
      }
    }

    // Check hierarchy
    const myLevel = currentEmp.designation?.level || 0
    const empLevel = employee.designation?.level || 0

    if (empLevel === myLevel) return 'Same Level'
    if (empLevel > myLevel) return 'Lower Level'
    if (empLevel < myLevel) return 'Higher Level'

    return 'Same Dept'
  }

  const getAssignmentTypeColor = (employee) => {
    const type = getAssignmentTypeLabel(employee)
    switch (type) {
      case 'Self': return 'bg-blue-100 text-blue-800'
      case 'Dept Head': return 'bg-purple-100 text-purple-800'
      case 'Same Level': return 'bg-green-100 text-green-800'
      case 'Lower Level': return 'bg-teal-100 text-teal-800'
      case 'Higher Level': return 'bg-orange-100 text-orange-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  return (
    <div className="space-y-4">
      {/* Current Assignees */}
      {selectedEmployees.length > 0 && (
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700">
            Assigned To ({selectedEmployees.length})
          </label>
          <div className="space-y-2">
            {selectedEmployees.map((assignee, index) => {
              // Get employee data from either employeeData or employee (if it's populated)
              const empData = assignee.employeeData || assignee.employee
              const employeeName = empData?.firstName && empData?.lastName
                ? `${empData.firstName} ${empData.lastName}`
                : empData?.firstName || empData?.lastName || 'Unknown User'

              return (
                <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center space-x-3">
                    <div className="flex-shrink-0">
                      <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center overflow-hidden">
                        {empData?.profilePicture ? (
                          <img
                            src={empData.profilePicture}
                            alt={employeeName}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <FaUser className="w-4 h-4 text-white" />
                        )}
                      </div>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {employeeName}
                      </p>
                      <p className="text-xs text-gray-500">
                        {empData?.employeeCode} {empData?.department?.name ? `• ${empData.department.name}` : ''}
                      </p>
                    </div>
                    {empData && (
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${getAssignmentTypeColor(empData)}`}>
                        {getAssignmentTypeLabel(empData)}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center space-x-2">
                    {/* Role Selector */}
                    <select
                      value={assignee.role}
                      onChange={(e) => updateAssigneeRole(assignee.employee, e.target.value)}
                      className="text-xs border border-gray-300 rounded px-2 py-1 focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="owner">Owner</option>
                      <option value="collaborator">Collaborator</option>
                      <option value="reviewer">Reviewer</option>
                      <option value="observer">Observer</option>
                    </select>

                    {/* Status Badge */}
                    {assignee.status && (
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${assignee.status === 'accepted' ? 'bg-green-100 text-green-800' :
                        assignee.status === 'rejected' ? 'bg-red-100 text-red-800' :
                          assignee.status === 'delegated' ? 'bg-purple-100 text-purple-800' :
                            'bg-yellow-100 text-yellow-800'
                        }`}>
                        {assignee.status}
                      </span>
                    )}

                    {/* Remove Button */}
                    <button
                      onClick={() => removeAssignee(assignee.employee)}
                      disabled={loading}
                      className={`p-1 ${loading ? 'text-gray-400 cursor-not-allowed' : 'text-red-600 hover:text-red-800'}`}
                      title="Remove assignee"
                    >
                      <FaTrash className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Department Tabs */}
      <div className="border-b border-gray-200 mb-4">
        <nav className="-mb-px flex space-x-8" aria-label="Tabs">
          <button
            onClick={() => setActiveTab('myDepartment')}
            className={`${activeTab === 'myDepartment'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm`}
          >
            My Department
            {currentEmp?.department?.name && (
              <span className="ml-2 text-xs text-gray-500">({currentEmp.department.name})</span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('otherDepartments')}
            disabled
            className="border-transparent text-gray-400 cursor-not-allowed whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm relative"
          >
            Other Departments
            <span className="ml-2 text-xs bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded-full">
              Coming Soon
            </span>
          </button>
        </nav>
      </div>

      {/* Add Assignee */}
      <div className="relative">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          {activeTab === 'myDepartment' ? 'Add Team Member' : 'Add Employee'}
        </label>

        {/* Hierarchy Info */}
        {currentEmp && activeTab === 'myDepartment' && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-3">
            <div className="flex items-start space-x-2">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="flex-1 text-xs text-blue-700">
                {isDepartmentHead ? (
                  <p><strong>Department Head:</strong> You can assign tasks to anyone in your department.</p>
                ) : (
                  <>
                    <p><strong>Your Level:</strong> {formatDesignation(currentEmp.designation, currentEmp)}</p>
                    <p className="mt-1">You can assign tasks to employees at your level or lower hierarchy. Department heads can assign to anyone in the department.</p>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="relative">
          <input
            type="text"
            placeholder={activeTab === 'myDepartment' ? 'Search team members by name, code, or designation...' : 'Search employees...'}
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value)
              setShowDropdown(true)
            }}
            onFocus={() => setShowDropdown(true)}
            className="w-full px-4 py-2 pl-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <FaSearch className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
        </div>

        {/* Employee Dropdown */}
        {showDropdown && (
          <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg">
            <div className="max-h-80 overflow-y-auto">
              {filteredEmployees.length > 0 ? (
                <>
                  {filteredEmployees.map((employee) => (
                    <div
                      key={employee._id}
                      onClick={() => addAssignee(employee)}
                      className="flex items-center justify-between p-3 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-b-0"
                    >
                      <div className="flex items-center space-x-3 flex-1 min-w-0">
                        <div className="w-8 h-8 bg-gradient-to-br from-blue-400 to-blue-600 rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden">
                          {employee.profilePicture ? (
                            <img
                              src={employee.profilePicture}
                              alt={`${employee.firstName} ${employee.lastName}`}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <FaUser className="w-4 h-4 text-white" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {employee.firstName} {employee.lastName}
                          </p>
                          <p className="text-xs text-gray-500 truncate">
                            {employee.employeeCode} • {formatDesignation(employee.designation, employee)}
                          </p>
                        </div>
                      </div>
                      <span className={`px-2 py-1 rounded-full text-xs font-medium whitespace-nowrap ml-2 ${getAssignmentTypeColor(employee)}`}>
                        {/* {getAssignmentTypeLabel(employee)} */}
                        {employee?.designation?.title}
                      </span>
                    </div>
                  ))}

                  {employeeLoading && (
                    <div className="p-3 text-center">
                      <Loader size="sm" />
                      <p className="text-xs text-gray-500 mt-2">Loading more employees...</p>
                    </div>
                  )}
                </>
              ) : (
                <div className="p-4 text-center text-sm text-gray-500">
                  {activeTab === 'myDepartment' ? (
                    <>
                      <p className="font-medium">No team members available</p>
                      <p className="text-xs mt-1">
                        {searchTerm
                          ? 'No employees match your search criteria.'
                          : isDepartmentHead
                            ? 'All department members are already assigned.'
                            : 'You can only assign to employees at your level or lower hierarchy.'}
                      </p>
                    </>
                  ) : (
                    <p>No employees found in other departments.</p>
                  )}
                </div>
              )}
            </div>

            {/* Load More Button */}
            {employeeHasMore && !employeeLoading && filteredEmployees.length > 0 && (
              <div className="border-t border-gray-200 p-3">
                <button
                  type="button"
                  onClick={loadMoreEmployees}
                  className="w-full px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-all duration-200 flex items-center justify-center space-x-2"
                >
                  <FaChevronDown className="w-3 h-3" />
                  <span>Load More Employees</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Assignment Actions (for existing tasks) */}
      {mode === 'manage' && taskId && (
        <div className="flex space-x-2 pt-4 border-t border-gray-200">
          <button
            onClick={() => handleAssignmentAction('assign')}
            disabled={loading || selectedEmployees.length === 0}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
          >
            <FaPlus className="w-4 h-4" />
            <span>{loading ? 'Assigning...' : 'Assign Task'}</span>
          </button>

          <button
            onClick={() => handleAssignmentAction('reassign')}
            disabled={loading || selectedEmployees.length === 0}
            className="bg-yellow-600 text-white px-4 py-2 rounded-lg hover:bg-yellow-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
          >
            <FaUsers className="w-4 h-4" />
            <span>{loading ? 'Reassigning...' : 'Reassign Task'}</span>
          </button>

          <button
            onClick={() => handleAssignmentAction('delegate')}
            disabled={loading || selectedEmployees.length === 0}
            className="bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
          >
            <FaUsers className="w-4 h-4" />
            <span>{loading ? 'Delegating...' : 'Delegate Task'}</span>
          </button>
        </div>
      )}

      {/* Assignment Response Actions (for assignees) */}
      {mode === 'respond' && taskId && (
        <div className="flex space-x-2 pt-4 border-t border-gray-200">
          <button
            onClick={() => handleAssignmentAction('accept')}
            disabled={loading}
            className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
          >
            <FaCheck className="w-4 h-4" />
            <span>{loading ? 'Accepting...' : 'Accept Assignment'}</span>
          </button>

          <button
            onClick={() => handleAssignmentAction('reject')}
            disabled={loading}
            className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
          >
            <FaTimes className="w-4 h-4" />
            <span>{loading ? 'Rejecting...' : 'Reject Assignment'}</span>
          </button>
        </div>
      )}

      {/* Click outside to close dropdown */}
      {showDropdown && (
        <div
          className="fixed inset-0 z-0"
          onClick={() => setShowDropdown(false)}
        />
      )}
    </div>
  )
}

export default TaskAssignment
