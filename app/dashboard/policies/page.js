'use client'

import { useState, useEffect } from 'react'
import toast from '@/utils/toast'
import { useSocket, REALTIME_EVENTS } from '@/contexts/SocketContext'
import { FaPlus, FaFileAlt, FaEdit, FaTrash, FaCheckCircle, FaExclamationCircle } from 'react-icons/fa'
import ModalPortal from '@/components/ModalPortal'
import Loader from '@/components/ui/Loader'

export default function PoliciesPage() {
  const [policies, setPolicies] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingPolicy, setEditingPolicy] = useState(null)
  const [currentUser, setCurrentUser] = useState(null)
  const [pendingPolicies, setPendingPolicies] = useState([])
  const [showAckModal, setShowAckModal] = useState(false)
  
  const [formData, setFormData] = useState({
    title: '',
    code: '',
    category: '',
    content: '',
    description: '',
    effectiveDate: '',
    requiresAcknowledgment: true,
    applicableTo: 'all'
  })

  // Real-time updates
  const { socket, isConnected, subscribe } = useSocket()

  useEffect(() => {
    const userData = localStorage.getItem('user')
    if (userData) {
      const user = JSON.parse(userData)
      setCurrentUser(user)
    }
    fetchPolicies()
  }, [])

  // Subscribe to real-time policy updates
  useEffect(() => {
    if (!socket || !isConnected) return

    const handlePolicyUpdate = (data) => {
      console.log('🔄 [Policies] Real-time update received:', data)
      fetchPolicies()
    }

    const unsub = subscribe?.(REALTIME_EVENTS.POLICY_UPDATE, handlePolicyUpdate)

    return () => {
      unsub?.()
    }
  }, [socket, isConnected])

  useEffect(() => {
    if (currentUser && policies.length > 0) {
      checkPendingAcknowledgments()
    }
  }, [currentUser, policies])

  const checkPendingAcknowledgments = () => {
    // If user is admin, they might not need to acknowledge, but let's assume everyone does if applicable
    // We need the employeeId. If the user object has it, great.
    const employeeId = currentUser.employeeId || currentUser._id // Fallback, might need adjustment based on User model

    const pending = policies.filter(policy => {
      if (!policy.requiresAcknowledgment) return false
      if (policy.status !== 'active' && policy.status !== 'draft') return false // Only active policies usually
      
      // Check if already acknowledged
      const hasAcknowledged = policy.acknowledgments?.some(
        ack => ack.employee === employeeId || ack.employee?._id === employeeId
      )
      
      return !hasAcknowledged
    })

    setPendingPolicies(pending)
    if (pending.length > 0) {
      setShowAckModal(true)
    }
  }

  const fetchPolicies = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/policies', {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      const data = await response.json()
      if (data.success) {
        setPolicies(data.data)
      }
    } catch (error) {
      console.error('Fetch policies error:', error)
      toast.error('Failed to fetch policies')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    try {
      const token = localStorage.getItem('token')
      const url = editingPolicy ? `/api/policies/${editingPolicy._id}` : '/api/policies'
      const method = editingPolicy ? 'PUT' : 'POST'

      // Auto-generate code if missing
      const dataToSend = { ...formData }
      if (!dataToSend.code) {
        dataToSend.code = `POL-${Date.now().toString().slice(-6)}`
      }
      
      // Add createdBy if new
      if (!editingPolicy && currentUser) {
        dataToSend.createdBy = currentUser.employeeId || currentUser._id
      }

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(dataToSend),
      })

      const data = await response.json()

      if (data.success) {
        toast.success(data.message)
        setShowModal(false)
        setEditingPolicy(null)
        setFormData({ 
          title: '', 
          code: '', 
          category: '', 
          content: '', 
          description: '', 
          effectiveDate: '',
          requiresAcknowledgment: true,
          applicableTo: 'all'
        })
        fetchPolicies()
      } else {
        toast.error(data.message)
      }
    } catch (error) {
      console.error('Submit error:', error)
      toast.error('Failed to save policy')
    }
  }

  const handleEdit = (policy) => {
    setEditingPolicy(policy)
    setFormData({
      title: policy.title,
      code: policy.code || '',
      category: policy.category || '',
      content: policy.content || '',
      description: policy.description || '',
      effectiveDate: policy.effectiveDate
        ? new Date(policy.effectiveDate).toISOString().split('T')[0]
        : '',
      requiresAcknowledgment: policy.requiresAcknowledgment ?? true,
      applicableTo: policy.applicableTo || 'all'
    })
    setShowModal(true)
  }

  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to delete this policy?')) return

    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/policies/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      })

      const data = await response.json()

      if (data.success) {
        toast.success(data.message)
        fetchPolicies()
      } else {
        toast.error(data.message)
      }
    } catch (error) {
      console.error('Delete error:', error)
      toast.error('Failed to delete policy')
    }
  }

  const handleAcknowledge = async (policyId) => {
    try {
      const token = localStorage.getItem('token')
      const employeeId = currentUser.employeeId || currentUser._id

      const response = await fetch(`/api/policies/${policyId}/acknowledge`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ employeeId }),
      })

      const data = await response.json()

      if (data.success) {
        toast.success('Policy acknowledged')
        // Remove from pending list
        const updatedPending = pendingPolicies.filter(p => p._id !== policyId)
        setPendingPolicies(updatedPending)
        if (updatedPending.length === 0) {
          setShowAckModal(false)
        }
        fetchPolicies() // Refresh list to show updated status
      } else {
        toast.error(data.message)
      }
    } catch (error) {
      console.error('Acknowledge error:', error)
      toast.error('Failed to acknowledge policy')
    }
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex md:justify-between md:items-center md:flex-row flex-col mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">Company Policies</h1>
          <p className="text-gray-600 mt-1">View and manage company policies</p>
        </div>
        {currentUser?.role === 'admin' && (
          <button
            onClick={() => setShowModal(true)}
            className="btn-primary flex items-center space-x-2"
          >
            <FaPlus />
            <span>Add Policy</span>
          </button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-gray-600">Total Policies</h3>
            <FaFileAlt className="text-primary-500" />
          </div>
          <div className="text-3xl font-bold text-gray-800">{policies.length}</div>
        </div>

        {['HR', 'IT', 'Finance', 'General'].map((cat) => (
          <div key={cat} className="bg-white rounded-lg shadow-md p-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-gray-600">{cat} Policies</h3>
              <FaFileAlt className="text-blue-500" />
            </div>
            <div className="text-3xl font-bold text-gray-800">
              {policies.filter((p) => p.category === cat.toLowerCase()).length}
            </div>
          </div>
        ))}
      </div>

      {/* Policies List */}
      <div className="space-y-4">
        {loading ? (
          <div className="bg-white rounded-lg shadow-md p-8 text-center">
            <Loader size="lg" className="mx-auto" />
            <p className="mt-4 text-gray-600">Loading policies...</p>
          </div>
        ) : policies.length === 0 ? (
          <div className="bg-white rounded-lg shadow-md p-8 text-center text-gray-500">
            No policies found
          </div>
        ) : (
          policies.map((policy) => (
            <div
              key={policy._id}
              className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center space-x-3 mb-2">
                    <FaFileAlt className="text-primary-500 text-xl" />
                    <h3 className="text-xl font-bold text-gray-800">{policy.title}</h3>
                    {policy.category && (
                      <span className="px-3 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800">
                        {policy.category}
                      </span>
                    )}
                    {policy.requiresAcknowledgment && (
                      <span className="px-3 py-1 text-xs font-semibold rounded-full bg-yellow-100 text-yellow-800 flex items-center">
                        <FaExclamationCircle className="mr-1" /> Requires Ack.
                      </span>
                    )}
                  </div>

                  <p className="text-gray-600 mb-2 font-medium">{policy.description}</p>
                  <p className="text-gray-500 mb-4 whitespace-pre-wrap text-sm">
                    {policy.content.substring(0, 200)}...
                  </p>

                  <div className="flex items-center space-x-4 text-sm text-gray-500">
                    {policy.effectiveDate && (
                      <span>
                        Effective: {new Date(policy.effectiveDate).toLocaleDateString()}
                      </span>
                    )}
                    {policy.code && (
                      <span>Code: {policy.code}</span>
                    )}
                  </div>
                </div>

                <div className="flex space-x-2 ml-4">
                  {currentUser?.role === 'admin' && (
                    <>
                      <button
                        onClick={() => handleEdit(policy)}
                        className="text-blue-600 hover:text-blue-800 p-2"
                      >
                        <FaEdit size={18} />
                      </button>
                      <button
                        onClick={() => handleDelete(policy._id)}
                        className="text-red-600 hover:text-red-800 p-2"
                      >
                        <FaTrash size={18} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Add/Edit Modal */}
      <ModalPortal show={showModal}>
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center" style={{ zIndex: 99999 }}>
          <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <h2 className="text-2xl font-bold text-gray-800 mb-4">
              {editingPolicy ? 'Edit Policy' : 'Add Policy'}
            </h2>
            <form onSubmit={handleSubmit}>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Policy Title *
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.title}
                      onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      placeholder="e.g., Work From Home Policy"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Policy Code
                    </label>
                    <input
                      type="text"
                      value={formData.code}
                      onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      placeholder="Auto-generated if empty"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Category *
                    </label>
                    <select
                      required
                      value={formData.category}
                      onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    >
                      <option value="">Select Category</option>
                      <option value="hr">HR</option>
                      <option value="it">IT</option>
                      <option value="finance">Finance</option>
                      <option value="general">General</option>
                      <option value="security">Security</option>
                      <option value="compliance">Compliance</option>
                      <option value="code-of-conduct">Code of Conduct</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Effective Date *
                    </label>
                    <input
                      type="date"
                      required
                      value={formData.effectiveDate}
                      onChange={(e) =>
                        setFormData({ ...formData, effectiveDate: e.target.value })
                      }
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Description
                  </label>
                  <textarea
                    rows="2"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    placeholder="Brief summary of the policy"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Policy Content *
                  </label>
                  <textarea
                    rows="8"
                    required
                    value={formData.content}
                    onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    placeholder="Full policy content..."
                  />
                </div>

                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="requiresAcknowledgment"
                    checked={formData.requiresAcknowledgment}
                    onChange={(e) => setFormData({ ...formData, requiresAcknowledgment: e.target.checked })}
                    className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                  />
                  <label htmlFor="requiresAcknowledgment" className="text-sm text-gray-700">
                    Requires Employee Acknowledgment
                  </label>
                </div>
              </div>

              <div className="flex justify-end space-x-4 mt-6">
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false)
                    setEditingPolicy(null)
                    setFormData({ 
                      title: '', 
                      code: '', 
                      category: '', 
                      content: '', 
                      description: '', 
                      effectiveDate: '',
                      requiresAcknowledgment: true,
                      applicableTo: 'all'
                    })
                  }}
                  className="btn-secondary"
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary">
                  {editingPolicy ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </ModalPortal>

      {/* Acknowledgment Modal */}
      <ModalPortal show={showAckModal}>
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center" style={{ zIndex: 99999 }}>
          <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-bold text-gray-800 flex items-center">
                <FaExclamationCircle className="text-yellow-500 mr-2" />
                Pending Acknowledgments
              </h2>
            </div>
            
            <p className="text-gray-600 mb-6">
              Please review and acknowledge the following policies to continue.
            </p>

            <div className="space-y-6">
              {pendingPolicies.map((policy) => (
                <div key={policy._id} className="border border-gray-200 rounded-lg p-4">
                  <h3 className="text-lg font-bold text-gray-800 mb-2">{policy.title}</h3>
                  <p className="text-sm text-gray-500 mb-2">Effective: {new Date(policy.effectiveDate).toLocaleDateString()}</p>
                  <div className="bg-gray-50 p-4 rounded text-sm text-gray-700 mb-4 max-h-40 overflow-y-auto whitespace-pre-wrap">
                    {policy.content}
                  </div>
                  <div className="flex justify-end">
                    <button
                      onClick={() => handleAcknowledge(policy._id)}
                      className="btn-primary flex items-center space-x-2"
                    >
                      <FaCheckCircle />
                      <span>I Acknowledge & Accept</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {pendingPolicies.length === 0 && (
              <div className="text-center py-4">
                <p className="text-green-600 font-medium">All policies acknowledged!</p>
                <button 
                  onClick={() => setShowAckModal(false)}
                  className="mt-4 btn-secondary"
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      </ModalPortal>
    </div>
  )
}


