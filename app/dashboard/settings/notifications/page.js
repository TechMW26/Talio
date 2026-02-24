'use client'

import { useState, useEffect } from 'react'
import { FaBell, FaClock, FaRedo, FaPaperPlane, FaUsers, FaBuilding, FaUserTag, FaCalendar, FaTrash, FaEdit, FaPause, FaPlay, FaHistory, FaPlus, FaEye, FaCheck, FaTimes, FaExclamationTriangle } from 'react-icons/fa'
import toast from '@/utils/toast'
import Loader from '@/components/ui/Loader'
import ModalPortal from '@/components/ui/ModalPortal'

export default function NotificationsPage() {
  const [activeTab, setActiveTab] = useState('send')
  const [userRole, setUserRole] = useState('')
  const [userDepartment, setUserDepartment] = useState(null)

  useEffect(() => {
    const userData = localStorage.getItem('user')
    if (userData) {
      const user = JSON.parse(userData)
      setUserRole(user.role)
    }

    const employeeData = localStorage.getItem('employee')
    if (employeeData) {
      const employee = JSON.parse(employeeData)
      setUserDepartment(employee.department)
    }
  }, [])

  // Check if user has access
  const hasAccess = ['admin', 'hr', 'department_head'].includes(userRole)

  if (!hasAccess) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
          <p className="text-red-600">You don't have permission to access this page.</p>
        </div>
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
    <div className="p-3 sm:p-6 pb-20 md:pb-6">
      {/* Header */}
      <div className="mb-4 sm:mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 flex items-center gap-2">
          <FaBell className="text-blue-600" />
          Notification Management
        </h1>
        <p className="text-sm sm:text-base text-gray-600 mt-1">
          Send, schedule, and manage push notifications
        </p>
      </div>

      {/* Tabs */}
      <div className="mb-6">
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex space-x-4 overflow-x-auto">
            {tabs.map((tab) => {
              const Icon = tab.icon
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center space-x-2 px-4 py-3 border-b-2 font-medium text-sm whitespace-nowrap transition-colors ${activeTab === tab.id
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{tab.name}</span>
                </button>
              )
            })}
          </nav>
        </div>
      </div>

      {/* Content */}
      <div className="bg-white rounded-lg shadow-md p-4 sm:p-6">
        {activeTab === 'send' && <SendNotificationTab userRole={userRole} userDepartment={userDepartment} />}
        {activeTab === 'scheduled' && <ScheduledNotificationsTab userRole={userRole} userDepartment={userDepartment} />}
        {activeTab === 'recurring' && <RecurringNotificationsTab userRole={userRole} userDepartment={userDepartment} />}
        {activeTab === 'history' && <NotificationHistoryTab userRole={userRole} userDepartment={userDepartment} />}
      </div>
    </div>
  )
}

