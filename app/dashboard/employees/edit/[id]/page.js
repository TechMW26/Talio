'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import { FaSave, FaArrowLeft, FaChevronDown, FaTimes } from 'react-icons/fa'

export default function EditEmployeePage() {
  const params = useParams()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [departments, setDepartments] = useState([])
  const [designations, setDesignations] = useState([])
  const [showDeptDropdown, setShowDeptDropdown] = useState(false)
  const deptDropdownRef = useRef(null)

  // Static levels list
  const levels = [
    { level: 1, levelName: 'Entry Level' },
    { level: 2, levelName: 'Junior' },
    { level: 3, levelName: 'Mid Level' },
    { level: 4, levelName: 'Senior' },
    { level: 5, levelName: 'Lead' },
    { level: 6, levelName: 'Manager' },
    { level: 7, levelName: 'Director' },
    { level: 8, levelName: 'Executive' },
  ]
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    dateOfBirth: '',
    gender: '',
    address: '',
    departments: [],
    department: '',
    designation: '',
    designationLevel: '',
    designationLevelName: '',
    dateOfJoining: '',
    employmentType: '',
    workLocation: '',
    status: 'active',
    // Salary fields
    salary: {
      ctc: '',
      grossSalary: '',
      basic: '',
      hra: '',
      conveyance: '',
      medical: '',
      special: '',
      allowances: '',
      deductions: '',
      currency: 'INR',
    },
    // System Role (User account role)
    systemRole: 'employee',
    // Statutory fields
    statutory: {
      pfEnrolled: false,
      esiEnrolled: false,
      pfNumber: '',
      esiNumber: '',
      uanNumber: '',
      panNumber: '',
    },
    // Corporate Health Insurance
    healthInsurance: {
      enrolled: false,
      policyNumber: '',
      provider: '',
    },
  })

  useEffect(() => {
    fetchEmployee()
    fetchDepartments()
    fetchDesignations()
  }, [params.id])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (deptDropdownRef.current && !deptDropdownRef.current.contains(event.target)) {
        setShowDeptDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const fetchEmployee = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/employees/${params.id}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      const data = await response.json()
      if (data.success) {
        const emp = data.data
        console.log('Fetched employee data:', emp)
        console.log('Employee departments:', emp.departments)
        console.log('Employee department (legacy):', emp.department)

        // Get departments as array of IDs (ensure string format for comparison)
        const deptIds = emp.departments?.map(d => {
          if (typeof d === 'object' && d !== null) {
            return d._id?.toString() || d.toString()
          }
          return d?.toString() || d
        }).filter(Boolean) || []

        const primaryDept = emp.department?._id?.toString() || emp.department?.toString() || (deptIds.length > 0 ? deptIds[0] : '')

        console.log('Extracted deptIds:', deptIds)
        console.log('Primary department:', primaryDept)

        setFormData({
          firstName: emp.firstName || '',
          lastName: emp.lastName || '',
          email: emp.email || '',
          phone: emp.phone || '',
          dateOfBirth: emp.dateOfBirth ? new Date(emp.dateOfBirth).toISOString().split('T')[0] : '',
          gender: emp.gender || '',
          address: emp.address || '',
          departments: deptIds.length > 0 ? deptIds : (primaryDept ? [primaryDept] : []),
          department: primaryDept,
          designation: emp.designation?._id?.toString() || emp.designation?.toString() || '',
          designationLevel: emp.designationLevel || emp.designation?.level || 1,
          designationLevelName: emp.designationLevelName || emp.designation?.levelName || '',
          dateOfJoining: emp.dateOfJoining ? new Date(emp.dateOfJoining).toISOString().split('T')[0] : '',
          employmentType: emp.employmentType || '',
          workLocation: emp.workLocation || '',
          status: emp.status || 'active',
          // System Role from linked user account
          systemRole: emp.userId?.role || 'employee',
          // Salary fields
          salary: {
            ctc: emp.salary?.ctc || '',
            grossSalary: emp.salary?.grossSalary || '',
            basic: emp.salary?.basic || '',
            hra: emp.salary?.hra || '',
            conveyance: emp.salary?.conveyance || '',
            medical: emp.salary?.medical || '',
            special: emp.salary?.special || '',
            allowances: emp.salary?.allowances || '',
            deductions: emp.salary?.deductions || '',
            currency: emp.salary?.currency || 'INR',
          },
          // Statutory fields  
          statutory: {
            pfEnrolled: emp.statutory?.pfEnrolled || false,
            esiEnrolled: emp.statutory?.esiEnrolled || false,
            pfNumber: emp.statutory?.pfNumber || '',
            esiNumber: emp.statutory?.esiNumber || '',
            uanNumber: emp.statutory?.uanNumber || '',
            panNumber: emp.statutory?.panNumber || '',
          },
          // Corporate Health Insurance
          healthInsurance: {
            enrolled: emp.healthInsurance?.enrolled || false,
            policyNumber: emp.healthInsurance?.policyNumber || '',
            provider: emp.healthInsurance?.provider || '',
          },
        })
      }
    } catch (error) {
      console.error('Fetch employee error:', error)
      toast.error('Failed to fetch employee details')
    } finally {
      setLoading(false)
    }
  }

  const fetchDepartments = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/departments', {
        headers: { 'Authorization': `Bearer ${token}` },
      })
      const data = await response.json()
      if (data.success) {
        setDepartments(data.data)
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
        setDesignations(data.data)
      }
    } catch (error) {
      console.error('Fetch designations error:', error)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSubmitting(true)

    try {
      const token = localStorage.getItem('token')

      // Log what we're sending
      console.log('Submitting formData:', formData)
      console.log('Departments being sent:', formData.departments)

      const response = await fetch(`/api/employees/${params.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(formData),
      })

      const data = await response.json()
      console.log('Update response:', data)

      if (data.success) {
        toast.success('Employee updated successfully!')
        router.push('/dashboard/employees')
      } else {
        toast.error(data.message || 'Failed to update employee')
      }
    } catch (error) {
      console.error('Update employee error:', error)
      toast.error('Failed to update employee')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="p-6">
        <div className="bg-white rounded-lg shadow-md p-8 text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">Edit Employee</h1>
          <p className="text-gray-600 mt-1">Update employee information</p>
        </div>
        <button
          onClick={() => router.push('/dashboard/employees')}
          className="btn-secondary flex items-center space-x-2"
        >
          <FaArrowLeft />
          <span>Back</span>
        </button>
      </div>

      {/* Form */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <form onSubmit={handleSubmit}>
          {/* Personal Information */}
          <div className="mb-8">
            <h2 className="text-xl font-bold text-gray-800 mb-4">Personal Information</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  First Name *
                </label>
                <input
                  type="text"
                  required
                  value={formData.firstName}
                  onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Last Name *
                </label>
                <input
                  type="text"
                  required
                  value={formData.lastName}
                  onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Email *
                </label>
                <input
                  type="email"
                  required
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Phone
                </label>
                <input
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Date of Birth
                </label>
                <input
                  type="date"
                  value={formData.dateOfBirth}
                  onChange={(e) => setFormData({ ...formData, dateOfBirth: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Gender
                </label>
                <select
                  value={formData.gender}
                  onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                >
                  <option value="">Select Gender</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Address
                </label>
                <textarea
                  rows="2"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>
            </div>
          </div>

          {/* Employment Information */}
          <div className="mb-8">
            <h2 className="text-xl font-bold text-gray-800 mb-4">Employment Information</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Department - Multi-select */}
              <div className="md:col-span-2" ref={deptDropdownRef}>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Departments <span className="text-gray-400 text-xs">(can select multiple)</span>
                </label>

                {/* Selected Departments Tags */}
                {formData.departments && formData.departments.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {formData.departments.map(deptId => {
                      const deptIdStr = deptId?.toString() || deptId
                      const dept = departments.find(d => (d._id?.toString() || d._id) === deptIdStr)
                      return dept ? (
                        <span
                          key={deptIdStr}
                          className="inline-flex items-center gap-1 px-3 py-1 bg-primary-100 text-primary-700 rounded-full text-sm"
                        >
                          {dept.name}
                          <button
                            type="button"
                            onClick={() => {
                              const newDepts = formData.departments.filter(id => (id?.toString() || id) !== deptIdStr)
                              setFormData({
                                ...formData,
                                departments: newDepts,
                                department: newDepts.length > 0 ? newDepts[0] : '',
                              })
                            }}
                            className="ml-1 text-primary-500 hover:text-primary-700"
                          >
                            <FaTimes className="w-3 h-3" />
                          </button>
                        </span>
                      ) : null
                    })}
                  </div>
                )}

                {/* Dropdown Button */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowDeptDropdown(!showDeptDropdown)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent text-left flex items-center justify-between bg-white"
                  >
                    <span className={formData.departments?.length > 0 ? 'text-gray-700' : 'text-gray-400'}>
                      {formData.departments?.length > 0
                        ? `${formData.departments.length} department(s) selected`
                        : 'Select Departments'}
                    </span>
                    <FaChevronDown className={`text-gray-400 transition-transform ${showDeptDropdown ? 'rotate-180' : ''}`} />
                  </button>

                  {/* Dropdown List */}
                  {showDeptDropdown && (
                    <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                      {departments.length === 0 ? (
                        <div className="px-4 py-2 text-gray-500 text-sm">No departments available</div>
                      ) : (
                        departments.map(dept => {
                          const deptId = dept._id?.toString() || dept._id
                          const isChecked = formData.departments?.some(d => d?.toString() === deptId) || false
                          return (
                            <label
                              key={dept._id}
                              className="flex items-center px-4 py-2 hover:bg-gray-50 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => {
                                  const currentDepts = formData.departments || []
                                  let newDepts
                                  if (currentDepts.some(d => d?.toString() === deptId)) {
                                    newDepts = currentDepts.filter(id => id?.toString() !== deptId)
                                  } else {
                                    newDepts = [...currentDepts, deptId]
                                  }
                                  console.log('Department toggled:', deptId, 'New departments:', newDepts)
                                  setFormData({
                                    ...formData,
                                    departments: newDepts,
                                    department: newDepts.length > 0 ? newDepts[0] : '',
                                  })
                                }}
                                className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                              />
                              <span className="ml-3 text-gray-700">{dept.name}</span>
                              {dept.code && (
                                <span className="ml-2 text-xs text-gray-400">({dept.code})</span>
                              )}
                            </label>
                          )
                        })
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Designation & Level - Side by Side */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Designation *
                </label>
                <select
                  required
                  value={formData.designation}
                  onChange={(e) => setFormData({ ...formData, designation: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                >
                  <option value="">Select Designation</option>
                  {designations.map((desig) => (
                    <option key={desig._id} value={desig._id}>
                      {desig.title}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Level
                </label>
                <select
                  value={formData.designationLevel}
                  onChange={(e) => {
                    const selectedLevel = levels.find(l => l.level === parseInt(e.target.value))
                    setFormData({
                      ...formData,
                      designationLevel: e.target.value,
                      designationLevelName: selectedLevel?.levelName || '',
                    })
                  }}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                >
                  <option value="">Select Level</option>
                  {levels.map((level) => (
                    <option key={level.level} value={level.level}>
                      {level.levelName}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Date of Joining *
                </label>
                <input
                  type="date"
                  required
                  value={formData.dateOfJoining}
                  onChange={(e) => setFormData({ ...formData, dateOfJoining: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Employment Type
                </label>
                <select
                  value={formData.employmentType}
                  onChange={(e) => setFormData({ ...formData, employmentType: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                >
                  <option value="">Select Type</option>
                  <option value="full-time">Full Time</option>
                  <option value="part-time">Part Time</option>
                  <option value="contract">Contract</option>
                  <option value="intern">Intern</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Work Location
                </label>
                <input
                  type="text"
                  value={formData.workLocation}
                  onChange={(e) => setFormData({ ...formData, workLocation: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Status *
                </label>
                <select
                  required
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="terminated">Terminated</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  System Role
                  <span className="text-xs text-gray-400 ml-2">(Access level)</span>
                </label>
                <select
                  value={formData.systemRole}
                  onChange={(e) => setFormData({ ...formData, systemRole: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                >
                  <option value="employee">Employee</option>
                  <option value="manager">Manager</option>
                  <option value="department_head">Department Head</option>
                  <option value="hr">HR</option>
                  <option value="admin">Admin</option>
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  Controls what features this user can access in the system
                </p>
              </div>
            </div>
          </div>

          {/* Salary & Statutory Details */}
          <div className="mb-8">
            <h2 className="text-xl font-bold text-gray-800 mb-4">Salary & Statutory Details</h2>
            
            {/* Salary Fields */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  CTC (Cost to Company)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">₹</span>
                  <input
                    type="number"
                    value={formData.salary.ctc}
                    onChange={(e) => setFormData({ ...formData, salary: { ...formData.salary, ctc: e.target.value } })}
                    placeholder="Annual CTC"
                    className="w-full pl-8 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Gross Salary (Monthly)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">₹</span>
                  <input
                    type="number"
                    value={formData.salary.grossSalary}
                    onChange={(e) => setFormData({ ...formData, salary: { ...formData.salary, grossSalary: e.target.value } })}
                    placeholder="Monthly gross salary"
                    className="w-full pl-8 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Basic Salary
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">₹</span>
                  <input
                    type="number"
                    value={formData.salary.basic}
                    onChange={(e) => setFormData({ ...formData, salary: { ...formData.salary, basic: e.target.value } })}
                    placeholder="Basic salary"
                    className="w-full pl-8 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  HRA
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">₹</span>
                  <input
                    type="number"
                    value={formData.salary.hra}
                    onChange={(e) => setFormData({ ...formData, salary: { ...formData.salary, hra: e.target.value } })}
                    placeholder="House rent allowance"
                    className="w-full pl-8 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Conveyance
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">₹</span>
                  <input
                    type="number"
                    value={formData.salary.conveyance}
                    onChange={(e) => setFormData({ ...formData, salary: { ...formData.salary, conveyance: e.target.value } })}
                    placeholder="Conveyance allowance"
                    className="w-full pl-8 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Medical Allowance
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">₹</span>
                  <input
                    type="number"
                    value={formData.salary.medical}
                    onChange={(e) => setFormData({ ...formData, salary: { ...formData.salary, medical: e.target.value } })}
                    placeholder="Medical allowance"
                    className="w-full pl-8 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Special Allowance
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">₹</span>
                  <input
                    type="number"
                    value={formData.salary.special}
                    onChange={(e) => setFormData({ ...formData, salary: { ...formData.salary, special: e.target.value } })}
                    placeholder="Special allowance"
                    className="w-full pl-8 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>
              </div>
            </div>

            {/* Statutory Details */}
            <h3 className="text-lg font-semibold text-gray-700 mb-3">Statutory Compliance</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-4">
              {/* PF Enrollment */}
              <div className="bg-gray-50 p-4 rounded-lg">
                <div className="flex items-center justify-between mb-3">
                  <label className="text-sm font-medium text-gray-700">PF Enrolled</label>
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, statutory: { ...formData.statutory, pfEnrolled: !formData.statutory.pfEnrolled } })}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${formData.statutory.pfEnrolled ? 'bg-green-500' : 'bg-red-400'}`}
                  >
                    <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${formData.statutory.pfEnrolled ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
                </div>
                {formData.statutory.pfEnrolled && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">PF Number</label>
                      <input
                        type="text"
                        value={formData.statutory.pfNumber}
                        onChange={(e) => setFormData({ ...formData, statutory: { ...formData.statutory, pfNumber: e.target.value } })}
                        placeholder="e.g., ABCDE1234567000123"
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">UAN Number</label>
                      <input
                        type="text"
                        value={formData.statutory.uanNumber}
                        onChange={(e) => setFormData({ ...formData, statutory: { ...formData.statutory, uanNumber: e.target.value } })}
                        placeholder="e.g., 100012345678"
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* ESI Enrollment */}
              <div className="bg-gray-50 p-4 rounded-lg">
                <div className="flex items-center justify-between mb-3">
                  <label className="text-sm font-medium text-gray-700">ESI Enrolled</label>
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, statutory: { ...formData.statutory, esiEnrolled: !formData.statutory.esiEnrolled } })}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${formData.statutory.esiEnrolled ? 'bg-green-500' : 'bg-red-400'}`}
                  >
                    <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${formData.statutory.esiEnrolled ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
                </div>
                {formData.statutory.esiEnrolled && (
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">ESI Number</label>
                    <input
                      type="text"
                      value={formData.statutory.esiNumber}
                      onChange={(e) => setFormData({ ...formData, statutory: { ...formData.statutory, esiNumber: e.target.value } })}
                      placeholder="e.g., 1234567890"
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* PAN Number */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  PAN Number
                </label>
                <input
                  type="text"
                  value={formData.statutory.panNumber}
                  onChange={(e) => setFormData({ ...formData, statutory: { ...formData.statutory, panNumber: e.target.value.toUpperCase() } })}
                  placeholder="e.g., ABCDE1234F"
                  maxLength={10}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent uppercase"
                />
              </div>
            </div>

            {/* Corporate Health Insurance */}
            <div className="mt-4 p-4 bg-gray-50 rounded-lg border">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                  🏥 Corporate Health Insurance
                </label>
                <div className="flex items-center gap-4">
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, healthInsurance: { ...formData.healthInsurance, enrolled: !formData.healthInsurance.enrolled } })}
                    style={{ backgroundColor: formData.healthInsurance.enrolled ? '#22c55e' : '#f87171' }}
                    className="relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none"
                  >
                    <span 
                      style={{ transform: formData.healthInsurance.enrolled ? 'translateX(20px)' : 'translateX(0)' }}
                      className="pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out" 
                    />
                  </button>
                  <span className="text-sm text-gray-600">{formData.healthInsurance.enrolled ? 'Enrolled' : 'Not Enrolled'}</span>
                </div>
              </div>
              {formData.healthInsurance.enrolled && (
                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Policy Provider</label>
                    <input
                      type="text"
                      value={formData.healthInsurance.provider || ''}
                      onChange={(e) => setFormData({ ...formData, healthInsurance: { ...formData.healthInsurance, provider: e.target.value } })}
                      placeholder="e.g., ICICI Lombard, Star Health"
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Policy Number</label>
                    <input
                      type="text"
                      value={formData.healthInsurance.policyNumber}
                      onChange={(e) => setFormData({ ...formData, healthInsurance: { ...formData.healthInsurance, policyNumber: e.target.value } })}
                      placeholder="Enter policy number"
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Submit Button */}
          <div className="flex justify-end space-x-4">
            <button
              type="button"
              onClick={() => router.push('/dashboard/employees')}
              className="btn-secondary"
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary flex items-center space-x-2"
              disabled={submitting}
            >
              <FaSave />
              <span>{submitting ? 'Updating...' : 'Update Employee'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

