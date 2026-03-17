'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import toast from '@/utils/toast'
import { FaArrowLeft, FaSave, FaTimes, FaPlus } from 'react-icons/fa'
import { HiOutlineSparkles } from 'react-icons/hi2'
import { Select, SelectItem, Input, Textarea, Button, Skeleton } from '@heroui/react'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import useApiMutation from '@/hooks/useApiMutation'
import LoadingButton from '@/components/ui/LoadingButton'
import { useAILoading } from '@/contexts/AILoadingContext'

export default function EditGoalPage() {
  const router = useRouter()
  const params = useParams()
  const [generatingDescription, setGeneratingDescription] = useState(false)
  const { startAILoading, stopAILoading } = useAILoading()
  const [formData, setFormData] = useState({
    employeeId: '',
    title: '',
    description: '',
    category: '',
    priority: 'medium',
    status: 'not-started',
    progress: 0,
    startDate: '',
    dueDate: '',
    milestones: [{ title: '', description: '', dueDate: '', completed: false }]
  })

  // Fetch employees
  const { data: empRes } = useAuthedSWR('/api/employees?limit=1000')
  const employees = empRes?.data || []

  // Fetch the goal
  const { data: goalRes, isLoading: initialLoading } = useAuthedSWR(
    params.id ? `/api/performance/goals?goalId=${params.id}` : null
  )

  // Populate form when goal data loads
  useEffect(() => {
    if (goalRes?.success && goalRes.data) {
      const goal = goalRes.data
      setFormData({
        employeeId: goal.employee?._id || goal.employee || '',
        title: goal.title || '',
        description: goal.description || '',
        category: goal.category || '',
        priority: goal.priority || 'medium',
        status: goal.status || 'not-started',
        progress: goal.progress || 0,
        startDate: goal.startDate ? new Date(goal.startDate).toISOString().split('T')[0] : '',
        dueDate: goal.dueDate ? new Date(goal.dueDate).toISOString().split('T')[0] : '',
        milestones: goal.milestones && goal.milestones.length > 0
          ? goal.milestones.map(m => ({
            title: m.title || '',
            description: m.description || '',
            dueDate: m.dueDate ? new Date(m.dueDate).toISOString().split('T')[0] : '',
            completed: m.completed || false
          }))
          : [{ title: '', description: '', dueDate: '', completed: false }]
      })
    } else if (goalRes && !goalRes.success) {
      toast.error(goalRes.message || 'Goal not found')
      router.push('/dashboard/performance/goals')
    }
  }, [goalRes, router])

  const handleInputChange = (e) => {
    const { name, value } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: value
    }))
  }

  const handleMilestoneChange = (index, field, value) => {
    setFormData(prev => ({
      ...prev,
      milestones: prev.milestones.map((milestone, i) =>
        i === index ? { ...milestone, [field]: value } : milestone
      )
    }))
  }

  const addMilestone = () => {
    setFormData(prev => ({
      ...prev,
      milestones: [...prev.milestones, { title: '', description: '', dueDate: '', completed: false }]
    }))
  }

  const removeMilestone = (index) => {
    setFormData(prev => ({
      ...prev,
      milestones: prev.milestones.filter((_, i) => i !== index)
    }))
  }

  const submitMutation = useApiMutation({
    method: 'PUT',
    onSuccess: () => {
      toast.success('Goal updated successfully')
      router.push('/dashboard/performance/goals/' + params.id)
    },
    onError: (msg) => toast.error(msg || 'Failed to update goal'),
  })

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (!formData.employeeId) {
      toast.error('Please select an employee')
      return
    }

    if (!formData.title) {
      toast.error('Please enter goal title')
      return
    }

    if (!formData.dueDate) {
      toast.error('Please select due date')
      return
    }

    submitMutation.execute('/api/performance/goals', {
      goalId: params.id,
      ...formData,
      milestones: formData.milestones.filter(m => m.title.trim())
    })
  }

  const categories = [
    'Skill Development',
    'Project Management',
    'Leadership',
    'Performance Improvement',
    'Career Growth',
    'Team Collaboration',
    'Innovation',
    'Customer Service',
    'Quality Improvement',
    'Other'
  ]

  if (initialLoading) {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <Skeleton className="h-10 w-64 rounded-lg" />
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    )
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-4">
          <button
            onClick={() => router.back()}
            className="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <FaArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-3xl font-bold text-gray-800">Edit Performance Goal</h1>
            <p className="text-gray-600 mt-1">Update goal details and milestones</p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic Information */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-xl font-semibold text-gray-800 mb-4">Basic Information</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Select
                label="Employee *"
                selectedKeys={formData.employeeId ? [formData.employeeId] : []}
                onSelectionChange={(keys) => handleInputChange({ target: { name: 'employeeId', value: Array.from(keys)[0] || '' } })}
                isRequired
                placeholder="Select Employee"
              >
                {employees.map((employee) => (
                  <SelectItem key={employee._id}>
                    {employee.firstName} {employee.lastName} ({employee.employeeCode})
                  </SelectItem>
                ))}
              </Select>
            </div>
            <div>
              <Select
                label="Category"
                selectedKeys={formData.category ? [formData.category] : []}
                onSelectionChange={(keys) => handleInputChange({ target: { name: 'category', value: Array.from(keys)[0] || '' } })}
                placeholder="Select Category"
              >
                {categories.map((category) => (
                  <SelectItem key={category}>
                    {category}
                  </SelectItem>
                ))}
              </Select>
            </div>
            <div>
              <Select
                label="Priority"
                selectedKeys={[formData.priority]}
                onSelectionChange={(keys) => handleInputChange({ target: { name: 'priority', value: Array.from(keys)[0] || 'medium' } })}
              >
                <SelectItem key="low">Low</SelectItem>
                <SelectItem key="medium">Medium</SelectItem>
                <SelectItem key="high">High</SelectItem>
              </Select>
            </div>
            <div>
              <Select
                label="Status"
                selectedKeys={[formData.status]}
                onSelectionChange={(keys) => handleInputChange({ target: { name: 'status', value: Array.from(keys)[0] || 'not-started' } })}
              >
                <SelectItem key="not-started">Not Started</SelectItem>
                <SelectItem key="in-progress">In Progress</SelectItem>
                <SelectItem key="on-hold">On Hold</SelectItem>
                <SelectItem key="completed">Completed</SelectItem>
                <SelectItem key="cancelled">Cancelled</SelectItem>
              </Select>
            </div>
          </div>
        </div>

        {/* Goal Details */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-xl font-semibold text-gray-800 mb-4">Goal Details</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Goal Title *
              </label>
              <input
                type="text"
                name="title"
                value={formData.title}
                onChange={handleInputChange}
                placeholder="Enter goal title"
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>
            <div>
              <div className="flex items-center justify-start mb-2">
                <label className="block text-sm font-medium text-gray-700">
                  Description
                </label>
                <Button
                  size="sm"
                  variant="flat"
                  onPress={async () => {
                    if (!formData.title.trim()) { toast.error('Please enter a goal title first'); return }
                    setGeneratingDescription(true)
                    startAILoading('MIRA is writing goal description...')
                    try {
                      const token = localStorage.getItem('token')
                      const res = await fetch('/api/ai/generate-text', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                        body: JSON.stringify({ type: 'goal_description', context: { goalTitle: formData.title, category: formData.category } })
                      })
                      const data = await res.json()
                      if (data.success && data.text) {
                        setFormData(prev => ({ ...prev, description: data.text }))
                        toast.success('Description generated!')
                      } else { toast.error(data.message || 'Failed to generate description') }
                    } catch (err) { console.error('AI generate error:', err); toast.error('Failed to generate description') }
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
                name="description"
                value={formData.description}
                onChange={handleInputChange}
                placeholder="Describe the goal in detail..."
                rows={4}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Start Date
                </label>
                <input
                  type="date"
                  name="startDate"
                  value={formData.startDate}
                  onChange={handleInputChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Due Date *
                </label>
                <input
                  type="date"
                  name="dueDate"
                  value={formData.dueDate}
                  onChange={handleInputChange}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Progress (%)
                </label>
                <input
                  type="number"
                  name="progress"
                  value={formData.progress}
                  onChange={handleInputChange}
                  min="0"
                  max="100"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Milestones */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-gray-800">Milestones</h2>
            <button
              type="button"
              onClick={addMilestone}
              className="px-3 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors flex items-center space-x-2"
            >
              <FaPlus className="w-4 h-4" />
              <span>Add Milestone</span>
            </button>
          </div>
          <div className="space-y-4">
            {formData.milestones.map((milestone, index) => (
              <div key={index} className="border border-gray-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-medium text-gray-800">Milestone {index + 1}</h3>
                  <div className="flex items-center space-x-2">
                    <label className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        checked={milestone.completed}
                        onChange={(e) => handleMilestoneChange(index, 'completed', e.target.checked)}
                        className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      />
                      <span className="text-sm text-gray-700">Completed</span>
                    </label>
                    {formData.milestones.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeMilestone(index)}
                        className="text-red-600 hover:text-red-800 p-1"
                      >
                        <FaTimes className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Milestone Title
                    </label>
                    <input
                      type="text"
                      value={milestone.title}
                      onChange={(e) => handleMilestoneChange(index, 'title', e.target.value)}
                      placeholder="Enter milestone title"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Due Date
                    </label>
                    <input
                      type="date"
                      value={milestone.dueDate}
                      onChange={(e) => handleMilestoneChange(index, 'dueDate', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    />
                  </div>
                </div>
                <div className="mt-3">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Description
                  </label>
                  <textarea
                    value={milestone.description}
                    onChange={(e) => handleMilestoneChange(index, 'description', e.target.value)}
                    placeholder="Describe this milestone..."
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex justify-end space-x-4">
          <button
            type="button"
            onClick={() => router.back()}
            className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors flex items-center space-x-2"
          >
            <FaTimes className="w-4 h-4" />
            <span>Cancel</span>
          </button>
          <LoadingButton
            type="submit"
            isLoading={submitMutation.isLoading}
            loadingText="Updating..."
            startContent={<FaSave className="w-4 h-4" />}
          >
            Update Goal
          </LoadingButton>
        </div>
      </form>
    </div>
  )
}
