'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import { FaSave, FaTimes, FaChevronDown, FaCheck, FaTimes as FaX, FaUserPlus, FaFileUpload } from 'react-icons/fa'
import BulkImportEmployees from '@/components/employees/BulkImportEmployees'

export default function AddEmployeePage() {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState('single') // 'single' or 'bulk'
  const [loading, setLoading] = useState(false)
  const [departments, setDepartments] = useState([])
  const [designations, setDesignations] = useState([])
  const [companies, setCompanies] = useState([])
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
    company: '',
    employmentType: 'full-time',
    status: 'active',
    password: '',
    role: 'employee',
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

  useEffect(() => {
    fetchDepartments()
    fetchDesignations()
    fetchCompanies()
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

  const fetchCompanies = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/companies', {
        headers: { 'Authorization': `Bearer ${token}` },
      })
      const data = await response.json()
      if (data.success) {
        setCompanies(data.data)
      }
    } catch (error) {
      console.error('Fetch companies error:', error)
    }
  }

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

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)

    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/employees', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(formData),
      })

      const data = await response.json()

      if (data.success) {
        toast.success('Employee and user account created successfully!')
        if (data.credentials) {
          toast.success(`Login: ${data.credentials.email} / ${data.credentials.password}`, {
            duration: 10000,
          })
        }
        setTimeout(() => {
          router.push('/dashboard/employees')
        }, 2000)
      } else {
        toast.error(data.message || 'Failed to create employee')
      }
    } catch (error) {
      console.error('Create employee error:', error)
      toast.error('An error occurred while creating employee')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-800">Add New Employee</h1>
        <p className="text-gray-600 mt-1">Create a single employee or bulk import from Excel</p>
      </div>

      {/* Tabs */}
      <div className="mb-6">
        <div className="flex border-b border-gray-200">
          <button
            type="button"
            onClick={() => setActiveTab('single')}
            className={`px-6 py-3 text-sm font-medium flex items-center gap-2 border-b-2 transition-colors ${
              activeTab === 'single'
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <FaUserPlus />
            <span>Single Employee</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('bulk')}
            className={`px-6 py-3 text-sm font-medium flex items-center gap-2 border-b-2 transition-colors ${
              activeTab === 'bulk'
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <FaFileUpload />
            <span>Bulk Import</span>
          </button>
        </div>
      </div>

      {/* Bulk Import Tab Content */}
      {activeTab === 'bulk' && (
        <div className="bg-white rounded-lg shadow-md p-6">
          <BulkImportEmployees />
        </div>
      )}

      {/* Single Employee Form */}
      {activeTab === 'single' && (
      <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow-md p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Employee Code */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Employee Code <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              name="employeeCode"
              value={formData.employeeCode}
              onChange={handleChange}
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              placeholder="EMP001"
            />
          </div>

          {/* First Name & Last Name - Side by Side */}
          <div className="grid grid-cols-2 gap-3">
            {/* First Name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                First Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="firstName"
                value={formData.firstName}
                onChange={handleChange}
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                placeholder="First Name"
              />
            </div>

            {/* Last Name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Last Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="lastName"
                value={formData.lastName}
                onChange={handleChange}
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                placeholder="Last Name"
              />
            </div>
          </div>

          {/* Email */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Email <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              placeholder="employee@mushroomworldgroup.com"
            />
          </div>

          {/* Phone */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Phone <span className="text-red-500">*</span>
            </label>
            <input
              type="tel"
              name="phone"
              value={formData.phone}
              onChange={handleChange}
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              placeholder="+1234567890"
            />
          </div>

          {/* Gender - Full Width */}
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Gender
            </label>
            <select
              name="gender"
              value={formData.gender}
              onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              <option value="">Select Gender</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </select>
          </div>

          {/* Date of Birth & Date of Joining - Side by Side */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Date of Birth
            </label>
            <input
              type="date"
              name="dateOfBirth"
              value={formData.dateOfBirth}
              onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>

          {/* Date of Joining */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Date of Joining <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              name="dateOfJoining"
              value={formData.dateOfJoining}
              onChange={handleChange}
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>

          {/* Department - Multi-select */}
          <div className="md:col-span-2" ref={deptDropdownRef}>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Departments <span className="text-gray-400 text-xs">(can select multiple)</span>
            </label>
            
            {/* Selected Departments Tags */}
            {formData.departments && formData.departments.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {formData.departments.map(deptId => {
                  const dept = departments.find(d => d._id === deptId)
                  return dept ? (
                    <span 
                      key={deptId} 
                      className="inline-flex items-center gap-1 px-3 py-1 bg-primary-100 text-primary-700 rounded-full text-sm"
                    >
                      {dept.name}
                      <button
                        type="button"
                        onClick={() => removeDepartment(deptId)}
                        className="ml-1 text-primary-500 hover:text-primary-700"
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
                    departments.map(dept => (
                      <label
                        key={dept._id}
                        className="flex items-center px-4 py-2 hover:bg-gray-50 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={formData.departments?.includes(dept._id) || false}
                          onChange={() => handleDepartmentToggle(dept._id)}
                          className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                        />
                        <span className="ml-3 text-gray-700">{dept.name}</span>
                        {dept.code && (
                          <span className="ml-2 text-xs text-gray-400">({dept.code})</span>
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
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Designation
              </label>
              <select
                name="designation"
                value={formData.designation}
                onChange={handleChange}
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

            {/* Level - Auto-populated from designation but can be overridden */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Level
              </label>
              <select
                name="designationLevel"
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
              {formData.designationLevelName && (
                <p className="text-xs text-gray-500 mt-1">
                  Current: {formData.designationLevelName}
                </p>
              )}
            </div>
          </div>

          {/* Company */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Company
            </label>
            <select
              name="company"
              value={formData.company}
              onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              <option value="">Select Company</option>
              {companies.map((company) => (
                <option key={company._id} value={company._id}>
                  {company.name} ({company.code})
                </option>
              ))}
            </select>
          </div>

          {/* Employment Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Employment Type
            </label>
            <select
              name="employmentType"
              value={formData.employmentType}
              onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              <option value="full-time">Full Time</option>
              <option value="part-time">Part Time</option>
              <option value="contract">Contract</option>
              <option value="intern">Intern</option>
            </select>
          </div>

          {/* Status */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Status
            </label>
            <select
              name="status"
              value={formData.status}
              onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>

          {/* Password */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Password <span className="text-red-500">*</span>
            </label>
            <input
              type="password"
              name="password"
              value={formData.password}
              onChange={handleChange}
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              placeholder="Enter login password"
            />
            <p className="text-xs text-gray-500 mt-1">
              This will be used for employee login. Default: employee123
            </p>
          </div>

          {/* Role */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              User Role <span className="text-red-500">*</span>
            </label>
            <select
              name="role"
              value={formData.role}
              onChange={handleChange}
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              <option value="employee">Employee</option>
              <option value="manager">Manager</option>
              <option value="hr">HR</option>
              <option value="admin">Admin</option>
            </select>
            <p className="text-xs text-gray-500 mt-1">
              Determines access level in the system
            </p>
          </div>
        </div>

        {/* Salary & Statutory Section */}
        <div className="mt-8 border-t pt-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
            💰 Salary & Statutory Details
            <span className="text-sm font-normal text-gray-500">(Optional - can be added later)</span>
          </h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Gross Salary */}
            <div className="lg:col-span-3">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Gross Salary (Monthly) <span className="text-xs text-blue-600 ml-2">← Enter this to auto-calculate breakdown</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">₹</span>
                <input
                  type="number"
                  value={formData.salary.grossSalary}
                  onChange={(e) => handleGrossSalaryChange(e.target.value)}
                  className="w-full pl-8 pr-4 py-2 border-2 border-blue-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-blue-500 bg-blue-50"
                  placeholder="50000"
                />
              </div>
              <p className="text-xs text-gray-500 mt-1">Auto-distributes: Basic 40%, HRA 40% of Basic, Conveyance ₹800, Medical 5%, Special = Remainder</p>
            </div>

            {/* Basic Salary */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Basic Salary <span className="text-xs text-gray-400">(40%)</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">₹</span>
                <input
                  type="number"
                  value={formData.salary.basic}
                  onChange={(e) => handleSalaryComponentChange('basic', e.target.value)}
                  className="w-full pl-8 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  placeholder="25000"
                />
              </div>
            </div>

            {/* HRA */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                HRA <span className="text-xs text-gray-400">(40% of Basic)</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">₹</span>
                <input
                  type="number"
                  value={formData.salary.hra}
                  onChange={(e) => handleSalaryComponentChange('hra', e.target.value)}
                  className="w-full pl-8 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  placeholder="10000"
                />
              </div>
            </div>

            {/* Conveyance */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Conveyance <span className="text-xs text-gray-400">(₹800 default)</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">₹</span>
                <input
                  type="number"
                  value={formData.salary.conveyance}
                  onChange={(e) => handleSalaryComponentChange('conveyance', e.target.value)}
                  className="w-full pl-8 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  placeholder="800"
                />
              </div>
            </div>

            {/* Medical */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Medical <span className="text-xs text-gray-400">(5%)</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">₹</span>
                <input
                  type="number"
                  value={formData.salary.medical}
                  onChange={(e) => handleSalaryComponentChange('medical', e.target.value)}
                  className="w-full pl-8 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  placeholder="1250"
                />
              </div>
            </div>

            {/* Special Allowance */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Special Allowance <span className="text-xs text-green-600">(auto-adjusted)</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">₹</span>
                <input
                  type="number"
                  value={formData.salary.special}
                  onChange={(e) => handleSalaryComponentChange('special', e.target.value)}
                  className="w-full pl-8 pr-4 py-2 border border-green-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent bg-green-50"
                  placeholder="5000"
                  readOnly
                />
              </div>
              <p className="text-xs text-green-600 mt-1">Auto-adjusts to balance gross salary</p>
            </div>

            {/* Total Summary */}
            {formData.salary.grossSalary && (
              <div className="lg:col-span-3 p-3 bg-gray-100 rounded-lg">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-gray-600">Total of components:</span>
                  <span className={`font-semibold ${
                    (parseFloat(formData.salary.basic || 0) + 
                     parseFloat(formData.salary.hra || 0) + 
                     parseFloat(formData.salary.conveyance || 0) + 
                     parseFloat(formData.salary.medical || 0) + 
                     parseFloat(formData.salary.special || 0)) === parseFloat(formData.salary.grossSalary || 0)
                      ? 'text-green-600' 
                      : 'text-red-600'
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
            <div className="p-4 bg-gray-50 rounded-lg border">
              <div className="flex items-center justify-between mb-4">
                <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
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
                  <span className="text-sm text-gray-600">{formData.pfEnrollment.enrolled ? 'Enrolled' : 'Not Enrolled'}</span>
                </div>
              </div>
              
              {formData.pfEnrollment.enrolled && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">PF Number</label>
                      <input
                        type="text"
                        value={formData.pfEnrollment.pfNumber}
                        onChange={(e) => setFormData({
                          ...formData,
                          pfEnrollment: { ...formData.pfEnrollment, pfNumber: e.target.value }
                        })}
                        className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-primary-500"
                        placeholder="PF Number"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">UAN Number</label>
                      <input
                        type="text"
                        value={formData.pfEnrollment.uanNumber}
                        onChange={(e) => setFormData({
                          ...formData,
                          pfEnrollment: { ...formData.pfEnrollment, uanNumber: e.target.value }
                        })}
                        className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-primary-500"
                        placeholder="UAN Number"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Employee Contribution %</label>
                      <input
                        type="number"
                        value={formData.pfEnrollment.employeeContribution}
                        onChange={(e) => setFormData({
                          ...formData,
                          pfEnrollment: { ...formData.pfEnrollment, employeeContribution: parseFloat(e.target.value) || 12 }
                        })}
                        className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-primary-500"
                        min="0"
                        max="100"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Employer Contribution %</label>
                      <input
                        type="number"
                        value={formData.pfEnrollment.employerContribution}
                        onChange={(e) => setFormData({
                          ...formData,
                          pfEnrollment: { ...formData.pfEnrollment, employerContribution: parseFloat(e.target.value) || 12 }
                        })}
                        className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-primary-500"
                        min="0"
                        max="100"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* ESI Enrollment */}
            <div className="p-4 bg-gray-50 rounded-lg border">
              <div className="flex items-center justify-between mb-4">
                <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
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
                  <span className="text-sm text-gray-600">{formData.esiEnrollment.enrolled ? 'Enrolled' : 'Not Enrolled'}</span>
                </div>
              </div>
              
              {formData.esiEnrollment.enrolled && (
                <div>
                  <label className="block text-xs text-gray-600 mb-1">ESI Number</label>
                  <input
                    type="text"
                    value={formData.esiEnrollment.esiNumber}
                    onChange={(e) => setFormData({
                      ...formData,
                      esiEnrollment: { ...formData.esiEnrollment, esiNumber: e.target.value }
                    })}
                    className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-primary-500"
                    placeholder="ESI Number"
                  />
                  <p className="text-xs text-gray-500 mt-1">Applicable for gross ≤ ₹21,000</p>
                </div>
              )}
            </div>
          </div>

          {/* Professional Tax */}
          <div className="mt-4 p-4 bg-gray-50 rounded-lg border">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
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
                    <span className="text-sm text-gray-600">₹</span>
                    <input
                      type="number"
                      value={formData.professionalTax.amount}
                      onChange={(e) => setFormData({
                        ...formData,
                        professionalTax: { ...formData.professionalTax, amount: parseFloat(e.target.value) || 200 }
                      })}
                      className="w-24 px-3 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-primary-500"
                    />
                    <span className="text-sm text-gray-500">/month</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Corporate Health Insurance */}
          <div className="mt-4 p-4 bg-gray-50 rounded-lg border">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
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
                    onChange={(e) => setFormData({
                      ...formData,
                      healthInsurance: { ...formData.healthInsurance, provider: e.target.value }
                    })}
                    className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-primary-500"
                    placeholder="e.g., ICICI Lombard, Star Health"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Policy Number</label>
                  <input
                    type="text"
                    value={formData.healthInsurance.policyNumber}
                    onChange={(e) => setFormData({
                      ...formData,
                      healthInsurance: { ...formData.healthInsurance, policyNumber: e.target.value }
                    })}
                    className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-primary-500"
                    placeholder="Enter policy number"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Login Credentials Info */}
        <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <h3 className="text-sm font-semibold text-blue-800 mb-2">
            📧 Login Credentials
          </h3>
          <p className="text-sm text-blue-700">
            A user account will be automatically created with the email and password provided above.
            The employee can use these credentials to login and mark attendance.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex justify-end space-x-4 mt-6">
          <button
            type="button"
            onClick={() => router.push('/dashboard/employees')}
            className="btn-secondary flex items-center space-x-2"
          >
            <FaTimes />
            <span>Cancel</span>
          </button>
          <button
            type="submit"
            disabled={loading}
            className="btn-primary flex items-center space-x-2"
          >
            <FaSave />
            <span>{loading ? 'Saving...' : 'Save Employee'}</span>
          </button>
        </div>
      </form>
      )}
    </div>
  )
}

