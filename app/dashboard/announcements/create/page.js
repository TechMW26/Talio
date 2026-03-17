'use client'

import React, { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import toast from '@/utils/toast'
import { Select, SelectItem, Skeleton, Button } from '@heroui/react'
import { FaBullhorn, FaUsers, FaCalendarAlt, FaExclamationTriangle } from 'react-icons/fa'
import { HiOutlineSparkles } from 'react-icons/hi2'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import useApiMutation from '@/hooks/useApiMutation'
import LoadingButton from '@/components/ui/LoadingButton'
import { useAILoading } from '@/contexts/AILoadingContext'

export default function CreateAnnouncementPage() {
  const router = useRouter()
  const [generatingDescription, setGeneratingDescription] = useState(false)
  const { startAILoading, stopAILoading } = useAILoading()
  const user = useMemo(() => {
    if (typeof window === 'undefined') return null
    const userData = localStorage.getItem('user')
    return userData ? JSON.parse(userData) : null
  }, [])
  const [formData, setFormData] = useState({
    title: '',
    content: '',
    priority: 'medium',
    targetAudience: 'all',
    departments: [],
    expiryDate: '',
    isActive: true,
  })

  // Check permissions
  const allowedRoles = ['admin', 'hr', 'department_head', 'manager']
  if (user && !allowedRoles.includes(user.role)) {
    toast.error('Access denied. You do not have permission to create announcements.')
    router.push('/dashboard')
  }

  // Fetch team members for managers
  const { data: teamRes } = useAuthedSWR(
    user?.role === 'manager' ? '/api/team/members' : null
  )
  const teamMembers = teamRes?.data || []

  // Fetch departments for admin/hr/department_head
  const { data: deptRes } = useAuthedSWR(
    user && ['admin', 'hr', 'department_head'].includes(user.role) ? '/api/departments' : null
  )
  const departments = deptRes?.data || []

  const submitMutation = useApiMutation({
    method: 'POST',
    onSuccess: () => {
      toast.success('Announcement created successfully! 📢')
      router.push('/dashboard/announcements')
    },
    onError: (msg) => toast.error(msg || 'Failed to create announcement'),
  })

  const handleSubmit = async (e) => {
    e.preventDefault()

    // Prepare announcement data
    const announcementData = {
      ...formData,
    }

    // For managers, set as department announcement
    if (user.role === 'manager') {
      announcementData.isDepartmentAnnouncement = true
      announcementData.targetAudience = 'department'
      if (user.employeeId && typeof user.employeeId === 'object' && user.employeeId.department) {
        if (user.employeeId.department._id) {
          announcementData.departments = [user.employeeId.department._id]
        } else {
          announcementData.departments = [user.employeeId.department]
        }
      }
    }

    submitMutation.execute('/api/announcements', announcementData)
  }

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'high': return 'text-red-600'
      case 'medium': return 'text-yellow-600'
      case 'low': return 'text-green-600'
      default: return 'text-gray-600'
    }
  }

  const getPriorityIcon = (priority) => {
    switch (priority) {
      case 'high': return FaExclamationTriangle
      case 'medium': return FaBullhorn
      case 'low': return FaCalendarAlt
      default: return FaBullhorn
    }
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Skeleton className="h-64 w-full max-w-4xl rounded-xl" />
      </div>
    )
  }

  return (
    <div className="p-3 sm:p-6 max-w-4xl mx-auto pb-20 sm:pb-6">
      {/* Header */}
      <div className="mb-4 sm:mb-6">
        <div className="flex items-center space-x-2 sm:space-x-3 mb-2">
          <FaBullhorn className="w-6 h-6 sm:w-8 sm:h-8 text-primary-500 flex-shrink-0" />
          <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-gray-800">Create Announcement</h1>
        </div>
        <p className="text-sm sm:text-base text-gray-600">
          {user.role === 'manager'
            ? 'Create a new announcement for your team members'
            : 'Create a new announcement for employees'}
        </p>
        {user.role === 'manager' && (
          <div className="mt-2 px-3 sm:px-4 py-2 bg-purple-50 border border-purple-200 rounded-lg">
            <p className="text-xs sm:text-sm text-purple-700">
              <strong>Note:</strong> This announcement will be sent to all members of your team.
            </p>
          </div>
        )}
      </div>

      {/* Form */}
      <div className="bg-white rounded-lg shadow-md p-4 sm:p-6">
        <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-6">
          {/* Title */}
          <div>
            <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1 sm:mb-2">
              Announcement Title *
            </label>
            <input
              type="text"
              required
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              className="w-full px-3 sm:px-4 py-2 text-sm sm:text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              placeholder="Enter announcement title..."
            />
          </div>

          {/* Content */}
          <div>
            <div className="flex items-center justify-start mb-1 sm:mb-2">
              <label className="block text-xs sm:text-sm font-medium text-gray-700">
                Content *
              </label>
              <Button
                size="sm"
                variant="flat"
                onPress={async () => {
                  if (!formData.title.trim()) { toast.error('Please enter an announcement title first'); return }
                  setGeneratingDescription(true)
                  startAILoading('MIRA is writing announcement content...')
                  try {
                    const token = localStorage.getItem('token')
                    const res = await fetch('/api/ai/generate-text', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                      body: JSON.stringify({ type: 'announcement', context: { title: formData.title } })
                    })
                    const data = await res.json()
                    if (data.success && data.text) {
                      setFormData(prev => ({ ...prev, content: data.text }))
                      toast.success('Content generated!')
                    } else { toast.error(data.message || 'Failed to generate content') }
                  } catch (err) { console.error('AI generate error:', err); toast.error('Failed to generate content') }
                  finally { setGeneratingDescription(false); stopAILoading() }
                }}
                isDisabled={generatingDescription || !formData.title.trim()}
                isLoading={generatingDescription}
                startContent={!generatingDescription && <HiOutlineSparkles className="w-3.5 h-3.5" />}
                className="ml-2 bg-gradient-to-r from-purple-600 to-indigo-600 text-white"
              >
                {generatingDescription ? 'Writing...' : 'AI Write'}
              </Button>
            </div>
            <textarea
              required
              value={formData.content}
              onChange={(e) => setFormData({ ...formData, content: e.target.value })}
              className="w-full px-3 sm:px-4 py-2 text-sm sm:text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
              rows="4"
              placeholder="Enter announcement content..."
            />
          </div>

          {/* Priority and Target Audience Row */}
          <div className="grid grid-cols-1 gap-4 sm:gap-6">
            {/* Priority */}
            <div>
              <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1 sm:mb-2">
                Priority *
              </label>
              <Select
                selectedKeys={[formData.priority]}
                onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
                aria-label="Priority"
                classNames={{ trigger: "bg-white" }}
              >
                <SelectItem key="low">Low Priority</SelectItem>
                <SelectItem key="medium">Medium Priority</SelectItem>
                <SelectItem key="high">High Priority</SelectItem>
              </Select>
              <div className="mt-2 flex items-center space-x-2">
                {React.createElement(getPriorityIcon(formData.priority), {
                  className: `w-3 h-3 sm:w-4 sm:h-4 ${getPriorityColor(formData.priority)}`
                })}
                <span className={`text-xs sm:text-sm ${getPriorityColor(formData.priority)}`}>
                  {formData.priority.charAt(0).toUpperCase() + formData.priority.slice(1)} Priority
                </span>
              </div>
            </div>

            {/* Target Audience - Only show for non-managers */}
            {user.role !== 'manager' && (
              <div>
                <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1 sm:mb-2">
                  Target Audience *
                </label>
                {user.role === 'department_head' ? (
                  <div className="w-full px-3 sm:px-4 py-2 border border-purple-300 bg-purple-50 rounded-lg">
                    <div className="flex items-center space-x-2">
                      <FaUsers className="w-3 h-3 sm:w-4 sm:h-4 text-purple-600 flex-shrink-0" />
                      <span className="text-xs sm:text-sm text-purple-700 font-medium">
                        Your Department Members
                      </span>
                    </div>
                  </div>
                ) : (
                  <>
                    <Select
                      selectedKeys={[formData.targetAudience]}
                      onChange={(e) => setFormData({ ...formData, targetAudience: e.target.value })}
                      aria-label="Target Audience"
                      classNames={{ trigger: "bg-white" }}
                    >
                      <SelectItem key="all">All Employees</SelectItem>
                      <SelectItem key="department">Specific Department(s)</SelectItem>
                    </Select>
                    {formData.targetAudience === 'department' && departments.length > 0 && (
                      <div className="mt-2 sm:mt-3 space-y-2">
                        <label className="block text-xs sm:text-sm font-medium text-gray-700">
                          Select Department(s)
                        </label>
                        <div className="max-h-32 sm:max-h-40 overflow-y-auto border border-gray-300 rounded-lg p-2">
                          {departments.map((dept) => (
                            <label key={dept._id} className="flex items-center space-x-2 p-1.5 sm:p-2 hover:bg-gray-50 rounded cursor-pointer">
                              <input
                                type="checkbox"
                                checked={formData.departments.includes(dept._id)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setFormData({
                                      ...formData,
                                      departments: [...formData.departments, dept._id]
                                    })
                                  } else {
                                    setFormData({
                                      ...formData,
                                      departments: formData.departments.filter(id => id !== dept._id)
                                    })
                                  }
                                }}
                                className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded flex-shrink-0"
                              />
                              <span className="text-xs sm:text-sm text-gray-700">{dept.name}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
                <div className="mt-2 flex items-center space-x-2">
                  <FaUsers className="w-3 h-3 sm:w-4 sm:h-4 text-blue-600 flex-shrink-0" />
                  <span className="text-xs sm:text-sm text-blue-600">
                    {user.role === 'department_head'
                      ? 'Department Members'
                      : formData.targetAudience === 'all'
                        ? 'All Employees'
                        : formData.targetAudience === 'department' && formData.departments.length > 0
                          ? `${formData.departments.length} Department(s) Selected`
                          : 'Select Target Audience'}
                  </span>
                </div>
              </div>
            )}

            {/* For managers, show team info */}
            {user.role === 'manager' && (
              <div>
                <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1 sm:mb-2">
                  Target Audience
                </label>
                <div className="w-full px-3 sm:px-4 py-2 border border-purple-300 bg-purple-50 rounded-lg">
                  <div className="flex items-center space-x-2">
                    <FaUsers className="w-3 h-3 sm:w-4 sm:h-4 text-purple-600 flex-shrink-0" />
                    <span className="text-xs sm:text-sm text-purple-700 font-medium">
                      Your Team Members ({teamMembers.length} members)
                    </span>
                  </div>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  This announcement will be sent to all your direct reports
                </p>
              </div>
            )}
          </div>

          {/* Expiry Date */}
          <div>
            <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1 sm:mb-2">
              Expiry Date (Optional)
            </label>
            <input
              type="date"
              value={formData.expiryDate}
              onChange={(e) => setFormData({ ...formData, expiryDate: e.target.value })}
              className="w-full px-3 sm:px-4 py-2 text-sm sm:text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              min={new Date().toISOString().split('T')[0]}
            />
            <p className="text-xs sm:text-sm text-gray-500 mt-1">
              Leave empty for permanent announcement
            </p>
          </div>

          {/* Active Status */}
          <div className="flex items-center">
            <input
              type="checkbox"
              id="isActive"
              checked={formData.isActive}
              onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
              className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded flex-shrink-0"
            />
            <label htmlFor="isActive" className="ml-2 block text-xs sm:text-sm text-gray-900">
              Publish announcement immediately
            </label>
          </div>

          {/* Preview */}
          <div className="border-t pt-4 sm:pt-6">
            <h3 className="text-base sm:text-lg font-semibold text-gray-800 mb-3 sm:mb-4">Preview</h3>
            <div className={`rounded-lg p-3 sm:p-4 border-l-4 ${user.role === 'manager' || user.role === 'department_head'
                ? 'bg-purple-50 border-purple-500'
                : 'bg-gray-50 border-primary-500'
              }`}>
              <div className="flex items-start sm:items-center justify-between mb-2 flex-wrap gap-2">
                <div className="flex items-center space-x-2 flex-wrap">
                  <h4 className="text-base sm:text-lg font-semibold text-gray-900">
                    {formData.title || 'Announcement Title'}
                  </h4>
                  {(user.role === 'manager' || user.role === 'department_head') && (
                    <span className="px-2 py-0.5 sm:py-1 text-xs font-semibold rounded-full bg-purple-100 text-purple-800">
                      {user.role === 'manager' ? 'Team' : 'Department'}
                    </span>
                  )}
                </div>
                <div className="flex items-center space-x-1.5 sm:space-x-2 flex-shrink-0">
                  {React.createElement(getPriorityIcon(formData.priority), {
                    className: `w-3 h-3 sm:w-4 sm:h-4 ${getPriorityColor(formData.priority)}`
                  })}
                  <span className={`text-xs px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-full ${formData.priority === 'high' ? 'bg-red-100 text-red-800' :
                      formData.priority === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                        'bg-green-100 text-green-800'
                    }`}>
                    {formData.priority.toUpperCase()}
                  </span>
                </div>
              </div>
              <p className="text-sm sm:text-base text-gray-700 whitespace-pre-wrap break-words">
                {formData.content || 'Announcement content will appear here...'}
              </p>
              <div className="mt-2 sm:mt-3 flex items-center justify-between text-xs sm:text-sm text-gray-500 flex-wrap gap-2">
                <span className="break-words">
                  Target: {
                    user.role === 'manager'
                      ? `Your Team (${teamMembers.length} members)`
                      : user.role === 'department_head'
                        ? 'Your Department'
                        : formData.targetAudience === 'all'
                          ? 'All Employees'
                          : formData.targetAudience === 'department' && formData.departments.length > 0
                            ? `${formData.departments.length} Department(s)`
                            : formData.targetAudience
                  }
                </span>
                {formData.expiryDate && (
                  <span className="whitespace-nowrap">Expires: {new Date(formData.expiryDate).toLocaleDateString()}</span>
                )}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-4 pt-4 sm:pt-6">
            <button
              type="button"
              onClick={() => router.push('/dashboard/announcements')}
              className="w-full sm:flex-1 px-4 sm:px-6 py-2.5 sm:py-2 text-sm sm:text-base border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <LoadingButton
              type="submit"
              isLoading={submitMutation.isLoading}
              loadingText="Creating..."
              className="w-full sm:flex-1"
            >
              Create Announcement
            </LoadingButton>
          </div>
        </form>
      </div>
    </div>
  )
}
