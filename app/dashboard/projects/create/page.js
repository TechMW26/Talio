'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import toast from '@/utils/toast'
import {
  HiOutlineArrowLeft,
  HiOutlinePlus,
  HiOutlineMagnifyingGlass
} from 'react-icons/hi2'
import {
  FaArrowLeft, FaSave, FaCalendarAlt, FaUsers, FaTimes,
  FaPlus, FaSearch
} from 'react-icons/fa'
import { formatDepartments } from '@/lib/formatters'
import Portal from '@/components/ui/Portal'

export default function CreateProjectPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [employees, setEmployees] = useState([])
  const [departments, setDepartments] = useState([])
  const [searchEmployee, setSearchEmployee] = useState('')
  const [showEmployeeSearch, setShowEmployeeSearch] = useState(false)
  const [user, setUser] = useState(null)

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    startDate: '',
    endDate: '',
    projectHeadId: '',
    priority: 'medium',
    department: '',
    tags: '',
    status: 'planned',
    members: []
  })

  useEffect(() => {
    const userData = localStorage.getItem('user')
    if (userData) {
      setUser(JSON.parse(userData))
    }
    fetchEmployees()
    fetchDepartments()
  }, [])

  const fetchEmployees = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/employees?limit=500&status=active', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await response.json()
      if (data.success) {
        setEmployees(data.data || [])
      }
    } catch (error) {
      console.error('Fetch employees error:', error)
    }
  }

  const fetchDepartments = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/departments', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await response.json()
      if (data.success) {
        setDepartments(data.data || [])
      }
    } catch (error) {
      console.error('Fetch departments error:', error)
    }
  }

  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
  }

  const handleAddMember = (employee) => {
    if (formData.members.some(m => m.userId === employee._id)) {
      toast.error('Member already added')
      return
    }
    if (employee._id === formData.projectHeadId) {
      toast.error('Project head is automatically added as a member')
      return
    }

    setFormData(prev => ({
      ...prev,
      members: [...prev.members, {
        userId: employee._id,
        name: `${employee.firstName} ${employee.lastName}`,
        profilePicture: employee.profilePicture,
        department: formatDepartments(employee),
        role: 'member'
      }]
    }))
    setShowEmployeeSearch(false)
    setSearchEmployee('')
  }

  const handleRemoveMember = (userId) => {
    setFormData(prev => ({
      ...prev,
      members: prev.members.filter(m => m.userId !== userId)
    }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (!formData.name.trim()) {
      toast.error('Project name is required')
      return
    }
    if (!formData.startDate) {
      toast.error('Start date is required')
      return
    }
    if (!formData.endDate) {
      toast.error('End date is required')
      return
    }
    if (!formData.projectHeadId) {
      toast.error('Project head is required')
      return
    }

    const startDate = new Date(formData.startDate)
    const endDate = new Date(formData.endDate)
    if (endDate < startDate) {
      toast.error('End date must be after start date')
      return
    }

    setLoading(true)

    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          name: formData.name.trim(),
          description: formData.description.trim(),
          startDate: formData.startDate,
          endDate: formData.endDate,
          projectHeadId: formData.projectHeadId,
          priority: formData.priority,
          department: formData.department || undefined,
          tags: formData.tags.split(',').map(t => t.trim()).filter(t => t),
          status: formData.status,
          members: formData.members.map(m => ({
            userId: m.userId,
            role: m.role
          }))
        })
      })

      const data = await response.json()

      if (data.success) {
        toast.success('Project created successfully!')
        router.push(`/dashboard/projects/${data.data._id}`)
      } else {
        toast.error(data.message || 'Failed to create project')
      }
    } catch (error) {
      console.error('Create project error:', error)
      toast.error('An error occurred while creating the project')
    } finally {
      setLoading(false)
    }
  }

  const filteredEmployees = employees.filter(emp => {
    const fullName = `${emp.firstName} ${emp.lastName}`.toLowerCase()
    const matchesSearch = searchEmployee === '' ||
      fullName.includes(searchEmployee.toLowerCase()) ||
      emp.email?.toLowerCase().includes(searchEmployee.toLowerCase()) ||
      emp.employeeCode?.toLowerCase().includes(searchEmployee.toLowerCase())

    // Exclude already added members and project head
    const notAlreadyAdded = !formData.members.some(m => m.userId === emp._id)
    const notProjectHead = emp._id !== formData.projectHeadId

    return matchesSearch && notAlreadyAdded && notProjectHead
  })

  const selectedProjectHead = employees.find(e => e._id === formData.projectHeadId)

  return (
    <div className="page-container max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={() => router.back()}
          className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <HiOutlineArrowLeft className="w-5 h-5 text-gray-600" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Create New Project</h1>
          <p className="text-gray-600 mt-1">Set up a new project and invite team members</p>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="bg-white rounded-xl shadow-sm p-6 mb-6 border border-gray-100">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">Project Details</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Project Name */}
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Project Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleChange}
                placeholder="Enter project name"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                required
              />
            </div>

            {/* Description */}
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Description
              </label>
              <textarea
                name="description"
                value={formData.description}
                onChange={handleChange}
                placeholder="Describe the project objectives and scope..."
                rows={4}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
              />
            </div>

            {/* Start Date */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Start Date <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <FaCalendarAlt className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="date"
                  name="startDate"
                  value={formData.startDate}
                  onChange={handleChange}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  required
                />
              </div>
            </div>

            {/* End Date */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                End Date / Deadline <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <FaCalendarAlt className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="date"
                  name="endDate"
                  value={formData.endDate}
                  onChange={handleChange}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  required
                />
              </div>
            </div>

            {/* Priority */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Priority
              </label>
              <select
                name="priority"
                value={formData.priority}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>

            {/* Status */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Initial Status
              </label>
              <select
                name="status"
                value={formData.status}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              >
                <option value="planned">Planned</option>
                <option value="ongoing">Ongoing</option>
              </select>
            </div>

            {/* Department */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Department (Optional)
              </label>
              <select
                name="department"
                value={formData.department}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              >
                <option value="">Select Department</option>
                {departments.map(dept => (
                  <option key={dept._id} value={dept._id}>{dept.name}</option>
                ))}
              </select>
            </div>

            {/* Tags */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Tags (comma-separated)
              </label>
              <input
                type="text"
                name="tags"
                value={formData.tags}
                onChange={handleChange}
                placeholder="e.g., frontend, urgent, Q1"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>
          </div>
        </div>

        {/* Project Head Section */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6 mb-6">
          <h2 className="text-lg font-semibold text-black-800 mb-4">
            Project Head <span className="text-red-500">*</span>
          </h2>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Select Project Head
            </label>
            <select
              name="projectHeadId"
              value={formData.projectHeadId}
              onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              required
            >
              <option value="">Select an employee</option>
              {employees.map(emp => (
                <option key={emp._id} value={emp._id}>
                  {emp.firstName} {emp.lastName} - {emp.department?.name || 'No Dept'}
                </option>
              ))}
            </select>
          </div>

          {selectedProjectHead && (
            <div className="mt-4 p-4 bg-primary-50 rounded-lg flex items-center">
              <div className="w-12 h-12 rounded-full bg-primary-500 flex items-center justify-center text-white font-medium overflow-hidden">
                {selectedProjectHead.profilePicture ? (
                  <img
                    src={selectedProjectHead.profilePicture}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span>{selectedProjectHead.firstName?.[0]}{selectedProjectHead.lastName?.[0]}</span>
                )}
              </div>
              <div className="ml-4">
                <p className="font-medium text-gray-800">
                  {selectedProjectHead.firstName} {selectedProjectHead.lastName}
                </p>
                <p className="text-sm text-gray-500">{selectedProjectHead.email}</p>
              </div>
            </div>
          )}
        </div>

        {/* Team Members Section */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-black-800 dark:text-black">
              <FaUsers className="inline mr-2" />
              Team Members
            </h2>
            <button
              type="button"
              onClick={() => setShowEmployeeSearch(true)}
              className="btn-secondary flex items-center text-sm"
            >
              <FaPlus className="mr-1" />
              Add Member
            </button>
          </div>

          {formData.members.length === 0 ? (
            <p className="text-gray-500 text-center py-8">
              No team members added yet. Click "Add Member" to invite team members.
            </p>
          ) : (
            <div className="space-y-3">
              {formData.members.map((member) => (
                <div key={member.userId} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center">
                    <div className="w-10 h-10 rounded-full bg-primary-500 flex items-center justify-center text-white text-sm overflow-hidden">
                      {member.profilePicture ? (
                        <img src={member.profilePicture} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <span>{member.name.split(' ').map(n => n[0]).join('')}</span>
                      )}
                    </div>
                    <div className="ml-3">
                      <p className="font-medium text-gray-800">{member.name}</p>
                      <p className="text-sm text-gray-500">{member.department || 'No Department'}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveMember(member.userId)}
                    className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <FaTimes />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Submit Buttons */}
        <div className="flex justify-end gap-4">
          <button
            type="button"
            onClick={() => router.back()}
            className="btn-secondary"
            disabled={loading}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn-primary flex items-center"
            disabled={loading}
          >
            {loading ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                Creating...
              </>
            ) : (
              <>
                <FaSave className="mr-2" />
                Create Project
              </>
            )}
          </button>
        </div>
      </form>

      {/* Employee Search Modal */}
      {showEmployeeSearch && (
      <Portal>
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9999] p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
            <div className="p-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
              <h3 className="text-lg font-semibold">Add Team Member</h3>
              <button
                onClick={() => {
                  setShowEmployeeSearch(false)
                  setSearchEmployee('')
                }}
                className="p-2 hover:bg-gray-100 rounded-lg"
              >
                <FaTimes />
              </button>
            </div>

            <div className="p-4 border-b border-gray-200">
              <div className="relative">
                <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={searchEmployee}
                  onChange={(e) => setSearchEmployee(e.target.value)}
                  placeholder="Search by name, email, or code..."
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  autoFocus
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {filteredEmployees.length === 0 ? (
                <p className="text-center text-gray-500 py-8">No employees found</p>
              ) : (
                <div className="space-y-2">
                  {filteredEmployees.slice(0, 20).map(emp => (
                    <button
                      key={emp._id}
                      type="button"
                      onClick={() => handleAddMember(emp)}
                      className="w-full flex items-center p-3 hover:bg-gray-50 rounded-lg transition-colors text-left"
                    >
                      <div className="w-10 h-10 rounded-full bg-primary-500 flex items-center justify-center text-white text-sm overflow-hidden">
                        {emp.profilePicture ? (
                          <img src={emp.profilePicture} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <span>{emp.firstName?.[0]}{emp.lastName?.[0]}</span>
                        )}
                      </div>
                      <div className="ml-3">
                        <p className="font-medium text-gray-800">
                          {emp.firstName} {emp.lastName}
                        </p>
                        <p className="text-sm text-gray-500">
                          {emp.email} • {emp.department?.name || 'No Dept'}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </Portal>
      )}
    </div>
  )
}
