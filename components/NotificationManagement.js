'use client'

import { useState, useEffect } from 'react'
import { FaBell, FaClock, FaRedo, FaPaperPlane, FaUsers, FaBuilding, FaUserTag, FaCalendar, FaTrash, FaEdit, FaPause, FaPlay, FaHistory, FaCheck, FaTimes, FaChevronDown, FaSync } from 'react-icons/fa'
import toast from '@/utils/toast'
import Loader from '@/components/ui/Loader'

export default function NotificationManagement() {
  const [activeTab, setActiveTab] = useState('send')
  const [userRole, setUserRole] = useState('')
  const [userDepartment, setUserDepartment] = useState(null)
  const [isDepartmentHead, setIsDepartmentHead] = useState(false)
  const [loading, setLoading] = useState(true)
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false)
  const [checkingApiKey, setCheckingApiKey] = useState(true)

  useEffect(() => {
    const userData = localStorage.getItem('user')
    if (userData) {
      const user = JSON.parse(userData)
      setUserRole(user.role)
      console.log('User role:', user.role)
    }

    const employeeData = localStorage.getItem('employee')
    if (employeeData) {
      const employee = JSON.parse(employeeData)
      const deptId = employee.department?._id || employee.department
      setUserDepartment(deptId)
      console.log('Employee department ID:', deptId)
    }

    checkDepartmentHead()
    checkApiKeyStatus()
  }, [])

  // Check if user is a department head
  const checkDepartmentHead = async () => {
    try {
      const token = localStorage.getItem('token')
      if (!token) {
        setLoading(false)
        return
      }

      const response = await fetch('/api/team/check-head', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      const data = await response.json()
      console.log('Department head check response:', data)
      if (data.success && data.isDepartmentHead) {
        setIsDepartmentHead(true)
        // Set the department they are head of
        if (data.department && data.department._id) {
          setUserDepartment(data.department._id)
          console.log('Department head of:', data.department._id, data.department.name)
        }
      }
    } catch (error) {
      console.error('Error checking department head:', error)
    } finally {
      setLoading(false)
    }
  }

  // Check if Firebase is configured
  const checkApiKeyStatus = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/notifications/config', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })
      const data = await response.json()
      if (data.success) {
        setApiKeyConfigured(data.configured)
      }
    } catch (error) {
      console.error('Error checking Firebase status:', error)
    } finally {
      setCheckingApiKey(false)
    }
  }

  // Check if user has access
  const hasAccess = ['admin', 'hr', 'department_head'].includes(userRole) || isDepartmentHead

  if (loading) {
    return (
      <div className="text-center py-12">
        <Loader size="lg" />
        <p className="mt-4 text-gray-600">Loading...</p>
      </div>
    )
  }

  if (!hasAccess) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
        <p className="text-red-600">You don't have permission to access this page.</p>
      </div>
    )
  }

  const tabs = [
    { id: 'send', name: 'Send Notification', icon: FaPaperPlane },
    { id: 'scheduled', name: 'Scheduled', icon: FaClock },
    { id: 'recurring', name: 'Recurring', icon: FaRedo },
    { id: 'history', name: 'History', icon: FaHistory }
  ]

  return (
    <div>
      {/* Header */}
      <div className="mb-4 md:mb-6">
        <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-2 flex items-center gap-2">
          <FaBell className="text-primary-500" />
          <span>Notification Management</span>
        </h2>
        <p className="text-gray-600 mb-6">Send, schedule, and manage push notifications</p>
      </div>

      {/* Firebase Status Banner */}

      {/* Firebase Configured Success Banner - Admin only */}
      {!checkingApiKey && apiKeyConfigured && ['admin'].includes(userRole) && (
        <div className="mb-6 bg-green-50 border-l-4 border-green-400 p-4 rounded-lg">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-green-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-medium text-green-800">
                Firebase Cloud Messaging is Active
              </h3>
              <p className="mt-1 text-sm text-green-700">
                Push notifications are configured and ready to send.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="mb-6">
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex space-x-4 overflow-x-auto scrollbar-hide">
            {tabs.map((tab) => {
              const Icon = tab.icon
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center space-x-2 px-4 py-3 border-b-2 font-medium text-sm whitespace-nowrap transition-colors ${
                    activeTab === tab.id
                      ? 'border-primary-500 text-primary-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span className="hidden sm:inline">{tab.name}</span>
                  <span className="sm:hidden">{tab.name.split(' ')[0]}</span>
                </button>
              )
            })}
          </nav>
        </div>
      </div>

      {/* Content */}
      <div>
        {activeTab === 'send' && <SendNotificationTab userRole={userRole} userDepartment={userDepartment} isDepartmentHead={isDepartmentHead} apiKeyConfigured={apiKeyConfigured} />}
        {activeTab === 'scheduled' && <ScheduledNotificationsTab userRole={userRole} userDepartment={userDepartment} isDepartmentHead={isDepartmentHead} />}
        {activeTab === 'recurring' && <RecurringNotificationsTab userRole={userRole} userDepartment={userDepartment} isDepartmentHead={isDepartmentHead} />}
        {activeTab === 'history' && <NotificationHistoryTab userRole={userRole} userDepartment={userDepartment} isDepartmentHead={isDepartmentHead} />}
      </div>
    </div>
  )
}

// Send Notification Tab
function SendNotificationTab({ userRole, userDepartment, isDepartmentHead, apiKeyConfigured }) {
  const [formData, setFormData] = useState({
    title: '',
    message: '',
    url: '/dashboard',
    scheduleType: 'now',
    scheduledFor: '',
    targetType: 'all',
    targetDepartment: '',
    targetRoles: [],
    targetUsers: []
  })
  const [sending, setSending] = useState(false)
  const [departments, setDepartments] = useState([])
  const [employees, setEmployees] = useState([])
  const [employeePage, setEmployeePage] = useState(1)
  const [employeeHasMore, setEmployeeHasMore] = useState(true)
  const [employeeLoading, setEmployeeLoading] = useState(false)

  // Check if user is admin/hr
  const isAdminOrHR = ['admin', 'hr'].includes(userRole)
  const isDeptHead = isDepartmentHead || userRole === 'department_head'

  useEffect(() => {
    fetchDepartments()
  }, [])

  // Fetch employees when component loads or when relevant props change
  useEffect(() => {
    // Only fetch employees if userRole is set (wait for parent to load user data)
    if (userRole) {
      console.log('Fetching employees - userRole:', userRole, 'isDeptHead:', isDeptHead, 'isAdminOrHR:', isAdminOrHR, 'userDepartment:', userDepartment)
      fetchEmployees(1, false)
    }
  }, [userRole, userDepartment, isDepartmentHead])

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
      console.error('Error fetching departments:', error)
    }
  }

  const fetchEmployees = async (page = 1, append = false) => {
    try {
      setEmployeeLoading(true)
      const token = localStorage.getItem('token')
      
      if (!token) {
        console.error('No token found - cannot fetch employees')
        return
      }

      // Build URL with department filter if department head (not admin/hr)
      let url = `/api/employees?limit=50&page=${page}&status=active`
      if (isDeptHead && !isAdminOrHR && userDepartment) {
        url += `&department=${userDepartment}`
        console.log('Fetching employees for department:', userDepartment)
      }

      console.log('Fetching employees from URL:', url)
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      
      if (!response.ok) {
        console.error('Employees API error:', response.status, response.statusText)
        toast.error('Failed to load employees - please refresh the page')
        return
      }
      
      const data = await response.json()
      console.log('Employees API response:', {
        success: data.success,
        count: data.data?.length,
        page,
        total: data.pagination?.total,
        isDeptHead,
        isAdminOrHR,
        userDepartment,
        userRole
      })

      if (data.success) {
        // The API already includes userId in the response
        console.log('Employees loaded:', data.data.length)
        if (append) {
          setEmployees(prev => [...prev, ...data.data])
        } else {
          setEmployees(data.data)
        }

        // Check if there are more pages
        setEmployeeHasMore(data.pagination.page < data.pagination.pages)
        setEmployeePage(page)
      } else {
        console.error('Employees API returned success: false', data.message)
        toast.error(data.message || 'Failed to load employees')
      }
    } catch (error) {
      console.error('Error fetching employees:', error)
      toast.error('Failed to load employees')
    } finally {
      setEmployeeLoading(false)
    }
  }

  const loadMoreEmployees = () => {
    if (!employeeLoading && employeeHasMore) {
      fetchEmployees(employeePage + 1, true)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSending(true)

    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/notifications/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(formData)
      })

      const data = await response.json()
      if (data.success) {
        toast.success(formData.scheduleType === 'now' ? 'Notification sent successfully!' : 'Notification scheduled successfully!')
        setFormData({
          title: '',
          message: '',
          url: '/dashboard',
          scheduleType: 'now',
          scheduledFor: '',
          targetType: 'all',
          targetDepartment: '',
          targetRoles: [],
          targetUsers: []
        })
      } else {
        toast.error(data.message || 'Failed to send notification')
      }
    } catch (error) {
      console.error('Error sending notification:', error)
      toast.error('Failed to send notification')
    } finally {
      setSending(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-6">
      {/* Firebase Status Info - Only show if not configured */}

      {/* Notification Content */}
      <div className="space-y-3 sm:space-y-4">
        <h3 className="text-base sm:text-lg font-semibold text-gray-900">Notification Content</h3>

        <div>
          <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-1.5 sm:mb-2">
            Title *
          </label>
          <input
            type="text"
            value={formData.title}
            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            className="w-full px-3 py-2 sm:px-4 sm:py-2.5 text-sm sm:text-base text-gray-900 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors"
            placeholder="Enter notification title"
            required
          />
        </div>

        <div>
          <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-1.5 sm:mb-2">
            Message *
          </label>
          <textarea
            value={formData.message}
            onChange={(e) => setFormData({ ...formData, message: e.target.value })}
            className="w-full px-3 py-2 sm:px-4 sm:py-2.5 text-sm sm:text-base text-gray-900 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors"
            placeholder="Enter notification message"
            rows={4}
            required
          />
        </div>

        <div>
          <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-1.5 sm:mb-2">
            Action URL
          </label>
          <input
            type="text"
            value={formData.url}
            onChange={(e) => setFormData({ ...formData, url: e.target.value })}
            className="w-full px-3 py-2 sm:px-4 sm:py-2.5 text-sm sm:text-base text-gray-900 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors"
            placeholder="/dashboard"
          />
        </div>
      </div>

      {/* Schedule Type */}
      <div className="space-y-3 sm:space-y-4">
        <h3 className="text-base sm:text-lg font-semibold text-gray-900">Schedule</h3>

        <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
          <label className="flex items-center space-x-2 cursor-pointer">
            <input
              type="radio"
              value="now"
              checked={formData.scheduleType === 'now'}
              onChange={(e) => setFormData({ ...formData, scheduleType: e.target.value })}
              className="w-4 h-4 text-primary-500 focus:ring-primary-500"
            />
            <span className="text-xs sm:text-sm text-gray-900">Send Now</span>
          </label>
          <label className="flex items-center space-x-2 cursor-pointer">
            <input
              type="radio"
              value="scheduled"
              checked={formData.scheduleType === 'scheduled'}
              onChange={(e) => setFormData({ ...formData, scheduleType: e.target.value })}
              className="w-4 h-4 text-primary-500 focus:ring-primary-500"
            />
            <span className="text-xs sm:text-sm text-gray-900">Schedule for Later</span>
          </label>
        </div>

        {formData.scheduleType === 'scheduled' && (
          <div>
            <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-1.5 sm:mb-2">
              Schedule Date & Time
            </label>
            <input
              type="datetime-local"
              value={formData.scheduledFor}
              onChange={(e) => setFormData({ ...formData, scheduledFor: e.target.value })}
              className="w-full px-3 py-2 sm:px-4 sm:py-2.5 text-sm sm:text-base text-gray-900 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors"
              required
            />
          </div>
        )}
      </div>

      {/* Target Audience */}
      <div className="space-y-3 sm:space-y-4">
        <h3 className="text-base sm:text-lg font-semibold text-gray-900">Target Audience</h3>

        <div>
          <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-1.5 sm:mb-2">
            Send To
          </label>
          <select
            value={formData.targetType}
            onChange={(e) => setFormData({ ...formData, targetType: e.target.value })}
            className="w-full px-3 py-2 sm:px-4 sm:py-2.5 text-sm sm:text-base text-gray-900 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors"
          >
            <option value="all">{isDeptHead && !isAdminOrHR ? 'All Department Members' : 'All Employees'}</option>
            {isAdminOrHR && <option value="department">Specific Department</option>}
            {isAdminOrHR && <option value="role">Specific Role</option>}
            <option value="specific">Specific Users</option>
          </select>
        </div>

        {formData.targetType === 'department' && isAdminOrHR && (
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Select Department
            </label>
            <select
              value={formData.targetDepartment}
              onChange={(e) => setFormData({ ...formData, targetDepartment: e.target.value })}
              className="w-full px-4 py-2.5 text-gray-900 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors"
              required
            >
              <option value="">Select a department</option>
              {departments.map(dept => (
                <option key={dept._id} value={dept._id}>{dept.name}</option>
              ))}
            </select>
          </div>
        )}

        {formData.targetType === 'role' && !isDeptHead && (
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Select Roles ({formData.targetRoles.length} selected)
            </label>
            <div className="border border-gray-300 rounded-lg p-4 space-y-2 bg-gray-50">
              {['admin', 'hr', 'manager', 'employee', 'department_head'].map(role => (
                <label key={role} className="flex items-center space-x-3 p-2 hover:bg-white rounded-lg cursor-pointer transition-colors">
                  <input
                    type="checkbox"
                    checked={formData.targetRoles.includes(role)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setFormData({ ...formData, targetRoles: [...formData.targetRoles, role] })
                      } else {
                        setFormData({ ...formData, targetRoles: formData.targetRoles.filter(r => r !== role) })
                      }
                    }}
                    className="rounded text-primary-500 w-4 h-4 focus:ring-primary-500"
                  />
                  <span className="text-sm font-medium text-gray-900 capitalize flex-1">{role.replace('_', ' ')}</span>
                </label>
              ))}
            </div>
            {formData.targetRoles.length > 0 && (
              <button
                type="button"
                onClick={() => setFormData({ ...formData, targetRoles: [] })}
                className="mt-2 text-sm text-primary-600 hover:text-primary-700 font-medium"
              >
                Clear selection
              </button>
            )}
          </div>
        )}

        {formData.targetType === 'specific' && (
          <div>
            <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-1.5 sm:mb-2">
              Select Users ({formData.targetUsers.length} selected)
            </label>
            <div className="border border-gray-300 rounded-lg bg-gray-50">
              <div className="p-3 sm:p-4 max-h-64 sm:max-h-96 overflow-y-auto">
                {employees.length === 0 && !employeeLoading ? (
                  <p className="text-xs sm:text-sm text-gray-500 text-center py-4">
                    {isDeptHead && !isAdminOrHR ? 'No employees found in your department' : 'No employees found'}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {employees.map(emp => {
                      const userId = emp.userId?._id || emp.userId
                      if (!userId) return null

                      return (
                        <label
                          key={emp._id}
                          className="flex items-center space-x-3 p-2 hover:bg-white rounded-lg cursor-pointer transition-colors"
                        >
                          <input
                            type="checkbox"
                            checked={formData.targetUsers.includes(userId)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setFormData({ ...formData, targetUsers: [...formData.targetUsers, userId] })
                              } else {
                                setFormData({ ...formData, targetUsers: formData.targetUsers.filter(id => id !== userId) })
                              }
                            }}
                            className="rounded text-primary-500 w-4 h-4 focus:ring-primary-500"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-medium text-gray-900 truncate">
                                {emp.firstName} {emp.lastName}
                              </span>
                              {emp.isDepartmentHead && (
                                <span className="px-2 py-0.5 text-xs bg-purple-100 text-purple-700 rounded-full whitespace-nowrap">
                                  Dept Head
                                </span>
                              )}
                            </div>
                            <div className="flex items-center flex-wrap gap-1 text-xs text-gray-500 mt-0.5">
                              <span className="truncate">{emp.department?.name || 'No Department'}</span>
                              {emp.designation?.title && (
                                <>
                                  <span>•</span>
                                  <span className="truncate">{emp.designation.title}</span>
                                </>
                              )}
                              {emp.userId?.role && (
                                <>
                                  <span>•</span>
                                  <span className="capitalize">{emp.userId.role}</span>
                                </>
                              )}
                            </div>
                          </div>
                        </label>
                      )
                    })}

                    {employeeLoading && (
                      <div className="text-center py-3">
                        <Loader size="sm" />
                        <p className="text-xs text-gray-500 mt-2">Loading more employees...</p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Load More Button */}
              {employeeHasMore && !employeeLoading && employees.length > 0 && (
                <div className="border-t border-gray-200 p-3">
                  <button
                    type="button"
                    onClick={loadMoreEmployees}
                    className="w-full px-4 py-2 text-sm font-medium text-white rounded-lg transition-all duration-200 flex items-center justify-center space-x-2"
                    style={{ backgroundColor: 'var(--color-primary-500)' }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--color-primary-600)'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'var(--color-primary-500)'}
                  >
                    <FaChevronDown className="w-3 h-3" />
                    <span>Load More Employees</span>
                  </button>
                </div>
              )}
            </div>
            <div className="flex items-center justify-between mt-2 gap-2">
              <p className="text-xs text-gray-500">
                {employees.length} employee{employees.length !== 1 ? 's' : ''} available
              </p>
              {formData.targetUsers.length > 0 && (
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, targetUsers: [] })}
                  className="text-sm text-primary-600 hover:text-primary-700 font-medium"
                >
                  Clear selection
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Submit Button */}
      <div className="flex justify-end pt-3 sm:pt-4">
        <button
          type="submit"
          disabled={sending}
          className="w-full sm:w-auto px-4 sm:px-6 py-2 sm:py-2.5 text-sm sm:text-base text-white rounded-lg disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center space-x-2 font-medium transition-colors"
          style={{
            backgroundColor: sending ? '#9CA3AF' : 'var(--color-primary-600)'
          }}
          onMouseEnter={(e) => {
            if (!sending) {
              e.currentTarget.style.backgroundColor = 'var(--color-primary-700)'
            }
          }}
          onMouseLeave={(e) => {
            if (!sending) {
              e.currentTarget.style.backgroundColor = 'var(--color-primary-600)'
            }
          }}
        >
          <FaPaperPlane className="w-3 h-3 sm:w-4 sm:h-4" />
          <span>{sending ? 'Sending...' : formData.scheduleType === 'now' ? 'Send Notification' : 'Schedule Notification'}</span>
        </button>
      </div>
    </form>
  )
}

