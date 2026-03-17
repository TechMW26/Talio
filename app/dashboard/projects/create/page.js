'use client'

import { useState, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import toast from '@/utils/toast'
import { Card, CardBody, CardHeader, Button, Input, Select, SelectItem, Textarea, Skeleton, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Spinner } from '@heroui/react'
import {
  HiOutlineArrowLeft,
  HiOutlinePlus,
  HiOutlineMagnifyingGlass,
  HiOutlineSparkles
} from 'react-icons/hi2'
import {
  FaArrowLeft, FaSave, FaCalendarAlt, FaUsers, FaTimes,
  FaPlus, FaSearch, FaChevronDown, FaChevronRight, FaCheckSquare
} from 'react-icons/fa'
import { formatDepartments } from '@/lib/formatters'
import Portal from '@/components/ui/Portal'
import ModalPortal from '@/components/ui/ModalPortal'
import { useAILoading } from '@/contexts/AILoadingContext'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import useApiMutation from '@/hooks/useApiMutation'
import LoadingButton from '@/components/ui/LoadingButton'

export default function CreateProjectPage() {
  const router = useRouter()
  const [generatingDescription, setGeneratingDescription] = useState(false)
  const [searchEmployee, setSearchEmployee] = useState('')
  const [showEmployeeSearch, setShowEmployeeSearch] = useState(false)
  const [expandedMemberDepts, setExpandedMemberDepts] = useState({})
  const [expandedHeadDepts, setExpandedHeadDepts] = useState({})

  const { startAILoading, stopAILoading } = useAILoading()

  // --- useMemo: user ---
  const user = useMemo(() => { try { return JSON.parse(localStorage.getItem('user')) } catch { return null } }, [])

  // --- SWR: Dropdown data ---
  const { data: empRes } = useAuthedSWR('/api/employees?limit=500&status=active')
  const employees = empRes?.data || []

  const { data: deptRes } = useAuthedSWR('/api/departments')
  const departments = deptRes?.data || []

  // --- Submit mutation ---
  const submitMutation = useApiMutation({
    onSuccess: (data) => {
      toast.success('Project created successfully!')
      router.push(`/dashboard/projects/${data.data._id}`)
    },
    onError: (msg) => toast.error(msg || 'Failed to create project'),
  })

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    startDate: '',
    endDate: '',
    projectHeadIds: [], // Support multiple project heads
    priority: 'medium',
    department: '',
    tags: '',
    status: 'planned',
    members: []
  })
  const [showHeadSearch, setShowHeadSearch] = useState(false)
  const [searchHead, setSearchHead] = useState('')

  // Auto-select creator as project head if not manually selected
  useEffect(() => {
    if (employees.length > 0 && formData.projectHeadIds.length === 0 && user?.employeeId) {
      const creatorEmployeeId = typeof user.employeeId === 'object' ? user.employeeId._id : user.employeeId
      const creatorExists = employees.some(emp => emp._id === creatorEmployeeId)
      if (creatorExists) {
        setFormData(prev => ({
          ...prev,
          projectHeadIds: [creatorEmployeeId]
        }))
      }
    }
  }, [employees])

  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
  }

  const handleAddProjectHead = (employee) => {
    if (formData.projectHeadIds.includes(employee._id)) {
      toast.error('Already added as project head')
      return
    }
    // Remove from members if already there
    setFormData(prev => ({
      ...prev,
      projectHeadIds: [...prev.projectHeadIds, employee._id],
      members: prev.members.filter(m => m.userId !== employee._id)
    }))
    setShowHeadSearch(false)
    setSearchHead('')
  }

  const handleRemoveProjectHead = (headId) => {
    setFormData(prev => ({
      ...prev,
      projectHeadIds: prev.projectHeadIds.filter(id => id !== headId)
    }))
  }

  const handleAddMember = (employee) => {
    if (formData.members.some(m => m.userId === employee._id)) {
      toast.error('Member already added')
      return
    }
    if (formData.projectHeadIds.includes(employee._id)) {
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
    if (formData.projectHeadIds.length === 0) {
      toast.error('At least one project head is required')
      return
    }

    const startDate = new Date(formData.startDate)
    const endDate = new Date(formData.endDate)
    if (endDate < startDate) {
      toast.error('End date must be after start date')
      return
    }

    await submitMutation.execute('/api/projects', {
      name: formData.name.trim(),
      description: formData.description.trim(),
      startDate: formData.startDate,
      endDate: formData.endDate,
      projectHeadIds: formData.projectHeadIds,
      priority: formData.priority,
      department: formData.department || undefined,
      tags: formData.tags.split(',').map(t => t.trim()).filter(t => t),
      status: formData.status,
      members: formData.members.map(m => ({
        userId: m.userId,
        role: m.role
      }))
    })
  }

  // AI generate description
  const generateDescription = async () => {
    if (!formData.name.trim()) {
      toast.error('Please enter a project name first')
      return
    }

    setGeneratingDescription(true)
    startAILoading('MIRA is writing project description...')

    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/ai/generate-text', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          type: 'project_description',
          context: {
            projectName: formData.name,
            priority: formData.priority,
            department: departments.find(d => d._id === formData.department)?.name || '',
            tags: formData.tags
          }
        })
      })

      const data = await response.json()
      if (data.success && data.text) {
        setFormData(prev => ({ ...prev, description: data.text }))
        toast.success('Description generated!')
      } else {
        toast.error(data.message || 'Failed to generate description')
      }
    } catch (error) {
      console.error('AI generate error:', error)
      toast.error('Failed to generate description')
    } finally {
      setGeneratingDescription(false)
      stopAILoading()
    }
  }

  const filteredEmployees = employees.filter(emp => {
    const fullName = `${emp.firstName} ${emp.lastName}`.toLowerCase()
    const matchesSearch = searchEmployee === '' ||
      fullName.includes(searchEmployee.toLowerCase()) ||
      emp.email?.toLowerCase().includes(searchEmployee.toLowerCase()) ||
      emp.employeeCode?.toLowerCase().includes(searchEmployee.toLowerCase())

    // Exclude already added members and project heads
    const notAlreadyAdded = !formData.members.some(m => m.userId === emp._id)
    const notProjectHead = !formData.projectHeadIds.includes(emp._id)

    return matchesSearch && notAlreadyAdded && notProjectHead
  })

  // Filter employees for project head search
  const filteredHeadEmployees = employees.filter(emp => {
    const fullName = `${emp.firstName} ${emp.lastName}`.toLowerCase()
    const matchesSearch = searchHead === '' ||
      fullName.includes(searchHead.toLowerCase()) ||
      emp.email?.toLowerCase().includes(searchHead.toLowerCase()) ||
      emp.employeeCode?.toLowerCase().includes(searchHead.toLowerCase())

    // Exclude already added as head
    const notAlreadyHead = !formData.projectHeadIds.includes(emp._id)

    return matchesSearch && notAlreadyHead
  })

  const selectedProjectHeads = employees.filter(e => formData.projectHeadIds.includes(e._id))

  return (
    <div className="page-container max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Button
          isIconOnly
          variant="light"
          onPress={() => router.back()}
        >
          <HiOutlineArrowLeft className="w-5 h-5 text-default-600" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-default-800">Create New Project</h1>
          <p className="text-default-600 mt-1">Set up a new project and invite team members</p>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <Card shadow="sm" className="mb-6">
          <CardBody className="p-6">
            <h2 className="text-lg font-semibold text-default-800 mb-4">Project Details</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Project Name */}
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-default-700 mb-2">
                  Project Name <span className="text-danger">*</span>
                </label>
                <input
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  placeholder="Enter project name"
                  className="w-full px-4 py-2 border border-default-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  required
                />
              </div>

              {/* Description */}
              <div className="md:col-span-2">
                <div className="flex items-center justify-start mb-2">
                  <label className="block text-sm font-medium text-default-700">
                    Description
                  </label>
                  <Button
                    size="sm"
                    color="secondary"
                    variant="flat"
                    onPress={generateDescription}
                    isDisabled={generatingDescription || !formData.name.trim()}
                    isLoading={generatingDescription}
                    startContent={!generatingDescription && <HiOutlineSparkles className="w-3.5 h-3.5" />}
                    className="ml-2 bg-gradient-to-r from-purple-600 to-indigo-600 text-white"
                  >
                    {generatingDescription ? 'Writing...' : 'AI Write'}
                  </Button>
                </div>
                <textarea
                  name="description"
                  value={formData.description}
                  onChange={handleChange}
                  placeholder="Describe the project objectives and scope..."
                  rows={4}
                  className="w-full px-4 py-2 border border-default-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
                />
              </div>

              {/* Start Date */}
              <div>
                <label className="block text-sm font-medium text-default-700 mb-2">
                  Start Date <span className="text-danger">*</span>
                </label>
                <div className="relative">
                  <FaCalendarAlt className="absolute left-3 top-1/2 -translate-y-1/2 text-default-400" />
                  <input
                    type="date"
                    name="startDate"
                    value={formData.startDate}
                    onChange={handleChange}
                    className="w-full pl-10 pr-4 py-2 border border-default-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    required
                  />
                </div>
              </div>

              {/* End Date */}
              <div>
                <label className="block text-sm font-medium text-default-700 mb-2">
                  End Date / Deadline <span className="text-danger">*</span>
                </label>
                <div className="relative">
                  <FaCalendarAlt className="absolute left-3 top-1/2 -translate-y-1/2 text-default-400" />
                  <input
                    type="date"
                    name="endDate"
                    value={formData.endDate}
                    onChange={handleChange}
                    className="w-full pl-10 pr-4 py-2 border border-default-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    required
                  />
                </div>
              </div>

              {/* Priority */}
              <div>
                <label className="block text-sm font-medium text-default-700 mb-2">
                  Priority
                </label>
                <Select
                  name="priority"
                  selectedKeys={[formData.priority]}
                  onChange={handleChange}
                  aria-label="Priority"
                  classNames={{ trigger: "bg-white" }}
                >
                  <SelectItem key="low">Low</SelectItem>
                  <SelectItem key="medium">Medium</SelectItem>
                  <SelectItem key="high">High</SelectItem>
                  <SelectItem key="critical">Critical</SelectItem>
                </Select>
              </div>

              {/* Status */}
              <div>
                <label className="block text-sm font-medium text-default-700 mb-2">
                  Initial Status
                </label>
                <Select
                  name="status"
                  selectedKeys={[formData.status]}
                  onChange={handleChange}
                  aria-label="Initial Status"
                  classNames={{ trigger: "bg-white" }}
                >
                  <SelectItem key="planned">Planned</SelectItem>
                  <SelectItem key="ongoing">Ongoing</SelectItem>
                </Select>
              </div>

              {/* Department */}
              <div>
                <label className="block text-sm font-medium text-default-700 mb-2">
                  Department (Optional)
                </label>
                <Select
                  name="department"
                  selectedKeys={formData.department ? [formData.department] : []}
                  onChange={handleChange}
                  aria-label="Department"
                  placeholder="Select Department"
                  classNames={{ trigger: "bg-white" }}
                >
                  {departments.map(dept => (
                    <SelectItem key={dept._id}>{dept.name}</SelectItem>
                  ))}
                </Select>
              </div>

              {/* Tags */}
              <div>
                <label className="block text-sm font-medium text-default-700 mb-2">
                  Tags (comma-separated)
                </label>
                <input
                  type="text"
                  name="tags"
                  value={formData.tags}
                  onChange={handleChange}
                  placeholder="e.g., frontend, urgent, Q1"
                  className="w-full px-4 py-2 border border-default-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>
            </div>
          </CardBody>
        </Card>

        {/* Project Heads Section */}
        <Card shadow="sm" className="mb-6">
          <CardBody className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-default-800">
                Project Heads <span className="text-danger">*</span>
              </h2>
              <Button
                variant="bordered"
                size="sm"
                onPress={() => setShowHeadSearch(true)}
                startContent={<FaPlus />}
              >
                Add Head
              </Button>
            </div>

            {selectedProjectHeads.length === 0 ? (
              <p className="text-default-500 text-center py-8">
                No project heads added yet. Click "Add Head" to assign project heads.
              </p>
            ) : (
              <div className="space-y-3">
                {selectedProjectHeads.map((head) => (
                  <div key={head._id} className="flex items-center justify-between p-3 bg-primary-50 dark:bg-primary-900/20 rounded-lg">
                    <div className="flex items-center">
                      <div className="w-12 h-12 rounded-full bg-primary-500 flex items-center justify-center text-white font-medium overflow-hidden">
                        {head.profilePicture ? (
                          <img
                            src={head.profilePicture}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <span>{head.firstName?.[0]}{head.lastName?.[0]}</span>
                        )}
                      </div>
                      <div className="ml-4">
                        <p className="font-medium text-default-800">
                          {head.firstName} {head.lastName}
                        </p>
                        <p className="text-sm text-default-500">{head.email}</p>
                      </div>
                    </div>
                    <Button
                      isIconOnly
                      variant="light"
                      color="danger"
                      onPress={() => handleRemoveProjectHead(head._id)}
                    >
                      <FaTimes />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        {/* Team Members Section */}
        <Card shadow="sm" className="mb-6">
          <CardBody className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-default-800">
                <FaUsers className="inline mr-2" />
                Team Members
              </h2>
              <Button
                variant="bordered"
                size="sm"
                onPress={() => setShowEmployeeSearch(true)}
                startContent={<FaPlus />}
              >
                Add Member
              </Button>
            </div>

            {formData.members.length === 0 ? (
              <p className="text-default-500 text-center py-8">
                No team members added yet. Click "Add Member" to invite team members.
              </p>
            ) : (
              <div className="space-y-3">
                {formData.members.map((member) => (
                  <div key={member.userId} className="flex items-center justify-between p-3 bg-default-50 rounded-lg">
                    <div className="flex items-center">
                      <div className="w-10 h-10 rounded-full bg-primary-500 flex items-center justify-center text-white text-sm overflow-hidden">
                        {member.profilePicture ? (
                          <img src={member.profilePicture} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <span>{member.name.split(' ').map(n => n[0]).join('')}</span>
                        )}
                      </div>
                      <div className="ml-3">
                        <p className="font-medium text-default-800">{member.name}</p>
                        <p className="text-sm text-default-500">{member.department || 'No Department'}</p>
                      </div>
                    </div>
                    <Button
                      isIconOnly
                      variant="light"
                      color="danger"
                      onPress={() => handleRemoveMember(member.userId)}
                    >
                      <FaTimes />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        {/* Submit Buttons */}
        <div className="flex justify-end gap-4">
          <Button
            variant="bordered"
            onPress={() => router.back()}
            isDisabled={submitMutation.isLoading}
          >
            Cancel
          </Button>
          <LoadingButton
            type="submit"
            color="primary"
            isLoading={submitMutation.isLoading}
            loadingText="Creating..."
            startContent={<FaSave />}
          >
            Create Project
          </LoadingButton>
        </div>
      </form>

      {/* Employee Search Modal */}
      <ModalPortal isOpen={showEmployeeSearch}>
        <div className="fixed inset-0 modal-overlay flex items-center justify-center z-[9999] p-4">
          <div className="bg-content1 rounded-[30px] shadow-xl w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col animate-modal-enter">
            <div className="p-4 border-b border-default-200 flex items-center justify-between flex-shrink-0">
              <h3 className="text-lg font-semibold">Add Team Member</h3>
              <Button
                isIconOnly
                variant="light"
                onPress={() => {
                  setShowEmployeeSearch(false)
                  setSearchEmployee('')
                }}
              >
                <FaTimes />
              </Button>
            </div>

            <div className="p-4 border-b border-default-200">
              <div className="relative">
                <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-default-400" />
                <input
                  type="text"
                  value={searchEmployee}
                  onChange={(e) => setSearchEmployee(e.target.value)}
                  placeholder="Search by name, email, or code..."
                  className="w-full pl-10 pr-4 py-2 border border-default-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  autoFocus
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {filteredEmployees.length === 0 ? (
                <p className="text-center text-default-500 py-8">No employees found</p>
              ) : (
                <div className="space-y-2">
                  {/* Group employees by department */}
                  {Object.entries(
                    filteredEmployees.reduce((acc, emp) => {
                      const deptName = emp.department?.name || 'No Department'
                      if (!acc[deptName]) acc[deptName] = []
                      acc[deptName].push(emp)
                      return acc
                    }, {})
                  ).sort(([a], [b]) => a.localeCompare(b)).map(([deptName, deptEmployees]) => {
                    const isExpanded = expandedMemberDepts[deptName]
                    const allSelected = deptEmployees.every(emp =>
                      formData.members.some(m => m.userId === emp._id)
                    )

                    return (
                      <div key={deptName} className="border border-default-200 rounded-lg overflow-hidden">
                        {/* Department Header - Clickable */}
                        <div className="flex items-center justify-between bg-default-50 px-3 py-2">
                          <button
                            type="button"
                            onClick={() => setExpandedMemberDepts(prev => ({ ...prev, [deptName]: !prev[deptName] }))}
                            className="flex items-center gap-2 flex-1 text-left"
                          >
                            {isExpanded ? (
                              <FaChevronDown className="w-3 h-3 text-default-500" />
                            ) : (
                              <FaChevronRight className="w-3 h-3 text-default-500" />
                            )}
                            <span className="text-sm font-semibold text-default-700">{deptName}</span>
                            <span className="text-xs text-default-500">({deptEmployees.length})</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (allSelected) {
                                // Remove all from this department
                                setFormData(prev => ({
                                  ...prev,
                                  members: prev.members.filter(m =>
                                    !deptEmployees.some(emp => emp._id === m.userId)
                                  )
                                }))
                              } else {
                                // Add all from this department
                                const newMembers = deptEmployees
                                  .filter(emp =>
                                    !formData.members.some(m => m.userId === emp._id) &&
                                    !formData.projectHeadIds.includes(emp._id)
                                  )
                                  .map(emp => ({
                                    userId: emp._id,
                                    name: `${emp.firstName} ${emp.lastName}`,
                                    profilePicture: emp.profilePicture,
                                    department: formatDepartments(emp),
                                    role: 'member'
                                  }))
                                setFormData(prev => ({
                                  ...prev,
                                  members: [...prev.members, ...newMembers]
                                }))
                              }
                            }}
                            className={`text-xs px-2 py-1 rounded flex items-center gap-1 ${allSelected
                                ? 'bg-primary-100 text-primary-700'
                                : 'bg-default-200 text-default-600 hover:bg-default-300'
                              }`}
                          >
                            <FaCheckSquare className="w-3 h-3" />
                            {allSelected ? 'Deselect All' : 'Select All'}
                          </button>
                        </div>

                        {/* Employees List - Collapsible */}
                        {isExpanded && (
                          <div className="divide-y divide-default-100">
                            {deptEmployees.map(emp => {
                              const isSelected = formData.members.some(m => m.userId === emp._id)
                              return (
                                <button
                                  key={emp._id}
                                  type="button"
                                  onClick={() => {
                                    if (isSelected) {
                                      setFormData(prev => ({
                                        ...prev,
                                        members: prev.members.filter(m => m.userId !== emp._id)
                                      }))
                                    } else {
                                      handleAddMember(emp)
                                    }
                                  }}
                                  className={`w-full flex items-center p-2 pl-8 transition-colors text-left ${isSelected ? 'bg-primary-50' : 'hover:bg-default-50'
                                    }`}
                                >
                                  <div className={`w-5 h-5 rounded border flex items-center justify-center mr-3 ${isSelected ? 'bg-primary-500 border-primary-500' : 'border-default-300'
                                    }`}>
                                    {isSelected && <FaTimes className="w-3 h-3 text-white" style={{ transform: 'rotate(45deg)' }} />}
                                  </div>
                                  <div className="w-8 h-8 rounded-full bg-primary-500 flex items-center justify-center text-white text-xs overflow-hidden">
                                    {emp.profilePicture ? (
                                      <img src={emp.profilePicture} alt="" className="w-full h-full object-cover" />
                                    ) : (
                                      <span>{emp.firstName?.[0]}{emp.lastName?.[0]}</span>
                                    )}
                                  </div>
                                  <div className="ml-2">
                                    <p className="font-medium text-default-800 text-sm">
                                      {emp.firstName} {emp.lastName}
                                    </p>
                                    <p className="text-xs text-default-500">{emp.email}</p>
                                  </div>
                                </button>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </ModalPortal>

      {/* Project Head Search Modal */}
      <ModalPortal isOpen={showHeadSearch}>
        <div className="fixed inset-0 modal-overlay flex items-center justify-center z-[9999] p-4">
          <div className="bg-content1 rounded-[30px] shadow-xl w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col animate-modal-enter">
            <div className="p-4 border-b border-default-200 flex items-center justify-between flex-shrink-0">
              <h3 className="text-lg font-semibold">Add Project Head</h3>
              <Button
                isIconOnly
                variant="light"
                onPress={() => {
                  setShowHeadSearch(false)
                  setSearchHead('')
                }}
              >
                <FaTimes />
              </Button>
            </div>

            <div className="p-4 border-b border-default-200">
              <div className="relative">
                <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-default-400" />
                <input
                  type="text"
                  value={searchHead}
                  onChange={(e) => setSearchHead(e.target.value)}
                  placeholder="Search by name, email, or code..."
                  className="w-full pl-10 pr-4 py-2 border border-default-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  autoFocus
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {filteredHeadEmployees.length === 0 ? (
                <p className="text-center text-default-500 py-8">No employees found</p>
              ) : (
                <div className="space-y-2">
                  {/* Group employees by department */}
                  {Object.entries(
                    filteredHeadEmployees.reduce((acc, emp) => {
                      const deptName = emp.department?.name || 'No Department'
                      if (!acc[deptName]) acc[deptName] = []
                      acc[deptName].push(emp)
                      return acc
                    }, {})
                  ).sort(([a], [b]) => a.localeCompare(b)).map(([deptName, deptEmployees]) => {
                    const isExpanded = expandedHeadDepts[deptName]
                    const allSelected = deptEmployees.every(emp =>
                      formData.projectHeadIds.includes(emp._id)
                    )

                    return (
                      <div key={deptName} className="border border-default-200 rounded-lg overflow-hidden">
                        {/* Department Header - Clickable */}
                        <div className="flex items-center justify-between bg-default-50 px-3 py-2">
                          <button
                            type="button"
                            onClick={() => setExpandedHeadDepts(prev => ({ ...prev, [deptName]: !prev[deptName] }))}
                            className="flex items-center gap-2 flex-1 text-left"
                          >
                            {isExpanded ? (
                              <FaChevronDown className="w-3 h-3 text-default-500" />
                            ) : (
                              <FaChevronRight className="w-3 h-3 text-default-500" />
                            )}
                            <span className="text-sm font-semibold text-default-700">{deptName}</span>
                            <span className="text-xs text-default-500">({deptEmployees.length})</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (allSelected) {
                                // Remove all from this department
                                setFormData(prev => ({
                                  ...prev,
                                  projectHeadIds: prev.projectHeadIds.filter(id =>
                                    !deptEmployees.some(emp => emp._id === id)
                                  )
                                }))
                              } else {
                                // Add all from this department
                                const newHeadIds = deptEmployees
                                  .filter(emp => !formData.projectHeadIds.includes(emp._id))
                                  .map(emp => emp._id)
                                setFormData(prev => ({
                                  ...prev,
                                  projectHeadIds: [...prev.projectHeadIds, ...newHeadIds],
                                  // Remove from members if added as head
                                  members: prev.members.filter(m => !newHeadIds.includes(m.userId))
                                }))
                              }
                            }}
                            className={`text-xs px-2 py-1 rounded flex items-center gap-1 ${allSelected
                                ? 'bg-primary-100 text-primary-700'
                                : 'bg-default-200 text-default-600 hover:bg-default-300'
                              }`}
                          >
                            <FaCheckSquare className="w-3 h-3" />
                            {allSelected ? 'Deselect All' : 'Select All'}
                          </button>
                        </div>

                        {/* Employees List - Collapsible */}
                        {isExpanded && (
                          <div className="divide-y divide-default-100">
                            {deptEmployees.map(emp => {
                              const isSelected = formData.projectHeadIds.includes(emp._id)
                              return (
                                <button
                                  key={emp._id}
                                  type="button"
                                  onClick={() => {
                                    if (isSelected) {
                                      setFormData(prev => ({
                                        ...prev,
                                        projectHeadIds: prev.projectHeadIds.filter(id => id !== emp._id)
                                      }))
                                    } else {
                                      handleAddProjectHead(emp)
                                    }
                                  }}
                                  className={`w-full flex items-center p-2 pl-8 transition-colors text-left ${isSelected ? 'bg-primary-50' : 'hover:bg-default-50'
                                    }`}
                                >
                                  <div className={`w-5 h-5 rounded border flex items-center justify-center mr-3 ${isSelected ? 'bg-primary-500 border-primary-500' : 'border-default-300'
                                    }`}>
                                    {isSelected && <FaTimes className="w-3 h-3 text-white" style={{ transform: 'rotate(45deg)' }} />}
                                  </div>
                                  <div className="w-8 h-8 rounded-full bg-primary-500 flex items-center justify-center text-white text-xs overflow-hidden">
                                    {emp.profilePicture ? (
                                      <img src={emp.profilePicture} alt="" className="w-full h-full object-cover" />
                                    ) : (
                                      <span>{emp.firstName?.[0]}{emp.lastName?.[0]}</span>
                                    )}
                                  </div>
                                  <div className="ml-2">
                                    <p className="font-medium text-default-800 text-sm">
                                      {emp.firstName} {emp.lastName}
                                    </p>
                                    <p className="text-xs text-default-500">{emp.email}</p>
                                  </div>
                                </button>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </ModalPortal>
    </div>
  )
}
