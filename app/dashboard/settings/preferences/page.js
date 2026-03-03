'use client'

import { useState, useEffect, useMemo } from 'react'
import toast from '@/utils/toast'
import { FaCog, FaMoneyBillWave, FaClock, FaCalendarAlt, FaSave } from 'react-icons/fa'
import { Card, CardBody, CardHeader, Button, Select, SelectItem, Input, Textarea, Checkbox, Skeleton } from '@heroui/react'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import useApiMutation from '@/hooks/useApiMutation'
import { DataErrorState } from '@/components/ui/ErrorBoundary'
import BackgroundRefreshIndicator from '@/components/ui/BackgroundRefreshIndicator'

const defaultPreferences = {
  // Currency Settings
  currency: 'INR',
  currencySymbol: '₹',
  // Time Settings
  timeFormat: '12',
  timezone: 'Asia/Kolkata',
  // Work Settings
  workingDaysPerWeek: 5,
  workingHoursPerDay: 8,
  weekStartsOn: 'monday',
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
}

export default function PreferencesPage() {
  const [preferences, setPreferences] = useState(defaultPreferences)

  const user = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('user')) } catch { return null }
  }, [])

  // Access check
  useEffect(() => {
    if (user && user.role !== 'admin') {
      toast.error('Access denied. Only Admin can manage preferences.')
      window.location.href = '/dashboard'
    }
  }, [user])

  // SWR: fetch preferences
  const { data: res, error, isLoading, isValidating, mutate: refresh } = useAuthedSWR('/api/settings/preferences')

  // Sync fetched data into local state for editing
  useEffect(() => {
    if (res?.data) {
      setPreferences(prev => ({ ...prev, ...res.data }))
    }
  }, [res])

  // Mutation: save preferences
  const saveMutation = useApiMutation({
    method: 'PUT',
    invalidateKeys: ['/api/settings/preferences'],
    onSuccess: () => toast.success('Preferences saved successfully'),
    onError: (msg) => toast.error(msg || 'Failed to save preferences'),
  })

  const handleSave = () => {
    saveMutation.execute('/api/settings/preferences', preferences, { method: 'PUT' })
  }

  const handleChange = (key, value) => {
    setPreferences(prev => ({ ...prev, [key]: value }))
  }

  if (isLoading) {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <div className="flex md:justify-between md:items-center md:flex-row flex-col mb-6">
          <div>
            <Skeleton className="h-8 w-64 rounded-lg mb-2" />
            <Skeleton className="h-4 w-80 rounded-lg" />
          </div>
          <Skeleton className="h-10 w-36 rounded-lg" />
        </div>
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="bg-white rounded-lg shadow-md p-6 space-y-4">
            <Skeleton className="h-6 w-48 rounded-lg" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Skeleton className="h-12 w-full rounded-lg" />
              <Skeleton className="h-12 w-full rounded-lg" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (error) {
    return <DataErrorState error={error} onRetry={refresh} title="Failed to load preferences" />
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <BackgroundRefreshIndicator isValidating={isValidating} />
      {/* Header */}
      <div className="flex md:justify-between md:items-center md:flex-row flex-col mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">System Preferences</h1>
          <p className="text-gray-600 mt-1">Configure system-wide settings and preferences</p>
        </div>
        <Button
          onPress={handleSave}
          isLoading={saveMutation.isLoading}
          color="primary"
          startContent={!saveMutation.isLoading && <FaSave className="w-4 h-4" />}
        >
          {saveMutation.isLoading ? 'Saving...' : 'Save Changes'}
        </Button>
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
              <Select
                label="Currency"
                selectedKeys={[preferences.currency]}
                onSelectionChange={(keys) => {
                  const currency = Array.from(keys)[0]
                  const symbol = currency === 'INR' ? '₹' : currency === 'USD' ? '$' : '€'
                  handleChange('currency', currency)
                  handleChange('currencySymbol', symbol)
                }}
              >
                <SelectItem key="INR">Indian Rupee (INR)</SelectItem>
                <SelectItem key="USD">US Dollar (USD)</SelectItem>
                <SelectItem key="EUR">Euro (EUR)</SelectItem>
              </Select>
            </div>
            <div>
              <Input
                label="Currency Symbol"
                value={preferences.currencySymbol}
                onChange={(e) => handleChange('currencySymbol', e.target.value)}
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
              <Select
                label="Time Format"
                selectedKeys={[preferences.timeFormat]}
                onSelectionChange={(keys) => handleChange('timeFormat', Array.from(keys)[0])}
              >
                <SelectItem key="12">12 Hour (AM/PM)</SelectItem>
                <SelectItem key="24">24 Hour</SelectItem>
              </Select>
            </div>
            <div>
              <Select
                label="Date Format"
                selectedKeys={[preferences.dateFormat]}
                onSelectionChange={(keys) => handleChange('dateFormat', Array.from(keys)[0])}
              >
                <SelectItem key="DD/MM/YYYY">DD/MM/YYYY</SelectItem>
                <SelectItem key="MM/DD/YYYY">MM/DD/YYYY</SelectItem>
                <SelectItem key="YYYY-MM-DD">YYYY-MM-DD</SelectItem>
              </Select>
            </div>
            <div>
              <Select
                label="Timezone"
                selectedKeys={[preferences.timezone]}
                onSelectionChange={(keys) => handleChange('timezone', Array.from(keys)[0])}
              >
                <SelectItem key="Asia/Kolkata">Asia/Kolkata (IST)</SelectItem>
                <SelectItem key="America/New_York">America/New_York (EST)</SelectItem>
                <SelectItem key="Europe/London">Europe/London (GMT)</SelectItem>
              </Select>
            </div>
            <div>
              <Select
                label="Week Starts On"
                selectedKeys={[preferences.weekStartsOn]}
                onSelectionChange={(keys) => handleChange('weekStartsOn', Array.from(keys)[0])}
              >
                <SelectItem key="monday">Monday</SelectItem>
                <SelectItem key="sunday">Sunday</SelectItem>
              </Select>
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
              <Input
                label="Working Days Per Week"
                type="number"
                min={1}
                max={7}
                value={String(preferences.workingDaysPerWeek)}
                onChange={(e) => handleChange('workingDaysPerWeek', parseInt(e.target.value))}
              />
            </div>
            <div>
              <Input
                label="Working Hours Per Day"
                type="number"
                min={1}
                max={24}
                value={String(preferences.workingHoursPerDay)}
                onChange={(e) => handleChange('workingHoursPerDay', parseInt(e.target.value))}
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
              <Input
                label="Late Threshold (Minutes)"
                type="number"
                min={0}
                value={String(preferences.lateThresholdMinutes)}
                onChange={(e) => handleChange('lateThresholdMinutes', parseInt(e.target.value))}
              />
            </div>
            <div>
              <Input
                label="Half Day Threshold (Hours)"
                type="number"
                min={1}
                max={12}
                value={String(preferences.halfDayThresholdHours)}
                onChange={(e) => handleChange('halfDayThresholdHours', parseInt(e.target.value))}
              />
            </div>
          </div>
          <div className="mt-4">
            <Checkbox
              isSelected={preferences.autoMarkAbsent}
              onValueChange={(checked) => handleChange('autoMarkAbsent', checked)}
            >
              Automatically mark employees as absent if no check-in
            </Checkbox>
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
              <Input
                label="Company Name"
                value={preferences.companyName}
                onChange={(e) => handleChange('companyName', e.target.value)}
                placeholder="Your Company Name"
              />
            </div>
            <div>
              <Textarea
                label="Company Address"
                value={preferences.companyAddress}
                onChange={(e) => handleChange('companyAddress', e.target.value)}
                minRows={3}
                placeholder="Company Address"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Input
                  label="Company Phone"
                  type="tel"
                  value={preferences.companyPhone}
                  onChange={(e) => handleChange('companyPhone', e.target.value)}
                  placeholder="+91 12345 67890"
                />
              </div>
              <div>
                <Input
                  label="Company Email"
                  type="email"
                  value={preferences.companyEmail}
                  onChange={(e) => handleChange('companyEmail', e.target.value)}
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
