'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import toast from '@/utils/toast'
import { FaArrowLeft, FaSave, FaTrash, FaPlus, FaTimes, FaUsers, FaArchive } from 'react-icons/fa'
import Portal from '@/components/ui/Portal'

export default function EditProjectPage() {
  const { projectId } = useParams()
  const router = useRouter()
  
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [project, setProject] = useState(null)
  const [departments, setDepartments] = useState([])
  const [employees, setEmployees] = useState([])
  const [showAddMemberModal, setShowAddMemberModal] = useState(false)
  const [selectedNewMembers, setSelectedNewMembers] = useState([])
  const [user, setUser] = useState(null)

  const [form, setForm] = useState({
    name: '',
    description: '',
    status: 'planned',
    priority: 'medium',
    startDate: '',
    endDate: '',
    projectHead: ''
  })

  useEffect(() => {
    const userData = localStorage.getItem('user')
    if (userData) {
      setUser(JSON.parse(userData))
    }
    fetchProject()
    fetchDepartments()
    fetchEmployees()
  }, [projectId])

  const fetchProject = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/projects/${projectId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })

      const data = await response.json()
      if (data.success) {
        const p = data.data
        
        // Only project head can edit the project
        if (!p.isProjectHead) {
          toast.error('Only the project head can edit this project')
          router.push(`/dashboard/projects/${projectId}`)
          return
        }
        
        setProject(p)
        setForm({
          name: p.name || '',
          description: p.description || '',
          status: p.status || 'planned',
          priority: p.priority || 'medium',
          startDate: p.startDate ? new Date(p.startDate).toISOString().split('T')[0] : '',
          endDate: p.endDate ? new Date(p.endDate).toISOString().split('T')[0] : '',
          projectHead: p.projectHead?._id || ''
        })
      } else {
        toast.error(data.message || 'Failed to load project')
        router.push('/dashboard/projects')
      }
    } catch (error) {
      console.error('Fetch project error:', error)
      toast.error('An error occurred')
      router.push('/dashboard/projects')
    } finally {
      setLoading(false)
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
        setDepartments(data.data)
      }
    } catch (error) {
      console.error('Fetch departments error:', error)
    }
  }

  const fetchEmployees = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/employees?limit=1000', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await response.json()
      if (data.success) {
        setEmployees(data.data)
      }
    } catch (error) {
      console.error('Fetch employees error:', error)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (!form.name.trim()) {
      toast.error('Project name is required')
      return
    }

    if (!form.startDate || !form.endDate) {
      toast.error('Start and end dates are required')
      return
    }

    if (new Date(form.endDate) < new Date(form.startDate)) {
      toast.error('End date cannot be before start date')
      return
    }

    setSaving(true)

    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/projects/${projectId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          name: form.name.trim(),
          description: form.description.trim(),
          status: form.status,
          priority: form.priority,
          startDate: form.startDate,
          endDate: form.endDate,
          projectHead: form.projectHead
        })
      })

      const data = await response.json()
      if (data.success) {
        toast.success('Project updated successfully')
        router.push(`/dashboard/projects/${projectId}`)
      } else {
        toast.error(data.message || 'Failed to update project')
      }
    } catch (error) {
      console.error('Update project error:', error)
      toast.error('An error occurred')
    } finally {
      setSaving(false)
    }
  }

  const handleAddMembers = async () => {
    if (selectedNewMembers.length === 0) {
      toast.error('Please select at least one member')
      return
    }

    setSaving(true)
    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/projects/${projectId}/members`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          memberIds: selectedNewMembers,
          role: 'member'
        })
      })

      const data = await response.json()
      if (data.success) {
        toast.success('Members added successfully')
        setShowAddMemberModal(false)
        setSelectedNewMembers([])
        fetchProject()
      } else {
        toast.error(data.message || 'Failed to add members')
      }
    } catch (error) {
      console.error('Add members error:', error)
      toast.error('An error occurred')
    } finally {
      setSaving(false)
    }
  }

  const handleRemoveMember = async (memberId) => {
    if (!confirm('Are you sure you want to remove this member?')) return

    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/projects/${projectId}/members/${memberId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      })

      const data = await response.json()
      if (data.success) {
        toast.success('Member removed')
        fetchProject()
      } else {
        toast.error(data.message || 'Failed to remove member')
      }
    } catch (error) {
      console.error('Remove member error:', error)
      toast.error('An error occurred')
    }
  }

  const handleArchiveProject = async () => {
    if (!confirm('Are you sure you want to archive this project? This action can be undone.')) return

    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/projects/${projectId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ status: 'archived' })
      })

      const data = await response.json()
      if (data.success) {
        toast.success('Project archived')
        router.push('/dashboard/projects')
      } else {
        toast.error(data.message)
      }
    } catch (error) {
      toast.error('Failed to archive project')
    }
  }

  const handleDeleteProject = async () => {
    if (!confirm('Are you sure you want to permanently delete this project? This action cannot be undone.')) return

    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/projects/${projectId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      })

      const data = await response.json()
      if (data.success) {
        toast.success('Project deleted')
        router.push('/dashboard/projects')
      } else {
        toast.error(data.message)
      }
    } catch (error) {
      toast.error('Failed to delete project')
    }
  }

  if (loading) {
    return (
      <div className="page-container">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
        </div>
      </div>
    )
  }

  if (!project) return null

  // Get list of current member IDs
  const currentMemberIds = project.members?.map(m => m.user?._id || m.user) || []
  
  // Filter available employees for adding
  const availableEmployees = employees.filter(emp => 
    !currentMemberIds.includes(emp._id) && 
    emp._id !== form.projectHead
  )

  // Group available employees by department
  const employeesByDept = {}
  availableEmployees.forEach(emp => {
    const deptName = emp.department?.name || 'No Department'
    if (!employeesByDept[deptName]) {
      employeesByDept[deptName] = []
    }
    employeesByDept[deptName].push(emp)
  })

  const canManage = project.isCreator || project.isProjectHead || (user && ['admin'].includes(user.role))

  return (
    <div className="page-container">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center">
          <button
            onClick={() => router.push(`/dashboard/projects/${projectId}`)}
            className="mr-4 p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <FaArrowLeft className="text-gray-600" />
          </button>
          <div>
            <h1 className="text-3xl font-bold text-gray-800">Edit Project</h1>
            <p className="text-gray-600">{project.name}</p>
          </div>
        </div>

        <div className="flex gap-2">
          {canManage && project.status !== 'archived' && (
            <button
              onClick={handleArchiveProject}
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 flex items-center"
            >
              <FaArchive className="mr-2" />
              Archive
            </button>
          )}
          {canManage && (
            <button
              onClick={handleDeleteProject}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 flex items-center"
            >
              <FaTrash className="mr-2" />
              Delete
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Form */}
        <div className="lg:col-span-2">
          <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6">
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Project Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  placeholder="Enter project name"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm(prev => ({ ...prev, description: e.target.value }))}
                  rows={4}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
                  placeholder="Describe the project..."
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                  <select
                    value={form.status}
                    onChange={(e) => setForm(prev => ({ ...prev, status: e.target.value }))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                  >
                    <option value="planned">Planned</option>
                    <option value="ongoing">Ongoing</option>
                    <option value="on_hold">On Hold</option>
                    <option value="completed">Completed</option>
                    <option value="archived">Archived</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
                  <select
                    value={form.priority}
                    onChange={(e) => setForm(prev => ({ ...prev, priority: e.target.value }))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Start Date <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={form.startDate}
                    onChange={(e) => setForm(prev => ({ ...prev, startDate: e.target.value }))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    End Date <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={form.endDate}
                    onChange={(e) => setForm(prev => ({ ...prev, endDate: e.target.value }))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Project Head</label>
                <select
                  value={form.projectHead}
                  onChange={(e) => setForm(prev => ({ ...prev, projectHead: e.target.value }))}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                >
                  <option value="">Select project head...</option>
                  {employees.map(emp => (
                    <option key={emp._id} value={emp._id}>
                      {emp.firstName} {emp.lastName} - {emp.department?.name || 'No Dept'}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
                <button
                  type="button"
                  onClick={() => router.push(`/dashboard/projects/${projectId}`)}
                  className="btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="btn-primary flex items-center"
                >
                  <FaSave className="mr-2" />
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </form>
        </div>

        {/* Members Panel */}
        <div>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-800 dark:text-white">Team Members</h3>
              {canManage && (
                <button
                  onClick={() => setShowAddMemberModal(true)}
                  className="p-2 text-primary-600 hover:bg-primary-50 rounded-lg"
                >
                  <FaPlus />
                </button>
              )}
            </div>

            <div className="space-y-3">
              {project.members?.map(member => (
                <div
                  key={member._id}
                  className={`flex items-center justify-between p-3 rounded-lg ${
                    member.role === 'head' ? 'bg-primary-50' : 'bg-gray-50'
                  }`}
                >
                  <div className="flex items-center">
                    <div className="w-8 h-8 rounded-full bg-primary-500 flex items-center justify-center text-white text-sm overflow-hidden">
                      {member.user?.profilePicture ? (
                        <img src={member.user.profilePicture} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <span>{member.user?.firstName?.[0]}{member.user?.lastName?.[0]}</span>
                      )}
                    </div>
                    <div className="ml-3">
                      <p className="text-sm font-medium text-gray-800">
                        {member.user?.firstName} {member.user?.lastName}
                      </p>
                      <p className="text-xs text-gray-500 capitalize">{member.role}</p>
                    </div>
                  </div>
                  
                  {canManage && member.role !== 'head' && (
                    <button
                      onClick={() => handleRemoveMember(member._id)}
                      className="p-1 text-red-500 hover:bg-red-50 rounded"
                    >
                      <FaTimes className="w-3 h-3" />
                    </button>
                  )}
                </div>
              ))}

              {(!project.members || project.members.length === 0) && (
                <p className="text-sm text-gray-500 text-center py-4">No members added yet</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Add Member Modal */}
      {showAddMemberModal && (
      <Portal>
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9999] p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
            <div className="p-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-2">
                <FaUsers className="text-primary-500" />
                <h3 className="text-lg font-semibold">Add Team Members</h3>
              </div>
              <button
                onClick={() => { setShowAddMemberModal(false); setSelectedNewMembers([]) }}
                className="p-2 hover:bg-gray-100 rounded-lg"
              >
                <FaTimes />
              </button>
            </div>
            
            <div className="p-4 overflow-y-auto flex-1">
              {Object.keys(employeesByDept).length > 0 ? (
                Object.entries(employeesByDept).map(([deptName, deptEmployees]) => (
                  <div key={deptName} className="mb-4">
                    <h4 className="text-sm font-medium text-gray-500 mb-2">{deptName}</h4>
                    <div className="space-y-2">
                      {deptEmployees.map(emp => (
                        <label
                          key={emp._id}
                          className="flex items-center gap-3 p-2 hover:bg-gray-50 rounded-lg cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={selectedNewMembers.includes(emp._id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedNewMembers(prev => [...prev, emp._id])
                              } else {
                                setSelectedNewMembers(prev => prev.filter(id => id !== emp._id))
                              }
                            }}
                            className="rounded border-gray-300 text-primary-500 focus:ring-primary-500"
                          />
                          <div className="w-8 h-8 rounded-full bg-primary-500 flex items-center justify-center text-white text-sm overflow-hidden">
                            {emp.profilePicture ? (
                              <img src={emp.profilePicture} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <span>{emp.firstName?.[0]}{emp.lastName?.[0]}</span>
                            )}
                          </div>
                          <span className="text-sm text-gray-700">
                            {emp.firstName} {emp.lastName}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-center text-gray-500 py-8">
                  All available employees are already members of this project
                </p>
              )}
            </div>
            
            <div className="p-4 border-t border-gray-200 flex justify-end gap-3 flex-shrink-0">
              <button
                onClick={() => { setShowAddMemberModal(false); setSelectedNewMembers([]) }}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleAddMembers}
                disabled={saving || selectedNewMembers.length === 0}
                className="btn-primary"
              >
                {saving ? 'Adding...' : `Add ${selectedNewMembers.length} Member${selectedNewMembers.length !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        </div>
      </Portal>
      )}
    </div>
  )
}
