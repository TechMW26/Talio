'use client'

import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { Button, Select, SelectItem } from '@heroui/react'
import { FaTimes, FaPlus, FaProjectDiagram } from 'react-icons/fa'
import { HiOutlineSparkles } from 'react-icons/hi2'
import toast from '@/utils/toast'
import ModalPortal from '@/components/ui/ModalPortal'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import { playNotificationSound, NotificationSoundTypes } from '@/lib/notificationSounds'
import { getCurrentUser, getEmployeeId } from '@/utils/userHelper'
import { useAILoading } from '@/contexts/AILoadingContext'

/**
 * CreateTaskModal - Standalone task creation modal.
 * Allows creating tasks with optional project association.
 * Includes: title, description, priority, due date, assignees (employee search),
 * optional project dropdown, subtasks, and attachments.
 * 
 * Props:
 *   isOpen - controls visibility
 *   onClose - called when modal is closed
 *   onTaskCreated - called after successful task creation (for SWR mutate, etc.)
 */
export default function CreateTaskModal({ isOpen, onClose, onTaskCreated }) {
  const currentEmployeeId = useMemo(() => {
    const user = getCurrentUser()
    return getEmployeeId(user) || user?.employeeId?._id || user?.employeeId
  }, [])
  const [generatingDescription, setGeneratingDescription] = useState(false)
  const { startAILoading, stopAILoading } = useAILoading()
  const [taskForm, setTaskForm] = useState({
    title: '',
    description: '',
    priority: 'medium',
    dueDate: '',
    assigneeIds: [],
    subtasks: [],
    attachments: [],
    projectId: ''
  })
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [uploadingAttachments, setUploadingAttachments] = useState(false)
  const [employeeSearch, setEmployeeSearch] = useState('')
  
  // ETA modal state
  const [showEtaModal, setShowEtaModal] = useState(false)
  const [taskEta, setTaskEta] = useState({ days: '', hours: '' })
  const [subtaskEtas, setSubtaskEtas] = useState({})
  const [pendingTaskData, setPendingTaskData] = useState(null)

  const attachmentInputRef = useRef(null)

  // Fetch employees for assignee selection
  const { data: employeesData } = useAuthedSWR(
    isOpen ? '/api/employees/list?includeAdmins=true' : null
  )
  const employees = employeesData?.data || []

  // Fetch user's projects for optional project link
  const { data: projectsData } = useAuthedSWR(
    isOpen ? '/api/projects?status=ongoing&limit=100' : null
  )
  const projects = projectsData?.data || []

  // Fetch selected project members
  const { data: projectMembersData } = useAuthedSWR(
    isOpen && taskForm.projectId ? `/api/projects/${taskForm.projectId}/members` : null
  )
  const projectMembers = projectMembersData?.data?.filter(m => m.invitationStatus === 'accepted') || []

  // Reset form on close
  useEffect(() => {
    if (!isOpen) {
      setTaskForm({
        title: '', description: '', priority: 'medium', dueDate: '',
        assigneeIds: [], subtasks: [], attachments: [], projectId: ''
      })
      setNewSubtaskTitle('')
      setEmployeeSearch('')
      setShowEtaModal(false)
      setTaskEta({ days: '', hours: '' })
      setSubtaskEtas({})
      setPendingTaskData(null)
    }
  }, [isOpen])

  const formatFileSize = useCallback((bytes = 0) => {
    if (!bytes || Number.isNaN(bytes)) return '0 B'
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), sizes.length - 1)
    return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${sizes[i]}`
  }, [])

  const handleAttachmentUpload = async (files) => {
    if (!files || files.length === 0) return
    try {
      setUploadingAttachments(true)
      const token = localStorage.getItem('token')
      const uploads = await Promise.all(Array.from(files).map(async (file) => {
        const formData = new FormData()
        formData.append('file', file)
        formData.append('folder', 'tasks')

        const response = await fetch('/api/upload', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` },
          body: formData
        })

        const result = await response.json()
        if (!result.success) throw new Error(result.message || 'Upload failed')

        return {
          name: result.data.fileName || file.name,
          url: result.data.fileUrl,
          type: result.data.fileType || file.type,
          size: result.data.fileSize || file.size
        }
      }))

      setTaskForm(prev => ({
        ...prev,
        attachments: [...(prev.attachments || []), ...uploads]
      }))
    } catch (error) {
      toast.error(error.message || 'Failed to upload attachment')
    } finally {
      setUploadingAttachments(false)
      if (attachmentInputRef.current) attachmentInputRef.current.value = ''
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!taskForm.title.trim()) {
      toast.error('Task title is required')
      return
    }
    if (taskForm.assigneeIds.length === 0) {
      toast.error('Please select at least one assignee')
      return
    }

    // If assigned to self and no ETA provided yet, show ETA modal
    const isAssignedToSelf = taskForm.assigneeIds.includes(currentEmployeeId)
    if (isAssignedToSelf && !pendingTaskData) {
      setPendingTaskData(taskForm)
      setShowEtaModal(true)
      return
    }

    await createTask()
  }

  const createTask = async () => {
    try {
      setSubmitting(true)
      const token = localStorage.getItem('token')

      const taskData = { ...(pendingTaskData || taskForm) }

      // Handle subtask-wise ETAs
      if (pendingTaskData && pendingTaskData.subtasks?.length > 0 && Object.keys(subtaskEtas).length > 0) {
        taskData.subtasks = pendingTaskData.subtasks.map((subtask, index) => ({
          ...subtask,
          estimatedDays: parseInt(subtaskEtas[index]?.days) || 0,
          estimatedHours: parseInt(subtaskEtas[index]?.hours) || 0
        }))
        let totalHours = 0
        Object.values(subtaskEtas).forEach(eta => {
          totalHours += (parseFloat(eta?.days) || 0) * 8 + (parseFloat(eta?.hours) || 0)
        })
        taskData.estimatedHours = totalHours
      } else if (pendingTaskData && (taskEta.days || taskEta.hours)) {
        const days = parseFloat(taskEta.days) || 0
        const hours = parseFloat(taskEta.hours) || 0
        taskData.estimatedHours = (days * 8) + hours
      }

      // Sanitize attachments
      const attachmentsToSend = Array.isArray(taskForm.attachments)
        ? taskForm.attachments
          .filter(f => f && typeof f === 'object' && f.name && f.url)
          .map(f => ({ name: String(f.name), url: String(f.url), type: f.type ? String(f.type) : undefined, size: typeof f.size === 'number' ? f.size : undefined }))
        : []

      const payload = {
        title: taskData.title,
        description: taskData.description,
        priority: taskData.priority,
        dueDate: taskData.dueDate,
        assigneeIds: taskData.assigneeIds,
        subtasks: taskData.subtasks,
        estimatedHours: taskData.estimatedHours,
        attachments: attachmentsToSend,
        projectId: taskData.projectId || undefined
      }

      const response = await fetch('/api/tasks/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      })

      const data = await response.json()
      if (data.success) {
        onClose()
        toast.success('Task created successfully')
        try { playNotificationSound(NotificationSoundTypes.SUCCESS) } catch {}
        if (onTaskCreated) onTaskCreated()
      } else {
        toast.error(data.message || 'Failed to create task')
      }
    } catch (error) {
      toast.error('Failed to create task')
    } finally {
      setSubmitting(false)
    }
  }

  // Filter employees for search
  const filteredEmployees = employees.filter(emp => {
    if (!employeeSearch) return true
    const name = `${emp.firstName} ${emp.lastName}`.toLowerCase()
    const code = (emp.employeeCode || '').toLowerCase()
    const query = employeeSearch.toLowerCase()
    return name.includes(query) || code.includes(query)
  })

  // Determine which assignee list to show
  // If a project is selected, show project members; otherwise show all employees
  const assigneeCandidates = taskForm.projectId ? projectMembers : filteredEmployees
  const getAssigneeId = (item) => {
    if (taskForm.projectId) {
      // Project member format: { user: { _id, firstName, ... } }
      return item.user?._id?.toString() || item.user?.toString()
    }
    // Employee format: { _id, firstName, ... }
    return item._id?.toString()
  }
  const getAssigneeName = (item) => {
    if (taskForm.projectId) {
      return `${item.user?.firstName || ''} ${item.user?.lastName || ''}`.trim()
    }
    return `${item.firstName || ''} ${item.lastName || ''}`.trim()
  }
  const getAssigneeCode = (item) => {
    if (taskForm.projectId) return item.user?.employeeCode || ''
    return item.employeeCode || ''
  }

  return (
    <>
      <ModalPortal isOpen={isOpen && !showEtaModal}>
        <div className="modal-overlay">
          <div className="bg-white rounded-[30px] shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col animate-modal-enter">
            <div className="px-6 py-4 bg-gray-50 flex items-center justify-between flex-shrink-0">
              <h3 className="text-xl font-bold text-gray-900">Assign New Task</h3>
              <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
                <FaTimes />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-4 space-y-4 overflow-y-auto flex-1">
              {/* Title */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Task Title <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={taskForm.title}
                  onChange={(e) => setTaskForm(prev => ({ ...prev, title: e.target.value }))}
                  placeholder="Enter task title"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  required
                />
              </div>

              {/* Description */}
              <div>
                <div className="flex items-center justify-start mb-1">
                  <label className="block text-sm font-medium text-gray-700">Description</label>
                  <Button
                    size="sm"
                    variant="flat"
                    onPress={async () => {
                      if (!taskForm.title.trim()) { toast.error('Please enter a task title first'); return }
                      setGeneratingDescription(true)
                      startAILoading('MIRA is writing task description...')
                      try {
                        const token = localStorage.getItem('token')
                        const res = await fetch('/api/ai/generate-text', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                          body: JSON.stringify({ type: 'task_description', context: { taskName: taskForm.title, priority: taskForm.priority } })
                        })
                        const data = await res.json()
                        if (data.success && data.text) {
                          setTaskForm(prev => ({ ...prev, description: data.text }))
                          toast.success('Description generated!')
                        } else { toast.error(data.message || 'Failed to generate description') }
                      } catch (err) { console.error('AI generate error:', err); toast.error('Failed to generate description') }
                      finally { setGeneratingDescription(false); stopAILoading() }
                    }}
                    isDisabled={generatingDescription || !taskForm.title.trim()}
                    isLoading={generatingDescription}
                    startContent={!generatingDescription && <HiOutlineSparkles className="w-3.5 h-3.5" />}
                    className="ml-2 bg-gradient-to-r from-purple-600 to-indigo-600 text-white"
                  >
                    {generatingDescription ? 'Writing...' : 'AI Write'}
                  </Button>
                </div>
                <textarea
                  value={taskForm.description}
                  onChange={(e) => setTaskForm(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Describe the task..."
                  rows={3}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Priority */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
                  <Select
                    selectedKeys={[taskForm.priority]}
                    onChange={(e) => setTaskForm(prev => ({ ...prev, priority: e.target.value }))}
                    aria-label="Priority"
                    classNames={{ trigger: "bg-white" }}
                  >
                    <SelectItem key="low">Low</SelectItem>
                    <SelectItem key="medium">Medium</SelectItem>
                    <SelectItem key="high">High</SelectItem>
                    <SelectItem key="critical">Critical</SelectItem>
                  </Select>
                </div>

                {/* Due Date */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Due Date</label>
                  <input
                    type="date"
                    value={taskForm.dueDate}
                    onChange={(e) => setTaskForm(prev => ({ ...prev, dueDate: e.target.value }))}
                    min={new Date().toISOString().split('T')[0]}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>
              </div>

              {/* Optional Project */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <FaProjectDiagram className="inline mr-1 text-gray-400" />
                  Project <span className="text-xs text-gray-400">(optional)</span>
                </label>
                <select
                  value={taskForm.projectId}
                  onChange={(e) => {
                    setTaskForm(prev => ({ ...prev, projectId: e.target.value, assigneeIds: [] }))
                    setEmployeeSearch('')
                  }}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white"
                >
                  <option value="">No Project (Standalone Task)</option>
                  {projects.map(p => (
                    <option key={p._id} value={p._id}>{p.name}</option>
                  ))}
                </select>
                {taskForm.projectId && (
                  <p className="text-xs text-blue-600 mt-1">
                    Assignees will be limited to project members
                  </p>
                )}
              </div>

              {/* Assignees */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Assign To <span className="text-red-500">*</span>
                </label>
                {/* Search (only for non-project mode) */}
                {!taskForm.projectId && (
                  <input
                    type="text"
                    value={employeeSearch}
                    onChange={(e) => setEmployeeSearch(e.target.value)}
                    placeholder="Search employees..."
                    className="input input-search text-sm mb-2"
                  />
                )}
                <div className="space-y-1 max-h-40 overflow-y-auto border border-gray-200 rounded-lg p-2">
                  {assigneeCandidates.length === 0 ? (
                    <p className="text-sm text-gray-400 py-2 text-center">
                      {taskForm.projectId ? 'No accepted project members found' : 'No employees found'}
                    </p>
                  ) : (
                    (() => {
                      const seenIds = new Set()
                      return assigneeCandidates.filter(item => {
                        const id = getAssigneeId(item)
                        if (!id || seenIds.has(id)) return false
                        seenIds.add(id)
                        return true
                      }).map(item => {
                        const id = getAssigneeId(item)
                        const name = getAssigneeName(item)
                        const code = getAssigneeCode(item)
                        return (
                          <label key={id} className="flex items-center gap-2 p-2 hover:bg-gray-50 rounded cursor-pointer">
                            <input
                              type="checkbox"
                              checked={taskForm.assigneeIds.includes(id)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setTaskForm(prev => ({ ...prev, assigneeIds: [...prev.assigneeIds, id] }))
                                } else {
                                  setTaskForm(prev => ({ ...prev, assigneeIds: prev.assigneeIds.filter(x => x !== id) }))
                                }
                              }}
                              className="rounded border-gray-300 text-primary-500 focus:ring-primary-500"
                            />
                            <span className="text-sm text-gray-700">{name}</span>
                            {code && <span className="text-xs text-gray-400">({code})</span>}
                          </label>
                        )
                      })
                    })()
                  )}
                </div>
                {taskForm.assigneeIds.length > 0 && (
                  <p className="text-xs text-gray-500 mt-1">
                    {taskForm.assigneeIds.length} assignee{taskForm.assigneeIds.length > 1 ? 's' : ''} selected
                  </p>
                )}
              </div>

              {/* Attachments */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Attachments</label>
                <div className="flex items-center gap-3">
                  <input
                    ref={attachmentInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => handleAttachmentUpload(e.target.files)}
                  />
                  <button
                    type="button"
                    onClick={() => attachmentInputRef.current?.click()}
                    disabled={uploadingAttachments}
                    className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm disabled:opacity-50"
                  >
                    {uploadingAttachments ? 'Uploading...' : 'Add Attachments'}
                  </button>
                  <span className="text-xs text-gray-500">Any file type &bull; Max 10MB each</span>
                </div>

                {taskForm.attachments?.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {taskForm.attachments.map((file, index) => (
                      <div key={`${file.url}-${index}`} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg border border-gray-200">
                        <div className="min-w-0">
                          <p className="text-sm text-gray-700 truncate">{file.name}</p>
                          <p className="text-xs text-gray-500">{formatFileSize(file.size)}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setTaskForm(prev => ({
                            ...prev,
                            attachments: prev.attachments.filter((_, i) => i !== index)
                          }))}
                          className="p-1.5 text-red-500 hover:text-red-700"
                        >
                          <FaTimes className="text-sm" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Subtasks */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Subtasks {taskForm.subtasks.length > 0 && `(${taskForm.subtasks.length})`}
                </label>
                <div className="space-y-2 mb-3">
                  {taskForm.subtasks.map((subtask, index) => (
                    <div key={index} className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg group">
                      <span className="text-sm text-gray-700 flex-1">{subtask.title}</span>
                      <button
                        type="button"
                        onClick={() => setTaskForm(prev => ({
                          ...prev,
                          subtasks: prev.subtasks.filter((_, i) => i !== index)
                        }))}
                        className="opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-700 transition-opacity"
                      >
                        <FaTimes className="text-sm" />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newSubtaskTitle}
                    onChange={(e) => setNewSubtaskTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        if (newSubtaskTitle.trim()) {
                          setTaskForm(prev => ({
                            ...prev,
                            subtasks: [...prev.subtasks, { title: newSubtaskTitle.trim(), completed: false }]
                          }))
                          setNewSubtaskTitle('')
                        }
                      }
                    }}
                    placeholder="Add a subtask..."
                    className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (newSubtaskTitle.trim()) {
                        setTaskForm(prev => ({
                          ...prev,
                          subtasks: [...prev.subtasks, { title: newSubtaskTitle.trim(), completed: false }]
                        }))
                        setNewSubtaskTitle('')
                      }
                    }}
                    className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 text-sm"
                  >
                    <FaPlus />
                  </button>
                </div>
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-4">
                <Button type="button" onPress={onClose} variant="flat">Cancel</Button>
                <Button
                  type="submit"
                  isDisabled={submitting || uploadingAttachments}
                  color="primary"
                >
                  {uploadingAttachments ? 'Uploading...' : submitting ? 'Creating...' : 'Assign Task'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      </ModalPortal>

      {/* ETA Modal (for self-assignment) */}
      <ModalPortal isOpen={showEtaModal && !!pendingTaskData}>
        {pendingTaskData && (
          <div className="modal-overlay">
            <div className="bg-white rounded-[30px] shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col animate-modal-enter">
              <div className="px-6 py-4 bg-gray-50 flex items-center justify-between">
                <h3 className="text-xl font-bold text-gray-900">Set Your ETA</h3>
                <button
                  onClick={() => {
                    setShowEtaModal(false)
                    setPendingTaskData(null)
                    setTaskEta({ days: '', hours: '' })
                    setSubtaskEtas({})
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <FaTimes />
                </button>
              </div>
              <div className="p-6 overflow-y-auto flex-1">
                <p className="text-gray-600 mb-4">
                  You&apos;re assigning this task to yourself.{' '}
                  {pendingTaskData.subtasks?.length > 0
                    ? 'Please provide an ETA for each subtask:'
                    : 'How long do you estimate it will take?'}
                </p>
                <div className="mb-4">
                  <p className="font-medium text-gray-800 mb-2">{pendingTaskData.title}</p>
                </div>

                {pendingTaskData.subtasks?.length > 0 ? (
                  <div className="space-y-4">
                    {pendingTaskData.subtasks.map((subtask, index) => (
                      <div key={index} className="border border-gray-200 rounded-lg p-3">
                        <p className="text-sm font-medium text-gray-700 mb-2">{subtask.title}</p>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs text-gray-500 mb-1">Days</label>
                            <input
                              type="number"
                              min="0"
                              value={subtaskEtas[index]?.days || ''}
                              onChange={(e) => setSubtaskEtas(prev => ({
                                ...prev,
                                [index]: { ...prev[index], days: e.target.value }
                              }))}
                              placeholder="0"
                              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-500 mb-1">Hours</label>
                            <input
                              type="number"
                              min="0"
                              max="23"
                              value={subtaskEtas[index]?.hours || ''}
                              onChange={(e) => setSubtaskEtas(prev => ({
                                ...prev,
                                [index]: { ...prev[index], hours: e.target.value }
                              }))}
                              placeholder="0"
                              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Days</label>
                      <input
                        type="number"
                        min="0"
                        value={taskEta.days}
                        onChange={(e) => setTaskEta(prev => ({ ...prev, days: e.target.value }))}
                        placeholder="0"
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Hours</label>
                      <input
                        type="number"
                        min="0"
                        max="23"
                        value={taskEta.hours}
                        onChange={(e) => setTaskEta(prev => ({ ...prev, hours: e.target.value }))}
                        placeholder="0"
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                      />
                    </div>
                  </div>
                )}
              </div>
              <div className="px-6 py-4 bg-gray-50 flex justify-end gap-3">
                <Button
                  variant="flat"
                  onPress={() => {
                    setShowEtaModal(false)
                    setPendingTaskData(null)
                    setTaskEta({ days: '', hours: '' })
                    setSubtaskEtas({})
                  }}
                >
                  Cancel
                </Button>
                <Button
                  color="primary"
                  isDisabled={submitting}
                  onPress={createTask}
                >
                  {submitting ? 'Creating...' : 'Confirm & Assign'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </ModalPortal>
    </>
  )
}
