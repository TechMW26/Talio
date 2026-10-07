'use client'
import { DialogSurface } from '@/components/ui/fernly'
import { NativeTable } from '@/components/ui/fernly'
import { SummaryCard, Surface } from '@/components/ui/fernly'


import { Heading1, Heading3, Heading2, NativeButton, NativeInput, NativeTextarea } from '@/components/ui/fernly/native'
import { useEffect, useState } from 'react'
import { Button, Skeleton } from '@/components/ui/fernly'
import toast from '@/utils/toast'
import { useSocket, REALTIME_EVENTS } from '@/contexts/SocketContext'
import { FaPlus, FaEdit, FaTrash, FaBriefcase } from 'react-icons/fa'
import ModalPortal from '@/components/ui/ModalPortal'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import useApiMutation from '@/hooks/useApiMutation'
import LoadingButton from '@/components/ui/LoadingButton'
import { DataErrorState } from '@/components/ui/ErrorBoundary'
import BackgroundRefreshIndicator from '@/components/ui/BackgroundRefreshIndicator'

export default function DesignationsPage() {
  const [showModal, setShowModal] = useState(false)
  const [editingDesig, setEditingDesig] = useState(null)
  const [formData, setFormData] = useState({
    title: '',
    description: '',
  })

  // --- SWR data fetching ---
  const { data: desigRes, error, isLoading, isValidating, mutate: refreshDesignations } = useAuthedSWR('/api/designations')
  const designations = desigRes?.data || []

  // Real-time updates
  const { socket, isConnected, subscribe } = useSocket()

  useEffect(() => {
    if (!socket || !isConnected) return
    const handleDesignationUpdate = () => refreshDesignations()
    const unsub = subscribe?.('designation-updated', handleDesignationUpdate)
    return () => unsub?.()
  }, [socket, isConnected, subscribe, refreshDesignations])

  // --- Submit mutation (create/edit) ---
  const submitMutation = useApiMutation({
    invalidateKeys: ['/api/designations'],
    onSuccess: (data) => {
      toast.success(data.message || 'Designation saved successfully')
      handleCloseModal()
    },
    onError: (msg) => toast.error(msg || 'Failed to save designation'),
  })

  // --- Delete mutation ---
  const deleteMutation = useApiMutation({
    method: 'DELETE',
    invalidateKeys: ['/api/designations'],
    onSuccess: (data) => toast.success(data.message || 'Designation deleted'),
    onError: (msg) => toast.error(msg || 'Failed to delete designation'),
  })

  const handleSubmit = (e) => {
    e.preventDefault()
    const url = editingDesig ? `/api/designations/${editingDesig._id}` : '/api/designations'
    const method = editingDesig ? 'PUT' : 'POST'
    submitMutation.execute(url, formData, { method })
  }

  const handleEdit = (desig) => {
    setEditingDesig(desig)
    setFormData({
      title: desig.title,
      description: desig.description || '',
    })
    setShowModal(true)
  }

  const handleDelete = (id) => {
    if (!confirm('Are you sure you want to delete this designation?')) return
    deleteMutation.execute(`/api/designations/${id}`)
  }

  const handleCloseModal = () => {
    setShowModal(false)
    setEditingDesig(null)
    setFormData({ title: '', description: '' })
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex md:justify-between md:items-center md:flex-row flex-col mb-6">
        <div>
          <Heading1 className="text-3xl font-bold text-gray-800">Designations</Heading1>
          <p className="text-gray-600 mt-1 flex items-center gap-2">
            Manage job designations and roles
            <BackgroundRefreshIndicator isValidating={isValidating && !isLoading} position="inline" />
          </p>
        </div>
        <Button
          onPress={() => setShowModal(true)}
          color="primary"
          startContent={<FaPlus />}
        >
          Add Designation
        </Button>
      </div>

      {/* Stats Card */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4 mb-4 sm:mb-6">
        <SummaryCard  label={<>Total Designations</>} value={<>{designations.length}</>} />



        <SummaryCard  label={<>Active Roles</>} value={<>{designations.filter(d => d.isActive !== false).length}</>} />
      </div>

      {/* Designations Table */}
      <Surface className="bg-white rounded-lg shadow-md overflow-hidden">

        {error ? (
          <div className="p-8">
            <DataErrorState message="Failed to load designations" onRetry={() => refreshDesignations()} />
          </div>
        ) : isLoading ? (
          <div className="p-4 space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex items-center gap-4 py-3 px-6">
                <Skeleton className="w-10 h-10 rounded-lg" />
                <Skeleton className="h-4 w-1/4 rounded-lg" />
                <Skeleton className="h-4 w-1/3 rounded-lg" />
              </div>
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <NativeTable className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Title
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Description
                  </th>
<th data-sticky-actions="true" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {designations.length === 0 ? (
                  <tr>
                    <td colSpan="3" className="px-6 py-4 text-center text-gray-500">
                      No designations found
                    </td>
                  </tr>
                ) : (
                  designations.map((desig) => (
                    <tr key={desig._id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className="bg-primary-100 p-2 rounded-lg mr-3">
                            <FaBriefcase className="text-primary-500" />
                          </div>
                          <div className="text-sm font-medium text-gray-900">
                            {desig.title}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900 max-w-xs truncate">
                        {desig.description || 'No description'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <NativeButton
                          onClick={() => handleEdit(desig)}
                          className="text-blue-600 hover:text-blue-900 mr-4"
                        >
                          <FaEdit />
                        </NativeButton>
                        <NativeButton
                          onClick={() => handleDelete(desig._id)}
                          className="text-red-600 hover:text-red-900"
                        >
                          <FaTrash />
                        </NativeButton>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </NativeTable>
          </div>
        )}
      </Surface>

      {/* Add/Edit Modal */}
      <ModalPortal isOpen={showModal}>
        <div className="modal-overlay">
          <DialogSurface className="bg-white rounded-[30px] animate-modal-enter p-6 w-full max-w-md">
            <Heading2 className="text-2xl font-bold text-gray-800 mb-4">
              {editingDesig ? 'Edit Designation' : 'Add Designation'}
            </Heading2>
            <form onSubmit={handleSubmit}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Title *
                  </label>
                  <NativeInput
                    type="text"
                    required
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    placeholder="e.g., Software Engineer"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Description
                  </label>
                  <NativeTextarea
                    rows="3"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    placeholder="Role description"
                  />
                </div>
              </div>

              <div className="flex justify-end space-x-4 mt-6">
                <Button
                  type="button"
                  onPress={handleCloseModal}
                  variant="flat"
                >
                  Cancel
                </Button>
                <LoadingButton
                  type="submit"
                  color="primary"
                  isLoading={submitMutation.isLoading}
                  loadingText={editingDesig ? 'Updating...' : 'Creating...'}
                >
                  {editingDesig ? 'Update' : 'Create'}
                </LoadingButton>
              </div>
            </form>
          </DialogSurface>
        </div>
      </ModalPortal>
    </div>
  )
}

