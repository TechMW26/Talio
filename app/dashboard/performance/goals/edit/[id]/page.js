'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import toast from '@/utils/toast'
import { FaArrowLeft, FaSave, FaTimes, FaPlus } from 'react-icons/fa'
import Loader from '@/components/ui/Loader'

export default function EditGoalPage() {
  const router = useRouter()
  const params = useParams()
  const [loading, setLoading] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)
  const [employees, setEmployees] = useState([])
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

  useEffect(() => {
    fetchEmployees()
    fetchGoal()
  }, [params.id])

  const fetchEmployees = async () => {
    try {
      const response = await fetch('/api/employees?limit=1000')
      const data = await response.json()
      if (data.success) {
        setEmployees(data.data)
      }
    } catch (error) {
      console.error('Fetch employees error:', error)
      toast.error('Failed to fetch employees')
    }
  }

  const fetchGoal = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/performance/goals?goalId=' + params.id, {
        headers: { 'Authorization': 'Bearer ' + token }
      })

      const data = await response.json()
      
      if (data.success && data.data) {
        const goal = data.data
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
      } else {
        toast.error(data.message || 'Goal not found')
        router.push('/dashboard/performance/goals')
      }
    } catch (error) {
      console.error('Fetch goal error:', error)
      toast.error('Failed to fetch goal details')
    } finally {
      setInitialLoading(false)
    }
  }

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

    setLoading(true)
    
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/performance/goals', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({
          goalId: params.id,
          ...formData,
          milestones: formData.milestones.filter(m => m.title.trim())
        })
      })

      const data = await response.json()
      
      if (data.success) {
        toast.success('Goal updated successfully')
        router.push('/dashboard/performance/goals/' + params.id)
      } else {
        toast.error(data.message || 'Failed to update goal')
      }
    } catch (error) {
      console.error('Update goal error:', error)
      toast.error('Failed to update goal')
    } finally {
      setLoading(false)
    }
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
      <div className="flex items-center justify-center min-h-screen">
        <Loader size="lg" />
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
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Employee *
              </label>
              <select
                name="employeeId"
                value={formData.employeeId}
                onChange={handleInputChange}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              >
                <option value="">Select Employee</option>
                {employees.map((employee) => (
                  <option key={employee._id} value={employee._id}>
                    {employee.firstName} {employee.lastName} ({employee.employeeCode})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Category
              </label>
              <select
                name="category"
                value={formData.category}
                onChange={handleInputChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              >
                <option value="">Select Category</option>
                {categories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Priority
              </label>
              <select
                name="priority"
                value={formData.priority}
                onChange={handleInputChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Status
              </label>
              <select
                name="status"
                value={formData.status}
                onChange={handleInputChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              >
                <option value="not-started">Not Started</option>
                <option value="in-progress">In Progress</option>
                <option value="on-hold">On Hold</option>
                <option value="completed">Completed</option>
              </select>
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
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Description
              </label>
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
          <button
            type="submit"
            disabled={loading}
            className="px-6 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors flex items-center space-x-2 disabled:opacity-50"
          >
            <FaSave className="w-4 h-4" />
            <span>{loading ? 'Updating...' : 'Update Goal'}</span>
          </button>
        </div>
      </form>
    </div>
  )
}
