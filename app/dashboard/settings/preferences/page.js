'use client'

import { useState, useEffect } from 'react'
import toast from '@/utils/toast'
import { FaCog, FaMoneyBillWave, FaClock, FaCalendarAlt, FaSave } from 'react-icons/fa'
import Loader from '@/components/ui/Loader'

export default function PreferencesPage() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [preferences, setPreferences] = useState({
    // Currency Settings
    currency: 'INR',
    currencySymbol: '₹',
    
    // Time Settings
    timeFormat: '12', // 12 or 24 hour
    timezone: 'Asia/Kolkata',
    
    // Work Settings
    workingDaysPerWeek: 5,
    workingHoursPerDay: 8,
    weekStartsOn: 'monday', // monday or sunday
    
    // Leave Settings
    defaultLeaveYear: new Date().getFullYear(),
    leaveCarryForward: true,
    maxCarryForwardDays: 10,
    
    // Attendance Settings
    lateThresholdMinutes: 15,
    halfDayThresholdHours: 4,
    autoMarkAbsent: true,
    
    // Notification Settings
    emailNotifications: true,
    leaveApprovalNotifications: true,
    attendanceReminders: true,
    
    // System Settings
    dateFormat: 'DD/MM/YYYY',
    companyName: 'Your Company',
    companyAddress: '',
    companyPhone: '',
    companyEmail: '',
  })

  useEffect(() => {
    const userData = localStorage.getItem('user')
    if (userData) {
      const parsedUser = JSON.parse(userData)
      setUser(parsedUser)
      
      // Check if user is admin
      if (parsedUser.role !== 'admin') {
        toast.error('Access denied. Only Admin can manage preferences.')
        window.location.href = '/dashboard'
        return
      }
      
      fetchPreferences()
    }
  }, [])

  const fetchPreferences = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/settings/preferences', {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      const data = await response.json()
      if (data.success) {
        setPreferences({ ...preferences, ...data.data })
      }
    } catch (error) {
      console.error('Fetch preferences error:', error)
      toast.error('Failed to fetch preferences')
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/settings/preferences', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(preferences),
      })

      const data = await response.json()
      if (data.success) {
        toast.success('Preferences saved successfully')
      } else {
        toast.error(data.message || 'Failed to save preferences')
      }
    } catch (error) {
      console.error('Save preferences error:', error)
      toast.error('Failed to save preferences')
    } finally {
      setSaving(false)
    }
  }

  const handleChange = (key, value) => {
    setPreferences(prev => ({ ...prev, [key]: value }))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader size="lg" />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex md:justify-between md:items-center md:flex-row flex-col mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">System Preferences</h1>
          <p className="text-gray-600 mt-1">Configure system-wide settings and preferences</p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
        >
          <FaSave className="w-4 h-4" />
          <span>{saving ? 'Saving...' : 'Save Changes'}</span>
        </button>
      </div>

      <div className="space-y-6">
        {/* Currency Settings */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center space-x-3 mb-4">
            <FaMoneyBillWave className="w-6 h-6 text-green-500" />
            <h2 className="text-xl font-semibold text-gray-800">Currency Settings</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Currency</label>
              <select
                value={preferences.currency}
                onChange={(e) => {
                  const currency = e.target.value
                  const symbol = currency === 'INR' ? '₹' : currency === 'USD' ? '$' : '€'
                  handleChange('currency', currency)
                  handleChange('currencySymbol', symbol)
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              >
                <option value="INR">Indian Rupee (INR)</option>
                <option value="USD">US Dollar (USD)</option>
                <option value="EUR">Euro (EUR)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Currency Symbol</label>
              <input
                type="text"
                value={preferences.currencySymbol}
                onChange={(e) => handleChange('currencySymbol', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                placeholder="₹"
              />
            </div>
          </div>
        </div>

        {/* Time & Date Settings */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center space-x-3 mb-4">
            <FaClock className="w-6 h-6 text-blue-500" />
            <h2 className="text-xl font-semibold text-gray-800">Time & Date Settings</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Time Format</label>
              <select
                value={preferences.timeFormat}
                onChange={(e) => handleChange('timeFormat', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              >
                <option value="12">12 Hour (AM/PM)</option>
                <option value="24">24 Hour</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Date Format</label>
              <select
                value={preferences.dateFormat}
                onChange={(e) => handleChange('dateFormat', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              >
                <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                <option value="YYYY-MM-DD">YYYY-MM-DD</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Timezone</label>
              <select
                value={preferences.timezone}
                onChange={(e) => handleChange('timezone', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              >
                <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
                <option value="America/New_York">America/New_York (EST)</option>
                <option value="Europe/London">Europe/London (GMT)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Week Starts On</label>
              <select
                value={preferences.weekStartsOn}
                onChange={(e) => handleChange('weekStartsOn', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              >
                <option value="monday">Monday</option>
                <option value="sunday">Sunday</option>
              </select>
            </div>
          </div>
        </div>

        {/* Work Settings */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center space-x-3 mb-4">
            <FaCalendarAlt className="w-6 h-6 text-purple-500" />
            <h2 className="text-xl font-semibold text-gray-800">Work Settings</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Working Days Per Week</label>
              <input
                type="number"
                min="1"
                max="7"
                value={preferences.workingDaysPerWeek}
                onChange={(e) => handleChange('workingDaysPerWeek', parseInt(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Working Hours Per Day</label>
              <input
                type="number"
                min="1"
                max="24"
                value={preferences.workingHoursPerDay}
                onChange={(e) => handleChange('workingHoursPerDay', parseInt(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>
          </div>
        </div>

        {/* Attendance Settings */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center space-x-3 mb-4">
            <FaClock className="w-6 h-6 text-orange-500" />
            <h2 className="text-xl font-semibold text-gray-800">Attendance Settings</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Late Threshold (Minutes)</label>
              <input
                type="number"
                min="0"
                value={preferences.lateThresholdMinutes}
                onChange={(e) => handleChange('lateThresholdMinutes', parseInt(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Half Day Threshold (Hours)</label>
              <input
                type="number"
                min="1"
                max="12"
                value={preferences.halfDayThresholdHours}
                onChange={(e) => handleChange('halfDayThresholdHours', parseInt(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>
          </div>
          <div className="mt-4">
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={preferences.autoMarkAbsent}
                onChange={(e) => handleChange('autoMarkAbsent', e.target.checked)}
                className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
              />
              <span className="ml-2 text-sm text-gray-900">Automatically mark employees as absent if no check-in</span>
            </label>
          </div>
        </div>

        {/* Company Information */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center space-x-3 mb-4">
            <FaCog className="w-6 h-6 text-gray-500" />
            <h2 className="text-xl font-semibold text-gray-800">Company Information</h2>
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Company Name</label>
              <input
                type="text"
                value={preferences.companyName}
                onChange={(e) => handleChange('companyName', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                placeholder="Your Company Name"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Company Address</label>
              <textarea
                value={preferences.companyAddress}
                onChange={(e) => handleChange('companyAddress', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                rows="3"
                placeholder="Company Address"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Company Phone</label>
                <input
                  type="tel"
                  value={preferences.companyPhone}
                  onChange={(e) => handleChange('companyPhone', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  placeholder="+91 12345 67890"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Company Email</label>
                <input
                  type="email"
                  value={preferences.companyEmail}
                  onChange={(e) => handleChange('companyEmail', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  placeholder="info@company.com"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
