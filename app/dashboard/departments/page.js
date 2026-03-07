'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { Button, Skeleton } from '@heroui/react'
import toast from '@/utils/toast'
import { useSocket, REALTIME_EVENTS } from '@/contexts/SocketContext'
import { FaPlus, FaEdit, FaTrash, FaBuilding, FaUsers, FaTimes, FaUserTie, FaSearch, FaLayerGroup, FaUserShield } from 'react-icons/fa'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import useApiMutation from '@/hooks/useApiMutation'
import LoadingButton from '@/components/ui/LoadingButton'
import { DataErrorState } from '@/components/ui/ErrorBoundary'
import BackgroundRefreshIndicator from '@/components/ui/BackgroundRefreshIndicator'
import ModalPortal from '@/components/ui/ModalPortal'
import { ConfirmModal } from '@/components/ui/heroui/Modal'

export default function DepartmentsPage() {
  const [showModal, setShowModal] = useState(false)
  const [editingDept, setEditingDept] = useState(null)
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    code: '',
    heads: [], // Changed from head to heads array
  })
  const [headSearch, setHeadSearch] = useState('')
  const [showHeadDropdown, setShowHeadDropdown] = useState(false)
  const dropdownRef = useRef(null)

  // Team management state
  const [showTeamModal, setShowTeamModal] = useState(false)
  const [editingTeam, setEditingTeam] = useState(null)
  const [teamDeptId, setTeamDeptId] = useState(null)
  const [teamFormData, setTeamFormData] = useState({
    teamName: '',
    teamCode: '',
    description: '',
    leaderIds: [],
    memberIds: [],
  })
  const [teamSearch, setTeamSearch] = useState('')
  const [showTeamDropdown, setShowTeamDropdown] = useState(false)
  const [teamSearchType, setTeamSearchType] = useState('leaders') // 'leaders' or 'members'
  const teamDropdownRef = useRef(null)
  const teamMemberDropdownRef = useRef(null)
  const [expandedDepts, setExpandedDepts] = useState({}) // track which dept cards show teams
  const [deleteTeamConfirmId, setDeleteTeamConfirmId] = useState(null) // team id pending delete confirmation

  // Debounced search values
  const [debouncedHeadSearch, setDebouncedHeadSearch] = useState('')
  const [debouncedTeamSearch, setDebouncedTeamSearch] = useState('')
  const debounceTimerRef = useRef(null)
  const teamDebounceTimerRef = useRef(null)

  const handleHeadSearchChange = useCallback((value) => {
    setHeadSearch(value)
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = setTimeout(() => setDebouncedHeadSearch(value), 300)
  }, [])

  const handleTeamSearchChange = useCallback((value, type) => {
    setTeamSearch(value)
    setTeamSearchType(type)
    setShowTeamDropdown(true)
    if (teamDebounceTimerRef.current) clearTimeout(teamDebounceTimerRef.current)
    teamDebounceTimerRef.current = setTimeout(() => setDebouncedTeamSearch(value), 300)
  }, [])

  // Cleanup timers
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
      if (teamDebounceTimerRef.current) clearTimeout(teamDebounceTimerRef.current)
    }
  }, [])

  // User from localStorage
  const user = useMemo(() => { try { return JSON.parse(localStorage.getItem('user')) } catch { return null } }, [])
  const isAdmin = user && ['admin', 'hr'].includes(user.role)

  // SWR data fetching
  const { data: deptsRes, error, isLoading, isValidating, mutate: refreshDepartments } = useAuthedSWR('/api/departments')
  const departments = deptsRes?.data || []

  const { data: employeesRes } = useAuthedSWR(isAdmin ? '/api/employees?limit=1000' : null)
  const employees = employeesRes?.data || []

  const { data: usersRes } = useAuthedSWR(isAdmin ? '/api/users?limit=1000' : null)
  const users = usersRes?.data || usersRes?.users || []

  // Real-time updates
  const { socket, isConnected, subscribe } = useSocket()

  // Subscribe to real-time department updates
  useEffect(() => {
    if (!socket || !isConnected) return

    const handleDepartmentUpdate = (data) => {
      console.log('🔄 [Departments] Real-time update received:', data)
      refreshDepartments()
    }

    const unsub = subscribe?.(REALTIME_EVENTS.DEPARTMENT_UPDATED, handleDepartmentUpdate)

    return () => {
      unsub?.()
    }
  }, [socket, isConnected])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowHeadDropdown(false)
      }
      const inLeadersDropdown = teamDropdownRef.current && teamDropdownRef.current.contains(event.target)
      const inMembersDropdown = teamMemberDropdownRef.current && teamMemberDropdownRef.current.contains(event.target)
      if (!inLeadersDropdown && !inMembersDropdown) {
        setShowTeamDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Mutations
  const submitMutation = useApiMutation({
    invalidateKeys: ['/api/departments'],
    onSuccess: (data) => {
      toast.success(data.message || 'Department saved')
      setShowModal(false)
      setEditingDept(null)
      setFormData({ name: '', description: '', code: '', heads: [] })
    },
    onError: (msg) => toast.error(msg || 'Failed to save department'),
  })

  const deleteMutation = useApiMutation({
    method: 'DELETE',
    invalidateKeys: ['/api/departments'],
    onSuccess: (data) => toast.success(data.message || 'Department deleted'),
    onError: (msg) => toast.error(msg || 'Failed to delete department'),
  })

  // Team mutations
  const teamSubmitMutation = useApiMutation({
    invalidateKeys: ['/api/departments'],
    onSuccess: (data) => {
      toast.success(data.message || 'Team saved')
      handleCloseTeamModal()
      refreshDepartments()
    },
    onError: (msg) => toast.error(msg || 'Failed to save team'),
  })

  const teamDeleteMutation = useApiMutation({
    method: 'DELETE',
    invalidateKeys: ['/api/departments'],
    onSuccess: (data) => {
      setDeleteTeamConfirmId(null)
      toast.success(data.message || 'Team deleted')
      refreshDepartments()
    },
    onError: (msg) => {
      setDeleteTeamConfirmId(null)
      toast.error(msg || 'Failed to delete team')
    },
  })

  const handleSubmit = (e) => {
    e.preventDefault()
    const url = editingDept ? `/api/departments/${editingDept._id}` : '/api/departments'
    submitMutation.execute(url, formData, { method: editingDept ? 'PUT' : 'POST' })
  }

  const handleEdit = (dept) => {
    setEditingDept(dept)
    // Combine legacy head with heads array for editing
    const existingHeads = []
    if (dept.heads && dept.heads.length > 0) {
      existingHeads.push(...dept.heads.map(h => h._id || h))
    } else if (dept.head) {
      existingHeads.push(dept.head._id || dept.head)
    }
    setFormData({
      name: dept.name,
      description: dept.description || '',
      code: dept.code || '',
      heads: existingHeads,
    })
    setShowModal(true)
  }

  const handleDelete = (id) => {
    if (!confirm('Are you sure you want to delete this department?')) return
    deleteMutation.execute(`/api/departments/${id}`)
  }

  const handleCloseModal = () => {
    setShowModal(false)
    setEditingDept(null)
    setFormData({ name: '', description: '', code: '', heads: [] })
    setHeadSearch('')
    setShowHeadDropdown(false)
  }

  const addHead = (employee) => {
    if (!formData.heads.includes(employee._id)) {
      setFormData({ ...formData, heads: [...formData.heads, employee._id] })
    }
    setHeadSearch('')
    setShowHeadDropdown(false)
  }

  const removeHead = (headId) => {
    setFormData({ ...formData, heads: formData.heads.filter(h => h !== headId) })
  }

  // ── Team Modal Handlers ──────────────────────────────────────────────
  const handleOpenTeamModal = (deptId, team = null) => {
    setTeamDeptId(deptId)
    if (team) {
      setEditingTeam(team)
      setTeamFormData({
        teamName: team.teamName || '',
        teamCode: team.teamCode || '',
        description: team.description || '',
        leaderIds: (team.teamLeaders || []).map(l => l._id || l),
        memberIds: (team.members || []).map(m => m._id || m),
      })
    } else {
      setEditingTeam(null)
      setTeamFormData({ teamName: '', teamCode: '', description: '', leaderIds: [], memberIds: [] })
    }
    setShowTeamModal(true)
  }

  const handleCloseTeamModal = () => {
    setShowTeamModal(false)
    setEditingTeam(null)
    setTeamDeptId(null)
    setTeamFormData({ teamName: '', teamCode: '', description: '', leaderIds: [], memberIds: [] })
    setTeamSearch('')
    setShowTeamDropdown(false)
  }

  const handleTeamSubmit = (e) => {
    e.preventDefault()
    const payload = {
      teamName: teamFormData.teamName,
      teamCode: teamFormData.teamCode,
      description: teamFormData.description,
      department: teamDeptId,
      teamLeaders: teamFormData.leaderIds,
      members: teamFormData.memberIds,
    }
    if (editingTeam) {
      teamSubmitMutation.execute(`/api/teams/${editingTeam._id}`, payload, { method: 'PUT' })
    } else {
      teamSubmitMutation.execute('/api/teams', payload, { method: 'POST' })
    }
  }

  const handleDeleteTeam = (teamId) => {
    setDeleteTeamConfirmId(teamId)
  }

  const handleDeleteTeamConfirm = () => {
    const teamId = deleteTeamConfirmId
    teamDeleteMutation.execute(`/api/teams/${teamId}`)
  }

  const toggleDeptExpand = (deptId) => {
    setExpandedDepts(prev => ({ ...prev, [deptId]: !prev[deptId] }))
  }

  const addTeamPerson = (employeeId, type) => {
    if (type === 'leaders') {
      if (!teamFormData.leaderIds.includes(employeeId)) {
        setTeamFormData({ ...teamFormData, leaderIds: [...teamFormData.leaderIds, employeeId] })
      }
    } else {
      if (!teamFormData.memberIds.includes(employeeId)) {
        setTeamFormData({ ...teamFormData, memberIds: [...teamFormData.memberIds, employeeId] })
      }
    }
    setTeamSearch('')
    setShowTeamDropdown(false)
  }

  const removeTeamPerson = (personId, type) => {
    if (type === 'leaders') {
      setTeamFormData({ ...teamFormData, leaderIds: teamFormData.leaderIds.filter(id => id !== personId) })
    } else {
      setTeamFormData({ ...teamFormData, memberIds: teamFormData.memberIds.filter(id => id !== personId) })
    }
  }

  const getHeadDetails = (headId) => {
    // Check employees first
    const emp = employees.find(e => e._id === headId)
    if (emp) return emp
    // Fallback to users
    const usr = users.find(u => u._id === headId || u.employeeId === headId)
    if (usr) return {
      _id: usr._id,
      firstName: usr.firstName || usr.email?.split('@')[0] || 'User',
      lastName: usr.lastName || '',
      employeeCode: usr.employeeId?.employeeCode || usr.email
    }
    return null
  }

  // Combine employees and users for selection
  const availablePeople = employees.length > 0 ? employees : users.map(u => ({
    _id: u._id,
    firstName: u.firstName || u.email?.split('@')[0] || 'User',
    lastName: u.lastName || '',
    employeeCode: u.email || u._id,
    email: u.email
  }))

  // Filter out already selected heads (ensure heads is always an array)
  const heads = formData.heads || []
  const unselectedPeople = availablePeople.filter(person => !heads.includes(person._id))

  // When searching, filter by debounced search term; otherwise just show first 10
  const filteredEmployees = debouncedHeadSearch.trim()
    ? unselectedPeople.filter(person =>
      `${person.firstName} ${person.lastName}`.toLowerCase().includes(debouncedHeadSearch.toLowerCase()) ||
      person.employeeCode?.toLowerCase().includes(debouncedHeadSearch.toLowerCase()) ||
      person.email?.toLowerCase().includes(debouncedHeadSearch.toLowerCase())
    )
    : unselectedPeople.slice(0, 10)

  const canManageDepartments = () => {
    return isAdmin
  }

  if (error) return <DataErrorState message="Failed to load departments" onRetry={() => refreshDepartments()} />

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex md:justify-between md:items-center md:flex-row flex-col mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">Departments</h1>
          <p className="text-gray-600 mt-1">
            {canManageDepartments() ? 'Manage company departments' : 'View company departments'}
            <BackgroundRefreshIndicator isValidating={isValidating} />
          </p>
        </div>
        {canManageDepartments() && (
          <Button
            onPress={() => setShowModal(true)}
            color="primary"
            startContent={<FaPlus />}
          >
            Add Department
          </Button>
        )}
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-4 sm:mb-6">
        <div className="bg-white rounded-lg shadow-md p-3 sm:p-6">
          <div className="flex items-center justify-start mb-2">
            <h3 className="text-xs sm:text-sm font-medium text-gray-600 truncate">Total Departments</h3>
            <FaBuilding className="text-primary-500 flex-shrink-0" />
          </div>
          <div className="text-2xl sm:text-3xl font-bold text-gray-800">{departments.length}</div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-3 sm:p-6">
          <div className="flex items-center justify-start mb-2">
            <h3 className="text-xs sm:text-sm font-medium text-gray-600 truncate">Active Departments</h3>
            <FaBuilding className="text-green-500 flex-shrink-0" />
          </div>
          <div className="text-2xl sm:text-3xl font-bold text-gray-800">
            {departments.filter(d => d.isActive !== false).length}
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-3 sm:p-6">
          <div className="flex items-center justify-start mb-2">
            <h3 className="text-xs sm:text-sm font-medium text-gray-600 truncate">Total Teams</h3>
            <FaLayerGroup className="text-indigo-500 flex-shrink-0" />
          </div>
          <div className="text-2xl sm:text-3xl font-bold text-gray-800">
            {departments.reduce((sum, d) => sum + (d.teams?.length || 0), 0)}
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-3 sm:p-6">
          <div className="flex items-center justify-start mb-2">
            <h3 className="text-xs sm:text-sm font-medium text-gray-600 truncate">Total Employees</h3>
            <FaUsers className="text-blue-500 flex-shrink-0" />
          </div>
          <div className="text-2xl sm:text-3xl font-bold text-gray-800">
            {departments.reduce((sum, d) => sum + (d.employeeCount || 0), 0)}
          </div>
        </div>
      </div>

      {/* Departments Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        {isLoading ? (
          <>
            {[...Array(6)].map((_, i) => (
              <div key={i} className="bg-white rounded-lg shadow-md p-3 sm:p-6">
                <div className="flex items-start justify-between mb-3 sm:mb-4">
                  <div className="flex items-center space-x-2 sm:space-x-3 flex-1">
                    <Skeleton className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-5 w-3/4 rounded" />
                      <Skeleton className="h-3 w-1/2 rounded" />
                    </div>
                  </div>
                </div>
                <Skeleton className="h-4 w-full rounded mb-3" />
                <div className="flex items-center justify-between pt-3 border-t border-gray-200">
                  <Skeleton className="h-4 w-24 rounded" />
                  <Skeleton className="h-4 w-20 rounded" />
                </div>
              </div>
            ))}
          </>
        ) : departments.length === 0 ? (
          <div className="col-span-full bg-white rounded-lg shadow-md p-6 sm:p-8 text-center text-gray-500">
            No departments found
          </div>
        ) : (
          departments.map((dept) => (
            <div
              key={dept._id}
              className="bg-white rounded-lg shadow-md p-3 sm:p-6 hover:shadow-lg transition-shadow"
            >
              <div className="flex items-start justify-between mb-3 sm:mb-4">
                <div className="flex items-center space-x-2 sm:space-x-3 flex-1 min-w-0">
                  <div className="bg-primary-100 p-2 sm:p-3 rounded-lg flex-shrink-0">
                    <FaBuilding className="text-primary-500 text-lg sm:text-xl" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-base sm:text-lg font-bold text-gray-800 truncate">{dept.name}</h3>
                    {dept.code && (
                      <p className="text-xs sm:text-sm text-gray-500 truncate">{dept.code}</p>
                    )}
                  </div>
                </div>
                {canManageDepartments() && (
                  <div className="flex space-x-1 sm:space-x-2 flex-shrink-0">
                    <button
                      onClick={() => handleEdit(dept)}
                      className="text-blue-600 hover:text-blue-800 p-1.5 sm:p-2 rounded-lg hover:bg-blue-50 transition-colors"
                      title="Edit Department"
                    >
                      <FaEdit className="w-3 h-3 sm:w-4 sm:h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(dept._id)}
                      disabled={deleteMutation.isLoading}
                      className="text-red-600 hover:text-red-800 p-1.5 sm:p-2 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50"
                      title="Delete Department"
                    >
                      <FaTrash className="w-3 h-3 sm:w-4 sm:h-4" />
                    </button>
                  </div>
                )}
              </div>

              {dept.description && (
                <p className="text-gray-600 text-xs sm:text-sm mb-3 sm:mb-4 line-clamp-2">{dept.description}</p>
              )}

              <div className="flex items-center justify-between pt-3 sm:pt-4 border-t border-gray-200">
                <div className="flex items-center space-x-1 sm:space-x-2 text-xs sm:text-sm text-gray-600">
                  <FaUsers className="flex-shrink-0" />
                  <span className="truncate">{dept.employeeCount || 0} Employees</span>
                </div>
                <div className="text-xs sm:text-sm text-gray-600">
                  {dept.heads && dept.heads.length > 0 ? (
                    <div className="flex items-center space-x-1">
                      <FaUserTie className="text-primary-500" />
                      <span className="truncate max-w-[100px]">
                        {dept.heads.length === 1
                          ? `${dept.heads[0].firstName} ${dept.heads[0].lastName}`
                          : `${dept.heads.length} Heads`
                        }
                      </span>
                    </div>
                  ) : dept.head ? (
                    <div className="flex items-center space-x-1">
                      <FaUserTie className="text-primary-500" />
                      <span className="truncate max-w-[100px]">{dept.head.firstName} {dept.head.lastName}</span>
                    </div>
                  ) : null}
                </div>
              </div>

              {/* Show all heads if multiple */}
              {dept.heads && dept.heads.length > 1 && (
                <div className="mt-2 pt-2 border-t border-gray-100">
                  <p className="text-xs text-gray-500 mb-1">Department Heads:</p>
                  <div className="flex flex-wrap gap-1">
                    {dept.heads.map(head => (
                      <span key={head._id} className="text-xs bg-primary-50 text-primary-700 px-2 py-0.5 rounded-full">
                        {head.firstName} {head.lastName}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Department Managers */}
              {dept.departmentManagers && dept.departmentManagers.length > 0 && (
                <div className="mt-2 pt-2 border-t border-gray-100">
                  <p className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                    <FaUserShield className="text-amber-500" /> Department Managers:
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {dept.departmentManagers.map(mgr => (
                      <span key={mgr._id} className="text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full">
                        {mgr.firstName} {mgr.lastName}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Teams Section */}
              <div className="mt-2 pt-2 border-t border-gray-100">
                <div className="flex items-center justify-between mb-1">
                  <button
                    onClick={() => toggleDeptExpand(dept._id)}
                    className="text-xs text-gray-500 flex items-center gap-1 hover:text-gray-700 transition-colors"
                  >
                    <FaLayerGroup className="text-indigo-500" />
                    <span>{dept.teams?.length || 0} Teams</span>
                    <span className="text-[10px]">{expandedDepts[dept._id] ? '▲' : '▼'}</span>
                  </button>
                  {canManageDepartments() && (
                    <button
                      onClick={() => handleOpenTeamModal(dept._id)}
                      className="text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-0.5"
                    >
                      <FaPlus className="w-2.5 h-2.5" /> Team
                    </button>
                  )}
                </div>
                {expandedDepts[dept._id] && dept.teams && dept.teams.length > 0 && (
                  <div className="space-y-1.5 mt-1">
                    {dept.teams.map(team => (
                      <div key={team._id} className="bg-gray-50 rounded-md px-2.5 py-1.5 flex items-center justify-between">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-gray-700 truncate">{team.teamName}</p>
                          <p className="text-[10px] text-gray-400">
                            {(team.teamLeaders?.length || 0)} lead{(team.teamLeaders?.length || 0) !== 1 ? 's' : ''} · {(team.members?.length || 0)} member{(team.members?.length || 0) !== 1 ? 's' : ''}
                          </p>
                        </div>
                        {canManageDepartments() && (
                          <div className="flex gap-1 flex-shrink-0">
                            <button
                              onClick={() => handleOpenTeamModal(dept._id, team)}
                              className="text-blue-500 hover:text-blue-700 p-1"
                              title="Edit Team"
                            >
                              <FaEdit className="w-2.5 h-2.5" />
                            </button>
                            <button
                              onClick={() => handleDeleteTeam(team._id)}
                              className="text-red-500 hover:text-red-700 p-1"
                              title="Delete Team"
                            >
                              <FaTrash className="w-2.5 h-2.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Add/Edit Modal */}
      <ModalPortal isOpen={showModal}>
        <div className="modal-overlay">
          <div className="bg-white rounded-[30px] animate-modal-enter p-6 w-full max-w-md">
            <h2 className="text-2xl font-bold text-gray-800 mb-4">
              {editingDept ? 'Edit Department' : 'Add Department'}
            </h2>
            <form onSubmit={handleSubmit}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Department Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    placeholder="e.g., Engineering"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Department Code
                  </label>
                  <input
                    type="text"
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    placeholder="e.g., ENG"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Description
                  </label>
                  <textarea
                    rows="3"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    placeholder="Department description"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Department Heads <span className="text-gray-400 font-normal">(Optional - Multiple allowed)</span>
                  </label>

                  {/* Selected heads */}
                  {formData.heads.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-2">
                      {formData.heads.map(headId => {
                        const head = getHeadDetails(headId)
                        return head ? (
                          <span
                            key={headId}
                            className="inline-flex items-center space-x-1 bg-primary-100 text-primary-800 px-3 py-1 rounded-full text-sm"
                          >
                            <span>{head.firstName} {head.lastName}</span>
                            <button
                              type="button"
                              onClick={() => removeHead(headId)}
                              className="text-primary-600 hover:text-primary-800"
                            >
                              <FaTimes className="w-3 h-3" />
                            </button>
                          </span>
                        ) : null
                      })}
                    </div>
                  )}

                  {/* Search and add heads */}
                  <div className="relative" ref={dropdownRef}>
                    <div className="relative">
                      <FaSearch className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                      <input
                        type="text"
                        value={headSearch}
                        onChange={(e) => {
                          handleHeadSearchChange(e.target.value)
                          setShowHeadDropdown(true)
                        }}
                        onFocus={() => setShowHeadDropdown(true)}
                        placeholder="Search and add department heads..."
                        className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      />
                    </div>

                    {showHeadDropdown && filteredEmployees.length > 0 && (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                        {filteredEmployees.slice(0, 10).map(employee => (
                          <button
                            key={employee._id}
                            type="button"
                            onClick={() => addHead(employee)}
                            className="w-full text-left px-4 py-2 hover:bg-gray-100 flex items-center justify-between text-gray-700"
                          >
                            <span className="text-gray-800">{employee.firstName} {employee.lastName}</span>
                            <span className="text-xs text-gray-500">{employee.employeeCode || employee.email}</span>
                          </button>
                        ))}
                        {!headSearch.trim() && unselectedPeople.length > 10 && (
                          <div className="px-4 py-2 text-xs text-gray-400 text-center border-t border-gray-100 bg-gray-50">
                            Type to search {unselectedPeople.length - 10} more...
                          </div>
                        )}
                      </div>
                    )}

                    {showHeadDropdown && filteredEmployees.length === 0 && headSearch.trim() && (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg p-4 text-center text-gray-500 text-sm">
                        No matches found for "{headSearch}"
                      </div>
                    )}

                    {showHeadDropdown && filteredEmployees.length === 0 && !headSearch.trim() && availablePeople.length === 0 && (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg p-4 text-center text-gray-500 text-sm">
                        No employees or users found. You can create the department without heads and add them later.
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    For larger departments, you can assign multiple heads. Authority is determined by employee role/level.
                  </p>
                </div>
              </div>

              <div className="flex justify-end space-x-4 mt-6">
                <Button
                  type="button"
                  onPress={handleCloseModal}
                  variant="flat"
                >
                  Cancel
                </Button>
                <LoadingButton type="submit" color="primary" isLoading={submitMutation.isLoading}>
                  {editingDept ? 'Update' : 'Create'}
                </LoadingButton>
              </div>
            </form>
          </div>
        </div>
      </ModalPortal>

      {/* Team Create/Edit Modal */}
      <ModalPortal isOpen={showTeamModal}>
        <div className="modal-overlay">
          <div className="bg-white rounded-[30px] animate-modal-enter p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <h2 className="text-2xl font-bold text-gray-800 mb-4">
              {editingTeam ? 'Edit Team' : 'Create Team'}
            </h2>
            <form onSubmit={handleTeamSubmit}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Team Name *</label>
                  <input
                    type="text"
                    required
                    value={teamFormData.teamName}
                    onChange={(e) => setTeamFormData({ ...teamFormData, teamName: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    placeholder="e.g., Frontend Squad"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Team Code *</label>
                  <input
                    type="text"
                    required
                    value={teamFormData.teamCode}
                    onChange={(e) => setTeamFormData({ ...teamFormData, teamCode: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    placeholder="e.g., ENG-FE"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                  <textarea
                    rows="2"
                    value={teamFormData.description}
                    onChange={(e) => setTeamFormData({ ...teamFormData, description: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    placeholder="Team description"
                  />
                </div>

                {/* Team Leaders */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Team Leaders <span className="text-gray-400 font-normal">(can be cross-department)</span>
                  </label>
                  {teamFormData.leaderIds.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {teamFormData.leaderIds.map(lid => {
                        const p = getHeadDetails(lid)
                        return p ? (
                          <span key={lid} className="inline-flex items-center gap-1 bg-indigo-100 text-indigo-800 px-2.5 py-0.5 rounded-full text-xs">
                            {p.firstName} {p.lastName}
                            <button type="button" onClick={() => removeTeamPerson(lid, 'leaders')} className="hover:text-indigo-950">
                              <FaTimes className="w-2.5 h-2.5" />
                            </button>
                          </span>
                        ) : null
                      })}
                    </div>
                  )}
                  <div className="relative" ref={teamDropdownRef}>
                    <input
                      type="text"
                      value={teamSearchType === 'leaders' ? teamSearch : ''}
                      onChange={(e) => handleTeamSearchChange(e.target.value, 'leaders')}
                      onFocus={() => { setShowTeamDropdown(true); setTeamSearchType('leaders') }}
                      placeholder="Search leaders..."
                      className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    />
                    {showTeamDropdown && teamSearchType === 'leaders' && (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-36 overflow-y-auto">
                        {availablePeople
                          .filter(p => !teamFormData.leaderIds.includes(p._id) && !teamFormData.memberIds.includes(p._id))
                          .filter(p => !debouncedTeamSearch.trim() || `${p.firstName} ${p.lastName}`.toLowerCase().includes(debouncedTeamSearch.toLowerCase()))
                          .slice(0, 8)
                          .map(p => (
                            <button
                              key={p._id}
                              type="button"
                              onMouseDown={(e) => { e.preventDefault(); addTeamPerson(p._id, 'leaders') }}
                              className="w-full text-left px-3 py-1.5 hover:bg-gray-100 text-sm text-gray-700"
                            >
                              {p.firstName} {p.lastName}
                              <span className="text-[10px] text-gray-400 ml-2">{p.employeeCode || ''}</span>
                            </button>
                          ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Team Members */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Team Members
                  </label>
                  {teamFormData.memberIds.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {teamFormData.memberIds.map(mid => {
                        const p = getHeadDetails(mid)
                        return p ? (
                          <span key={mid} className="inline-flex items-center gap-1 bg-gray-100 text-gray-700 px-2.5 py-0.5 rounded-full text-xs">
                            {p.firstName} {p.lastName}
                            <button type="button" onClick={() => removeTeamPerson(mid, 'members')} className="hover:text-gray-900">
                              <FaTimes className="w-2.5 h-2.5" />
                            </button>
                          </span>
                        ) : null
                      })}
                    </div>
                  )}
                  <div className="relative" ref={teamMemberDropdownRef}>
                    <input
                      type="text"
                      value={teamSearchType === 'members' ? teamSearch : ''}
                      onChange={(e) => handleTeamSearchChange(e.target.value, 'members')}
                      onFocus={() => { setShowTeamDropdown(true); setTeamSearchType('members') }}
                      placeholder="Search members..."
                      className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    />
                    {showTeamDropdown && teamSearchType === 'members' && (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-36 overflow-y-auto">
                        {availablePeople
                          .filter(p => !teamFormData.memberIds.includes(p._id) && !teamFormData.leaderIds.includes(p._id))
                          .filter(p => !debouncedTeamSearch.trim() || `${p.firstName} ${p.lastName}`.toLowerCase().includes(debouncedTeamSearch.toLowerCase()))
                          .slice(0, 8)
                          .map(p => (
                            <button
                              key={p._id}
                              type="button"
                              onMouseDown={(e) => { e.preventDefault(); addTeamPerson(p._id, 'members') }}
                              className="w-full text-left px-3 py-1.5 hover:bg-gray-100 text-sm text-gray-700"
                            >
                              {p.firstName} {p.lastName}
                              <span className="text-[10px] text-gray-400 ml-2">{p.employeeCode || ''}</span>
                            </button>
                          ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex justify-end space-x-4 mt-6">
                <Button type="button" onPress={handleCloseTeamModal} variant="flat">Cancel</Button>
                <LoadingButton type="submit" color="primary" isLoading={teamSubmitMutation.isLoading}>
                  {editingTeam ? 'Update Team' : 'Create Team'}
                </LoadingButton>
              </div>
            </form>
          </div>
        </div>
      </ModalPortal>

      {/* Team Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={!!deleteTeamConfirmId}
        onClose={() => setDeleteTeamConfirmId(null)}
        onConfirm={handleDeleteTeamConfirm}
        title="Delete Team"
        message="Are you sure you want to delete this team? All members will be removed from the team. This action cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
        isLoading={teamDeleteMutation.isLoading}
      />
    </div>
  )
}

