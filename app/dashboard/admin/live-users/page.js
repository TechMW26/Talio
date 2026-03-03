'use client'

import { useState, useMemo } from 'react'
import { Button, Skeleton } from '@heroui/react'
import { useSocket } from '@/contexts/SocketContext'
import toast from '@/utils/toast'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import useApiMutation from '@/hooks/useApiMutation'
import { DataErrorState } from '@/components/ui/ErrorBoundary'
import BackgroundRefreshIndicator from '@/components/ui/BackgroundRefreshIndicator'
import {
  HiOutlineSignal,
  HiOutlineUserGroup,
  HiOutlineCheckCircle,
  HiOutlineClock,
  HiOutlineArrowPath,
  HiOutlineMagnifyingGlass,
  HiOutlineBuildingOffice2,
  HiOutlineChevronDown,
  HiOutlineChevronUp,
  HiOutlineUser,
  HiOutlineExclamationCircle
} from 'react-icons/hi2'

export default function LiveUsersPage() {
  const { isConnected } = useSocket()
  const [activeTab, setActiveTab] = useState('checkedIn')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedDepartment, setSelectedDepartment] = useState('')
  const [expandedDepartments, setExpandedDepartments] = useState({})
  const [selectedUsers, setSelectedUsers] = useState([])

  // SWR: fetch live users data (auto-refresh every 30s)
  const { data: result, error, isLoading, isValidating, mutate: refresh } = useAuthedSWR(
    '/api/admin/live-users',
    { refreshInterval: 30000 }
  )

  // Derive data from SWR response
  const data = useMemo(() => {
    if (!result?.data && !result?.summary) return null
    const apiData = result.data || result
    return {
      summary: apiData.summary || {},
      checkedInToday: apiData.users?.checkedInToday || [],
      loggedInToday: apiData.users?.loggedInToday || [],
      activeUsers: apiData.users?.activeNow || [],
      allUsers: apiData.users?.all || [],
      byDepartment: apiData.byDepartment || [],
      departments: apiData.departments || [],
    }
  }, [result])

  const permissions = useMemo(() => {
    if (!result?.data && !result?.summary) return { canRefresh: false, viewScope: 'all', userRole: 'employee' }
    const apiData = result.data || result
    return apiData.permissions || { canRefresh: false, viewScope: 'all', userRole: 'employee' }
  }, [result])

  // Mutation: broadcast refresh
  const broadcastMutation = useApiMutation({
    method: 'POST',
    onSuccess: (data) => {
      toast.success(data?.message || 'Refresh request sent successfully')
      setSelectedUsers([])
    },
    onError: (msg) => toast.error(msg || 'Failed to send refresh request'),
  })

  const handleRefresh = () => {
    refresh()
  }

  const handleBroadcastRefresh = async (target, targetId = null) => {
    if (!permissions.canRefresh) {
      toast.error('You do not have permission to send refresh requests')
      return
    }

    const body = { target }

    if (target === 'department' && targetId) {
      body.departmentId = targetId
    } else if (target === 'user' && targetId) {
      body.userId = targetId
    } else if (target === 'selected' && selectedUsers.length > 0) {
      body.target = 'selected'
      body.userIds = selectedUsers
    }

    broadcastMutation.execute('/api/admin/broadcast-refresh', body)
  }

  const toggleUserSelection = (userId) => {
    if (!permissions.canRefresh) return
    setSelectedUsers(prev =>
      prev.includes(userId)
        ? prev.filter(id => id !== userId)
        : [...prev, userId]
    )
  }

  const toggleDepartmentExpand = (deptId) => {
    setExpandedDepartments(prev => ({
      ...prev,
      [deptId]: !prev[deptId]
    }))
  }

  const getFilteredUsers = () => {
    if (!data) return []

    let users = []
    switch (activeTab) {
      case 'checkedIn':
        users = data.checkedInToday || []
        break
      case 'loggedIn':
        users = data.loggedInToday || []
        break
      case 'activeNow':
        users = data.activeUsers || []
        break
      case 'all':
        users = data.allUsers || []
        break
      default:
        users = []
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      users = users.filter(user =>
        user.fullName?.toLowerCase().includes(query) ||
        user.email?.toLowerCase().includes(query) ||
        user.departmentName?.toLowerCase().includes(query)
      )
    }

    if (selectedDepartment) {
      users = users.filter(user => user.departmentId === selectedDepartment)
    }

    return users
  }

  const getDepartments = () => {
    if (!data?.byDepartment) return []
    return data.byDepartment
  }

  const filteredUsers = getFilteredUsers()
  const departments = getDepartments()

  // Stats for cards
  const stats = [
    {
      label: 'Checked In Today',
      value: data?.summary?.checkedInToday || 0,
      icon: HiOutlineCheckCircle,
      color: 'green'
    },
    {
      label: 'Logged In Today',
      value: data?.summary?.loggedInToday || 0,
      icon: HiOutlineClock,
      color: 'blue'
    },
    {
      label: 'Active Now',
      value: data?.summary?.activeNow || 0,
      icon: HiOutlineSignal,
      color: 'amber'
    },
    {
      label: 'Total Employees',
      value: data?.summary?.totalUsers || 0,
      icon: HiOutlineUserGroup,
      color: 'purple'
    }
  ]

  const tabs = [
    { id: 'checkedIn', label: 'Checked In', count: data?.summary?.checkedInToday || 0 },
    { id: 'loggedIn', label: 'Logged In', count: data?.summary?.loggedInToday || 0 },
    { id: 'activeNow', label: 'Active Now', count: data?.summary?.activeNow || 0 },
    { id: 'all', label: 'All Users', count: data?.summary?.totalUsers || 0 },
    { id: 'byDepartment', label: 'By Department', count: departments.length }
  ]

  if (isLoading) {
    return (
      <div className="page-container">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <Skeleton className="h-8 w-48 rounded-lg mb-2" />
            <Skeleton className="h-4 w-72 rounded-lg" />
          </div>
          <div className="flex items-center gap-3">
            <Skeleton className="h-9 w-28 rounded-full" />
            <Skeleton className="h-10 w-28 rounded-lg" />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
              <div className="flex items-center gap-4">
                <Skeleton className="w-12 h-12 rounded-lg" />
                <div>
                  <Skeleton className="h-7 w-12 rounded-lg mb-1" />
                  <Skeleton className="h-4 w-24 rounded-lg" />
                </div>
              </div>
            </div>
          ))}
        </div>
        <Skeleton className="h-12 w-full rounded-xl mb-6" />
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="flex items-center justify-between p-4 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div>
                  <Skeleton className="h-4 w-32 rounded-lg mb-1" />
                  <Skeleton className="h-3 w-48 rounded-lg" />
                </div>
              </div>
              <Skeleton className="h-6 w-20 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="page-container">
        <DataErrorState error={error} onRetry={refresh} title="Error Loading Data" />
      </div>
    )
  }

  return (
    <div className="page-container">
      <BackgroundRefreshIndicator isValidating={isValidating} />
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Live Users</h1>
          <p className="text-gray-600 mt-1">Monitor active users and send refresh requests</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Socket Status */}
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm ${isConnected ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
            }`}>
            <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></span>
            {isConnected ? 'Connected' : 'Disconnected'}
          </div>
          {/* Refresh Button */}
          <button
            onClick={handleRefresh}
            disabled={isValidating}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <HiOutlineArrowPath className={`h-5 w-5 ${isValidating ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
          {/* Broadcast All Button - Admin Only */}
          {permissions.canRefresh && (
            <Button
              onPress={() => handleBroadcastRefresh('all')}
              isDisabled={broadcastMutation.isLoading}
              color="primary"
              startContent={<HiOutlineSignal className="h-5 w-5" />}
            >
              <span className="hidden sm:inline">Refresh All Users</span>
            </Button>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {stats.map((stat, index) => {
          const Icon = stat.icon
          const colorClasses = {
            green: 'bg-green-100 text-green-600',
            blue: 'bg-blue-100 text-blue-600',
            amber: 'bg-amber-100 text-amber-600',
            purple: 'bg-purple-100 text-purple-600'
          }
          return (
            <div key={index} className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
              <div className="flex items-center gap-4">
                <div className={`p-3 rounded-lg ${colorClasses[stat.color]}`}>
                  <Icon className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-gray-800">{stat.value}</p>
                  <p className="text-sm text-gray-600">{stat.label}</p>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Filters Section */}
      <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100 mb-6">
        <div className="flex flex-col lg:flex-row gap-4">
          {/* Search */}
          <div className="flex-1 relative">
            <HiOutlineMagnifyingGlass className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search by name, email, or department..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          {/* Department Filter */}
          {activeTab !== 'byDepartment' && (
            <select
              value={selectedDepartment}
              onChange={(e) => setSelectedDepartment(e.target.value)}
              className="px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
            >
              <option value="">All Departments</option>
              {departments.map(dept => (
                <option key={dept.id} value={dept.id}>
                  {dept.name} ({dept.users?.length || 0})
                </option>
              ))}
            </select>
          )}
          {/* Selected Users Actions - Admin Only */}
          {permissions.canRefresh && selectedUsers.length > 0 && (
            <Button
              onPress={() => handleBroadcastRefresh('selected')}
              isDisabled={broadcastMutation.isLoading}
              color="primary"
              startContent={<HiOutlineSignal className="h-5 w-5" />}
            >
              Refresh Selected ({selectedUsers.length})
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 mb-6 overflow-hidden">
        <div className="flex overflow-x-auto border-b border-gray-200">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-6 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${activeTab === tab.id
                  ? 'border-blue-600 text-blue-600 bg-blue-50'
                  : 'border-transparent text-gray-600 hover:text-gray-800 hover:bg-gray-50'
                }`}
            >
              {tab.label}
              <span className={`px-2 py-0.5 rounded-full text-xs ${activeTab === tab.id ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
                }`}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      {activeTab === 'byDepartment' ? (
        /* By Department View */
        <div className="space-y-4">
          {departments.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm p-8 border border-gray-100 text-center">
              <HiOutlineBuildingOffice2 className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-800 mb-2">No Departments Found</h3>
              <p className="text-gray-600">No department data available.</p>
            </div>
          ) : (
            departments.map(dept => (
              <div key={dept.id} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                {/* Department Header */}
                <div
                  onClick={() => toggleDepartmentExpand(dept.id)}
                  className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-100 rounded-lg">
                      <HiOutlineBuildingOffice2 className="h-5 w-5 text-blue-600" />
                    </div>
                    <div>
                      <h3 className="font-medium text-gray-800">{dept.name}</h3>
                      <p className="text-sm text-gray-600">{dept.users?.length || 0} users</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {permissions.canRefresh && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleBroadcastRefresh('department', dept.id)
                        }}
                        disabled={broadcastMutation.isLoading}
                        className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                      >
                        Refresh Dept
                      </button>
                    )}
                    {expandedDepartments[dept.id] ? (
                      <HiOutlineChevronUp className="h-5 w-5 text-gray-400" />
                    ) : (
                      <HiOutlineChevronDown className="h-5 w-5 text-gray-400" />
                    )}
                  </div>
                </div>
                {/* Department Users */}
                {expandedDepartments[dept.id] && (
                  <div className="border-t border-gray-100">
                    {dept.users?.length === 0 ? (
                      <div className="p-4 text-center text-gray-600">No users in this department</div>
                    ) : (
                      <div className="divide-y divide-gray-100">
                        {dept.users?.map(user => (
                          <div key={user.id} className="flex items-center justify-between p-4 hover:bg-gray-50">
                            <div className="flex items-center gap-3">
                              {permissions.canRefresh && (
                                <input
                                  type="checkbox"
                                  checked={selectedUsers.includes(user.userId)}
                                  onChange={() => toggleUserSelection(user.userId)}
                                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                />
                              )}
                              <div className="h-10 w-10 rounded-full bg-gray-200 flex items-center justify-center overflow-hidden">
                                {user.profilePicture ? (
                                  <img src={user.profilePicture} alt={user.fullName} className="h-full w-full object-cover" />
                                ) : (
                                  <HiOutlineUser className="h-5 w-5 text-gray-500" />
                                )}
                              </div>
                              <div>
                                <p className="font-medium text-gray-800">{user.fullName}</p>
                                <p className="text-sm text-gray-600">{user.email}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <div className="flex items-center gap-2">
                                {user.isCheckedIn && (
                                  <span className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded-full">Checked In</span>
                                )}
                              </div>
                              {permissions.canRefresh && (
                                <button
                                  onClick={() => handleBroadcastRefresh('user', user.userId)}
                                  disabled={broadcastMutation.isLoading}
                                  className="p-2 text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                  title="Refresh this user"
                                >
                                  <HiOutlineArrowPath className="h-5 w-5" />
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      ) : (
        /* User List View */
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          {filteredUsers.length === 0 ? (
            <div className="p-8 text-center">
              <HiOutlineUserGroup className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-800 mb-2">No Users Found</h3>
              <p className="text-gray-600">
                {searchQuery || selectedDepartment
                  ? 'Try adjusting your filters.'
                  : 'No users match the current criteria.'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {filteredUsers.map(user => (
                <div key={user.id} className="flex items-center justify-between p-4 hover:bg-gray-50 transition-colors">
                  <div className="flex items-center gap-3">
                    {permissions.canRefresh && (
                      <input
                        type="checkbox"
                        checked={selectedUsers.includes(user.userId)}
                        onChange={() => toggleUserSelection(user.userId)}
                        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                    )}
                    <div className="h-10 w-10 rounded-full bg-gray-200 flex items-center justify-center overflow-hidden">
                      {user.profilePicture ? (
                        <img src={user.profilePicture} alt={user.fullName} className="h-full w-full object-cover" />
                      ) : (
                        <HiOutlineUser className="h-5 w-5 text-gray-500" />
                      )}
                    </div>
                    <div>
                      <p className="font-medium text-gray-800">{user.fullName}</p>
                      <p className="text-sm text-gray-600">{user.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="hidden md:block">
                      <p className="text-sm text-gray-600">{user.departmentName || 'No Department'}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {user.isCheckedIn && (
                        <span className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded-full">Checked In</span>
                      )}
                    </div>
                    {permissions.canRefresh && (
                      <button
                        onClick={() => handleBroadcastRefresh('user', user.userId)}
                        disabled={broadcastMutation.isLoading}
                        className="p-2 text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        title="Refresh this user"
                      >
                        <HiOutlineArrowPath className="h-5 w-5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
