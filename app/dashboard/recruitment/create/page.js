'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import toast from '@/utils/toast'
import { FaArrowLeft, FaSave, FaTimes, FaPlus } from 'react-icons/fa'
import { Card, CardBody, CardHeader, Button, Input, Select, SelectItem, Textarea, Checkbox } from '@heroui/react'

export default function CreateJobPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [departments, setDepartments] = useState([])
  const [employees, setEmployees] = useState([])
  const [formData, setFormData] = useState({
    title: '',
    department: '',
    location: '',
    employmentType: 'full-time',
    experienceLevel: 'mid-level',
    salaryRange: {
      min: '',
      max: '',
      currency: 'USD'
    },
    description: '',
    requirements: [''],
    responsibilities: [''],
    benefits: [''],
    hiringManager: '',
    applicationDeadline: '',
    status: 'active',
    skills: [''],
    educationLevel: 'bachelor',
    remote: false
  })

  useEffect(() => {
    fetchDepartments()
    fetchEmployees()
  }, [])

  const fetchDepartments = async () => {
    try {
      const response = await fetch('/api/departments')
      const data = await response.json()
      if (data.success) {
        setDepartments(data.data)
      }
    } catch (error) {
      console.error('Fetch departments error:', error)
    }
  }

  const fetchEmployees = async () => {
    try {
      const response = await fetch('/api/employees?limit=1000')
      const data = await response.json()
      if (data.success) {
        setEmployees(data.data.filter(emp => ['manager', 'hr', 'admin'].includes(emp.role)))
      }
    } catch (error) {
      console.error('Fetch employees error:', error)
    }
  }

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target
    if (name.includes('.')) {
      const [parent, child] = name.split('.')
      setFormData(prev => ({
        ...prev,
        [parent]: {
          ...prev[parent],
          [child]: value
        }
      }))
    } else {
      setFormData(prev => ({
        ...prev,
        [name]: type === 'checkbox' ? checked : value
      }))
    }
  }

  const handleArrayChange = (field, index, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: prev[field].map((item, i) => i === index ? value : item)
    }))
  }

  const addArrayItem = (field) => {
    setFormData(prev => ({
      ...prev,
      [field]: [...prev[field], '']
    }))
  }

  const removeArrayItem = (field, index) => {
    setFormData(prev => ({
      ...prev,
      [field]: prev[field].filter((_, i) => i !== index)
    }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    
    if (!formData.title) {
      toast.error('Please enter job title')
      return
    }
    
    if (!formData.department) {
      toast.error('Please select department')
      return
    }

    if (!formData.description) {
      toast.error('Please enter job description')
      return
    }

    setLoading(true)
    
    try {
      const response = await fetch('/api/recruitment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
          ...formData,
          requirements: formData.requirements.filter(r => r.trim()),
          responsibilities: formData.responsibilities.filter(r => r.trim()),
          benefits: formData.benefits.filter(b => b.trim()),
          skills: formData.skills.filter(s => s.trim())
        })
      })

      const data = await response.json()
      
      if (data.success) {
        toast.success('Job posting created successfully')
        router.push('/dashboard/recruitment')
      } else {
        toast.error(data.message || 'Failed to create job posting')
      }
    } catch (error) {
      console.error('Create job error:', error)
      toast.error('Failed to create job posting')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-4">
          <button
            onClick={() => router.back()}
            className="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <FaArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-3xl font-bold text-gray-800">Create Job Posting</h1>
            <p className="text-gray-600 mt-1">Post a new job opening</p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic Information */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-xl font-semibold text-gray-800 mb-4">Basic Information</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Job Title *
              </label>
              <input
                type="text"
                name="title"
                value={formData.title}
                onChange={handleInputChange}
                placeholder="e.g., Senior Software Engineer"
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>
            <div>
              <Select
                label="Department"
                isRequired
                selectedKeys={formData.department ? [formData.department] : []}
                onSelectionChange={(keys) => {
                  const value = Array.from(keys)[0] || ''
                  setFormData(prev => ({ ...prev, department: value }))
                }}
                placeholder="Select Department"
              >
                {departments.map((dept) => (
                  <SelectItem key={dept._id}>{dept.name}</SelectItem>
                ))}
              </Select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Location
              </label>
              <input
                type="text"
                name="location"
                value={formData.location}
                onChange={handleInputChange}
                placeholder="e.g., New York, NY"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>
            <div>
              <Select
                label="Employment Type"
                selectedKeys={[formData.employmentType]}
                onSelectionChange={(keys) => {
                  const value = Array.from(keys)[0] || 'full-time'
                  setFormData(prev => ({ ...prev, employmentType: value }))
                }}
              >
                <SelectItem key="full-time">Full-time</SelectItem>
                <SelectItem key="part-time">Part-time</SelectItem>
                <SelectItem key="contract">Contract</SelectItem>
                <SelectItem key="internship">Internship</SelectItem>
              </Select>
            </div>
            <div>
              <Select
                label="Experience Level"
                selectedKeys={[formData.experienceLevel]}
                onSelectionChange={(keys) => {
                  const value = Array.from(keys)[0] || 'mid-level'
                  setFormData(prev => ({ ...prev, experienceLevel: value }))
                }}
              >
                <SelectItem key="entry-level">Entry Level</SelectItem>
                <SelectItem key="mid-level">Mid Level</SelectItem>
                <SelectItem key="senior-level">Senior Level</SelectItem>
                <SelectItem key="executive">Executive</SelectItem>
              </Select>
            </div>
            <div>
              <Select
                label="Hiring Manager"
                selectedKeys={formData.hiringManager ? [formData.hiringManager] : []}
                onSelectionChange={(keys) => {
                  const value = Array.from(keys)[0] || ''
                  setFormData(prev => ({ ...prev, hiringManager: value }))
                }}
                placeholder="Select Hiring Manager"
              >
                {employees.map((emp) => (
                  <SelectItem key={emp._id}>{emp.firstName} {emp.lastName}</SelectItem>
                ))}
              </Select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Application Deadline
              </label>
              <input
                type="date"
                name="applicationDeadline"
                value={formData.applicationDeadline}
                onChange={handleInputChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>
            <div>
              <Select
                label="Status"
                selectedKeys={[formData.status]}
                onSelectionChange={(keys) => {
                  const value = Array.from(keys)[0] || 'active'
                  setFormData(prev => ({ ...prev, status: value }))
                }}
              >
                <SelectItem key="active">Active</SelectItem>
                <SelectItem key="draft">Draft</SelectItem>
                <SelectItem key="closed">Closed</SelectItem>
                <SelectItem key="on-hold">On Hold</SelectItem>
              </Select>
            </div>
          </div>
          
          {/* Remote Work Option */}
          <div className="mt-4">
            <Checkbox
              isSelected={formData.remote}
              onValueChange={(checked) => setFormData(prev => ({ ...prev, remote: checked }))}
            >
              Remote work available
            </Checkbox>
          </div>
        </div>

        {/* Salary Range */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-xl font-semibold text-gray-800 mb-4">Salary Range</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Minimum Salary
              </label>
              <input
                type="number"
                name="salaryRange.min"
                value={formData.salaryRange.min}
                onChange={handleInputChange}
                placeholder="50000"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Maximum Salary
              </label>
              <input
                type="number"
                name="salaryRange.max"
                value={formData.salaryRange.max}
                onChange={handleInputChange}
                placeholder="80000"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>
            <div>
              <Select
                label="Currency"
                selectedKeys={[formData.salaryRange.currency]}
                onSelectionChange={(keys) => {
                  const value = Array.from(keys)[0] || 'USD'
                  setFormData(prev => ({ ...prev, salaryRange: { ...prev.salaryRange, currency: value } }))
                }}
              >
                <SelectItem key="USD">USD</SelectItem>
                <SelectItem key="EUR">EUR</SelectItem>
                <SelectItem key="GBP">GBP</SelectItem>
                <SelectItem key="INR">INR</SelectItem>
              </Select>
            </div>
          </div>
        </div>

        {/* Job Description */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-xl font-semibold text-gray-800 mb-4">Job Description</h2>
          <textarea
            name="description"
            value={formData.description}
            onChange={handleInputChange}
            placeholder="Provide a detailed description of the job role..."
            rows={6}
            required
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
        </div>

        {/* Action Buttons */}
        <div className="flex justify-end space-x-4">
          <Button
            variant="bordered"
            onPress={() => router.back()}
            startContent={<FaTimes className="w-4 h-4" />}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            color="primary"
            isLoading={loading}
            startContent={!loading && <FaSave className="w-4 h-4" />}
          >
            {loading ? 'Creating...' : 'Create Job Posting'}
          </Button>
        </div>
      </form>
    </div>
  )
}
