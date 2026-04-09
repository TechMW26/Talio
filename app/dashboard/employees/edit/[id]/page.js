'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import toast from '@/utils/toast'
import { FaSave, FaArrowLeft, FaChevronDown, FaTimes, FaExclamationTriangle } from 'react-icons/fa'
import { Card, CardBody, Button, Skeleton, Select, SelectItem } from '@heroui/react'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import useApiMutation from '@/hooks/useApiMutation'
import LoadingButton from '@/components/ui/LoadingButton'
import useRoles from '@/hooks/useRoles'

export default function EditEmployeePage() {
  const params = useParams()
  const router = useRouter()
  const [accessDenied, setAccessDenied] = useState(false)
  const [showDeptDropdown, setShowDeptDropdown] = useState(false)
  const deptDropdownRef = useRef(null)

  // --- SWR: Dropdown data ---
  const { data: deptRes } = useAuthedSWR(accessDenied ? null : '/api/departments')
  const departments = deptRes?.data || []

  const { data: desigRes } = useAuthedSWR(accessDenied ? null : '/api/designations')
  const designations = desigRes?.data || []

  const { roles: availableRoles, loading: rolesLoading } = useRoles()

  // --- SWR: Employee data ---
  const { data: empRes, isLoading: loading } = useAuthedSWR(
    accessDenied ? null : `/api/employees/${params.id}`
  )

  // --- Submit mutation ---
  const submitMutation = useApiMutation({
    method: 'PUT',
    invalidateKeys: [`/api/employees/${params.id}`],
    onSuccess: (response) => {
      try {
        const storedUser = JSON.parse(localStorage.getItem('user') || 'null')
        const storedEmployeeId =
          storedUser?.employeeId?._id ||
          storedUser?.employeeId?.id ||
          storedUser?.employeeId ||
          null

        if (storedUser && storedEmployeeId && String(storedEmployeeId) === String(params.id)) {
          localStorage.setItem(
            'user',
            JSON.stringify({
              ...storedUser,
              role: response?.data?.userId?.role || formData.systemRole,
              roleId: response?.data?.userId?.roleId || storedUser.roleId || null,
              permissionsCache: null,
              cacheUpdatedAt: null,
            })
          )
        }
      } catch (error) {
        console.warn('[Edit Employee] Failed to sync local user role after update:', error)
      }

      toast.success('Employee updated successfully!')
      router.push('/dashboard/employees')
    },
    onError: (msg) => toast.error(msg || 'Failed to update employee'),
  })

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
    // Check access control
    const userData = localStorage.getItem('user')
    if (userData) {
      const parsedUser = JSON.parse(userData)
      const allowedRoles = ['admin', 'hr']
      if (!allowedRoles.includes(parsedUser.role)) {
        setAccessDenied(true)
        return
      }
    }
  }, [params.id])

  // Populate form when employee data loads
  useEffect(() => {
    if (!empRes?.data) return
    const emp = empRes.data

    // Get departments as array of IDs (ensure string format for comparison)
    const deptIds = emp.departments?.map(d => {
      if (typeof d === 'object' && d !== null) {
        return d._id?.toString() || d.toString()
      }
      return d?.toString() || d
    }).filter(Boolean) || []

    const primaryDept = emp.department?._id?.toString() || emp.department?.toString() || (deptIds.length > 0 ? deptIds[0] : '')

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
  }, [empRes])

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

  const handleSubmit = async (e) => {
    e.preventDefault()
    await submitMutation.execute(`/api/employees/${params.id}`, formData)
  }

  // Access denied screen for non-admin/non-hr users
  if (accessDenied) {
    return (
      <div className="p-6">
        <div className="flex flex-col items-center justify-center min-h-[60vh]">
          <div className="bg-danger-50 rounded-full p-6 mb-6">
            <FaExclamationTriangle className="w-16 h-16 text-danger" />
          </div>
          <h1 className="text-2xl font-bold text-default-800 mb-2">Access Denied</h1>
          <p className="text-default-500 text-center max-w-md mb-6">
            You don't have permission to edit employees.
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

  if (loading) {
    return (
      <div className="p-6">
        <Card shadow="sm">
          <CardBody className="p-8">
            <div className="space-y-6">
              <Skeleton className="w-1/3 h-8 rounded-lg" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Skeleton className="h-12 rounded-lg" />
                <Skeleton className="h-12 rounded-lg" />
                <Skeleton className="h-12 rounded-lg" />
                <Skeleton className="h-12 rounded-lg" />
              </div>
              <Skeleton className="w-1/4 h-8 rounded-lg" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Skeleton className="h-12 rounded-lg" />
                <Skeleton className="h-12 rounded-lg" />
              </div>
            </div>
          </CardBody>
        </Card>
      </div>
    )
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-default-800">Edit Employee</h1>
          <p className="text-default-500 mt-1">Update employee information</p>
        </div>
        <Button
          variant="bordered"
          onPress={() => router.push('/dashboard/employees')}
          startContent={<FaArrowLeft />}
        >
          Back
        </Button>
      </div>

      {/* Form */}
      <Card shadow="sm">
        <CardBody className="p-6">
          <form onSubmit={handleSubmit}>
            {/* Personal Information */}
            <div className="mb-8">
              <h2 className="text-xl font-bold text-default-800 mb-4">Personal Information</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-default-700 mb-2">
                    First Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.firstName}
                    onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                    className="w-full px-4 py-2 border border-default-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-default-700 mb-2">
                    Last Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.lastName}
                    onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                    className="w-full px-4 py-2 border border-default-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-default-700 mb-2">
                    Email *
                  </label>
                  <input
                    type="email"
                    required
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full px-4 py-2 border border-default-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-default-700 mb-2">
                    Phone
                  </label>
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full px-4 py-2 border border-default-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-default-700 mb-2">
                    Date of Birth
                  </label>
                  <input
                    type="date"
                    value={formData.dateOfBirth}
                    onChange={(e) => setFormData({ ...formData, dateOfBirth: e.target.value })}
                    className="w-full px-4 py-2 border border-default-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-default-700 mb-2">
                    Gender
                  </label>
                  <Select
                    selectedKeys={formData.gender ? [formData.gender] : []}
                    onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
                    aria-label="Gender"
                    placeholder="Select Gender"
                    classNames={{ trigger: "bg-white" }}
                  >
                    <SelectItem key="male">Male</SelectItem>
                    <SelectItem key="female">Female</SelectItem>
                    <SelectItem key="other">Other</SelectItem>
                  </Select>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-default-700 mb-2">
                    Address
                  </label>
                  <textarea
                    rows="2"
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    className="w-full px-4 py-2 border border-default-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                  />
                </div>
              </div>
            </div>

            {/* Employment Information */}
            <div className="mb-8">
              <h2 className="text-xl font-bold text-default-800 mb-4">Employment Information</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Department - Multi-select */}
                <div className="md:col-span-2" ref={deptDropdownRef}>
                  <label className="block text-sm font-medium text-default-700 mb-2">
                    Departments <span className="text-default-400 text-xs">(can select multiple)</span>
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
                            className="inline-flex items-center gap-1 px-3 py-1 bg-primary-100 text-primary rounded-full text-sm"
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
                              className="ml-1 text-primary hover:text-primary-700"
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
                      className="w-full px-4 py-2 border border-default-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent text-left flex items-center justify-between bg-white"
                    >
                      <span className={formData.departments?.length > 0 ? 'text-default-700' : 'text-default-400'}>
                        {formData.departments?.length > 0
                          ? `${formData.departments.length} department(s) selected`
                          : 'Select Departments'}
                      </span>
                      <FaChevronDown className={`text-default-400 transition-transform ${showDeptDropdown ? 'rotate-180' : ''}`} />
                    </button>

                    {/* Dropdown List */}
                    {showDeptDropdown && (
                      <div className="absolute z-50 w-full mt-1 bg-white border border-default-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                        {departments.length === 0 ? (
                          <div className="px-4 py-2 text-default-500 text-sm">No departments available</div>
                        ) : (
                          departments.map(dept => {
                            const deptId = dept._id?.toString() || dept._id
                            const isChecked = formData.departments?.some(d => d?.toString() === deptId) || false
                            return (
                              <label
                                key={dept._id}
                                className="flex items-center px-4 py-2 hover:bg-default-50 cursor-pointer"
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
                                  className="w-4 h-4 text-primary border-default-300 rounded focus:ring-primary"
                                />
                                <span className="ml-3 text-default-700">{dept.name}</span>
                                {dept.code && (
                                  <span className="ml-2 text-xs text-default-400">({dept.code})</span>
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
                  <label className="block text-sm font-medium text-default-700 mb-2">
                    Designation *
                  </label>
                  <Select
                    isRequired
                    selectedKeys={formData.designation ? [formData.designation] : []}
                    onChange={(e) => setFormData({ ...formData, designation: e.target.value })}
                    aria-label="Designation"
                    placeholder="Select Designation"
                    classNames={{ trigger: "bg-white" }}
                  >
                    {designations.map((desig) => (
                      <SelectItem key={desig._id}>
                        {desig.title}
                      </SelectItem>
                    ))}
                  </Select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-default-700 mb-2">
                    Level
                  </label>
                  <Select
                    selectedKeys={formData.designationLevel ? [String(formData.designationLevel)] : []}
                    onChange={(e) => {
                      const selectedLevel = levels.find(l => l.level === parseInt(e.target.value))
                      setFormData({
                        ...formData,
                        designationLevel: e.target.value,
                        designationLevelName: selectedLevel?.levelName || '',
                      })
                    }}
                    aria-label="Level"
                    placeholder="Select Level"
                    classNames={{ trigger: "bg-white" }}
                  >
                    {levels.map((level) => (
                      <SelectItem key={String(level.level)}>
                        {level.levelName}
                      </SelectItem>
                    ))}
                  </Select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-default-700 mb-2">
                    Date of Joining *
                  </label>
                  <input
                    type="date"
                    required
                    value={formData.dateOfJoining}
                    onChange={(e) => setFormData({ ...formData, dateOfJoining: e.target.value })}
                    className="w-full px-4 py-2 border border-default-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-default-700 mb-2">
                    Employment Type
                  </label>
                  <Select
                    selectedKeys={formData.employmentType ? [formData.employmentType] : []}
                    onChange={(e) => setFormData({ ...formData, employmentType: e.target.value })}
                    aria-label="Employment Type"
                    placeholder="Select Type"
                    classNames={{ trigger: "bg-white" }}
                  >
                    <SelectItem key="full-time">Full Time</SelectItem>
                    <SelectItem key="part-time">Part Time</SelectItem>
                    <SelectItem key="contract">Contract</SelectItem>
                    <SelectItem key="intern">Intern</SelectItem>
                  </Select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-default-700 mb-2">
                    Work Location
                  </label>
                  <input
                    type="text"
                    value={formData.workLocation}
                    onChange={(e) => setFormData({ ...formData, workLocation: e.target.value })}
                    className="w-full px-4 py-2 border border-default-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-default-700 mb-2">
                    Status *
                  </label>
                  <Select
                    isRequired
                    selectedKeys={[formData.status]}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                    aria-label="Status"
                    classNames={{ trigger: "bg-white" }}
                  >
                    <SelectItem key="active">Active</SelectItem>
                    <SelectItem key="inactive">Inactive</SelectItem>
                    <SelectItem key="terminated">Terminated</SelectItem>
                  </Select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-default-700 mb-2">
                    System Role
                    <span className="text-xs text-default-400 ml-2">(Access level)</span>
                  </label>
                  <Select
                    name="systemRole"
                    selectedKeys={formData.systemRole ? [formData.systemRole] : []}
                    onSelectionChange={(keys) => {
                      if (keys === 'all') return
                      const selectedRole = Array.from(keys)[0]
                      setFormData((prev) => ({
                        ...prev,
                        systemRole: selectedRole ? String(selectedRole) : '',
                      }))
                    }}
                    aria-label="System Role"
                    placeholder="Select Role"
                    isLoading={rolesLoading}
                    items={availableRoles}
                    className="text-default-900"
                    classNames={{
                      trigger: "bg-white border border-default-300 text-default-900 data-[hover=true]:border-default-400",
                      value: "text-default-900",
                      innerWrapper: "text-default-900",
                      selectorIcon: "text-default-600",
                      listbox: "text-default-900",
                      popoverContent: "bg-white text-default-900"
                    }}
                  >
                    {(role) => (
                      <SelectItem key={role.name}>{role.displayLabel}</SelectItem>
                    )}
                  </Select>
                  <p className="text-xs text-default-500 mt-1">
                    Controls what features this user can access in the system
                  </p>
                </div>
              </div>
            </div>

            {/* Salary & Statutory Details */}
            <div className="mb-8">
              <h2 className="text-xl font-bold text-default-800 mb-4">Salary & Statutory Details</h2>

              {/* Salary Fields */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div>
                  <label className="block text-sm font-medium text-default-700 mb-2">
                    CTC (Cost to Company)
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-default-500">₹</span>
                    <input
                      type="number"
                      value={formData.salary.ctc}
                      onChange={(e) => setFormData({ ...formData, salary: { ...formData.salary, ctc: e.target.value } })}
                      placeholder="Annual CTC"
                      className="w-full pl-8 pr-4 py-2 border border-default-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-default-700 mb-2">
                    Gross Salary (Monthly)
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-default-500">₹</span>
                    <input
                      type="number"
                      value={formData.salary.grossSalary}
                      onChange={(e) => setFormData({ ...formData, salary: { ...formData.salary, grossSalary: e.target.value } })}
                      placeholder="Monthly gross salary"
                      className="w-full pl-8 pr-4 py-2 border border-default-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-default-700 mb-2">
                    Basic Salary
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-default-500">₹</span>
                    <input
                      type="number"
                      value={formData.salary.basic}
                      onChange={(e) => setFormData({ ...formData, salary: { ...formData.salary, basic: e.target.value } })}
                      placeholder="Basic salary"
                      className="w-full pl-8 pr-4 py-2 border border-default-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-default-700 mb-2">
                    HRA
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-default-500">₹</span>
                    <input
                      type="number"
                      value={formData.salary.hra}
                      onChange={(e) => setFormData({ ...formData, salary: { ...formData.salary, hra: e.target.value } })}
                      placeholder="House rent allowance"
                      className="w-full pl-8 pr-4 py-2 border border-default-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-default-700 mb-2">
                    Conveyance
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-default-500">₹</span>
                    <input
                      type="number"
                      value={formData.salary.conveyance}
                      onChange={(e) => setFormData({ ...formData, salary: { ...formData.salary, conveyance: e.target.value } })}
                      placeholder="Conveyance allowance"
                      className="w-full pl-8 pr-4 py-2 border border-default-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-default-700 mb-2">
                    Medical Allowance
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-default-500">₹</span>
                    <input
                      type="number"
                      value={formData.salary.medical}
                      onChange={(e) => setFormData({ ...formData, salary: { ...formData.salary, medical: e.target.value } })}
                      placeholder="Medical allowance"
                      className="w-full pl-8 pr-4 py-2 border border-default-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-default-700 mb-2">
                    Special Allowance
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-default-500">₹</span>
                    <input
                      type="number"
                      value={formData.salary.special}
                      onChange={(e) => setFormData({ ...formData, salary: { ...formData.salary, special: e.target.value } })}
                      placeholder="Special allowance"
                      className="w-full pl-8 pr-4 py-2 border border-default-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                    />
                  </div>
                </div>
              </div>

              {/* Statutory Details */}
              <h3 className="text-lg font-semibold text-default-700 mb-3">Statutory Compliance</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-4">
                {/* PF Enrollment */}
                <div className="bg-default-50 p-4 rounded-lg">
                  <div className="flex items-center justify-between mb-3">
                    <label className="text-sm font-medium text-default-700">PF Enrolled</label>
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, statutory: { ...formData.statutory, pfEnrolled: !formData.statutory.pfEnrolled } })}
                      className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 ${formData.statutory.pfEnrolled ? 'bg-green-500' : 'bg-red-400'}`}
                    >
                      <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${formData.statutory.pfEnrolled ? 'translate-x-5' : 'translate-x-0'}`} />
                    </button>
                  </div>
                  {formData.statutory.pfEnrolled && (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs text-default-600 mb-1">PF Number</label>
                        <input
                          type="text"
                          value={formData.statutory.pfNumber}
                          onChange={(e) => setFormData({ ...formData, statutory: { ...formData.statutory, pfNumber: e.target.value } })}
                          placeholder="e.g., ABCDE1234567000123"
                          className="w-full px-3 py-2 text-sm border border-default-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-default-600 mb-1">UAN Number</label>
                        <input
                          type="text"
                          value={formData.statutory.uanNumber}
                          onChange={(e) => setFormData({ ...formData, statutory: { ...formData.statutory, uanNumber: e.target.value } })}
                          placeholder="e.g., 100012345678"
                          className="w-full px-3 py-2 text-sm border border-default-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* ESI Enrollment */}
                <div className="bg-default-50 p-4 rounded-lg">
                  <div className="flex items-center justify-between mb-3">
                    <label className="text-sm font-medium text-default-700">ESI Enrolled</label>
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, statutory: { ...formData.statutory, esiEnrolled: !formData.statutory.esiEnrolled } })}
                      className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 ${formData.statutory.esiEnrolled ? 'bg-green-500' : 'bg-red-400'}`}
                    >
                      <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${formData.statutory.esiEnrolled ? 'translate-x-5' : 'translate-x-0'}`} />
                    </button>
                  </div>
                  {formData.statutory.esiEnrolled && (
                    <div>
                      <label className="block text-xs text-default-600 mb-1">ESI Number</label>
                      <input
                        type="text"
                        value={formData.statutory.esiNumber}
                        onChange={(e) => setFormData({ ...formData, statutory: { ...formData.statutory, esiNumber: e.target.value } })}
                        placeholder="e.g., 1234567890"
                        className="w-full px-3 py-2 text-sm border border-default-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* PAN Number */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-default-700 mb-2">
                    PAN Number
                  </label>
                  <input
                    type="text"
                    value={formData.statutory.panNumber}
                    onChange={(e) => setFormData({ ...formData, statutory: { ...formData.statutory, panNumber: e.target.value.toUpperCase() } })}
                    placeholder="e.g., ABCDE1234F"
                    maxLength={10}
                    className="w-full px-4 py-2 border border-default-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent uppercase"
                  />
                </div>
              </div>

              {/* Corporate Health Insurance */}
              <div className="mt-4 p-4 bg-default-50 rounded-lg border border-default-200">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-default-700 flex items-center gap-2">
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
                    <span className="text-sm text-default-600">{formData.healthInsurance.enrolled ? 'Enrolled' : 'Not Enrolled'}</span>
                  </div>
                </div>
                {formData.healthInsurance.enrolled && (
                  <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-default-600 mb-1">Policy Provider</label>
                      <input
                        type="text"
                        value={formData.healthInsurance.provider || ''}
                        onChange={(e) => setFormData({ ...formData, healthInsurance: { ...formData.healthInsurance, provider: e.target.value } })}
                        placeholder="e.g., ICICI Lombard, Star Health"
                        className="w-full px-3 py-2 text-sm border border-default-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-default-600 mb-1">Policy Number</label>
                      <input
                        type="text"
                        value={formData.healthInsurance.policyNumber}
                        onChange={(e) => setFormData({ ...formData, healthInsurance: { ...formData.healthInsurance, policyNumber: e.target.value } })}
                        placeholder="Enter policy number"
                        className="w-full px-3 py-2 text-sm border border-default-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Submit Button */}
            <div className="flex justify-end space-x-4">
              <Button
                variant="bordered"
                onPress={() => router.push('/dashboard/employees')}
                isDisabled={submitMutation.isLoading}
              >
                Cancel
              </Button>
              <LoadingButton
                type="submit"
                color="primary"
                isLoading={submitMutation.isLoading}
                loadingText="Updating..."
                startContent={<FaSave />}
              >
                Update Employee
              </LoadingButton>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  )
}