// Scheduled Notifications Tab
function ScheduledNotificationsTab({ userRole, userDepartment, isDepartmentHead }) {
  const [scheduledNotifications, setScheduledNotifications] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    fetchScheduledNotifications()
  }, [])

  const fetchScheduledNotifications = async (isRefresh = false) => {
    try {
      if (isRefresh) setRefreshing(true)
      const token = localStorage.getItem('token')
      const response = await fetch('/api/notifications/scheduled', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await response.json()
      if (data.success) {
        // Filter only pending notifications
        const pending = data.data.filter(n => n.status === 'pending')
        // Sort by scheduled date (soonest first)
        pending.sort((a, b) => new Date(a.scheduledFor) - new Date(b.scheduledFor))
        setScheduledNotifications(pending)
      }
    } catch (error) {
      console.error('Error fetching scheduled notifications:', error)
      toast.error('Failed to load scheduled notifications')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  const handleCancel = async (id) => {
    if (!confirm('Are you sure you want to cancel this scheduled notification?')) return

    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/notifications/scheduled?id=${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await response.json()
      if (data.success) {
        toast.success('Scheduled notification cancelled')
        fetchScheduledNotifications()
      } else {
        toast.error(data.message || 'Failed to cancel notification')
      }
    } catch (error) {
      console.error('Error cancelling notification:', error)
      toast.error('Failed to cancel notification')
    }
  }

  const getTargetLabel = (notification) => {
    if (notification.targetType === 'all') return 'All Employees'
    if (notification.targetType === 'department') return notification.targetDepartment?.name || 'Department'
    if (notification.targetType === 'role') return `Roles: ${notification.targetRoles?.join(', ') || 'N/A'}`
    if (notification.targetType === 'specific') return `${notification.targetUsers?.length || 0} User(s)`
    return 'Unknown'
  }

  const getTimeRemaining = (scheduledFor) => {
    const now = new Date()
    const scheduled = new Date(scheduledFor)
    const diff = scheduled - now

    if (diff <= 0) return 'Sending soon...'

    const hours = Math.floor(diff / (1000 * 60 * 60))
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))

    if (hours > 24) {
      const days = Math.floor(hours / 24)
      return `${days} day${days > 1 ? 's' : ''} left`
    }
    if (hours > 0) {
      return `${hours}h ${minutes}m left`
    }
    return `${minutes}m left`
  }

  if (loading) {
    return (
      <div className="text-center py-12">
        <Loader size="lg" />
        <p className="mt-4 text-gray-600">Loading scheduled notifications...</p>
      </div>
    )
  }

  if (scheduledNotifications.length === 0) {
    return (
      <div className="text-center py-12 bg-gray-50 rounded-xl border-2 border-dashed border-gray-300">
        <FaClock className="w-16 h-16 text-gray-400 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-gray-700 mb-2">No Pending Notifications</h3>
        <p className="text-gray-500">Schedule a notification from the "Send Notification" tab</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-800">
          Pending Notifications ({scheduledNotifications.length})
        </h3>
        <button
          onClick={() => fetchScheduledNotifications(true)}
          disabled={refreshing}
          className="p-2 text-gray-500 hover:text-primary-600 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
          title="Refresh"
        >
          <FaSync className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {scheduledNotifications.map((notification) => (
        <div key={notification._id} className="bg-white border border-gray-200 rounded-xl p-4 hover:shadow-md transition-shadow">
          <div className="flex justify-between items-start gap-4">
            <div className="flex-1 min-w-0">
              <h4 className="font-semibold text-gray-900">{notification.title}</h4>
              <p className="text-sm text-gray-600 mt-1 line-clamp-2">{notification.message}</p>
              <div className="flex flex-wrap items-center gap-3 mt-3 text-xs">
                <span className="flex items-center gap-1 text-gray-500">
                  <FaClock className="w-3 h-3" />
                  <span>{new Date(notification.scheduledFor).toLocaleString()}</span>
                </span>
                <span className="flex items-center gap-1 text-gray-500">
                  <FaUsers className="w-3 h-3" />
                  <span>{getTargetLabel(notification)}</span>
                </span>
                <span className="px-2 py-1 bg-yellow-100 text-yellow-800 rounded-full font-medium">
                  {getTimeRemaining(notification.scheduledFor)}
                </span>
              </div>
            </div>
            <button
              onClick={() => handleCancel(notification._id)}
              className="px-3 py-2 text-sm bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors flex items-center gap-1"
            >
              <FaTimes className="w-3 h-3" />
              <span>Cancel</span>
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

// Create Recurring Notification Form Component
function CreateRecurringForm({ formData, setFormData, handleSubmit, creating, departments, employees, isDeptHead }) {
  return (
    <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-lg p-6 space-y-4">
      <h4 className="text-lg font-semibold text-gray-800 mb-4">Create Recurring Notification</h4>

      {/* Title */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Title *
        </label>
        <input
          type="text"
          required
          value={formData.title}
          onChange={(e) => setFormData({ ...formData, title: e.target.value })}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:border-transparent transition-colors"
          style={{ '--tw-ring-color': 'var(--color-primary-500)' }}
          onFocus={(e) => e.currentTarget.style.borderColor = 'var(--color-primary-500)'}
          onBlur={(e) => e.currentTarget.style.borderColor = '#D1D5DB'}
          placeholder="e.g., Daily Standup Reminder"
        />
      </div>

      {/* Message */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Message *
        </label>
        <textarea
          required
          value={formData.message}
          onChange={(e) => setFormData({ ...formData, message: e.target.value })}
          rows={3}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:border-transparent transition-colors"
          style={{ '--tw-ring-color': 'var(--color-primary-500)' }}
          onFocus={(e) => e.currentTarget.style.borderColor = 'var(--color-primary-500)'}
          onBlur={(e) => e.currentTarget.style.borderColor = '#D1D5DB'}
          placeholder="Enter notification message..."
        />
      </div>

      {/* Frequency */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Frequency *
        </label>
        <select
          value={formData.frequency}
          onChange={(e) => setFormData({ ...formData, frequency: e.target.value })}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:border-transparent transition-colors"
          style={{ '--tw-ring-color': 'var(--color-primary-500)' }}
          onFocus={(e) => e.currentTarget.style.borderColor = 'var(--color-primary-500)'}
          onBlur={(e) => e.currentTarget.style.borderColor = '#D1D5DB'}
        >
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
          <option value="custom">Custom (Specific Days)</option>
        </select>
      </div>

      {/* Time */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Time *
        </label>
        <input
          type="time"
          required
          value={formData.time}
          onChange={(e) => setFormData({ ...formData, time: e.target.value })}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:border-transparent transition-colors"
          style={{ '--tw-ring-color': 'var(--color-primary-500)' }}
          onFocus={(e) => e.currentTarget.style.borderColor = 'var(--color-primary-500)'}
          onBlur={(e) => e.currentTarget.style.borderColor = '#D1D5DB'}
        />
      </div>

      {/* Days of Week (for weekly/custom) */}
      {(formData.frequency === 'weekly' || formData.frequency === 'custom') && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Days of Week *
          </label>
          <div className="border border-gray-300 rounded-lg p-4 space-y-2">
            {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(day => (
              <label key={day} className="flex items-center space-x-3 p-2 hover:bg-gray-50 rounded-lg cursor-pointer transition-colors">
                <input
                  type="checkbox"
                  checked={formData.daysOfWeek.includes(day)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setFormData({ ...formData, daysOfWeek: [...formData.daysOfWeek, day] })
                    } else {
                      setFormData({ ...formData, daysOfWeek: formData.daysOfWeek.filter(d => d !== day) })
                    }
                  }}
                  className="rounded w-4 h-4"
                  style={{ accentColor: 'var(--color-primary-500)' }}
                />
                <span className="text-sm font-medium text-gray-800">{day}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Day of Month (for monthly) */}
      {formData.frequency === 'monthly' && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Day of Month *
          </label>
          <input
            type="number"
            min="1"
            max="31"
            required
            value={formData.dayOfMonth}
            onChange={(e) => setFormData({ ...formData, dayOfMonth: parseInt(e.target.value) })}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:border-transparent transition-colors"
            style={{ '--tw-ring-color': 'var(--color-primary-500)' }}
            onFocus={(e) => e.currentTarget.style.borderColor = 'var(--color-primary-500)'}
            onBlur={(e) => e.currentTarget.style.borderColor = '#D1D5DB'}
          />
        </div>
      )}

      {/* Target Type */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-2">
          Send To *
        </label>
        <select
          value={formData.targetType}
          onChange={(e) => setFormData({ ...formData, targetType: e.target.value })}
          className="w-full px-4 py-2.5 text-gray-900 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors"
        >
          <option value="all">{isDeptHead ? 'All Department Members' : 'All Users'}</option>
          {!isDeptHead && <option value="department">Specific Department</option>}
          {!isDeptHead && <option value="role">Specific Role</option>}
          <option value="users">Specific Users</option>
        </select>
      </div>

      {/* Department Selection */}
      {formData.targetType === 'department' && !isDeptHead && (
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            Select Department
          </label>
          <select
            value={formData.targetDepartment}
            onChange={(e) => setFormData({ ...formData, targetDepartment: e.target.value })}
            className="w-full px-4 py-2.5 text-gray-900 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors"
          >
            <option value="">Select a department</option>
            {departments.map(dept => (
              <option key={dept._id} value={dept._id}>{dept.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Role Selection */}
      {formData.targetType === 'role' && !isDeptHead && (
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            Select Roles ({formData.targetRoles.length} selected)
          </label>
          <div className="border border-gray-300 rounded-lg p-4 space-y-2 bg-gray-50">
            {['admin', 'hr', 'manager', 'employee', 'department_head'].map(role => (
              <label key={role} className="flex items-center space-x-3 p-2 hover:bg-white rounded-lg cursor-pointer transition-colors">
                <input
                  type="checkbox"
                  checked={formData.targetRoles.includes(role)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setFormData({ ...formData, targetRoles: [...formData.targetRoles, role] })
                    } else {
                      setFormData({ ...formData, targetRoles: formData.targetRoles.filter(r => r !== role) })
                    }
                  }}
                  className="rounded text-primary-500 w-4 h-4 focus:ring-primary-500"
                />
                <span className="text-sm font-medium text-gray-900 capitalize">{role.replace('_', ' ')}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* User Selection */}
      {formData.targetType === 'users' && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Select Users ({formData.targetUsers.length} selected)
          </label>
          <div className="border border-gray-300 rounded-lg bg-gray-50">
            <div className="p-4 max-h-64 overflow-y-auto space-y-2">
              {employees.length === 0 && !employeeLoading2 ? (
                <p className="text-sm text-gray-500 text-center py-4">No employees found</p>
              ) : (
                <>
                  {employees.map(emp => (
                    <label key={emp._id} className="flex items-center space-x-3 p-2 hover:bg-white rounded-lg cursor-pointer transition-colors">
                      <input
                        type="checkbox"
                        checked={formData.targetUsers.includes(emp.userId?._id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setFormData({ ...formData, targetUsers: [...formData.targetUsers, emp.userId?._id] })
                          } else {
                            setFormData({ ...formData, targetUsers: formData.targetUsers.filter(id => id !== emp.userId?._id) })
                          }
                        }}
                        className="rounded w-4 h-4"
                        style={{ accentColor: 'var(--color-primary-500)' }}
                      />
                      <div className="flex-1">
                        <span className="text-sm font-medium text-gray-800">{emp.name}</span>
                        <span className="text-xs text-gray-500 ml-2">({emp.designation})</span>
                        {emp.isDepartmentHead && (
                          <span className="ml-2 px-2 py-0.5 text-xs bg-purple-100 text-purple-700 rounded">Dept Test</span>
                        )}
                      </div>
                    </label>
                  ))}

                  {employeeLoading2 && (
                    <div className="text-center py-3">
                      <Loader size="sm" />
                      <p className="text-xs text-gray-500 mt-2">Loading more employees...</p>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Load More Button */}
            {employeeHasMore2 && !employeeLoading2 && employees.length > 0 && (
              <div className="border-t border-gray-200 p-3">
                <button
                  type="button"
                  onClick={loadMoreEmployees2}
                  className="w-full px-4 py-2 text-sm font-medium text-white rounded-lg transition-all duration-200 flex items-center justify-center space-x-2"
                  style={{ backgroundColor: 'var(--color-primary-500)' }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--color-primary-600)'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'var(--color-primary-500)'}
                >
                  <FaChevronDown className="w-3 h-3" />
                  <span>Load More Employees</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* URL */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Click Action URL
        </label>
        <input
          type="text"
          value={formData.url}
          onChange={(e) => setFormData({ ...formData, url: e.target.value })}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:border-transparent transition-colors"
          style={{ '--tw-ring-color': 'var(--color-primary-500)' }}
          onFocus={(e) => e.currentTarget.style.borderColor = 'var(--color-primary-500)'}
          onBlur={(e) => e.currentTarget.style.borderColor = '#D1D5DB'}
          placeholder="/dashboard"
        />
      </div>

      {/* Submit Button */}
      <div className="flex justify-end space-x-3 pt-4">
        <button
          type="submit"
          disabled={creating}
          className="px-6 py-2 text-white rounded-lg transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center space-x-2"
          style={{
            backgroundColor: creating ? '#9CA3AF' : 'var(--color-primary-600)'
          }}
          onMouseEnter={(e) => {
            if (!creating) {
              e.currentTarget.style.backgroundColor = 'var(--color-primary-700)'
            }
          }}
          onMouseLeave={(e) => {
            if (!creating) {
              e.currentTarget.style.backgroundColor = 'var(--color-primary-600)'
            }
          }}
        >
          {creating ? (
            <>
              <Loader size="xs" color="#ffffff" />
              <span>Creating...</span>
            </>
          ) : (
            <>
              <FaRedo className="w-4 h-4" />
              <span>Create Recurring Notification</span>
            </>
          )}
        </button>
      </div>
    </form>
  )
}

// Recurring Notifications Tab
function RecurringNotificationsTab({ userRole, userDepartment, isDepartmentHead }) {
  const [recurringNotifications, setRecurringNotifications] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [formData, setFormData] = useState({
    title: '',
    message: '',
    url: '/dashboard',
    frequency: 'daily',
    time: '09:00',
    daysOfWeek: [],
    dayOfMonth: 1,
    targetType: 'all',
    targetDepartment: '',
    targetRoles: [],
    targetUsers: []
  })
  const [departments, setDepartments] = useState([])
  const [employees, setEmployees] = useState([])
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    fetchRecurringNotifications()
    if (showCreateForm) {
      fetchDepartments()
      fetchEmployees()
    }
  }, [showCreateForm])

  const fetchRecurringNotifications = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/notifications/recurring', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await response.json()
      if (data.success) {
        setRecurringNotifications(data.data)
      }
    } catch (error) {
      console.error('Error fetching recurring notifications:', error)
      toast.error('Failed to load recurring notifications')
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
      console.error('Error fetching departments:', error)
    }
  }

  const [employeePage2, setEmployeePage2] = useState(1)
  const [employeeHasMore2, setEmployeeHasMore2] = useState(true)
  const [employeeLoading2, setEmployeeLoading2] = useState(false)

  const fetchEmployees = async (page = 1, append = false) => {
    try {
      setEmployeeLoading2(true)
      const token = localStorage.getItem('token')
      const isDeptHead = userRole === 'department_head' || isDepartmentHead

      let url = `/api/employees?limit=50&page=${page}`
      if (isDeptHead && userDepartment) {
        url += `&department=${userDepartment}`
      }

      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await response.json()
      if (data.success) {
        if (append) {
          setEmployees(prev => [...prev, ...data.data])
        } else {
          setEmployees(data.data)
        }

        // Check if there are more pages
        setEmployeeHasMore2(data.pagination.page < data.pagination.pages)
        setEmployeePage2(page)
      }
    } catch (error) {
      console.error('Error fetching employees:', error)
    } finally {
      setEmployeeLoading2(false)
    }
  }

  const loadMoreEmployees2 = () => {
    if (!employeeLoading2 && employeeHasMore2) {
      fetchEmployees(employeePage2 + 1, true)
    }
  }

  const handleCreateSubmit = async (e) => {
    e.preventDefault()
    setCreating(true)

    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/notifications/recurring', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(formData)
      })

      const data = await response.json()
      if (data.success) {
        toast.success('Recurring notification created successfully!')
        setShowCreateForm(false)
        setFormData({
          title: '',
          message: '',
          url: '/dashboard',
          frequency: 'daily',
          time: '09:00',
          daysOfWeek: [],
          dayOfMonth: 1,
          targetType: 'all',
          targetDepartment: '',
          targetRoles: [],
          targetUsers: []
        })
        fetchRecurringNotifications()
      } else {
        toast.error(data.message || 'Failed to create recurring notification')
      }
    } catch (error) {
      console.error('Error creating recurring notification:', error)
      toast.error('Failed to create recurring notification')
    } finally {
      setCreating(false)
    }
  }

  const handleToggleActive = async (id, currentStatus) => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/notifications/recurring', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ id, isActive: !currentStatus })
      })
      const data = await response.json()
      if (data.success) {
        toast.success(`Notification ${!currentStatus ? 'activated' : 'paused'}`)
        fetchRecurringNotifications()
      } else {
        toast.error(data.message || 'Failed to update notification')
      }
    } catch (error) {
      console.error('Error updating notification:', error)
      toast.error('Failed to update notification')
    }
  }

  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to delete this recurring notification?')) return

    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/notifications/recurring?id=${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await response.json()
      if (data.success) {
        toast.success('Recurring notification deleted')
        fetchRecurringNotifications()
      } else {
        toast.error(data.message || 'Failed to delete notification')
      }
    } catch (error) {
      console.error('Error deleting notification:', error)
      toast.error('Failed to delete notification')
    }
  }

  if (loading) {
    return (
      <div className="text-center py-12">
        <Loader size="lg" />
        <p className="mt-4 text-gray-600">Loading recurring notifications...</p>
      </div>
    )
  }

  const isDeptHead = userRole === 'department_head' || isDepartmentHead

  return (
    <div className="space-y-4">
      {/* Create Button */}
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold text-gray-800">
          {recurringNotifications.length > 0 ? `Recurring Notifications (${recurringNotifications.length})` : 'Recurring Notifications'}
        </h3>
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="px-4 py-2 text-white rounded-lg transition-colors flex items-center space-x-2"
          style={{ backgroundColor: 'var(--color-primary-600)' }}
          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--color-primary-700)'}
          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'var(--color-primary-600)'}
        >
          {showCreateForm ? (
            <>
              <FaTrash className="w-4 h-4" />
              <span>Cancel</span>
            </>
          ) : (
            <>
              <FaRedo className="w-4 h-4" />
              <span>Create Recurring Notification</span>
            </>
          )}
        </button>
      </div>

      {/* Create Form */}
      {showCreateForm && (
        <CreateRecurringForm
          formData={formData}
          setFormData={setFormData}
          handleSubmit={handleCreateSubmit}
          creating={creating}
          departments={departments}
          employees={employees}
          isDeptHead={isDeptHead}
        />
      )}

      {/* Empty State */}
      {!showCreateForm && recurringNotifications.length === 0 && (
        <div className="text-center py-12 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
          <FaRedo className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-700 mb-2">No Recurring Notifications</h3>
          <p className="text-gray-500 mb-4">You haven't set up any recurring notifications yet</p>
          <button
            onClick={() => setShowCreateForm(true)}
            className="px-6 py-2 text-white rounded-lg transition-colors inline-flex items-center space-x-2"
            style={{ backgroundColor: 'var(--color-primary-600)' }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--color-primary-700)'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'var(--color-primary-600)'}
          >
            <FaRedo className="w-4 h-4" />
            <span>Create Your First Recurring Notification</span>
          </button>
        </div>
      )}

      {/* Notifications List */}
      {recurringNotifications.length > 0 && (
        <div className="space-y-4">
          {recurringNotifications.map((notification) => (
        <div key={notification._id} className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
          <div className="flex justify-between items-start">
            <div className="flex-1">
              <div className="flex items-center space-x-2">
                <h4 className="font-semibold text-gray-800">{notification.title}</h4>
                <span className={`px-2 py-1 text-xs rounded-full ${
                  notification.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                }`}>
                  {notification.isActive ? 'Active' : 'Paused'}
                </span>
              </div>
              <p className="text-sm text-gray-600 mt-1">{notification.message}</p>
              <div className="flex items-center space-x-4 mt-3 text-xs text-gray-500">
                <span className="flex items-center space-x-1">
                  <FaRedo className="w-3 h-3" />
                  <span className="capitalize">{notification.frequency}</span>
                </span>
                {notification.nextScheduledAt && (
                  <span className="flex items-center space-x-1">
                    <FaClock className="w-3 h-3" />
                    <span>Next: {new Date(notification.nextScheduledAt).toLocaleString()}</span>
                  </span>
                )}
                <span>Sent: {notification.totalSent || 0} times</span>
              </div>
            </div>
            <div className="ml-4 flex space-x-2">
              <button
                onClick={() => handleToggleActive(notification._id, notification.isActive)}
                className={`px-3 py-1 text-sm rounded-lg transition-colors flex items-center space-x-1 ${
                  notification.isActive
                    ? 'bg-yellow-100 text-yellow-600 hover:bg-yellow-200'
                    : 'bg-green-100 text-green-600 hover:bg-green-200'
                }`}
              >
                {notification.isActive ? <FaPause className="w-3 h-3" /> : <FaPlay className="w-3 h-3" />}
                <span>{notification.isActive ? 'Pause' : 'Resume'}</span>
              </button>
              <button
                onClick={() => handleDelete(notification._id)}
                className="px-3 py-1 text-sm bg-red-100 text-red-600 rounded-lg hover:bg-red-200 transition-colors flex items-center space-x-1"
              >
                <FaTrash className="w-3 h-3" />
                <span>Delete</span>
              </button>
            </div>
          </div>
        </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Notification History Tab
function NotificationHistoryTab({ userRole, userDepartment, isDepartmentHead }) {
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    fetchHistory()
  }, [])

  const fetchHistory = async (isRefresh = false) => {
    try {
      if (isRefresh) setRefreshing(true)
      const token = localStorage.getItem('token')
      const response = await fetch('/api/notifications/scheduled?status=sent', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await response.json()
      if (data.success) {
        // Sort by sentAt date (most recent first)
        const sortedData = data.data.sort((a, b) => 
          new Date(b.sentAt || b.scheduledFor) - new Date(a.sentAt || a.scheduledFor)
        )
        setHistory(sortedData)
      }
    } catch (error) {
      console.error('Error fetching history:', error)
      toast.error('Failed to load notification history')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  const getTargetLabel = (notification) => {
    if (notification.targetType === 'all') return 'All Employees'
    if (notification.targetType === 'department') return notification.targetDepartment?.name || 'Department'
    if (notification.targetType === 'role') return `Roles: ${notification.targetRoles?.join(', ') || 'N/A'}`
    if (notification.targetType === 'specific') return `${notification.recipientCount || notification.targetUsers?.length || 0} User(s)`
    return 'Unknown'
  }

  if (loading) {
    return (
      <div className="text-center py-12">
        <Loader size="lg" />
        <p className="mt-4 text-gray-600">Loading notification history...</p>
      </div>
    )
  }

  if (history.length === 0) {
    return (
      <div className="text-center py-12 bg-gray-50 rounded-xl border-2 border-dashed border-gray-300">
        <FaHistory className="w-16 h-16 text-gray-400 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-gray-700 mb-2">No Notification History</h3>
        <p className="text-gray-500">Sent notifications will appear here</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-800">
          Sent Notifications ({history.length})
        </h3>
        <button
          onClick={() => fetchHistory(true)}
          disabled={refreshing}
          className="p-2 text-gray-500 hover:text-primary-600 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
          title="Refresh"
        >
          <FaRedo className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {history.map((notification) => (
        <div key={notification._id} className="bg-white border border-gray-200 rounded-xl p-4 hover:shadow-md transition-shadow">
          <div className="flex justify-between items-start gap-4">
            <div className="flex-1 min-w-0">
              <h4 className="font-semibold text-gray-900">{notification.title}</h4>
              <p className="text-sm text-gray-600 mt-1 line-clamp-2">{notification.message}</p>
              <div className="flex flex-wrap items-center gap-3 mt-3 text-xs">
                <span className="flex items-center gap-1 text-gray-500">
                  <FaClock className="w-3 h-3" />
                  <span>Sent: {new Date(notification.sentAt || notification.scheduledFor).toLocaleString()}</span>
                </span>
                <span className="flex items-center gap-1 text-gray-500">
                  <FaUsers className="w-3 h-3" />
                  <span>{getTargetLabel(notification)}</span>
                </span>
                <span className="px-2 py-1 bg-green-100 text-green-800 rounded-full font-medium">
                  ✓ Sent
                </span>
                {notification.successCount !== undefined && notification.successCount > 0 && (
                  <span className="text-green-600 font-medium">
                    {notification.successCount} delivered
                  </span>
                )}
                {notification.failureCount > 0 && (
                  <span className="text-red-600 font-medium">
                    {notification.failureCount} failed
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// Configuration Tab (Admin Only) - Firebase Status Display
function ConfigurationTab({ apiKeyConfigured, onConfigUpdate }) {
  const [config, setConfig] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchCurrentConfig()
  }, [])

  const fetchCurrentConfig = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/notifications/config', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })
      const data = await response.json()
      if (data.success) {
        setConfig(data.config || {})
      }
    } catch (error) {
      console.error('Error fetching config:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="text-center py-12">
        <Loader size="lg" />
        <p className="mt-4 text-gray-600">Loading configuration...</p>
      </div>
    )
  }

  return (
    <div className="max-w-3xl">
      {/* Status Banner */}
      <div className={`mb-6 p-4 rounded-lg border-l-4 ${
        apiKeyConfigured
          ? 'bg-green-50 border-green-400'
          : 'bg-yellow-50 border-yellow-400'
      }`}>
        <div className="flex items-center">
          <div className="flex-shrink-0">
            {apiKeyConfigured ? (
              <svg className="h-5 w-5 text-green-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
            ) : (
              <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            )}
          </div>
          <div className="ml-3">
            <h3 className={`text-sm font-medium ${
              apiKeyConfigured ? 'text-green-800' : 'text-yellow-800'
            }`}>
              {apiKeyConfigured ? 'Firebase Cloud Messaging is Configured' : 'Firebase Not Configured'}
            </h3>
            <p className={`mt-1 text-sm ${
              apiKeyConfigured ? 'text-green-700' : 'text-yellow-700'
            }`}>
              {apiKeyConfigured
                ? 'Your Firebase integration is active and ready to send push notifications.'
                : 'Firebase Cloud Messaging is not configured. Please check your .env file.'}
            </p>
          </div>
        </div>
      </div>

      {/* Firebase Configuration Status */}
      <div className="space-y-6">
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">Firebase Cloud Messaging Configuration</h3>

          <div className="space-y-4">
            {/* Project ID */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Firebase Project ID
              </label>
              <div className="px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-700">
                {config?.projectId || 'Not configured'}
              </div>
            </div>

            {/* Client Email */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Service Account Email
              </label>
              <div className="px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-700">
                {config?.clientEmail || 'Not configured'}
              </div>
            </div>

            {/* Private Key Status */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Private Key Status
              </label>
              <div className="px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-700">
                {config?.privateKey || 'Not configured'}
              </div>
            </div>

            {/* API Key */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Firebase API Key
              </label>
              <div className="px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-700">
                {config?.apiKey || 'Not configured'}
              </div>
            </div>

            {/* VAPID Key */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                VAPID Key (Web Push)
              </label>
              <div className="px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-700">
                {config?.vapidKey || 'Not configured'}
              </div>
            </div>
          </div>

          {/* Help Section */}
          <div className="mt-6 p-4 rounded-lg" style={{ backgroundColor: 'var(--color-primary-50)' }}>
            <h4 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-primary-800)' }}>Firebase Configuration</h4>
            <p className="text-sm mb-2" style={{ color: 'var(--color-primary-700)' }}>
              Firebase Cloud Messaging is configured via environment variables in the <code className="bg-white px-1 rounded">.env</code> file.
            </p>
            <p className="text-sm" style={{ color: 'var(--color-primary-700)' }}>
              To update Firebase credentials, edit the <code className="bg-white px-1 rounded">.env</code> file and restart the server.
            </p>
          </div>
        </div>

        {/* Info Box */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <svg className="h-5 w-5 text-blue-500 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
            <div>
              <h4 className="text-sm font-semibold text-blue-800 mb-1">About Firebase Cloud Messaging</h4>
              <p className="text-sm text-blue-700">
                Firebase Cloud Messaging (FCM) provides a reliable and battery-efficient connection between your server and devices.
                It allows you to send notifications and data messages to users across platforms.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