// Send Notification Tab
function SendNotificationTab({ userRole, userDepartment }) {
  const [formData, setFormData] = useState({
    title: '',
    message: '',
    url: '/dashboard',
    targetType: 'all',
    targetDepartment: '',
    targetUsers: [],
    targetRoles: [],
    scheduleType: 'now'
  })
  const [sending, setSending] = useState(false)
  const [departments, setDepartments] = useState([])
  const [employees, setEmployees] = useState([])

  useEffect(() => {
    fetchDepartments()
    fetchEmployees()
  }, [])

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
      console.error('Error fetching employees:', error)
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
        toast.success(data.message || 'Notification sent successfully!')
        setFormData({
          title: '',
          message: '',
          url: '/dashboard',
          targetType: 'all',
          targetDepartment: '',
          targetUsers: [],
          targetRoles: [],
          scheduleType: 'now'
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
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Notification Content */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-gray-900">Notification Content</h3>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Title *
          </label>
          <input
            type="text"
            value={formData.title}
            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="Enter notification title"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Message *
          </label>
          <textarea
            value={formData.message}
            onChange={(e) => setFormData({ ...formData, message: e.target.value })}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="Enter notification message"
            rows={4}
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Action URL
          </label>
          <input
            type="text"
            value={formData.url}
            onChange={(e) => setFormData({ ...formData, url: e.target.value })}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="/dashboard"
          />
          <p className="text-xs text-gray-500 mt-1">URL to open when notification is clicked</p>
        </div>
      </div>

      {/* Target Audience */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-gray-900">Target Audience</h3>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Send To *
          </label>
          <select
            value={formData.targetType}
            onChange={(e) => setFormData({ ...formData, targetType: e.target.value })}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            required
          >
            <option value="all">All Users</option>
            {userRole !== 'department_head' && <option value="department">Specific Department</option>}
            <option value="role">Specific Role</option>
            <option value="specific">Specific Users</option>
          </select>
        </div>

        {formData.targetType === 'department' && userRole !== 'department_head' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Select Department
            </label>
            <select
              value={formData.targetDepartment}
              onChange={(e) => setFormData({ ...formData, targetDepartment: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            >
              <option value="">Select a department</option>
              {departments.map(dept => (
                <option key={dept._id} value={dept._id}>{dept.name}</option>
              ))}
            </select>
          </div>
        )}

        {formData.targetType === 'role' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Select Roles
            </label>
            <div className="space-y-2">
              {['admin', 'hr', 'manager', 'employee', 'department_head'].map(role => (
                <label key={role} className="flex items-center space-x-2">
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
                    className="rounded text-blue-600"
                  />
                  <span className="text-sm capitalize">{role.replace('_', ' ')}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Submit Button */}
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={sending}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center space-x-2"
        >
          <FaPaperPlane className="w-4 h-4" />
          <span>{sending ? 'Sending...' : 'Send Notification'}</span>
        </button>
      </div>
    </form>
  )
}

// Placeholder tabs - will be implemented
function ScheduledNotificationsTab({ userRole, userDepartment }) {
  const [notifications, setNotifications] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [departments, setDepartments] = useState([])
  const [employees, setEmployees] = useState([])
  const [formData, setFormData] = useState({
    title: '',
    message: '',
    url: '/dashboard',
    targetType: 'all',
    targetDepartment: '',
    targetUsers: [],
    targetRoles: [],
    scheduledFor: ''
  })
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    fetchScheduledNotifications()
    fetchDepartments()
    fetchEmployees()
  }, [])

  const fetchScheduledNotifications = async () => {
    try {
      setLoading(true)
      const token = localStorage.getItem('token')
      const response = await fetch('/api/notifications/scheduled', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await response.json()
      if (data.success) {
        setNotifications(data.data || [])
      }
    } catch (error) {
      console.error('Error fetching scheduled notifications:', error)
      toast.error('Failed to load scheduled notifications')
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
      console.error('Error fetching employees:', error)
    }
  }

  const handleCreateScheduled = async (e) => {
    e.preventDefault()
    if (!formData.scheduledFor) {
      toast.error('Please select a date and time')
      return
    }

    setCreating(true)
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/notifications/scheduled', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(formData)
      })
      const data = await response.json()
      if (data.success) {
        toast.success('Scheduled notification created!')
        setShowCreateModal(false)
        setFormData({
          title: '',
          message: '',
          url: '/dashboard',
          targetType: 'all',
          targetDepartment: '',
          targetUsers: [],
          targetRoles: [],
          scheduledFor: ''
        })
        fetchScheduledNotifications()
      } else {
        toast.error(data.message || 'Failed to create scheduled notification')
      }
    } catch (error) {
      console.error('Error creating scheduled notification:', error)
      toast.error('Failed to create scheduled notification')
    } finally {
      setCreating(false)
    }
  }

  const handleCancelNotification = async (id) => {
    if (!confirm('Are you sure you want to cancel this scheduled notification?')) return

    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/notifications/scheduled?id=${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await response.json()
      if (data.success) {
        toast.success('Notification cancelled')
        fetchScheduledNotifications()
      } else {
        toast.error(data.message || 'Failed to cancel notification')
      }
    } catch (error) {
      console.error('Error cancelling notification:', error)
      toast.error('Failed to cancel notification')
    }
  }

  const getStatusBadge = (status) => {
    const styles = {
      pending: 'bg-yellow-100 text-yellow-800',
      sent: 'bg-green-100 text-green-800',
      failed: 'bg-red-100 text-red-800',
      cancelled: 'bg-gray-100 text-gray-800'
    }
    return (
      <span className={`px-2 py-1 text-xs font-medium rounded-full ${styles[status] || styles.pending}`}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    )
  }

  const formatDate = (date) => {
    return new Date(date).toLocaleString('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short'
    })
  }

  const getTargetDisplay = (notification) => {
    switch (notification.targetType) {
      case 'all':
        return 'All Users'
      case 'department':
        return notification.targetDepartment?.name || 'Department'
      case 'role':
        return notification.targetRoles?.join(', ') || 'Roles'
      case 'specific':
        return `${notification.targetUsers?.length || 0} users`
      default:
        return notification.targetType
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader size="md" />
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Scheduled Notifications</h3>
          <p className="text-sm text-gray-500">Schedule notifications to be sent at a specific time</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
        >
          <FaPlus className="w-4 h-4" />
          <span>Schedule New</span>
        </button>
      </div>

      {/* Notifications List */}
      {notifications.length === 0 ? (
        <div className="text-center py-12">
          <FaClock className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500">No scheduled notifications yet</p>
        </div>
      ) : (
        <div className="space-y-4">
          {notifications.map((notification) => (
            <div key={notification._id} className="border border-gray-200 rounded-lg p-4">
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="font-medium text-gray-900">{notification.title}</h4>
                    {getStatusBadge(notification.status)}
                  </div>
                  <p className="text-sm text-gray-600 mb-2">{notification.message}</p>
                  <div className="flex flex-wrap gap-4 text-xs text-gray-500">
                    <span className="flex items-center gap-1">
                      <FaClock className="w-3 h-3" />
                      {formatDate(notification.scheduledFor)}
                    </span>
                    <span className="flex items-center gap-1">
                      <FaUsers className="w-3 h-3" />
                      {getTargetDisplay(notification)}
                    </span>
                    {notification.createdBy && (
                      <span>
                        By: {notification.createdBy.firstName} {notification.createdBy.lastName}
                      </span>
                    )}
                  </div>
                </div>
                {notification.status === 'pending' && (
                  <button
                    onClick={() => handleCancelNotification(notification._id)}
                    className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                    title="Cancel"
                  >
                    <FaTimes className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Modal */}
      <ModalPortal isOpen={showCreateModal}>
        <div className="modal-overlay">
          <div className="bg-white rounded-[30px] animate-modal-enter w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-4 border-b border-gray-200 flex justify-between items-center">
              <h3 className="text-lg font-semibold">Schedule Notification</h3>
              <button onClick={() => setShowCreateModal(false)} className="text-gray-500 hover:text-gray-700">
                <FaTimes className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateScheduled} className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Message *</label>
                <textarea
                  value={formData.message}
                  onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  rows={3}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Schedule For *</label>
                <input
                  type="datetime-local"
                  value={formData.scheduledFor}
                  onChange={(e) => setFormData({ ...formData, scheduledFor: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  min={new Date().toISOString().slice(0, 16)}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Target Audience</label>
                <select
                  value={formData.targetType}
                  onChange={(e) => setFormData({ ...formData, targetType: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                >
                  <option value="all">All Users</option>
                  {userRole !== 'department_head' && <option value="department">Specific Department</option>}
                  <option value="role">Specific Role</option>
                </select>
              </div>
              {formData.targetType === 'department' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Select Department</label>
                  <select
                    value={formData.targetDepartment}
                    onChange={(e) => setFormData({ ...formData, targetDepartment: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    required
                  >
                    <option value="">Select department</option>
                    {departments.map(dept => (
                      <option key={dept._id} value={dept._id}>{dept.name}</option>
                    ))}
                  </select>
                </div>
              )}
              {formData.targetType === 'role' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Select Roles</label>
                  <div className="space-y-2">
                    {['admin', 'hr', 'manager', 'employee', 'department_head'].map(role => (
                      <label key={role} className="flex items-center gap-2">
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
                          className="rounded text-blue-600"
                        />
                        <span className="text-sm capitalize">{role.replace('_', ' ')}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex justify-end gap-2 pt-4">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400"
                >
                  {creating ? 'Scheduling...' : 'Schedule'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </ModalPortal>
    </div>
  )
}

function RecurringNotificationsTab({ userRole, userDepartment }) {
  const [notifications, setNotifications] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [departments, setDepartments] = useState([])
  const [formData, setFormData] = useState({
    title: '',
    message: '',
    url: '/dashboard',
    targetType: 'all',
    targetDepartment: '',
    targetUsers: [],
    targetRoles: [],
    frequency: 'daily',
    dailyTime: '09:00',
    weeklyDays: [],
    weeklyTime: '09:00',
    monthlyDay: 1,
    monthlyTime: '09:00',
    startDate: new Date().toISOString().split('T')[0],
    endDate: ''
  })
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    fetchRecurringNotifications()
    fetchDepartments()
  }, [])

  const fetchRecurringNotifications = async () => {
    try {
      setLoading(true)
      const token = localStorage.getItem('token')
      const response = await fetch('/api/notifications/recurring', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await response.json()
      if (data.success) {
        setNotifications(data.data || [])
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

  const handleCreateRecurring = async (e) => {
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
        toast.success('Recurring notification created!')
        setShowCreateModal(false)
        setFormData({
          title: '',
          message: '',
          url: '/dashboard',
          targetType: 'all',
          targetDepartment: '',
          targetUsers: [],
          targetRoles: [],
          frequency: 'daily',
          dailyTime: '09:00',
          weeklyDays: [],
          weeklyTime: '09:00',
          monthlyDay: 1,
          monthlyTime: '09:00',
          startDate: new Date().toISOString().split('T')[0],
          endDate: ''
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

  const handleToggleActive = async (id, isActive) => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/notifications/recurring', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ id, isActive: !isActive })
      })
      const data = await response.json()
      if (data.success) {
        toast.success(isActive ? 'Notification paused' : 'Notification resumed')
        fetchRecurringNotifications()
      } else {
        toast.error(data.message || 'Failed to update notification')
      }
    } catch (error) {
      console.error('Error updating notification:', error)
      toast.error('Failed to update notification')
    }
  }

  const handleDeleteRecurring = async (id) => {
    if (!confirm('Are you sure you want to delete this recurring notification?')) return

    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/notifications/recurring?id=${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await response.json()
      if (data.success) {
        toast.success('Notification deleted')
        fetchRecurringNotifications()
      } else {
        toast.error(data.message || 'Failed to delete notification')
      }
    } catch (error) {
      console.error('Error deleting notification:', error)
      toast.error('Failed to delete notification')
    }
  }

  const getFrequencyDisplay = (notification) => {
    switch (notification.frequency) {
      case 'daily':
        return `Daily at ${notification.dailyTime || '09:00'}`
      case 'weekly':
        const days = notification.weeklyDays?.map(d => d.charAt(0).toUpperCase() + d.slice(1, 3)).join(', ') || ''
        return `Weekly on ${days} at ${notification.weeklyTime || '09:00'}`
      case 'monthly':
        return `Monthly on day ${notification.monthlyDay || 1} at ${notification.monthlyTime || '09:00'}`
      default:
        return notification.frequency
    }
  }

  const getTargetDisplay = (notification) => {
    switch (notification.targetType) {
      case 'all':
        return 'All Users'
      case 'department':
        return notification.targetDepartment?.name || 'Department'
      case 'role':
        return notification.targetRoles?.join(', ') || 'Roles'
      case 'specific':
        return `${notification.targetUsers?.length || 0} users`
      default:
        return notification.targetType
    }
  }

  const weekdays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader size="md" />
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Recurring Notifications</h3>
          <p className="text-sm text-gray-500">Set up notifications that repeat on a schedule</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
        >
          <FaPlus className="w-4 h-4" />
          <span>Create Recurring</span>
        </button>
      </div>

      {/* Notifications List */}
      {notifications.length === 0 ? (
        <div className="text-center py-12">
          <FaRedo className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500">No recurring notifications yet</p>
        </div>
      ) : (
        <div className="space-y-4">
          {notifications.map((notification) => (
            <div key={notification._id} className="border border-gray-200 rounded-lg p-4">
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="font-medium text-gray-900">{notification.title}</h4>
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${notification.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                      {notification.isActive ? 'Active' : 'Paused'}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 mb-2">{notification.message}</p>
                  <div className="flex flex-wrap gap-4 text-xs text-gray-500">
                    <span className="flex items-center gap-1">
                      <FaRedo className="w-3 h-3" />
                      {getFrequencyDisplay(notification)}
                    </span>
                    <span className="flex items-center gap-1">
                      <FaUsers className="w-3 h-3" />
                      {getTargetDisplay(notification)}
                    </span>
                    {notification.lastSentAt && (
                      <span>
                        Last sent: {new Date(notification.lastSentAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleToggleActive(notification._id, notification.isActive)}
                    className={`p-2 rounded-lg ${notification.isActive ? 'text-yellow-600 hover:bg-yellow-50' : 'text-green-600 hover:bg-green-50'}`}
                    title={notification.isActive ? 'Pause' : 'Resume'}
                  >
                    {notification.isActive ? <FaPause className="w-4 h-4" /> : <FaPlay className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={() => handleDeleteRecurring(notification._id)}
                    className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                    title="Delete"
                  >
                    <FaTrash className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Modal */}
      <ModalPortal isOpen={showCreateModal}>
        <div className="modal-overlay">
          <div className="bg-white rounded-[30px] animate-modal-enter w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-4 border-b border-gray-200 flex justify-between items-center">
              <h3 className="text-lg font-semibold">Create Recurring Notification</h3>
              <button onClick={() => setShowCreateModal(false)} className="text-gray-500 hover:text-gray-700">
                <FaTimes className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateRecurring} className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Message *</label>
                <textarea
                  value={formData.message}
                  onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  rows={3}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Frequency *</label>
                <select
                  value={formData.frequency}
                  onChange={(e) => setFormData({ ...formData, frequency: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>

              {formData.frequency === 'daily' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Time *</label>
                  <input
                    type="time"
                    value={formData.dailyTime}
                    onChange={(e) => setFormData({ ...formData, dailyTime: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>
              )}

              {formData.frequency === 'weekly' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Days *</label>
                    <div className="flex flex-wrap gap-2">
                      {weekdays.map(day => (
                        <label key={day} className="flex items-center gap-1">
                          <input
                            type="checkbox"
                            checked={formData.weeklyDays.includes(day)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setFormData({ ...formData, weeklyDays: [...formData.weeklyDays, day] })
                              } else {
                                setFormData({ ...formData, weeklyDays: formData.weeklyDays.filter(d => d !== day) })
                              }
                            }}
                            className="rounded text-blue-600"
                          />
                          <span className="text-xs capitalize">{day.slice(0, 3)}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Time *</label>
                    <input
                      type="time"
                      value={formData.weeklyTime}
                      onChange={(e) => setFormData({ ...formData, weeklyTime: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      required
                    />
                  </div>
                </>
              )}

              {formData.frequency === 'monthly' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Day of Month *</label>
                    <input
                      type="number"
                      min="1"
                      max="31"
                      value={formData.monthlyDay}
                      onChange={(e) => setFormData({ ...formData, monthlyDay: parseInt(e.target.value) })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Time *</label>
                    <input
                      type="time"
                      value={formData.monthlyTime}
                      onChange={(e) => setFormData({ ...formData, monthlyTime: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      required
                    />
                  </div>
                </>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Start Date *</label>
                <input
                  type="date"
                  value={formData.startDate}
                  onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">End Date (Optional)</label>
                <input
                  type="date"
                  value={formData.endDate}
                  onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Target Audience</label>
                <select
                  value={formData.targetType}
                  onChange={(e) => setFormData({ ...formData, targetType: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                >
                  <option value="all">All Users</option>
                  {userRole !== 'department_head' && <option value="department">Specific Department</option>}
                  <option value="role">Specific Role</option>
                </select>
              </div>

              {formData.targetType === 'department' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Select Department</label>
                  <select
                    value={formData.targetDepartment}
                    onChange={(e) => setFormData({ ...formData, targetDepartment: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    required
                  >
                    <option value="">Select department</option>
                    {departments.map(dept => (
                      <option key={dept._id} value={dept._id}>{dept.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {formData.targetType === 'role' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Select Roles</label>
                  <div className="space-y-2">
                    {['admin', 'hr', 'manager', 'employee', 'department_head'].map(role => (
                      <label key={role} className="flex items-center gap-2">
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
                          className="rounded text-blue-600"
                        />
                        <span className="text-sm capitalize">{role.replace('_', ' ')}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-4">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400"
                >
                  {creating ? 'Creating...' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </ModalPortal>
    </div>
  )
}

function NotificationHistoryTab({ userRole, userDepartment }) {
  const [notifications, setNotifications] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all') // 'all', 'scheduled', 'recurring'
  const [selectedNotification, setSelectedNotification] = useState(null)

  useEffect(() => {
    fetchHistory()
  }, [filter])

  const fetchHistory = async () => {
    try {
      setLoading(true)
      const token = localStorage.getItem('token')

      let allNotifications = []

      // Fetch sent scheduled notifications
      if (filter === 'all' || filter === 'scheduled') {
        const scheduledRes = await fetch('/api/notifications/scheduled?status=sent', {
          headers: { 'Authorization': `Bearer ${token}` }
        })
        const scheduledData = await scheduledRes.json()
        if (scheduledData.success) {
          allNotifications = [...allNotifications, ...(scheduledData.data || []).map(n => ({ ...n, type: 'scheduled' }))]
        }

        // Also fetch failed
        const failedRes = await fetch('/api/notifications/scheduled?status=failed', {
          headers: { 'Authorization': `Bearer ${token}` }
        })
        const failedData = await failedRes.json()
        if (failedData.success) {
          allNotifications = [...allNotifications, ...(failedData.data || []).map(n => ({ ...n, type: 'scheduled' }))]
        }
      }

      // Fetch recurring notifications with sent history
      if (filter === 'all' || filter === 'recurring') {
        const recurringRes = await fetch('/api/notifications/recurring', {
          headers: { 'Authorization': `Bearer ${token}` }
        })
        const recurringData = await recurringRes.json()
        if (recurringData.success) {
          // Only include recurring notifications that have been sent at least once
          const sentRecurring = (recurringData.data || []).filter(n => n.lastSentAt || n.totalSent > 0)
          allNotifications = [...allNotifications, ...sentRecurring.map(n => ({ ...n, type: 'recurring' }))]
        }
      }

      // Sort by most recent first
      allNotifications.sort((a, b) => {
        const dateA = new Date(a.sentAt || a.lastSentAt || a.createdAt)
        const dateB = new Date(b.sentAt || b.lastSentAt || b.createdAt)
        return dateB - dateA
      })

      setNotifications(allNotifications)
    } catch (error) {
      console.error('Error fetching history:', error)
      toast.error('Failed to load notification history')
    } finally {
      setLoading(false)
    }
  }

  const formatDate = (date) => {
    if (!date) return 'N/A'
    return new Date(date).toLocaleString('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short'
    })
  }

  const getStatusBadge = (notification) => {
    if (notification.type === 'recurring') {
      return (
        <span className="px-2 py-1 text-xs font-medium rounded-full bg-purple-100 text-purple-800">
          Recurring
        </span>
      )
    }

    const styles = {
      sent: 'bg-green-100 text-green-800',
      failed: 'bg-red-100 text-red-800'
    }
    return (
      <span className={`px-2 py-1 text-xs font-medium rounded-full ${styles[notification.status] || 'bg-gray-100 text-gray-800'}`}>
        {notification.status?.charAt(0).toUpperCase() + notification.status?.slice(1)}
      </span>
    )
  }

  const getTargetDisplay = (notification) => {
    switch (notification.targetType) {
      case 'all':
        return 'All Users'
      case 'department':
        return notification.targetDepartment?.name || 'Department'
      case 'role':
        return notification.targetRoles?.join(', ') || 'Roles'
      case 'specific':
        return `${notification.targetUsers?.length || 0} users`
      default:
        return notification.targetType
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader size="md" />
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Notification History</h3>
          <p className="text-sm text-gray-500">View all sent notifications</p>
        </div>
        <div className="flex gap-2">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
          >
            <option value="all">All Types</option>
            <option value="scheduled">Scheduled Only</option>
            <option value="recurring">Recurring Only</option>
          </select>
        </div>
      </div>

      {/* Notifications List */}
      {notifications.length === 0 ? (
        <div className="text-center py-12">
          <FaHistory className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500">No notification history yet</p>
          <p className="text-sm text-gray-400 mt-1">Sent notifications will appear here</p>
        </div>
      ) : (
        <div className="space-y-4">
          {notifications.map((notification, index) => (
            <div
              key={notification._id || index}
              className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 cursor-pointer transition-colors"
              onClick={() => setSelectedNotification(notification)}
            >
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="font-medium text-gray-900">{notification.title}</h4>
                    {getStatusBadge(notification)}
                  </div>
                  <p className="text-sm text-gray-600 mb-2 line-clamp-2">{notification.message}</p>
                  <div className="flex flex-wrap gap-4 text-xs text-gray-500">
                    <span className="flex items-center gap-1">
                      <FaClock className="w-3 h-3" />
                      {notification.type === 'recurring'
                        ? `Last sent: ${formatDate(notification.lastSentAt)}`
                        : `Sent: ${formatDate(notification.sentAt)}`
                      }
                    </span>
                    <span className="flex items-center gap-1">
                      <FaUsers className="w-3 h-3" />
                      {getTargetDisplay(notification)}
                    </span>
                    {notification.successCount !== undefined && (
                      <span className="flex items-center gap-1">
                        <FaCheck className="w-3 h-3 text-green-600" />
                        {notification.successCount} delivered
                      </span>
                    )}
                    {notification.failureCount > 0 && (
                      <span className="flex items-center gap-1 text-red-600">
                        <FaExclamationTriangle className="w-3 h-3" />
                        {notification.failureCount} failed
                      </span>
                    )}
                    {notification.type === 'recurring' && notification.totalSent > 0 && (
                      <span>
                        Total sent: {notification.totalSent} times
                      </span>
                    )}
                  </div>
                </div>
                <FaEye className="w-4 h-4 text-gray-400" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Detail Modal */}
      <ModalPortal isOpen={!!selectedNotification}>
        <div className="modal-overlay">
          <div className="bg-white rounded-[30px] animate-modal-enter w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-4 border-b border-gray-200 flex justify-between items-center">
              <h3 className="text-lg font-semibold">Notification Details</h3>
              <button onClick={() => setSelectedNotification(null)} className="text-gray-500 hover:text-gray-700">
                <FaTimes className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-1">Title</label>
                <p className="text-gray-900">{selectedNotification.title}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-1">Message</label>
                <p className="text-gray-900">{selectedNotification.message}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-1">Type</label>
                <p className="text-gray-900 capitalize">{selectedNotification.type}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-1">Status</label>
                {getStatusBadge(selectedNotification)}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-1">Target Audience</label>
                <p className="text-gray-900">{getTargetDisplay(selectedNotification)}</p>
              </div>
              {selectedNotification.type === 'scheduled' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-500 mb-1">Scheduled For</label>
                    <p className="text-gray-900">{formatDate(selectedNotification.scheduledFor)}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-500 mb-1">Sent At</label>
                    <p className="text-gray-900">{formatDate(selectedNotification.sentAt)}</p>
                  </div>
                </>
              )}
              {selectedNotification.type === 'recurring' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-500 mb-1">Frequency</label>
                    <p className="text-gray-900 capitalize">{selectedNotification.frequency}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-500 mb-1">Last Sent</label>
                    <p className="text-gray-900">{formatDate(selectedNotification.lastSentAt)}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-500 mb-1">Total Times Sent</label>
                    <p className="text-gray-900">{selectedNotification.totalSent || 0}</p>
                  </div>
                </>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-500 mb-1">Recipients</label>
                  <p className="text-gray-900">{selectedNotification.recipientCount || 0}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-500 mb-1">Delivered</label>
                  <p className="text-green-600">{selectedNotification.successCount || 0}</p>
                </div>
              </div>
              {selectedNotification.failureCount > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-500 mb-1">Failed</label>
                  <p className="text-red-600">{selectedNotification.failureCount}</p>
                </div>
              )}
              {selectedNotification.error && (
                <div>
                  <label className="block text-sm font-medium text-gray-500 mb-1">Error</label>
                  <p className="text-red-600 text-sm">{selectedNotification.error}</p>
                </div>
              )}
              {selectedNotification.createdBy && (
                <div>
                  <label className="block text-sm font-medium text-gray-500 mb-1">Created By</label>
                  <p className="text-gray-900">
                    {selectedNotification.createdBy.firstName} {selectedNotification.createdBy.lastName}
                  </p>
                </div>
              )}
            </div>
            <div className="p-4 border-t border-gray-200">
              <button
                onClick={() => setSelectedNotification(null)}
                className="w-full px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </ModalPortal>
    </div>
  )
}

