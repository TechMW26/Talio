'use client'

import { useState, useEffect, useMemo } from 'react'
import toast from '@/utils/toast'
import { useSocket, REALTIME_EVENTS } from '@/contexts/SocketContext'
import { FaPlus, FaFileAlt, FaEdit, FaTrash, FaCheckCircle, FaExclamationCircle } from 'react-icons/fa'
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button, Input, Select, SelectItem, Textarea, Checkbox, Skeleton } from '@heroui/react'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import useApiMutation from '@/hooks/useApiMutation'
import LoadingButton from '@/components/ui/LoadingButton'
import { DataErrorState } from '@/components/ui/ErrorBoundary'
import BackgroundRefreshIndicator from '@/components/ui/BackgroundRefreshIndicator'

// --- Skeleton Loader for Policies page ---
function PoliciesSkeleton() {
  return (
    <div className="p-6 animate-in fade-in duration-300">
      {/* Header skeleton */}
      <div className="flex md:justify-between md:items-center md:flex-row flex-col mb-6">
        <div>
          <Skeleton className="h-8 w-48 rounded-lg mb-2" />
          <Skeleton className="h-4 w-64 rounded-lg" />
        </div>
        <Skeleton className="h-10 w-32 rounded-lg" />
      </div>

      {/* Stats skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="bg-white rounded-lg shadow-md p-6">
            <Skeleton className="h-3 w-24 rounded mb-3" />
            <Skeleton className="h-8 w-12 rounded" />
          </div>
        ))}
      </div>

      {/* Policy cards skeleton */}
      <div className="space-y-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="bg-white rounded-lg shadow-md p-6">
            <div className="flex items-center space-x-3 mb-3">
              <Skeleton className="h-5 w-5 rounded" />
              <Skeleton className="h-6 w-48 rounded-lg" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
            <Skeleton className="h-4 w-full rounded mb-2" />
            <Skeleton className="h-4 w-3/4 rounded mb-4" />
            <div className="flex space-x-4">
              <Skeleton className="h-3 w-32 rounded" />
              <Skeleton className="h-3 w-24 rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function PoliciesPage() {
  const [showModal, setShowModal] = useState(false)
  const [editingPolicy, setEditingPolicy] = useState(null)
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

  const resetForm = () => {
    setFormData({ title: '', code: '', category: '', content: '', description: '', effectiveDate: '', requiresAcknowledgment: true, applicableTo: 'all' })
  }

  // Real-time updates
  const { socket, isConnected, subscribe } = useSocket()

  // --- Memoized current user ---
  const currentUser = useMemo(() => { try { return JSON.parse(localStorage.getItem('user')) } catch { return null } }, [])

  // --- SWR Data Fetching (replaces raw useEffect+fetch) ---
  const { data: policiesRes, error, isLoading, isValidating, mutate: refreshPolicies } = useAuthedSWR('/api/policies')
  const policies = policiesRes?.data || []

  // --- Pending acknowledgments (replaces checkPendingAcknowledgments + useEffect) ---
  const pendingPolicies = useMemo(() => {
    if (!currentUser || !policies.length) return []
    const employeeId = currentUser.employeeId || currentUser._id
    return policies.filter(policy => {
      if (!policy.requiresAcknowledgment) return false
      if (policy.status !== 'active' && policy.status !== 'draft') return false
      return !policy.acknowledgments?.some(ack => ack.employee === employeeId || ack.employee?._id === employeeId)
    })
  }, [currentUser, policies])

  // Auto-show ack modal when pending policies exist
  const showAckModalAuto = useMemo(() => pendingPolicies.length > 0, [pendingPolicies])

  // --- Mutations with loading states ---
  const submitMutation = useApiMutation({
    invalidateKeys: ['/api/policies'],
    onSuccess: () => { toast.success(editingPolicy ? 'Policy updated' : 'Policy created'); setShowModal(false); setEditingPolicy(null); resetForm() },
    onError: (msg) => toast.error(msg || 'Failed to save policy'),
  })

  const deleteMutation = useApiMutation({
    method: 'DELETE',
    invalidateKeys: ['/api/policies'],
    onSuccess: (data) => toast.success(data.message || 'Policy deleted'),
    onError: (msg) => toast.error(msg || 'Failed to delete policy'),
  })

  const acknowledgeMutation = useApiMutation({
    invalidateKeys: ['/api/policies'],
    onSuccess: () => toast.success('Policy acknowledged'),
    onError: (msg) => toast.error(msg || 'Failed to acknowledge policy'),
  })

  // Subscribe to real-time policy updates
  useEffect(() => {
    if (!socket || !isConnected) return

    const handlePolicyUpdate = (data) => {
      console.log('🔄 [Policies] Real-time update received:', data)
      refreshPolicies()
    }

    const unsub = subscribe?.(REALTIME_EVENTS.POLICY_UPDATE, handlePolicyUpdate)

    return () => {
      unsub?.()
    }
  }, [socket, isConnected])

  const handleSubmit = async (e) => {
    e.preventDefault()

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

    await submitMutation.execute(url, dataToSend, { method })
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
    await deleteMutation.execute(`/api/policies/${id}`, null, { method: 'DELETE' })
  }

  const handleAcknowledge = async (policyId) => {
    const employeeId = currentUser.employeeId || currentUser._id
    await acknowledgeMutation.execute(`/api/policies/${policyId}/acknowledge`, { employeeId })
  }

  // --- Loading & Error states ---
  if (isLoading) return <PoliciesSkeleton />
  if (error) return <DataErrorState error={error} onRetry={() => refreshPolicies()} title="Failed to load policies" />

  return (
    <div className="p-6">
      {/* Background refresh indicator */}
      <BackgroundRefreshIndicator isValidating={isValidating} />

      {/* Header */}
      <div className="flex md:justify-between md:items-center md:flex-row flex-col mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">Company Policies</h1>
          <p className="text-gray-600 mt-1">View and manage company policies</p>
        </div>
        {currentUser?.role === 'admin' && (
          <Button
            onPress={() => setShowModal(true)}
            color="primary"
            startContent={<FaPlus />}
          >
            Add Policy
          </Button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center justify-start mb-2">
            <h3 className="text-sm font-medium text-gray-600">Total Policies</h3>
            <FaFileAlt className="text-primary-500" />
          </div>
          <div className="text-3xl font-bold text-gray-800">{policies.length}</div>
        </div>

        {['HR', 'IT', 'Finance', 'General'].map((cat) => (
          <div key={cat} className="bg-white rounded-lg shadow-md p-6">
            <div className="flex items-center justify-start mb-2">
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
        {policies.length === 0 ? (
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
      <Modal isOpen={showModal} onOpenChange={setShowModal} size="2xl">
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>
                {editingPolicy ? 'Edit Policy' : 'Add Policy'}
              </ModalHeader>
              <form onSubmit={handleSubmit}>
                <ModalBody className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <Input
                      type="text"
                      isRequired
                      label="Policy Title"
                      value={formData.title}
                      onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                      placeholder="e.g., Work From Home Policy"
                    />
                    <Input
                      type="text"
                      label="Policy Code"
                      value={formData.code}
                      onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                      placeholder="Auto-generated if empty"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <Select
                      isRequired
                      label="Category"
                      selectedKeys={formData.category ? [formData.category] : []}
                      onSelectionChange={(keys) => setFormData({ ...formData, category: Array.from(keys)[0] || '' })}
                      placeholder="Select Category"
                    >
                      <SelectItem key="hr">HR</SelectItem>
                      <SelectItem key="it">IT</SelectItem>
                      <SelectItem key="finance">Finance</SelectItem>
                      <SelectItem key="general">General</SelectItem>
                      <SelectItem key="security">Security</SelectItem>
                      <SelectItem key="compliance">Compliance</SelectItem>
                      <SelectItem key="code-of-conduct">Code of Conduct</SelectItem>
                    </Select>
                    <Input
                      type="date"
                      isRequired
                      label="Effective Date"
                      value={formData.effectiveDate}
                      onChange={(e) => setFormData({ ...formData, effectiveDate: e.target.value })}
                    />
                  </div>

                  <Textarea
                    label="Description"
                    minRows={2}
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Brief summary of the policy"
                  />

                  <Textarea
                    label="Policy Content"
                    isRequired
                    minRows={8}
                    value={formData.content}
                    onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                    placeholder="Full policy content..."
                  />

                  <Checkbox
                    isSelected={formData.requiresAcknowledgment}
                    onValueChange={(checked) => setFormData({ ...formData, requiresAcknowledgment: checked })}
                  >
                    Requires Employee Acknowledgment
                  </Checkbox>
                </ModalBody>

                <ModalFooter>
                  <Button
                    variant="light"
                    onPress={() => {
                      onClose()
                      setEditingPolicy(null)
                      resetForm()
                    }}
                  >
                    Cancel
                  </Button>
                  <LoadingButton
                    color="primary"
                    type="submit"
                    isLoading={submitMutation.isLoading}
                    loadingText={editingPolicy ? 'Updating...' : 'Creating...'}
                  >
                    {editingPolicy ? 'Update' : 'Create'}
                  </LoadingButton>
                </ModalFooter>
              </form>
            </>
          )}
        </ModalContent>
      </Modal>

      {/* Acknowledgment Modal */}
      <Modal isOpen={showAckModal || showAckModalAuto} onOpenChange={setShowAckModal} size="2xl" isDismissable={pendingPolicies.length === 0}>
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex items-center gap-2">
                <FaExclamationCircle className="text-yellow-500" />
                Pending Acknowledgments
              </ModalHeader>
              <ModalBody>
                <p className="text-default-600 mb-6">
                  Please review and acknowledge the following policies to continue.
                </p>

                <div className="space-y-6">
                  {pendingPolicies.map((policy) => (
                    <div key={policy._id} className="border border-default-200 rounded-lg p-4">
                      <h3 className="text-lg font-bold text-default-800 mb-2">{policy.title}</h3>
                      <p className="text-sm text-default-500 mb-2">Effective: {new Date(policy.effectiveDate).toLocaleDateString()}</p>
                      <div className="bg-default-50 p-4 rounded text-sm text-default-700 mb-4 max-h-40 overflow-y-auto whitespace-pre-wrap">
                        {policy.content}
                      </div>
                      <div className="flex justify-end">
                        <LoadingButton
                          color="primary"
                          onPress={() => handleAcknowledge(policy._id)}
                          startContent={<FaCheckCircle />}
                          isLoading={acknowledgeMutation.isLoading}
                          loadingText="Acknowledging..."
                        >
                          I Acknowledge & Accept
                        </LoadingButton>
                      </div>
                    </div>
                  ))}
                </div>

                {pendingPolicies.length === 0 && (
                  <div className="text-center py-4">
                    <p className="text-success font-medium">All policies acknowledged!</p>
                    <Button
                      onPress={onClose}
                      className="mt-4"
                      variant="light"
                    >
                      Close
                    </Button>
                  </div>
                )}
              </ModalBody>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  )
}