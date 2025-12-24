'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  HiOutlineXMark,
  HiOutlineVideoCamera,
  HiOutlineMapPin,
  HiOutlineCalendarDays,
  HiOutlineClock,
  HiOutlineUserGroup,
  HiOutlineMagnifyingGlass,
  HiOutlineCheck,
  HiOutlineChevronDown,
  HiOutlineChevronUp,
  HiOutlinePlus,
  HiOutlineTrash
} from 'react-icons/hi2'
import toast from '@/utils/toast'
import ModalPortal from '@/components/ui/ModalPortal'

export default function CreateMeetingModal({ isOpen, onClose, onSuccess }) {
  const [step, setStep] = useState(1) // 1: Basic Info, 2: Invitees, 3: Review
  const [loading, setLoading] = useState(false)
  const [loadingInvitees, setLoadingInvitees] = useState(false)
  
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    type: 'online',
    scheduledStart: '',
    scheduledEnd: '',
    location: '',
    priority: 'medium',
    agenda: []
  })

  const [departmentGroups, setDepartmentGroups] = useState([])
  const [selectedInvitees, setSelectedInvitees] = useState([])
  const [selectedDepartments, setSelectedDepartments] = useState([])
  const [expandedDepts, setExpandedDepts] = useState({})
  const [searchQuery, setSearchQuery] = useState('')
  const [agendaInput, setAgendaInput] = useState({ title: '', duration: 15 })

  // Fetch department-grouped employees
  useEffect(() => {
    if (step === 2) {
      fetchInvitees()
    }
  }, [step])

  const fetchInvitees = async () => {
    try {
      setLoadingInvitees(true)
      const token = localStorage.getItem('token')
      const response = await fetch('/api/meetings/invitees', {
        headers: { Authorization: `Bearer ${token}` }
      })
      const data = await response.json()
      if (data.success) {
        setDepartmentGroups(data.data.departmentGroups)
      }
    } catch (error) {
      console.error('Error fetching invitees:', error)
      toast.error('Failed to load employees')
    } finally {
      setLoadingInvitees(false)
    }
  }

  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const toggleDepartmentExpand = (deptId) => {
    setExpandedDepts(prev => ({ ...prev, [deptId]: !prev[deptId] }))
  }

  const toggleSelectAllDepartment = (deptId) => {
    const dept = departmentGroups.find(d => d.department._id === deptId)
    if (!dept) return

    const deptEmployeeIds = dept.employees.map(e => e._id)
    const allSelected = deptEmployeeIds.every(id => selectedInvitees.includes(id))

    if (allSelected) {
      // Deselect all from this department
      setSelectedInvitees(prev => prev.filter(id => !deptEmployeeIds.includes(id)))
      setSelectedDepartments(prev => prev.filter(id => id !== deptId))
    } else {
      // Select all from this department
      setSelectedInvitees(prev => [...new Set([...prev, ...deptEmployeeIds])])
      if (!selectedDepartments.includes(deptId)) {
        setSelectedDepartments(prev => [...prev, deptId])
      }
    }
  }

  const toggleEmployeeSelect = (employeeId, deptId) => {
    setSelectedInvitees(prev => {
      if (prev.includes(employeeId)) {
        return prev.filter(id => id !== employeeId)
      } else {
        return [...prev, employeeId]
      }
    })
  }

  const addAgendaItem = () => {
    if (!agendaInput.title.trim()) return
    setFormData(prev => ({
      ...prev,
      agenda: [...prev.agenda, { ...agendaInput }]
    }))
    setAgendaInput({ title: '', duration: 15 })
  }

  const removeAgendaItem = (index) => {
    setFormData(prev => ({
      ...prev,
      agenda: prev.agenda.filter((_, i) => i !== index)
    }))
  }

  const validateStep1 = () => {
    if (!formData.title.trim()) {
      toast.error('Please enter a meeting title')
      return false
    }
    if (!formData.scheduledStart || !formData.scheduledEnd) {
      toast.error('Please select start and end times')
      return false
    }
    if (new Date(formData.scheduledStart) >= new Date(formData.scheduledEnd)) {
      toast.error('End time must be after start time')
      return false
    }
    if (formData.type === 'offline' && !formData.location.trim()) {
      toast.error('Please enter a location for offline meeting')
      return false
    }
    return true
  }

  const validateStep2 = () => {
    if (selectedInvitees.length === 0) {
      toast.error('Please select at least one invitee')
      return false
    }
    return true
  }

  const handleNext = () => {
    if (step === 1 && validateStep1()) {
      setStep(2)
    } else if (step === 2 && validateStep2()) {
      setStep(3)
    }
  }

  const handleBack = () => {
    if (step > 1) setStep(step - 1)
  }

  const handleSubmit = async () => {
    try {
      setLoading(true)
      const token = localStorage.getItem('token')

      const response = await fetch('/api/meetings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          ...formData,
          inviteeIds: selectedInvitees,
          departmentIds: selectedDepartments.filter(id => id !== 'no-department')
        })
      })

      const data = await response.json()
      if (data.success) {
        onSuccess(data.data)
      } else {
        toast.error(data.message || 'Failed to create meeting')
      }
    } catch (error) {
      console.error('Error creating meeting:', error)
      toast.error('Failed to create meeting')
    } finally {
      setLoading(false)
    }
  }

  const filteredDeptGroups = departmentGroups.map(group => ({
    ...group,
    employees: group.employees.filter(emp => {
      if (!searchQuery) return true
      const query = searchQuery.toLowerCase()
      return (
        emp.fullName?.toLowerCase().includes(query) ||
        emp.email?.toLowerCase().includes(query) ||
        emp.designation?.toLowerCase().includes(query)
      )
    })
  })).filter(group => group.employees.length > 0)

  const getSelectedInviteesList = () => {
    const list = []
    for (const group of departmentGroups) {
      for (const emp of group.employees) {
        if (selectedInvitees.includes(emp._id)) {
          list.push({ ...emp, department: group.department.name })
        }
      }
    }
    return list
  }

  if (!isOpen) return null

  return (
    <ModalPortal isOpen={isOpen}>
      <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="modal-backdrop" />
        <div className="modal-container modal-2xl">
          {/* Header */}
          <div className="modal-header">
            <div>
              <h2 className="modal-title">
                Schedule Meeting
              </h2>
              <p className="text-sm text-gray-500 mt-1">
                Step {step} of 3: {step === 1 ? 'Meeting Details' : step === 2 ? 'Invite Attendees' : 'Review & Create'}
              </p>
            </div>
            <button
              onClick={onClose}
              className="modal-close-btn"
            >
              <HiOutlineXMark className="w-5 h-5" />
            </button>
          </div>

          {/* Progress Bar */}
          <div className="px-4 pt-4">
            <div className="flex gap-2">
              {[1, 2, 3].map(s => (
                <div
                  key={s}
                  className={`flex-1 h-1.5 rounded-full transition-colors ${
                    s <= step ? 'bg-primary-600' : 'bg-gray-200'
                  }`}
                />
              ))}
            </div>
          </div>

          {/* Content */}
          <div className="modal-body">
            {/* Step 1: Basic Info */}
          {step === 1 && (
            <div className="space-y-4">
              {/* Meeting Type */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Meeting Type
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => handleInputChange('type', 'online')}
                    className={`flex items-center gap-3 p-4 rounded-xl border-2 transition-all ${
                      formData.type === 'online'
                        ? 'border-indigo-600 bg-indigo-50'
                        : 'border-gray-200 hover:border-indigo-300'
                    }`}
                  >
                    <HiOutlineVideoCamera className={`w-6 h-6 ${formData.type === 'online' ? 'text-indigo-600' : 'text-gray-400'}`} />
                    <div className="text-left">
                      <p className={`font-medium ${formData.type === 'online' ? 'text-indigo-600' : 'text-gray-700'}`}>
                        Online
                      </p>
                      <p className="text-xs text-gray-500">Video conference</p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleInputChange('type', 'offline')}
                    className={`flex items-center gap-3 p-4 rounded-xl border-2 transition-all ${
                      formData.type === 'offline'
                        ? 'border-amber-600 bg-amber-50'
                        : 'border-gray-200 hover:border-amber-300'
                    }`}
                  >
                    <HiOutlineMapPin className={`w-6 h-6 ${formData.type === 'offline' ? 'text-amber-600' : 'text-gray-400'}`} />
                    <div className="text-left">
                      <p className={`font-medium ${formData.type === 'offline' ? 'text-amber-600' : 'text-gray-700'}`}>
                        Offline
                      </p>
                      <p className="text-xs text-gray-500">In-person meeting</p>
                    </div>
                  </button>
                </div>
              </div>

              {/* Title */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Meeting Title *
                </label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => handleInputChange('title', e.target.value)}
                  placeholder="e.g., Weekly Team Standup"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Description
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => handleInputChange('description', e.target.value)}
                  placeholder="Meeting agenda and objectives..."
                  rows={3}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>

              {/* Date & Time */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Start Date & Time *
                  </label>
                  <input
                    type="datetime-local"
                    min={new Date(new Date().getTime() - (new Date().getTimezoneOffset() * 60000)).toISOString().slice(0, 16)}
                    value={formData.scheduledStart}
                    onChange={(e) => handleInputChange('scheduledStart', e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    End Date & Time *
                  </label>
                  <input
                    type="datetime-local"
                    min={formData.scheduledStart || new Date(new Date().getTime() - (new Date().getTimezoneOffset() * 60000)).toISOString().slice(0, 16)}
                    value={formData.scheduledEnd}
                    onChange={(e) => handleInputChange('scheduledEnd', e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>
              </div>

              {/* Location (for offline) */}
              {formData.type === 'offline' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Location *
                  </label>
                  <input
                    type="text"
                    value={formData.location}
                    onChange={(e) => handleInputChange('location', e.target.value)}
                    placeholder="e.g., Conference Room A, 3rd Floor"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>
              )}

              {/* Priority */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Priority
                </label>
                <select
                  value={formData.priority}
                  onChange={(e) => handleInputChange('priority', e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>

              {/* Agenda Items */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Agenda Items (Optional)
                </label>
                <div className="flex gap-2 mb-2">
                  <input
                    type="text"
                    value={agendaInput.title}
                    onChange={(e) => setAgendaInput(prev => ({ ...prev, title: e.target.value }))}
                    placeholder="Agenda item title"
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                  <input
                    type="number"
                    value={agendaInput.duration}
                    onChange={(e) => setAgendaInput(prev => ({ ...prev, duration: parseInt(e.target.value) || 15 }))}
                    placeholder="Min"
                    className="w-20 px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                  <button
                    type="button"
                    onClick={addAgendaItem}
                    className="p-2 bg-indigo-100 text-indigo-600 rounded-lg hover:bg-indigo-200"
                  >
                    <HiOutlinePlus className="w-5 h-5" />
                  </button>
                </div>
                {formData.agenda.length > 0 && (
                  <div className="space-y-2">
                    {formData.agenda.map((item, index) => (
                      <div key={index} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
                        <span className="text-sm text-gray-700">{item.title}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-500">{item.duration} min</span>
                          <button
                            type="button"
                            onClick={() => removeAgendaItem(index)}
                            className="p-1 text-red-500 hover:bg-red-100 rounded"
                          >
                            <HiOutlineTrash className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 2: Invitees */}
          {step === 2 && (
            <div className="space-y-4">
              {/* Search */}
              <div className="relative">
                <HiOutlineMagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search employees..."
                  className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>

              {/* Selected count */}
              <div className="flex items-center justify-between py-2 px-3 bg-indigo-50 rounded-lg">
                <span className="text-sm text-indigo-700">
                  <strong>{selectedInvitees.length}</strong> employees selected
                </span>
                {selectedInvitees.length > 0 && (
                  <button
                    onClick={() => {
                      setSelectedInvitees([])
                      setSelectedDepartments([])
                    }}
                    className="text-sm text-indigo-600 hover:text-indigo-700"
                  >
                    Clear all
                  </button>
                )}
              </div>

              {/* Department groups */}
              {loadingInvitees ? (
                <div className="space-y-3">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="animate-pulse">
                      <div className="h-12 bg-gray-200 rounded-lg"></div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredDeptGroups.map(group => {
                    const deptId = group.department._id
                    const isExpanded = expandedDepts[deptId]
                    const deptEmployeeIds = group.employees.map(e => e._id)
                    const selectedCount = deptEmployeeIds.filter(id => selectedInvitees.includes(id)).length
                    const allSelected = selectedCount === group.employees.length

                    return (
                      <div key={deptId} className="border border-gray-200 rounded-xl overflow-hidden">
                        {/* Department Header */}
                        <div
                          className="flex items-center justify-between p-3 bg-gray-50 cursor-pointer"
                          onClick={() => toggleDepartmentExpand(deptId)}
                        >
                          <div className="flex items-center gap-3">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                toggleSelectAllDepartment(deptId)
                              }}
                              className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                                allSelected
                                  ? 'bg-indigo-600 border-indigo-600'
                                  : selectedCount > 0
                                  ? 'bg-indigo-200 border-indigo-400'
                                  : 'border-gray-300'
                              }`}
                            >
                              {allSelected && <HiOutlineCheck className="w-3 h-3 text-white" />}
                              {selectedCount > 0 && !allSelected && <div className="w-2 h-2 bg-indigo-600 rounded-sm"></div>}
                            </button>
                            <div>
                              <p className="font-medium text-gray-800">
                                {group.department.name}
                              </p>
                              <p className="text-xs text-gray-500">
                                {selectedCount}/{group.count} selected
                              </p>
                            </div>
                          </div>
                          {isExpanded ? (
                            <HiOutlineChevronUp className="w-5 h-5 text-gray-400" />
                          ) : (
                            <HiOutlineChevronDown className="w-5 h-5 text-gray-400" />
                          )}
                        </div>

                        {/* Employees List */}
                        {isExpanded && (
                          <div className="divide-y divide-gray-100">
                            {group.employees.map(emp => {
                              const isSelected = selectedInvitees.includes(emp._id)
                              return (
                                <div
                                  key={emp._id}
                                  onClick={() => toggleEmployeeSelect(emp._id, deptId)}
                                  className={`flex items-center gap-3 p-3 cursor-pointer transition-colors ${
                                    isSelected ? 'bg-indigo-50' : 'hover:bg-gray-50'
                                  }`}
                                >
                                  <button
                                    type="button"
                                    className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                                      isSelected
                                        ? 'bg-indigo-600 border-indigo-600'
                                        : 'border-gray-300'
                                    }`}
                                  >
                                    {isSelected && <HiOutlineCheck className="w-3 h-3 text-white" />}
                                  </button>
                                  {emp.profilePicture ? (
                                    <img
                                      src={emp.profilePicture}
                                      alt={emp.fullName}
                                      className="w-8 h-8 rounded-full object-cover"
                                    />
                                  ) : (
                                    <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center">
                                      <span className="text-xs font-medium text-indigo-600">
                                        {emp.firstName?.[0]}{emp.lastName?.[0]}
                                      </span>
                                    </div>
                                  )}
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-gray-800 truncate">
                                      {emp.fullName}
                                    </p>
                                    <p className="text-xs text-gray-500 truncate">
                                      {emp.designation}
                                    </p>
                                  </div>
                                </div>
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
          )}

          {/* Step 3: Review */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="bg-gray-50 rounded-xl p-4 space-y-4">
                {/* Meeting Details */}
                <div className="flex items-start gap-3">
                  {formData.type === 'online' ? (
                    <HiOutlineVideoCamera className="w-6 h-6 text-indigo-600 mt-0.5" />
                  ) : (
                    <HiOutlineMapPin className="w-6 h-6 text-amber-600 mt-0.5" />
                  )}
                  <div>
                    <h3 className="text-lg font-semibold text-gray-800">
                      {formData.title}
                    </h3>
                    <p className="text-sm text-gray-600 capitalize">
                      {formData.type} Meeting • {formData.priority} priority
                    </p>
                  </div>
                </div>

                {formData.description && (
                  <p className="text-sm text-gray-600 pl-9">
                    {formData.description}
                  </p>
                )}

                {/* Date/Time */}
                <div className="flex items-center gap-2 text-sm text-gray-600 pl-9">
                  <HiOutlineCalendarDays className="w-4 h-4" />
                  <span>
                    {new Date(formData.scheduledStart).toLocaleDateString('en-IN', {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric'
                    })}
                  </span>
                </div>

                <div className="flex items-center gap-2 text-sm text-gray-600 pl-9">
                  <HiOutlineClock className="w-4 h-4" />
                  <span>
                    {new Date(formData.scheduledStart).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                    {' - '}
                    {new Date(formData.scheduledEnd).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>

                {formData.type === 'offline' && (
                  <div className="flex items-center gap-2 text-sm text-gray-600 pl-9">
                    <HiOutlineMapPin className="w-4 h-4" />
                    <span>{formData.location}</span>
                  </div>
                )}

                {/* Invitees */}
                <div className="pt-4 border-t border-gray-200">
                  <div className="flex items-center gap-2 mb-3">
                    <HiOutlineUserGroup className="w-5 h-5 text-gray-500" />
                    <span className="font-medium text-gray-800">
                      Invitees ({selectedInvitees.length})
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {getSelectedInviteesList().slice(0, 10).map(emp => (
                      <div
                        key={emp._id}
                        className="flex items-center gap-2 px-2 py-1 bg-white rounded-full border border-gray-200"
                      >
                        {emp.profilePicture ? (
                          <img
                            src={emp.profilePicture}
                            alt={emp.fullName}
                            className="w-5 h-5 rounded-full object-cover"
                          />
                        ) : (
                          <div className="w-5 h-5 rounded-full bg-indigo-100 flex items-center justify-center">
                            <span className="text-[10px] font-medium text-indigo-600">
                              {emp.firstName?.[0]}{emp.lastName?.[0]}
                            </span>
                          </div>
                        )}
                        <span className="text-xs text-gray-700">
                          {emp.fullName}
                        </span>
                      </div>
                    ))}
                    {selectedInvitees.length > 10 && (
                      <span className="px-2 py-1 text-xs text-gray-500">
                        +{selectedInvitees.length - 10} more
                      </span>
                    )}
                  </div>
                </div>

                {/* Agenda */}
                {formData.agenda.length > 0 && (
                  <div className="pt-4 border-t border-gray-200">
                    <p className="font-medium text-gray-800 mb-2">Agenda</p>
                    <ul className="space-y-1">
                      {formData.agenda.map((item, index) => (
                        <li key={index} className="flex items-center justify-between text-sm">
                          <span className="text-gray-600">
                            {index + 1}. {item.title}
                          </span>
                          <span className="text-gray-500">{item.duration} min</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-gray-200">
          <button
            onClick={step === 1 ? onClose : handleBack}
            className="modal-btn modal-btn-secondary"
          >
            {step === 1 ? 'Cancel' : 'Back'}
          </button>
          <button
            onClick={step === 3 ? handleSubmit : handleNext}
            disabled={loading}
            className="modal-btn modal-btn-primary"
          >
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                Creating...
              </>
            ) : step === 3 ? (
              'Create Meeting'
            ) : (
              'Next'
            )}
          </button>
        </div>
        </div>
      </div>
    </ModalPortal>
  )
}
