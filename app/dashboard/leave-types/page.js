'use client'

import { useState, useMemo } from 'react'
import toast from '@/utils/toast'
import { FaPlus, FaEdit, FaTrash, FaUmbrella } from 'react-icons/fa'
import { Card, CardBody, Button, Chip, Skeleton, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Input, Textarea, Switch } from '@heroui/react'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import useApiMutation from '@/hooks/useApiMutation'
import LoadingButton from '@/components/ui/LoadingButton'
import { DataErrorState } from '@/components/ui/ErrorBoundary'
import BackgroundRefreshIndicator from '@/components/ui/BackgroundRefreshIndicator'

export default function LeaveTypesPage() {
  const [showModal, setShowModal] = useState(false)
  const [editingType, setEditingType] = useState(null)
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    maxDaysPerYear: 0,
    description: '',
    isPaid: true,
    requiresApproval: true,
  })

  const user = useMemo(() => {
    if (typeof window === 'undefined') return null
    try {
      const parsedUser = JSON.parse(localStorage.getItem('user'))
      if (parsedUser && !['hr', 'admin'].includes(parsedUser.role)) {
        toast.error('Access denied. Only HR and Admin can manage leave types.')
        window.location.href = '/dashboard'
        return null
      }
      return parsedUser
    } catch { return null }
  }, [])

  // --- SWR data fetching ---
  const { data: leaveTypesRes, error, isLoading, isValidating, mutate: refreshLeaveTypes } = useAuthedSWR(
    user ? '/api/leave/types' : null
  )
  const leaveTypes = leaveTypesRes?.data || []

  // --- Submit mutation ---
  const submitMutation = useApiMutation({
    invalidateKeys: ['/api/leave/types'],
    onSuccess: (data) => {
      toast.success(data.message || 'Leave type saved')
      handleCloseModal()
    },
    onError: (msg) => toast.error(msg || 'Failed to save leave type'),
  })

  // --- Delete mutation ---
  const deleteMutation = useApiMutation({
    method: 'DELETE',
    invalidateKeys: ['/api/leave/types'],
    onSuccess: (data) => toast.success(data.message || 'Leave type deleted'),
    onError: (msg) => toast.error(msg || 'Failed to delete leave type'),
  })

  const handleSubmit = (e) => {
    e.preventDefault()
    const url = editingType ? `/api/leave/types/${editingType._id}` : '/api/leave/types'
    const method = editingType ? 'PUT' : 'POST'
    submitMutation.execute(url, formData, { method })
  }
  setEditingType(null)
  setFormData({
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

  const handleDelete = (id) => {
      if (!confirm('Are you sure you want to delete this leave type?')) return
      deleteMutation.execute(`/api/leave/types/${id}`)
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

  return(
    <div className = "page-container space-y-4 sm:space-y-6" >
        {/* Header */ }
        < div className = "flex flex-col sm:flex-row sm:justify-between sm:items-center space-y-3 sm:space-y-0" >
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-default-900">Leave Types</h1>
          <p className="text-default-500 mt-1 text-sm sm:text-base flex items-center gap-2">
            Configure different types of leaves
            <BackgroundRefreshIndicator isValidating={isValidating && !isLoading} position="inline" />
          </p>
        </div>
        <Button
          color="primary"
          startContent={<FaPlus className="w-4 h-4" />}
          onPress={() => setShowModal(true)}
          className="w-full sm:w-auto"
        >
          Add Leave Type
        </Button>
      </div>

    {/* Stats Card */ }
    < div className = "grid grid-cols-1 md:grid-cols-3 gap-4 mb-6" >
        <Card shadow="sm">
          <CardBody className="flex flex-row items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-default-500">Total Leave Types</h3>
              <div className="text-3xl font-bold text-default-900 mt-1">{leaveTypes.length}</div>
            </div>
            <div className="bg-primary-100 p-3 rounded-xl">
              <FaUmbrella className="text-primary-500 h-6 w-6" />
            </div>
          </CardBody>
        </Card>

        <Card shadow="sm">
          <CardBody className="flex flex-row items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-default-500">Paid Leaves</h3>
              <div className="text-3xl font-bold text-success-600 mt-1">
                {leaveTypes.filter(t => t.isPaid).length}
              </div>
            </div>
            <div className="bg-success-100 p-3 rounded-xl">
              <FaUmbrella className="text-success-500 h-6 w-6" />
            </div>
          </CardBody>
        </Card>

        <Card shadow="sm">
          <CardBody className="flex flex-row items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-default-500">Total Days</h3>
              <div className="text-3xl font-bold text-primary-600 mt-1">
                {leaveTypes.reduce((sum, t) => sum + (t.maxDaysPerYear || 0), 0)}
              </div>
            </div>
            <div className="bg-primary-100 p-3 rounded-xl">
              <FaUmbrella className="text-primary-500 h-6 w-6" />
            </div>
          </CardBody>
        </Card>
      </div >

    {/* Leave Types Grid */ }
    < div className = "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" >
    {
      error?(
          <div className = "col-span-full" >
          <DataErrorState message="Failed to load leave types" onRetry={() => refreshLeaveTypes()} />
          </div>
        ) : isLoading ? (
    <>
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <Card key={i} shadow="sm">
          <CardBody className="space-y-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center space-x-3">
                <Skeleton className="w-12 h-12 rounded-lg" />
                <div className="space-y-2">
                  <Skeleton className="h-5 w-32 rounded-lg" />
                  <Skeleton className="h-4 w-16 rounded-lg" />
                </div>
              </div>
            </div>
            <Skeleton className="h-12 w-full rounded-lg" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-full rounded-lg" />
              <Skeleton className="h-4 w-full rounded-lg" />
              <Skeleton className="h-4 w-full rounded-lg" />
            </div>
          </CardBody>
        </Card>
      ))}
    </>
  ) : leaveTypes.length === 0 ? (
    <div className="col-span-full">
      <Card shadow="sm">
        <CardBody className="py-12 text-center">
          <div className="w-16 h-16 bg-default-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <FaUmbrella className="text-default-300 h-8 w-8" />
          </div>
          <p className="text-default-500">No leave types found</p>
          <Button
            color="primary"
            variant="flat"
            startContent={<FaPlus />}
            onPress={() => setShowModal(true)}
            className="mt-4"
          >
            Add First Leave Type
          </Button>
        </CardBody>
      </Card>
    </div>
  ) : (
    leaveTypes.map((type) => (
      <Card
        key={type._id}
        shadow="sm"
        className="hover:shadow-md transition-shadow"
      >
        <CardBody>
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center space-x-3">
              <div className="bg-primary-100 p-3 rounded-xl">
                <FaUmbrella className="text-primary-500 text-xl" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-default-900">{type.name}</h3>
                {type.code && (
                  <p className="text-sm text-default-500">{type.code}</p>
                )}
              </div>
            </div>
            <div className="flex space-x-1">
              <Button
                isIconOnly
                variant="light"
                color="primary"
                size="sm"
                onPress={() => handleEdit(type)}
              >
                <FaEdit />
              </Button>
              <Button
                isIconOnly
                variant="light"
                color="danger"
                size="sm"
                onPress={() => handleDelete(type._id)}
              >
                <FaTrash />
              </Button>
            </div>
          </div>

          {type.description && (
            <p className="text-default-600 text-sm mb-4">{type.description}</p>
          )}

          <div className="space-y-3 pt-4 border-t border-default-200">
            <div className="flex justify-between text-sm">
              <span className="text-default-500">Max Days Per Year:</span>
              <span className="font-semibold text-default-900">{type.maxDaysPerYear || 0}</span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-default-500">Type:</span>
              <Chip
                size="sm"
                color={type.isPaid ? 'success' : 'default'}
                variant="flat"
              >
                {type.isPaid ? 'Paid' : 'Unpaid'}
              </Chip>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-default-500">Approval:</span>
              <Chip
                size="sm"
                color={type.requiresApproval ? 'primary' : 'default'}
                variant="flat"
              >
                {type.requiresApproval ? 'Required' : 'Not Required'}
              </Chip>
            </div>
          </div>
        </CardBody>
      </Card>
    ))
  )
}
      </div >

  {/* Add/Edit Modal */ }
  < Modal isOpen = { showModal } onClose = { handleCloseModal } size = "lg" >
    <ModalContent>
      <form onSubmit={handleSubmit}>
        <ModalHeader className="flex flex-col gap-1">
          <h2 className="text-xl font-bold">
            {editingType ? 'Edit Leave Type' : 'Add Leave Type'}
          </h2>
        </ModalHeader>
        <ModalBody>
          <div className="space-y-4">
            <Input
              label="Leave Name"
              placeholder="e.g., Casual Leave"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              isRequired
              variant="bordered"
            />

            <Input
              label="Code"
              placeholder="e.g., CL"
              value={formData.code}
              onChange={(e) => setFormData({ ...formData, code: e.target.value })}
              variant="bordered"
            />

            <Input
              type="number"
              label="Max Days Per Year"
              placeholder="0"
              value={formData.maxDaysPerYear.toString()}
              onChange={(e) => setFormData({ ...formData, maxDaysPerYear: parseInt(e.target.value) || 0 })}
              isRequired
              min={0}
              variant="bordered"
            />

            <Textarea
              label="Description"
              placeholder="Leave type description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              variant="bordered"
            />

            <div className="flex flex-col gap-3 pt-2">
              <Switch
                isSelected={formData.isPaid}
                onValueChange={(value) => setFormData({ ...formData, isPaid: value })}
                size="sm"
              >
                Paid Leave
              </Switch>

              <Switch
                isSelected={formData.requiresApproval}
                onValueChange={(value) => setFormData({ ...formData, requiresApproval: value })}
                size="sm"
              >
                Requires Approval
              </Switch>
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="flat" onPress={handleCloseModal}>
            Cancel
          </Button>
          <LoadingButton
            color="primary"
            type="submit"
            isLoading={submitMutation.isLoading}
            loadingText={editingType ? 'Updating...' : 'Creating...'}
          >
            {editingType ? 'Update' : 'Create'}
          </LoadingButton>
        </ModalFooter>
      </form>
    </ModalContent>
      </Modal >
    </div >
  )
}

