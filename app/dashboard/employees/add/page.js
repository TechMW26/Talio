'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import toast from '@/utils/toast'
import { FaSave, FaTimes, FaChevronDown, FaCheck, FaTimes as FaX, FaUserPlus, FaFileUpload, FaExclamationTriangle } from 'react-icons/fa'
import BulkImportEmployees from '@/components/employees/BulkImportEmployees'
import { Card, CardBody, Button, Select, SelectItem } from '@heroui/react'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import useApiMutation from '@/hooks/useApiMutation'
import LoadingButton from '@/components/ui/LoadingButton'
import useRoles from '@/hooks/useRoles'

export default function AddEmployeePage() {
  const router = useRouter()
  const [accessDenied, setAccessDenied] = useState(false)
  const [activeTab, setActiveTab] = useState('single') // 'single' or 'bulk'
  const [showDeptDropdown, setShowDeptDropdown] = useState(false)
  const deptDropdownRef = useRef(null)

  // --- SWR: Dropdown data ---
  const { data: deptRes } = useAuthedSWR(accessDenied ? null : '/api/departments')
  const departments = deptRes?.data || []

  const { data: desigRes } = useAuthedSWR(accessDenied ? null : '/api/designations')
  const designations = desigRes?.data || []

  const { data: compRes } = useAuthedSWR(accessDenied ? null : '/api/companies')
  const companies = compRes?.data || []

  const { data: assignRes } = useAuthedSWR(accessDenied ? null : '/api/employees?status=active&limit=500&sortBy=firstName&sortOrder=asc')
  const assignmentEmployees = assignRes?.data || []

  const { roles: availableRoles, loading: rolesLoading } = useRoles()

  // --- Submit mutation ---
  const submitMutation = useApiMutation({
    onSuccess: (data) => {
      toast.success('Employee and user account created successfully!')
      if (data.credentials) {
        toast.success(`Login: ${data.credentials.email} / ${data.credentials.password}`, {
          duration: 10000,
        })
      }
      setTimeout(() => {
        router.push('/dashboard/employees')
      }, 2000)
    },
    onError: (msg) => toast.error(msg || 'Failed to create employee'),
  })

  const presetDesignationTitles = [
    'Director',
    'CEO',
    'CTO',
    'CMO',
    'CFO',
    'COO',
    'CHRO',
    'CIO',
    'CISO',
    'Assistant Director',
    'Senior Manager',
    'Manager',
    'Assistant Manager',
    'Team Lead',
    'Senior Executive',
    'Executive',
  ]

  // Static levels list (1-9, top = Director).
  const levels = [
    { level: 1, levelName: 'Entry Level' },
    { level: 2, levelName: 'Mid Level' },
    { level: 3, levelName: 'Senior' },
    { level: 4, levelName: 'Team Lead' },
    { level: 5, levelName: 'Assistant Manager' },
    { level: 6, levelName: 'Manager' },
    { level: 7, levelName: 'C-Suite' },
    { level: 8, levelName: 'Assistant Director' },
    { level: 9, levelName: 'Director' },
  ]

  const [formData, setFormData] = useState({
    employeeCode: '',
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    dateOfBirth: '',
    gender: '',
    dateOfJoining: '',
    departments: [], // Changed to array for multiple departments
    department: '', // Primary department (first selected)
    designation: '',
    designationLevel: '',
    designationLevelName: '',
    designationTitle: '',
    company: '',
    employmentType: 'full-time',
    status: 'active',
    password: '',
    role: 'employee',
    assignedManager: '',
    assignedTeamLead: '',
    reportsTo: '',
    // Salary fields (optional)
    salary: {
      basic: '',
      hra: '',
      conveyance: '',
      medical: '',
      special: '',
      grossSalary: '',
    },
    // PF enrollment
    pfEnrollment: {
      enrolled: false,
      pfNumber: '',
      uanNumber: '',
      employeeContribution: 12,
      employerContribution: 12,
    },
    // ESI enrollment
    esiEnrollment: {
      enrolled: false,
      esiNumber: '',
    },
    // Professional Tax
    professionalTax: {
      applicable: true,
      amount: 200,
    },
    // Corporate Health Insurance
    healthInsurance: {
      enrolled: false,
      policyNumber: '',
      provider: '',
    },
  })

  const allDesignationOptions = useMemo(() => {
    const existingTitles = new Set((designations || []).map((d) => (d.title || '').trim().toLowerCase()))
    const presets = presetDesignationTitles
      .filter((t) => !existingTitles.has(t.toLowerCase()))
      .map((title) => ({ _id: `preset:${title}`, title, _preset: true }))
    return [...(designations || []), ...presets]
  }, [designations])

  const managerCandidates = useMemo(
    () => (assignmentEmployees || []).filter((e) => Number(e.designationLevel || e.designation?.level || 0) >= 5),
    [assignmentEmployees]
  )
  const teamLeadCandidates = useMemo(
    () => (assignmentEmployees || []).filter((e) => Number(e.designationLevel || e.designation?.level || 0) >= 4),
    [assignmentEmployees]
  )
  // "Reports To" choices follow the strict hierarchy:
  //   Asst. Director (L8) -> only Director (L9)
  //   C-Suite (L7)        -> Asst. Director (L8) or Director (L9)
  //   L1-L6               -> C-Suite, Asst. Director, or Director
  const reportsToCandidates = useMemo(() => {
    const lvl = Number(formData.designationLevel || 0)
    let allowed
    if (lvl === 8) allowed = new Set([9])
    else if (lvl === 7) allowed = new Set([8, 9])
    else allowed = new Set([7, 8, 9])
    return (assignmentEmployees || []).filter((e) => {
      const lv = Number(e.designationLevel || e.designation?.level || 0)
      return allowed.has(lv)
    })
  }, [assignmentEmployees, formData.designationLevel])

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
  }, [])

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

  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData({
      ...formData,
      [name]: value,
    })
  }

  // Handle department toggle (multi-select)
  const handleDepartmentToggle = (deptId) => {
    setFormData(prev => {
      const currentDepts = prev.departments || []
      let newDepts

      if (currentDepts.includes(deptId)) {
        // Remove department
        newDepts = currentDepts.filter(id => id !== deptId)
      } else {
        // Add department
        newDepts = [...currentDepts, deptId]
      }

      return {
        ...prev,
        departments: newDepts,
        // Set primary department as the first selected
        department: newDepts.length > 0 ? newDepts[0] : '',
      }
    })
  }

  // Remove a specific department
  const removeDepartment = (deptId) => {
    setFormData(prev => {
      const newDepts = (prev.departments || []).filter(id => id !== deptId)
      return {
        ...prev,
        departments: newDepts,
        department: newDepts.length > 0 ? newDepts[0] : '',
      }
    })
  }

  // Auto-calculate salary breakdown based on gross salary
  // Standard breakdown: Basic 40%, HRA 40% of Basic, Conveyance ₹800 fixed, Medical 5%, Special = remainder
  const calculateSalaryBreakdown = (grossSalary) => {
    const gross = parseFloat(grossSalary) || 0
    if (gross <= 0) {
      return { basic: '', hra: '', conveyance: '', medical: '', special: '' }
    }
    const basic = Math.round(gross * 0.40)           // 40% of gross
    const hra = Math.round(basic * 0.40)             // 40% of basic (16% of gross)
    const conveyance = 800                            // Fixed ₹800
    const medical = Math.round(gross * 0.05)         // 5% of gross
    const special = gross - basic - hra - conveyance - medical  // Remainder

    return {
      basic,
      hra,
      conveyance,
      medical,
      special: Math.max(0, special),
    }
  }

  // Handle gross salary change - auto-distribute to components
  const handleGrossSalaryChange = (value) => {
    const breakdown = calculateSalaryBreakdown(value)
    setFormData(prev => ({
      ...prev,
      salary: {
        ...prev.salary,
        grossSalary: value,
        ...breakdown,
      }
    }))
  }

  // Handle individual salary component change - adjust 'special' to balance
  const handleSalaryComponentChange = (field, value) => {
    setFormData(prev => {
      const newSalary = { ...prev.salary, [field]: value }
      const gross = parseFloat(newSalary.grossSalary) || 0

      if (gross > 0 && field !== 'grossSalary') {
        // Calculate sum of all components except 'special'
        const basic = parseFloat(newSalary.basic) || 0
        const hra = parseFloat(newSalary.hra) || 0
        const conveyance = parseFloat(newSalary.conveyance) || 0
        const medical = parseFloat(newSalary.medical) || 0

        // Auto-adjust 'special' to make total equal gross
        const sumWithoutSpecial = basic + hra + conveyance + medical
        const adjustedSpecial = Math.max(0, gross - sumWithoutSpecial)

        newSalary.special = Math.round(adjustedSpecial)
      }

      return { ...prev, salary: newSalary }
    })
  }

  const inferLevelFromTitle = (title = '') => {
    const t = title.toLowerCase().trim()
    if (!t) return 2
    if (/(intern|trainee|apprentice|\bjunior\b|\bjr\b)/.test(t)) return 1
    if (/(asst\.?|assistant)\s*director/.test(t)) return 8
    if (/\bdirector\b/.test(t)) return 9
    if (/(ceo|cto|cmo|cfo|coo|chro|cio|ciso|chief)/.test(t)) return 7
    if (/(senior\s*manager|sr\.?\s*manager|head|principal)/.test(t)) return 6
    if (/(asst\.?|assistant)\s*manager/.test(t)) return 5
    if (/(manager|architect)/.test(t)) return 6
    if (/(team\s*lead|tech\s*lead|\blead\b|supervisor)/.test(t)) return 4
    if (/(senior|sr\.?)/.test(t)) return 3
    return 2
  }

  const selectedLevel = Number(formData.designationLevel || 0)
  // Anyone Manager (L6) and below can have an assigned manager. C-Suite and above cannot.
  const allowManagerAssignment = selectedLevel > 0 && selectedLevel <= 6
  // Only IC roles (Senior and below) can have an assigned team lead.
  const allowTeamLeadAssignment = selectedLevel > 0 && selectedLevel <= 3
  // Everyone except Director (L9) needs to report to a higher exec.
  const requireReportsTo = selectedLevel > 0 && selectedLevel <= 8

  const handleSubmit = async (e) => {
    e.preventDefault()
    const payload = { ...formData }

    // Custom/preset designation selected from UI (e.g. CTO/CMO/CEO) is created server-side.
    if (String(payload.designation || '').startsWith('preset:')) {
      const title = String(payload.designation).replace('preset:', '')
      const inferred = inferLevelFromTitle(title)
      payload.designationTitle = title
      payload.designation = ''
      payload.designationLevel = payload.designationLevel || inferred
      payload.designationLevelName = payload.designationLevelName || (levels.find((l) => l.level === Number(payload.designationLevel))?.levelName || '')
    }

    if (!allowManagerAssignment) payload.assignedManager = ''
    if (!allowTeamLeadAssignment) payload.assignedTeamLead = ''
    if (!requireReportsTo) payload.reportsTo = ''

    await submitMutation.execute('/api/employees', payload)
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
            You don't have permission to add employees.
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
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-default-800">Add New Employee</h1>
        <p className="text-default-500 mt-1">Create a single employee or bulk import from Excel</p>
      </div>

      {/* Tabs */}
      <div className="mb-6">
        <div className="flex border-b border-default-200">
          <button
            type="button"
            onClick={() => setActiveTab('single')}
            className={`px-6 py-3 text-sm font-medium flex items-center gap-2 border-b-2 transition-colors ${activeTab === 'single'
              ? 'border-primary text-primary'
              : 'border-transparent text-default-500 hover:text-default-700 hover:border-default-300'
              }`}
          >
            <FaUserPlus />
            <span>Single Employee</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('bulk')}
            className={`px-6 py-3 text-sm font-medium flex items-center gap-2 border-b-2 transition-colors ${activeTab === 'bulk'
              ? 'border-primary text-primary'
              : 'border-transparent text-default-500 hover:text-default-700 hover:border-default-300'
              }`}
          >
            <FaFileUpload />
            <span>Bulk Import</span>
          </button>
        </div>
      </div>

      {/* Bulk Import Tab Content */}
      {activeTab === 'bulk' && (
        <Card shadow="sm">
          <CardBody className="p-6">
            <BulkImportEmployees />
          </CardBody>
        </Card>
      )}

      {/* Single Employee Form */}
      {activeTab === 'single' && (
        <Card shadow="sm">
          <CardBody className="p-6">
            <form onSubmit={handleSubmit}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Employee Code */}
                <div>
                  <label className="block text-sm font-medium text-default-700 mb-2">
                    Employee Code <span className="text-danger">*</span>
                  </label>
                  <input
                    type="text"
                    name="employeeCode"
                    value={formData.employeeCode}
                    onChange={handleChange}
                    required
                    className="w-full px-4 py-2 border border-default-300 rounded-lg bg-white text-default-900 placeholder:text-default-400 focus:ring-2 focus:ring-primary focus:border-primary"
                    placeholder="EMP001"
                  />
                </div>

                {/* First Name & Last Name - Side by Side */}
                <div className="grid grid-cols-2 gap-3">
                  {/* First Name */}
                  <div>
                    <label className="block text-sm font-medium text-default-700 mb-2">
                      First Name <span className="text-danger">*</span>
                    </label>
                    <input
                      type="text"
                      name="firstName"
                      value={formData.firstName}
                      onChange={handleChange}
                      required
                      className="w-full px-4 py-2 border border-default-300 rounded-lg bg-white text-default-900 placeholder:text-default-400 focus:ring-2 focus:ring-primary focus:border-primary"
                      placeholder="First Name"
                    />
                  </div>

                  {/* Last Name */}
                  <div>
                    <label className="block text-sm font-medium text-default-700 mb-2">
                      Last Name <span className="text-danger">*</span>
                    </label>
                    <input
                      type="text"
                      name="lastName"
                      value={formData.lastName}
                      onChange={handleChange}
                      required
                      className="w-full px-4 py-2 border border-default-300 rounded-lg bg-white text-default-900 placeholder:text-default-400 focus:ring-2 focus:ring-primary focus:border-primary"
                      placeholder="Last Name"
                    />
                  </div>
                </div>

                {/* Email */}
                <div>
                  <label className="block text-sm font-medium text-default-700 mb-2">
                    Email <span className="text-danger">*</span>
                  </label>
                  <input
                    type="email"
                    name="email"
                    value={formData.email}
                    onChange={handleChange}
                    required
                    className="w-full px-4 py-2 border border-default-300 rounded-lg bg-white text-default-900 placeholder:text-default-400 focus:ring-2 focus:ring-primary focus:border-primary"
                    placeholder="employee@mushroomworldgroup.com"
                  />
                </div>

                {/* Phone */}
                <div>
                  <label className="block text-sm font-medium text-default-700 mb-2">
                    Phone <span className="text-danger">*</span>
                  </label>
                  <input
                    type="tel"
                    name="phone"
                    value={formData.phone}
                    onChange={handleChange}
                    required
                    className="w-full px-4 py-2 border border-default-300 rounded-lg bg-white text-default-900 placeholder:text-default-400 focus:ring-2 focus:ring-primary focus:border-primary"
                    placeholder="+1234567890"
                  />
                </div>

                {/* Gender - Full Width */}
                <div className="md:col-span-1">
                  <label className="block text-sm font-medium text-default-700 mb-2">
                    Gender
                  </label>
                  <Select
                    name="gender"
                    selectedKeys={formData.gender ? new Set([String(formData.gender)]) : new Set()}
                    onSelectionChange={(keys) => {
                      if (keys === 'all') return
                      const value = Array.from(keys)[0] || ''
                      setFormData((prev) => ({ ...prev, gender: String(value) }))
                    }}
                    aria-label="Gender"
                    placeholder="Select Gender"
                    classNames={{
                      trigger: "bg-white border border-default-300 text-default-700 data-[hover=true]:border-default-400",
                      value: "text-default-700",
                      selectorIcon: "text-default-500",
                      listbox: "text-default-700"
                    }}
                  >
                    <SelectItem key="male">Male</SelectItem>
                    <SelectItem key="female">Female</SelectItem>
                    <SelectItem key="other">Other</SelectItem>
                  </Select>
                </div>

                {/* Date of Birth & Date of Joining - Side by Side */}
                <div>
                  <label className="block text-sm font-medium text-default-700 mb-2">
                    Date of Birth
                  </label>
                  <input
                    type="date"
                    name="dateOfBirth"
                    value={formData.dateOfBirth}
                    onChange={handleChange}
                    className="w-full px-4 py-2 border border-default-300 rounded-lg bg-white text-default-900 placeholder:text-default-400 focus:ring-2 focus:ring-primary focus:border-primary"
                  />
                </div>

                {/* Date of Joining */}
                <div>
                  <label className="block text-sm font-medium text-default-700 mb-2">
                    Date of Joining <span className="text-danger">*</span>
                  </label>
                  <input
                    type="date"
                    name="dateOfJoining"
                    value={formData.dateOfJoining}
                    onChange={handleChange}
                    required
                    className="w-full px-4 py-2 border border-default-300 rounded-lg bg-white text-default-900 placeholder:text-default-400 focus:ring-2 focus:ring-primary focus:border-primary"
                  />
                </div>

                {/* Department - Multi-select */}
                <div className="md:col-span-1" ref={deptDropdownRef}>
                  <label className="block text-sm font-medium text-default-700 mb-2">
                    Departments <span className="text-default-400 text-xs">(can select multiple)</span>
                  </label>

                  {/* Selected Departments Tags */}
                  {formData.departments && formData.departments.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-2">
                      {formData.departments.map(deptId => {
                        const dept = departments.find(d => d._id === deptId)
                        return dept ? (
                          <span
                            key={deptId}
                            className="inline-flex items-center gap-1 px-3 py-1 bg-primary-100 text-primary rounded-full text-sm"
                          >
                            {dept.name}
                            <button
                              type="button"
                              onClick={() => removeDepartment(deptId)}
                              className="ml-1 text-primary hover:text-primary-700"
                            >
                              <FaX className="w-3 h-3" />
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
                      className="w-full px-4 py-2 border border-default-300 rounded-lg bg-white text-default-900 focus:ring-2 focus:ring-primary focus:border-primary text-left flex items-center justify-between"
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
                          departments.map(dept => (
                            <label
                              key={dept._id}
                              className="flex items-center px-4 py-2 hover:bg-default-50 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={formData.departments?.includes(dept._id) || false}
                                onChange={() => handleDepartmentToggle(dept._id)}
                                className="w-4 h-4 text-primary border-default-300 rounded focus:ring-primary"
                              />
                              <span className="ml-3 text-default-700">{dept.name}</span>
                              {dept.code && (
                                <span className="ml-2 text-xs text-default-400">({dept.code})</span>
                              )}
                            </label>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Designation & Level - Side by Side */}
                <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Designation */}
                  <div>
                    <label className="block text-sm font-medium text-default-700 mb-2">
                      Designation
                    </label>
                    <Select
                      name="designation"
                      selectedKeys={formData.designation ? new Set([String(formData.designation)]) : new Set()}
                      onSelectionChange={(keys) => {
                        const selectedId = Array.from(keys)[0] || ''
                        const selected = allDesignationOptions.find((d) => String(d._id) === String(selectedId))
                        const level = Number(selected?.level || selected?.designationLevel || 0)
                        setFormData((prev) => ({
                          ...prev,
                          designation: String(selectedId),
                          designationTitle: selected?._preset ? selected.title : '',
                          designationLevel: level || prev.designationLevel,
                          designationLevelName: selected?.levelName || prev.designationLevelName,
                        }))
                      }}
                      aria-label="Designation"
                      placeholder="Select Designation"
                      classNames={{
                        trigger: "bg-white border border-default-300 text-default-700 data-[hover=true]:border-default-400",
                        value: "text-default-700",
                        selectorIcon: "text-default-500",
                        listbox: "text-default-700"
                      }}
                    >
                      {allDesignationOptions.map((desig) => (
                        <SelectItem key={String(desig._id)} textValue={desig._preset ? `${desig.title} (new)` : desig.title}>
                          {desig.title}{desig._preset ? ' (new)' : ''}
                        </SelectItem>
                      ))}
                    </Select>
                  </div>

                  {/* Level - Auto-populated from designation but can be overridden */}
                  <div>
                    <label className="block text-sm font-medium text-default-700 mb-2">
                      Level
                    </label>
                    <Select
                      name="designationLevel"
                      selectedKeys={formData.designationLevel ? new Set([String(formData.designationLevel)]) : new Set()}
                      onSelectionChange={(keys) => {
                        if (keys === 'all') return
                        const value = Array.from(keys)[0] || ''
                        const selectedLevel = levels.find(l => l.level === parseInt(value))
                        setFormData((prev) => ({
                          ...prev,
                          designationLevel: value,
                          designationLevelName: selectedLevel?.levelName || '',
                        }))
                      }}
                      aria-label="Level"
                      placeholder="Select Level"
                      classNames={{
                        trigger: "bg-white border border-default-300 text-default-700 data-[hover=true]:border-default-400",
                        value: "text-default-700",
                        selectorIcon: "text-default-500",
                        listbox: "text-default-700"
                      }}
                    >
                      {levels.map((level) => (
                        <SelectItem key={String(level.level)} textValue={level.levelName}>
                          {level.levelName}
                        </SelectItem>
                      ))}
                    </Select>
                    {formData.designationLevelName && (
                      <p className="text-xs text-default-500 mt-1">
                        Current: {formData.designationLevelName}
                      </p>
                    )}
                  </div>
                </div>

                {/* Hierarchy Assignment */}
                <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-default-700 mb-2">
                      Assigned Manager
                    </label>
                    <Select
                      name="assignedManager"
                      selectedKeys={formData.assignedManager ? new Set([String(formData.assignedManager)]) : new Set()}
                      onSelectionChange={(keys) => {
                        if (keys === 'all') return
                        const value = Array.from(keys)[0] || ''
                        setFormData((prev) => ({ ...prev, assignedManager: String(value) }))
                      }}
                      isDisabled={!allowManagerAssignment}
                      aria-label="Assigned Manager"
                      placeholder={allowManagerAssignment ? 'Select Manager' : 'Not required for selected role level'}
                      classNames={{
                        trigger: "bg-white border border-default-300 text-default-700 data-[hover=true]:border-default-400",
                        value: "text-default-700",
                        selectorIcon: "text-default-500",
                        listbox: "text-default-700"
                      }}
                    >
                      {managerCandidates.map((emp) => (
                        <SelectItem key={String(emp._id)} textValue={`${`${emp.firstName || ''} ${emp.lastName || ''}`.trim()} (${emp.employeeCode || 'EMP'})`}>{`${emp.firstName || ''} ${emp.lastName || ''}`.trim()} ({emp.employeeCode || 'EMP'})</SelectItem>
                      ))}
                    </Select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-default-700 mb-2">
                      Assigned Team Lead
                    </label>
                    <Select
                      name="assignedTeamLead"
                      selectedKeys={formData.assignedTeamLead ? new Set([String(formData.assignedTeamLead)]) : new Set()}
                      onSelectionChange={(keys) => {
                        if (keys === 'all') return
                        const value = Array.from(keys)[0] || ''
                        setFormData((prev) => ({ ...prev, assignedTeamLead: String(value) }))
                      }}
                      isDisabled={!allowTeamLeadAssignment}
                      aria-label="Assigned Team Lead"
                      placeholder={allowTeamLeadAssignment ? 'Select Team Lead' : 'Not required for selected role level'}
                      classNames={{
                        trigger: "bg-white border border-default-300 text-default-700 data-[hover=true]:border-default-400",
                        value: "text-default-700",
                        selectorIcon: "text-default-500",
                        listbox: "text-default-700"
                      }}
                    >
                      {teamLeadCandidates.map((emp) => (
                        <SelectItem key={String(emp._id)} textValue={`${`${emp.firstName || ''} ${emp.lastName || ''}`.trim()} (${emp.employeeCode || 'EMP'})`}>{`${emp.firstName || ''} ${emp.lastName || ''}`.trim()} ({emp.employeeCode || 'EMP'})</SelectItem>
                      ))}
                    </Select>
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-default-700 mb-2">
                      Reports To {requireReportsTo && <span className="text-danger">*</span>}
                    </label>
                    <Select
                      name="reportsTo"
                      selectedKeys={formData.reportsTo ? new Set([String(formData.reportsTo)]) : new Set()}
                      onSelectionChange={(keys) => {
                        if (keys === 'all') return
                        const value = Array.from(keys)[0] || ''
                        setFormData((prev) => ({ ...prev, reportsTo: String(value) }))
                      }}
                      isDisabled={!requireReportsTo}
                      isRequired={requireReportsTo}
                      aria-label="Reports To"
                      placeholder={requireReportsTo ? (selectedLevel === 8 ? 'Select Director' : selectedLevel === 7 ? 'Select Assistant Director or Director' : 'Select Director, Assistant Director, or C-Suite') : 'Directors do not report to anyone'}
                      classNames={{
                        trigger: "bg-white border border-default-300 text-default-700 data-[hover=true]:border-default-400",
                        value: "text-default-700",
                        selectorIcon: "text-default-500",
                        listbox: "text-default-700"
                      }}
                    >
                      {reportsToCandidates.map((emp) => {
                        const lvl = Number(emp.designationLevel || emp.designation?.level || 0)
                        const lvlLabel = lvl === 9 ? 'Director' : lvl === 8 ? 'Asst. Director' : 'C-Suite'
                        const label = `${`${emp.firstName || ''} ${emp.lastName || ''}`.trim()} \u2014 ${lvlLabel} (${emp.employeeCode || 'EMP'})`
                        return (
                          <SelectItem key={String(emp._id)} textValue={label}>{label}</SelectItem>
                        )
                      })}
                    </Select>
                    <p className="text-xs text-default-500 mt-1">
                      {selectedLevel === 8
                        ? 'Assistant Directors report only to a Director.'
                        : selectedLevel === 7
                          ? 'C-Suite reports only to an Assistant Director or Director.'
                          : 'Required for everyone except Directors. Choose from Director, Assistant Director, or C-Suite.'}
                    </p>
                  </div>
                </div>

                {/* Company */}
                <div>
                  <label className="block text-sm font-medium text-default-700 mb-2">
                    Company
                  </label>
                  <Select
                    name="company"
                    selectedKeys={formData.company ? new Set([String(formData.company)]) : new Set()}
                    onSelectionChange={(keys) => {
                      if (keys === 'all') return
                      const value = Array.from(keys)[0] || ''
                      setFormData((prev) => ({ ...prev, company: String(value) }))
                    }}
                    aria-label="Company"
                    placeholder="Select Company"
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
                    {companies.map((company) => (
                      <SelectItem key={String(company._id)} textValue={`${company.name} (${company.code})`}>
                        {company.name} ({company.code})
                      </SelectItem>
                    ))}
                  </Select>
                </div>

                {/* Employment Type */}
                <div>
                  <label className="block text-sm font-medium text-default-700 mb-2">
                    Employment Type
                  </label>
                  <Select
                    name="employmentType"
                    selectedKeys={formData.employmentType ? new Set([String(formData.employmentType)]) : new Set()}
                    onSelectionChange={(keys) => {
                      if (keys === 'all') return
                      const value = Array.from(keys)[0] || ''
                      setFormData((prev) => ({ ...prev, employmentType: String(value) }))
                    }}
                    aria-label="Employment Type"
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
                    <SelectItem key="full-time">Full Time</SelectItem>
                    <SelectItem key="part-time">Part Time</SelectItem>
                    <SelectItem key="contract">Contract</SelectItem>
                    <SelectItem key="intern">Intern</SelectItem>
                  </Select>
                </div>

                {/* Status */}
                <div>
                  <label className="block text-sm font-medium text-default-700 mb-2">
                    Status
                  </label>
                  <Select
                    name="status"
                    selectedKeys={formData.status ? new Set([String(formData.status)]) : new Set()}
                    onSelectionChange={(keys) => {
                      if (keys === 'all') return
                      const value = Array.from(keys)[0] || ''
                      setFormData((prev) => ({ ...prev, status: String(value) }))
                    }}
                    aria-label="Status"
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
                    <SelectItem key="active">Active</SelectItem>
                    <SelectItem key="inactive">Inactive</SelectItem>
                  </Select>
                </div>

                {/* Password */}
                <div>
                  <label className="block text-sm font-medium text-default-700 mb-2">
                    Password <span className="text-danger">*</span>
                  </label>
                  <input
                    type="password"
                    name="password"
                    value={formData.password}
                    onChange={handleChange}
                    required
                    className="w-full px-4 py-2 border border-default-300 rounded-lg bg-white text-default-900 placeholder:text-default-400 focus:ring-2 focus:ring-primary focus:border-primary"
                    placeholder="Enter login password"
                  />
                  <p className="text-xs text-default-500 mt-1">
                    This will be used for employee login. Default: employee123
                  </p>
                </div>

                {/* Role */}
                <div>
                  <label className="block text-sm font-medium text-default-700 mb-2">
                    User Role <span className="text-danger">*</span>
                  </label>
                  <Select
                    name="role"
                    selectedKeys={formData.role ? new Set([String(formData.role)]) : new Set()}
                    onSelectionChange={(keys) => {
                      if (keys === 'all') return
                      const selectedRole = Array.from(keys)[0] || ''
                      setFormData((prev) => ({
                        ...prev,
                        role: selectedRole ? String(selectedRole) : '',
                      }))
                    }}
                    isRequired
                    isLoading={rolesLoading}
                    aria-label="User Role"
                    placeholder="Select Role"
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
                      <SelectItem key={String(role.name)} textValue={role.displayLabel || role.name}>{role.displayLabel}</SelectItem>
                    )}
                  </Select>
                  <p className="text-xs text-default-500 mt-1">
                    Determines access level in the system
                  </p>
                </div>
              </div>

              {/* Salary & Statutory Section */}
              <div className="mt-8 border-t border-default-200 pt-6">
                <h3 className="text-lg font-semibold text-default-800 mb-4 flex items-center gap-2">
                  💰 Salary & Statutory Details
                  <span className="text-sm font-normal text-default-500">(Optional - can be added later)</span>
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {/* Gross Salary */}
                  <div className="lg:col-span-3">
                    <label className="block text-sm font-medium text-default-700 mb-2">
                      Gross Salary (Monthly) <span className="text-xs text-primary ml-2">← Enter this to auto-calculate breakdown</span>
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-default-500">₹</span>
                      <input
                        type="number"
                        value={formData.salary.grossSalary}
                        onChange={(e) => handleGrossSalaryChange(e.target.value)}
                        className="w-full pl-8 pr-4 py-2 border-2 border-primary-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary bg-primary-50"
                        placeholder="50000"
                      />
                    </div>
                    <p className="text-xs text-default-500 mt-1">Auto-distributes: Basic 40%, HRA 40% of Basic, Conveyance ₹800, Medical 5%, Special = Remainder</p>
                  </div>

                  {/* Basic Salary */}
                  <div>
                    <label className="block text-sm font-medium text-default-700 mb-2">
                      Basic Salary <span className="text-xs text-default-400">(40%)</span>
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-default-500">₹</span>
                      <input
                        type="number"
                        value={formData.salary.basic}
                        onChange={(e) => handleSalaryComponentChange('basic', e.target.value)}
                        className="w-full pl-8 pr-4 py-2 border border-default-300 rounded-lg bg-white text-default-900 placeholder:text-default-400 focus:ring-2 focus:ring-primary focus:border-primary"
                        placeholder="25000"
                      />
                    </div>
                  </div>

                  {/* HRA */}
                  <div>
                    <label className="block text-sm font-medium text-default-700 mb-2">
                      HRA <span className="text-xs text-default-400">(40% of Basic)</span>
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-default-500">₹</span>
                      <input
                        type="number"
                        value={formData.salary.hra}
                        onChange={(e) => handleSalaryComponentChange('hra', e.target.value)}
                        className="w-full pl-8 pr-4 py-2 border border-default-300 rounded-lg bg-white text-default-900 placeholder:text-default-400 focus:ring-2 focus:ring-primary focus:border-primary"
                        placeholder="10000"
                      />
                    </div>
                  </div>

                  {/* Conveyance */}
                  <div>
                    <label className="block text-sm font-medium text-default-700 mb-2">
                      Conveyance <span className="text-xs text-default-400">(₹800 default)</span>
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-default-500">₹</span>
                      <input
                        type="number"
                        value={formData.salary.conveyance}
                        onChange={(e) => handleSalaryComponentChange('conveyance', e.target.value)}
                        className="w-full pl-8 pr-4 py-2 border border-default-300 rounded-lg bg-white text-default-900 placeholder:text-default-400 focus:ring-2 focus:ring-primary focus:border-primary"
                        placeholder="800"
                      />
                    </div>
                  </div>

                  {/* Medical */}
                  <div>
                    <label className="block text-sm font-medium text-default-700 mb-2">
                      Medical <span className="text-xs text-default-400">(5%)</span>
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-default-500">₹</span>
                      <input
                        type="number"
                        value={formData.salary.medical}
                        onChange={(e) => handleSalaryComponentChange('medical', e.target.value)}
                        className="w-full pl-8 pr-4 py-2 border border-default-300 rounded-lg bg-white text-default-900 placeholder:text-default-400 focus:ring-2 focus:ring-primary focus:border-primary"
                        placeholder="1250"
                      />
                    </div>
                  </div>

                  {/* Special Allowance */}
                  <div>
                    <label className="block text-sm font-medium text-default-700 mb-2">
                      Special Allowance <span className="text-xs text-success">(auto-adjusted)</span>
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-default-500">₹</span>
                      <input
                        type="number"
                        value={formData.salary.special}
                        onChange={(e) => handleSalaryComponentChange('special', e.target.value)}
                        className="w-full pl-8 pr-4 py-2 border border-success-300 rounded-lg focus:ring-2 focus:ring-success focus:border-transparent bg-success-50"
                        placeholder="5000"
                        readOnly
                      />
                    </div>
                    <p className="text-xs text-success mt-1">Auto-adjusts to balance gross salary</p>
                  </div>

                  {/* Total Summary */}
                  {formData.salary.grossSalary && (
                    <div className="lg:col-span-3 p-3 bg-default-100 rounded-lg">
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-default-600">Total of components:</span>
                        <span className={`font-semibold ${(parseFloat(formData.salary.basic || 0) +
                          parseFloat(formData.salary.hra || 0) +
                          parseFloat(formData.salary.conveyance || 0) +
                          parseFloat(formData.salary.medical || 0) +
                          parseFloat(formData.salary.special || 0)) === parseFloat(formData.salary.grossSalary || 0)
                          ? 'text-success'
                          : 'text-danger'
                          }`}>
                          ₹{(
                            parseFloat(formData.salary.basic || 0) +
                            parseFloat(formData.salary.hra || 0) +
                            parseFloat(formData.salary.conveyance || 0) +
                            parseFloat(formData.salary.medical || 0) +
                            parseFloat(formData.salary.special || 0)
                          ).toLocaleString('en-IN')} / ₹{parseFloat(formData.salary.grossSalary || 0).toLocaleString('en-IN')}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* PF & ESI Section */}
                <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* PF Enrollment */}
                  <div className="p-4 bg-default-50 rounded-lg border border-default-200">
                    <div className="flex items-center justify-between mb-4">
                      <label className="text-sm font-medium text-default-700 flex items-center gap-2">
                        🏦 Provident Fund (PF)
                      </label>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setFormData({
                            ...formData,
                            pfEnrollment: { ...formData.pfEnrollment, enrolled: !formData.pfEnrollment.enrolled }
                          })}
                          style={{ backgroundColor: formData.pfEnrollment.enrolled ? '#22c55e' : '#f87171' }}
                          className="relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none"
                        >
                          <span
                            style={{ transform: formData.pfEnrollment.enrolled ? 'translateX(20px)' : 'translateX(0)' }}
                            className="pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
                          />
                        </button>
                        <span className="text-sm text-default-600">{formData.pfEnrollment.enrolled ? 'Enrolled' : 'Not Enrolled'}</span>
                      </div>
                    </div>

                    {formData.pfEnrollment.enrolled && (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs text-default-600 mb-1">PF Number</label>
                            <input
                              type="text"
                              value={formData.pfEnrollment.pfNumber}
                              onChange={(e) => setFormData({
                                ...formData,
                                pfEnrollment: { ...formData.pfEnrollment, pfNumber: e.target.value }
                              })}
                              className="w-full px-3 py-1.5 text-sm border border-default-300 rounded focus:ring-2 focus:ring-primary"
                              placeholder="PF Number"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-default-600 mb-1">UAN Number</label>
                            <input
                              type="text"
                              value={formData.pfEnrollment.uanNumber}
                              onChange={(e) => setFormData({
                                ...formData,
                                pfEnrollment: { ...formData.pfEnrollment, uanNumber: e.target.value }
                              })}
                              className="w-full px-3 py-1.5 text-sm border border-default-300 rounded focus:ring-2 focus:ring-primary"
                              placeholder="UAN Number"
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs text-default-600 mb-1">Employee Contribution %</label>
                            <input
                              type="number"
                              value={formData.pfEnrollment.employeeContribution}
                              onChange={(e) => setFormData({
                                ...formData,
                                pfEnrollment: { ...formData.pfEnrollment, employeeContribution: parseFloat(e.target.value) || 12 }
                              })}
                              className="w-full px-3 py-1.5 text-sm border border-default-300 rounded focus:ring-2 focus:ring-primary"
                              min="0"
                              max="100"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-default-600 mb-1">Employer Contribution %</label>
                            <input
                              type="number"
                              value={formData.pfEnrollment.employerContribution}
                              onChange={(e) => setFormData({
                                ...formData,
                                pfEnrollment: { ...formData.pfEnrollment, employerContribution: parseFloat(e.target.value) || 12 }
                              })}
                              className="w-full px-3 py-1.5 text-sm border border-default-300 rounded focus:ring-2 focus:ring-primary"
                              min="0"
                              max="100"
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* ESI Enrollment */}
                  <div className="p-4 bg-default-50 rounded-lg border border-default-200">
                    <div className="flex items-center justify-between mb-4">
                      <label className="text-sm font-medium text-default-700 flex items-center gap-2">
                        🏥 ESI (Employee State Insurance)
                      </label>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setFormData({
                            ...formData,
                            esiEnrollment: { ...formData.esiEnrollment, enrolled: !formData.esiEnrollment.enrolled }
                          })}
                          style={{ backgroundColor: formData.esiEnrollment.enrolled ? '#22c55e' : '#f87171' }}
                          className="relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none"
                        >
                          <span
                            style={{ transform: formData.esiEnrollment.enrolled ? 'translateX(20px)' : 'translateX(0)' }}
                            className="pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
                          />
                        </button>
                        <span className="text-sm text-default-600">{formData.esiEnrollment.enrolled ? 'Enrolled' : 'Not Enrolled'}</span>
                      </div>
                    </div>

                    {formData.esiEnrollment.enrolled && (
                      <div>
                        <label className="block text-xs text-default-600 mb-1">ESI Number</label>
                        <input
                          type="text"
                          value={formData.esiEnrollment.esiNumber}
                          onChange={(e) => setFormData({
                            ...formData,
                            esiEnrollment: { ...formData.esiEnrollment, esiNumber: e.target.value }
                          })}
                          className="w-full px-3 py-1.5 text-sm border border-default-300 rounded focus:ring-2 focus:ring-primary"
                          placeholder="ESI Number"
                        />
                        <p className="text-xs text-default-500 mt-1">Applicable for gross ≤ ₹21,000</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Professional Tax */}
                <div className="mt-4 p-4 bg-default-50 rounded-lg border border-default-200">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-default-700 flex items-center gap-2">
                      📋 Professional Tax
                    </label>
                    <div className="flex items-center gap-4">
                      <button
                        type="button"
                        onClick={() => setFormData({
                          ...formData,
                          professionalTax: { ...formData.professionalTax, applicable: !formData.professionalTax.applicable }
                        })}
                        style={{ backgroundColor: formData.professionalTax.applicable ? '#22c55e' : '#f87171' }}
                        className="relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none"
                      >
                        <span
                          style={{ transform: formData.professionalTax.applicable ? 'translateX(20px)' : 'translateX(0)' }}
                          className="pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
                        />
                      </button>
                      {formData.professionalTax.applicable && (
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-default-600">₹</span>
                          <input
                            type="number"
                            value={formData.professionalTax.amount}
                            onChange={(e) => setFormData({
                              ...formData,
                              professionalTax: { ...formData.professionalTax, amount: parseFloat(e.target.value) || 200 }
                            })}
                            className="w-24 px-3 py-1.5 text-sm border border-default-300 rounded focus:ring-2 focus:ring-primary"
                          />
                          <span className="text-sm text-default-500">/month</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Corporate Health Insurance */}
                <div className="mt-4 p-4 bg-default-50 rounded-lg border border-default-200">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-default-700 flex items-center gap-2">
                      🏥 Corporate Health Insurance
                    </label>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setFormData({
                          ...formData,
                          healthInsurance: { ...formData.healthInsurance, enrolled: !formData.healthInsurance.enrolled }
                        })}
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
                          onChange={(e) => setFormData({
                            ...formData,
                            healthInsurance: { ...formData.healthInsurance, provider: e.target.value }
                          })}
                          className="w-full px-3 py-1.5 text-sm border border-default-300 rounded focus:ring-2 focus:ring-primary"
                          placeholder="e.g., ICICI Lombard, Star Health"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-default-600 mb-1">Policy Number</label>
                        <input
                          type="text"
                          value={formData.healthInsurance.policyNumber}
                          onChange={(e) => setFormData({
                            ...formData,
                            healthInsurance: { ...formData.healthInsurance, policyNumber: e.target.value }
                          })}
                          className="w-full px-3 py-1.5 text-sm border border-default-300 rounded focus:ring-2 focus:ring-primary"
                          placeholder="Enter policy number"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Login Credentials Info */}
              <div className="mt-6 p-4 bg-primary-50 border border-primary-200 rounded-lg">
                <h3 className="text-sm font-semibold text-primary-800 mb-2">
                  📧 Login Credentials
                </h3>
                <p className="text-sm text-primary-700">
                  A user account will be automatically created with the email and password provided above.
                  The employee can use these credentials to login and mark attendance.
                </p>
              </div>

              {/* Action Buttons */}
              <div className="flex justify-end space-x-4 mt-6">
                <Button
                  variant="bordered"
                  onPress={() => router.push('/dashboard/employees')}
                  startContent={<FaTimes />}
                >
                  Cancel
                </Button>
                <LoadingButton
                  type="submit"
                  color="primary"
                  isLoading={submitMutation.isLoading}
                  loadingText="Saving..."
                  startContent={<FaSave />}
                >
                  Save Employee
                </LoadingButton>
              </div>
            </form>
          </CardBody>
        </Card>
      )}
    </div>
  )
}

