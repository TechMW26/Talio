'use client'

import { useState, useEffect } from 'react'
import toast from '@/utils/toast'
import { FaPlus, FaEdit, FaTrash, FaUmbrella } from 'react-icons/fa'
import Loader from '@/components/ui/Loader'

export default function LeaveTypesPage() {
  const [leaveTypes, setLeaveTypes] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingType, setEditingType] = useState(null)
  const [user, setUser] = useState(null)
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    maxDaysPerYear: 0,
    description: '',
    isPaid: true,
    requiresApproval: true,
  })

  useEffect(() => {
    const userData = localStorage.getItem('user')
    if (userData) {
      const parsedUser = JSON.parse(userData)
      setUser(parsedUser)

      // Check if user has permission (HR or Admin only)
      if (!['hr', 'admin'].includes(parsedUser.role)) {
        toast.error('Access denied. Only HR and Admin can manage leave types.')
        window.location.href = '/dashboard'
        return
      }

      fetchLeaveTypes()
    }
  }, [])

  const fetchLeaveTypes = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/leave/types', {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      const data = await response.json()
      if (data.success) {
        setLeaveTypes(data.data)
      }
    } catch (error) {
      console.error('Fetch leave types error:', error)
      toast.error('Failed to fetch leave types')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    try {
      const token = localStorage.getItem('token')
      const url = editingType
        ? `/api/leave/types/${editingType._id}`
        : '/api/leave/types'
      const method = editingType ? 'PUT' : 'POST'

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(formData),
      })

      const data = await response.json()

      if (data.success) {
        toast.success(data.message)
        setShowModal(false)
        setEditingType(null)
        setFormData({
          name: '',
          code: '',
          maxDaysPerYear: 0,
          description: '',
          isPaid: true,
          requiresApproval: true,
        })
        fetchLeaveTypes()
      } else {
        toast.error(data.message)
      }
    } catch (error) {
      console.error('Submit error:', error)
      toast.error('Failed to save leave type')
    }
  }

  const handleEdit = (type) => {
    setEditingType(type)
    setFormData({
      name: type.name,
      code: type.code || '',
      maxDaysPerYear: type.maxDaysPerYear || 0,
      description: type.description || '',
      isPaid: type.isPaid !== false,
      requiresApproval: type.requiresApproval !== false,
    })
    setShowModal(true)
  }

  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to delete this leave type?')) return

    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/leave/types/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      })

      const data = await response.json()

      if (data.success) {
        toast.success(data.message)
        fetchLeaveTypes()
      } else {
        toast.error(data.message)
      }
    } catch (error) {
      console.error('Delete error:', error)
      toast.error('Failed to delete leave type')
    }
  }

  const handleCloseModal = () => {
    setShowModal(false)
    setEditingType(null)
    setFormData({
      name: '',
      code: '',
      maxDaysPerYear: 0,
      description: '',
      isPaid: true,
      requiresApproval: true,
    })
  }

  return (
    <div className="page-container space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center space-y-3 sm:space-y-0">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-800">Leave Types</h1>
          <p className="text-gray-600 mt-1 text-sm sm:text-base">Configure different types of leaves</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="btn-theme-primary flex items-center justify-center space-x-2 w-full sm:w-auto rounded-lg px-4 py-2 font-semibold shadow-md hover:shadow-lg transition-all duration-200"
        >
          <FaPlus className="w-4 h-4" />
          <span>Add Leave Type</span>
        </button>
      </div>

      {/* Stats Card */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-gray-600">Total Leave Types</h3>
            <FaUmbrella className="text-primary-500" />
          </div>
          <div className="text-3xl font-bold text-gray-800">{leaveTypes.length}</div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-gray-600">Paid Leaves</h3>
            <FaUmbrella className="text-green-500" />
          </div>
          <div className="text-3xl font-bold text-gray-800">
            {leaveTypes.filter(t => t.isPaid).length}
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-gray-600">Total Days</h3>
            <FaUmbrella className="text-blue-500" />
          </div>
          <div className="text-3xl font-bold text-gray-800">
            {leaveTypes.reduce((sum, t) => sum + (t.maxDaysPerYear || 0), 0)}
          </div>
        </div>
      </div>

      {/* Leave Types Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading ? (
          <div className="col-span-full bg-white rounded-lg shadow-md p-8 text-center">
            <Loader size="lg" className="mx-auto" />
            <p className="mt-4 text-gray-600">Loading leave types...</p>
          </div>
        ) : leaveTypes.length === 0 ? (
          <div className="col-span-full bg-white rounded-lg shadow-md p-8 text-center text-gray-500">
            No leave types found
          </div>
        ) : (
          leaveTypes.map((type) => (
            <div
              key={type._id}
              className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center space-x-3">
                  <div className="bg-primary-100 p-3 rounded-lg">
                    <FaUmbrella className="text-primary-500 text-xl" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-gray-800">{type.name}</h3>
                    {type.code && (
                      <p className="text-sm text-gray-500">{type.code}</p>
                    )}
                  </div>
                </div>
                <div className="flex space-x-2">
                  <button
                    onClick={() => handleEdit(type)}
                    className="text-blue-600 hover:text-blue-800"
                  >
                    <FaEdit />
                  </button>
                  <button
                    onClick={() => handleDelete(type._id)}
                    className="text-red-600 hover:text-red-800"
                  >
                    <FaTrash />
                  </button>
                </div>
              </div>

              {type.description && (
                <p className="text-gray-600 text-sm mb-4">{type.description}</p>
              )}

              <div className="space-y-2 pt-4 border-t border-gray-200">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Max Days Per Year:</span>
                  <span className="font-semibold text-gray-800">{type.maxDaysPerYear || 0}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Type:</span>
                  <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                    type.isPaid ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                  }`}>
                    {type.isPaid ? 'Paid' : 'Unpaid'}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Approval:</span>
                  <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                    type.requiresApproval ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'
                  }`}>
                    {type.requiresApproval ? 'Required' : 'Not Required'}
                  </span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center style={{ zIndex: 99999 }}">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-2xl font-bold text-gray-800 mb-4">
              {editingType ? 'Edit Leave Type' : 'Add Leave Type'}
            </h2>
            <form onSubmit={handleSubmit}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Leave Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    placeholder="e.g., Casual Leave"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Code
                  </label>
                  <input
                    type="text"
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    placeholder="e.g., CL"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Max Days Per Year *
                  </label>
                  <input
                    type="number"
                    required
                    min="0"
                    value={formData.maxDaysPerYear}
                    onChange={(e) => setFormData({ ...formData, maxDaysPerYear: parseInt(e.target.value) })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    placeholder="0"
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
                    placeholder="Leave type description"
                  />
                </div>

                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="isPaid"
                    checked={formData.isPaid}
                    onChange={(e) => setFormData({ ...formData, isPaid: e.target.checked })}
                    className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                  />
                  <label htmlFor="isPaid" className="text-sm font-medium text-gray-700">
                    Paid Leave
                  </label>
                </div>

                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="requiresApproval"
                    checked={formData.requiresApproval}
                    onChange={(e) => setFormData({ ...formData, requiresApproval: e.target.checked })}
                    className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                  />
                  <label htmlFor="requiresApproval" className="text-sm font-medium text-gray-700">
                    Requires Approval
                  </label>
                </div>
              </div>

              <div className="flex justify-end space-x-4 mt-6">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="btn-secondary"
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary">
                  {editingType ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

