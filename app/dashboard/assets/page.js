'use client'

import { useState, useEffect, useMemo } from 'react'
import toast from '@/utils/toast'
import { useSocket, REALTIME_EVENTS } from '@/contexts/SocketContext'
import { FaPlus, FaLaptop, FaCheckCircle, FaClock, FaTools, FaTimes, FaBox, FaFileUpload, FaEye, FaPen } from 'react-icons/fa'
import { HiOutlineSparkles } from 'react-icons/hi2'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import useApiMutation from '@/hooks/useApiMutation'
import LoadingButton from '@/components/ui/LoadingButton'
import { DataErrorState } from '@/components/ui/ErrorBoundary'
import BackgroundRefreshIndicator from '@/components/ui/BackgroundRefreshIndicator'
import ModalPortal from '@/components/ui/ModalPortal'
import SearchableSelect from '@/components/ui/heroui/SearchableSelect'
import { Select, SelectItem, Input, Textarea, Button, Skeleton } from '@heroui/react'
import { useAILoading } from '@/contexts/AILoadingContext'
import { getAssetAssigneeLabel } from '@/utils/assetAssigneeSearch'
import { formatAssetStatus, getAssetDisplayDetails, normalizeAssetInput, normalizeAssetStatus } from '@/utils/assetData'

const EMPTY_ASSET_FORM = {
  name: '',
  assetCode: '',
  uin: '',
  category: 'laptop',
  description: '',
  specs: '',
  assignedTo: '',
  status: 'available',
  purchaseDate: '',
  purchasePrice: '',
}

const toDateInputValue = (value) => {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10)
}

const assetToFormData = (asset = {}) => {
  const details = getAssetDisplayDetails(asset)
  return {
    name: details.name === 'Unnamed asset' ? '' : details.name,
    assetCode: details.code === 'Not provided' ? '' : details.code,
    uin: asset.uin || '',
    category: details.category,
    description: asset.description || '',
    specs: asset.specs || '',
    assignedTo: String(asset.assignedTo?._id || asset.assignedTo || ''),
    status: details.status,
    purchaseDate: toDateInputValue(asset.purchaseDate),
    purchasePrice: asset.purchasePrice ?? '',
  }
}

export default function AssetsPage() {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isBulkImportOpen, setIsBulkImportOpen] = useState(false)
  const [bulkFile, setBulkFile] = useState(null)
  const [bulkPreview, setBulkPreview] = useState(null)
  const [bulkImporting, setBulkImporting] = useState(false)
  const [bulkPreviewing, setBulkPreviewing] = useState(false)
  const [generatingDescription, setGeneratingDescription] = useState(false)
  const [selectedAsset, setSelectedAsset] = useState(null)
  const [isEditingAsset, setIsEditingAsset] = useState(false)
  const [editFormData, setEditFormData] = useState(EMPTY_ASSET_FORM)
  const { startAILoading, stopAILoading } = useAILoading()
  const [formData, setFormData] = useState(EMPTY_ASSET_FORM)

  // User from localStorage
  const currentUser = useMemo(() => { try { return JSON.parse(localStorage.getItem('user')) } catch { return null } }, [])
  const userRole = currentUser?.role
  const isAdmin = ['admin', 'hr', 'super_admin'].includes(userRole)

  // SWR: Assets (conditional URL based on role)
  const assetsUrl = useMemo(() => {
    if (!currentUser) return null
    if (isAdmin) return '/api/assets'
    const employeeId = currentUser.employeeId?._id || currentUser.employeeId
    return employeeId ? `/api/assets?employeeId=${employeeId}` : '/api/assets'
  }, [currentUser, isAdmin])

  const { data: assetsRes, error, isLoading, isValidating, mutate: refreshAssets } = useAuthedSWR(assetsUrl)
  const assets = assetsRes?.data || []

  // SWR: Employees (admin only, for assignment dropdown)
  const { data: employeesRes } = useAuthedSWR(isAdmin ? '/api/employees?limit=1000' : null)
  const employees = useMemo(() => employeesRes?.data?.employees || employeesRes?.data || [], [employeesRes])
  const assigneeOptions = useMemo(() => [
    { _id: 'unassigned', displayLabel: 'Unassigned' },
    ...employees.map((employee) => ({ ...employee, displayLabel: getAssetAssigneeLabel(employee) })),
  ], [employees])

  // Real-time updates
  const { socket, isConnected, subscribe } = useSocket()

  // Subscribe to real-time asset updates
  useEffect(() => {
    if (!socket || !isConnected) return

    const handleAssetUpdate = (data) => {
      console.log('🔄 [Assets] Real-time update received:', data)
      refreshAssets()
    }

    const unsub = subscribe?.(REALTIME_EVENTS.ASSET_UPDATE, handleAssetUpdate)

    return () => {
      unsub?.()
    }
  }, [socket, isConnected, subscribe, refreshAssets])

  const handleInputChange = (e) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
  }

  // Mutations
  const submitMutation = useApiMutation({
    invalidateKeys: [assetsUrl],
    onSuccess: () => {
      toast.success('Asset added successfully')
      closeModal()
    },
    onError: (msg) => toast.error(msg || 'Failed to add asset'),
  })

  const closeModal = () => {
    setIsModalOpen(false)
    setFormData(EMPTY_ASSET_FORM)
  }

  const updateMutation = useApiMutation({
    method: 'PUT',
    invalidateKeys: [assetsUrl],
    onSuccess: (response) => {
      toast.success('Asset updated successfully')
      setSelectedAsset(response.data)
      setEditFormData(assetToFormData(response.data))
      setIsEditingAsset(false)
    },
    onError: (msg) => toast.error(msg || 'Failed to update asset'),
  })

  const openAsset = (asset) => {
    setSelectedAsset(asset)
    setEditFormData(assetToFormData(asset))
    setIsEditingAsset(false)
  }

  const closeAsset = () => {
    setSelectedAsset(null)
    setIsEditingAsset(false)
    updateMutation.reset()
  }

  const handleEditChange = (e) => {
    const { name, value } = e.target
    setEditFormData((previous) => ({ ...previous, [name]: value }))
  }

  const handleAssetUpdate = async (event) => {
    event.preventDefault()
    if (!selectedAsset?._id) return
    const { data, errors } = normalizeAssetInput(editFormData, { partial: true })
    if (errors.length > 0) {
      toast.error(errors[0])
      return
    }
    await updateMutation.execute(`/api/assets/${selectedAsset._id}`, data)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const { data, errors } = normalizeAssetInput(formData)
    if (errors.length > 0) {
      toast.error(errors[0])
      return
    }
    await submitMutation.execute('/api/assets', data)
  }

  const handleBulkPreview = async () => {
    if (!bulkFile) return toast.error('Please select a file')
    setBulkPreviewing(true)
    try {
      const token = localStorage.getItem('token')
      const fd = new FormData()
      fd.append('file', bulkFile)
      fd.append('mode', 'preview')
      const res = await fetch('/api/assets/bulk-import', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      })
      const data = await res.json()
      if (data.success) {
        setBulkPreview(data)
      } else {
        toast.error(data.message || 'Preview failed')
      }
    } catch (err) {
      toast.error('Failed to preview file')
    } finally {
      setBulkPreviewing(false)
    }
  }

  const handleBulkImport = async () => {
    if (!bulkFile || !bulkPreview?.mapping) return
    setBulkImporting(true)
    try {
      const token = localStorage.getItem('token')
      const fd = new FormData()
      fd.append('file', bulkFile)
      fd.append('mode', 'import')
      fd.append('mapping', JSON.stringify(bulkPreview.mapping))
      const res = await fetch('/api/assets/bulk-import', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      })
      const data = await res.json()
      if (data.success) {
        toast.success(data.message)
        setIsBulkImportOpen(false)
        setBulkFile(null)
        setBulkPreview(null)
        refreshAssets()
      } else {
        toast.error(data.message || 'Import failed')
      }
    } catch (err) {
      toast.error('Failed to import assets')
    } finally {
      setBulkImporting(false)
    }
  }

  return (
    <div className="p-6 relative">
      <BackgroundRefreshIndicator isValidating={isValidating} position="bar" />
      {/* Header */}
      <div className="flex md:justify-between md:items-center md:flex-row flex-col mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">{isAdmin ? 'Assets' : 'My Assets'}</h1>
          <p className="text-gray-600 mt-1">
            {isAdmin ? 'Manage company assets and equipment' : 'View assets assigned to you'}
          </p>
        </div>
        {['admin', 'hr', 'super_admin'].includes(userRole) && (
          <div className="flex gap-2">
            <Button
              onPress={() => setIsBulkImportOpen(true)}
              variant="flat"
              startContent={<FaFileUpload />}
            >
              Bulk Import
            </Button>
            <Button
              onPress={() => setIsModalOpen(true)}
              color="primary"
              startContent={<FaPlus />}
            >
              Add Asset
            </Button>
          </div>
        )}
      </div>

      {/* Stats Cards - Different view for admin vs employee */}
      {isAdmin ? (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="flex items-center justify-start mb-2">
              <h3 className="text-sm font-medium text-gray-600">Total Assets</h3>
              <FaLaptop className="text-primary-500" />
            </div>
            <div className="text-3xl font-bold text-gray-800">{assets.length}</div>
          </div>

          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="flex items-center justify-start mb-2">
              <h3 className="text-sm font-medium text-gray-600">Assigned</h3>
              <FaCheckCircle className="text-green-500" />
            </div>
            <div className="text-3xl font-bold text-gray-800">
              {assets.filter(a => a.status === 'assigned').length}
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="flex items-center justify-start mb-2">
              <h3 className="text-sm font-medium text-gray-600">Available</h3>
              <FaClock className="text-blue-500" />
            </div>
            <div className="text-3xl font-bold text-gray-800">
              {assets.filter(a => a.status === 'available').length}
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="flex items-center justify-start mb-2">
              <h3 className="text-sm font-medium text-gray-600">Under Maintenance</h3>
              <FaTools className="text-orange-500" />
            </div>
            <div className="text-3xl font-bold text-gray-800">
              {assets.filter(a => normalizeAssetStatus(a.status) === 'under-maintenance').length}
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="flex items-center justify-start mb-2">
              <h3 className="text-sm font-medium text-gray-600">Assets Assigned to You</h3>
              <FaBox className="text-primary-500" />
            </div>
            <div className="text-3xl font-bold text-gray-800">{assets.length}</div>
          </div>

          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="flex items-center justify-start mb-2">
              <h3 className="text-sm font-medium text-gray-600">Under Maintenance</h3>
              <FaTools className="text-orange-500" />
            </div>
            <div className="text-3xl font-bold text-gray-800">
              {assets.filter(a => normalizeAssetStatus(a.status) === 'under-maintenance').length}
            </div>
          </div>
        </div>
      )}

      {/* Assets Table */}
      <div className="bg-white rounded-lg shadow-md overflow-hidden">
        <div className="p-4 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-800">
            {isAdmin ? 'Asset Inventory' : 'Your Assigned Assets'}
          </h2>
        </div>

        {error ? (
          <DataErrorState error={error} onRetry={() => refreshAssets()} />
        ) : isLoading ? (
          <div className="p-6 space-y-3">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-lg" />
            ))}
          </div>
        ) : assets.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <FaBox className="mx-auto text-4xl text-gray-300 mb-3" />
            <p className="text-lg font-medium">
              {isAdmin ? 'No assets found' : 'No assets assigned to you'}
            </p>
            <p className="text-sm mt-1">
              {isAdmin
                ? 'Add your first asset to get started'
                : 'Contact HR or your manager if you need equipment'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Asset Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Asset ID
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Type
                  </th>
                  {isAdmin && (
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Assigned To
                    </th>
                  )}
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Purchase Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  {isAdmin && (
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {assets.map((asset) => {
                  const details = getAssetDisplayDetails(asset)
                  return (
                  <tr
                    key={asset._id}
                    className="hover:bg-gray-50 cursor-pointer focus-within:bg-gray-50"
                    onClick={() => openAsset(asset)}
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        openAsset(asset)
                      }
                    }}
                  >
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">
                        {details.name}
                      </div>
                      {details.manufacturer && <div className="text-sm text-gray-500">{details.manufacturer}</div>}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {details.code}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      <span className="capitalize">{details.category}</span>
                    </td>
                    {isAdmin && (
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {asset.assignedTo ? (
                          <>
                            {asset.assignedTo.firstName} {asset.assignedTo.lastName}
                          </>
                        ) : (
                          <span className="text-gray-400">Unassigned</span>
                        )}
                      </td>
                    )}
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {asset.purchaseDate
                        ? new Date(asset.purchaseDate).toLocaleDateString()
                        : 'N/A'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${details.status === 'assigned' ? 'bg-green-100 text-green-800' :
                          details.status === 'available' ? 'bg-blue-100 text-blue-800' :
                            details.status === 'under-maintenance' ? 'bg-orange-100 text-orange-800' :
                              'bg-red-100 text-red-800'
                        }`}>
                        {formatAssetStatus(details.status)}
                      </span>
                    </td>
                    {isAdmin && (
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <button
                          type="button"
                          onClick={(event) => { event.stopPropagation(); openAsset(asset) }}
                          className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-primary-600 hover:bg-primary-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
                          aria-label={`Open ${details.name}`}
                        >
                          <FaEye aria-hidden="true" /> View
                        </button>
                      </td>
                    )}
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Asset details and edit modal */}
      <ModalPortal isOpen={Boolean(selectedAsset)}>
        <div className="modal-overlay" onMouseDown={(event) => event.target === event.currentTarget && closeAsset()}>
          <div className="bg-white rounded-[30px] animate-modal-enter w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="asset-details-title">
            <div className="flex items-start justify-between gap-4 mb-6">
              <div>
                <h2 id="asset-details-title" className="text-xl font-bold text-gray-900">
                  {isEditingAsset ? 'Edit Asset' : getAssetDisplayDetails(selectedAsset || {}).name}
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  {isEditingAsset ? 'Update details, status, or employee assignment.' : getAssetDisplayDetails(selectedAsset || {}).code}
                </p>
              </div>
              <button type="button" onClick={closeAsset} className="rounded-full p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700" aria-label="Close asset details">
                <FaTimes />
              </button>
            </div>

            {isEditingAsset ? (
              <form onSubmit={handleAssetUpdate} className="space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Input label="Asset Name" name="name" value={editFormData.name} onChange={handleEditChange} isRequired />
                  <Input label="Asset Code" name="assetCode" value={editFormData.assetCode} onChange={handleEditChange} isRequired />
                  <Input label="UIN" name="uin" value={editFormData.uin} onChange={handleEditChange} />
                  <Select
                    label="Category"
                    selectedKeys={[editFormData.category]}
                    onSelectionChange={(keys) => handleEditChange({ target: { name: 'category', value: Array.from(keys)[0] || 'other' } })}
                    isRequired
                  >
                    <SelectItem key="laptop">Laptop</SelectItem>
                    <SelectItem key="desktop">Desktop</SelectItem>
                    <SelectItem key="mobile">Mobile</SelectItem>
                    <SelectItem key="tablet">Tablet</SelectItem>
                    <SelectItem key="monitor">Monitor</SelectItem>
                    <SelectItem key="keyboard">Keyboard</SelectItem>
                    <SelectItem key="mouse">Mouse</SelectItem>
                    <SelectItem key="furniture">Furniture</SelectItem>
                    <SelectItem key="vehicle">Vehicle</SelectItem>
                    <SelectItem key="other">Other</SelectItem>
                  </Select>
                  <SearchableSelect
                    label="Assigned To"
                    placeholder="Search by name or employee code"
                    options={assigneeOptions}
                    value={editFormData.assignedTo || 'unassigned'}
                    onValueChange={(key) => {
                      const assignedTo = key && key !== 'unassigned' ? String(key) : ''
                      setEditFormData((previous) => ({
                        ...previous,
                        assignedTo,
                        status: assignedTo ? 'assigned' : (previous.status === 'assigned' ? 'available' : previous.status),
                      }))
                    }}
                    getOptionKey={(employee) => employee._id}
                    getOptionLabel={(employee) => employee.displayLabel}
                    getOptionSearchText={(employee) => `${employee.displayLabel} ${employee.email || ''} ${employee.designation?.name || employee.designation?.title || ''}`}
                    emptyContent="No employees match your search"
                  />
                  <Select
                    label="Status"
                    selectedKeys={[editFormData.status]}
                    onSelectionChange={(keys) => handleEditChange({ target: { name: 'status', value: Array.from(keys)[0] || 'available' } })}
                    isDisabled={Boolean(editFormData.assignedTo)}
                    disabledKeys={['assigned']}
                    description={editFormData.assignedTo ? 'Assigned automatically when an employee is selected' : undefined}
                  >
                    <SelectItem key="available">Available</SelectItem>
                    <SelectItem key="assigned">Assigned</SelectItem>
                    <SelectItem key="under-maintenance">Under Maintenance</SelectItem>
                    <SelectItem key="damaged">Damaged</SelectItem>
                    <SelectItem key="disposed">Disposed</SelectItem>
                  </Select>
                  <Input label="Purchase Date" type="date" name="purchaseDate" value={editFormData.purchaseDate} onChange={handleEditChange} />
                  <Input label="Purchase Price" type="number" min="0" name="purchasePrice" value={String(editFormData.purchasePrice)} onChange={handleEditChange} />
                  <Textarea className="md:col-span-2" label="Description" name="description" value={editFormData.description} onChange={handleEditChange} />
                  <Textarea className="md:col-span-2" label="Specifications" name="specs" value={editFormData.specs} onChange={handleEditChange} />
                </div>
                <div className="flex justify-end gap-3">
                  <Button type="button" variant="flat" onPress={() => setIsEditingAsset(false)}>Cancel</Button>
                  <LoadingButton type="submit" isLoading={updateMutation.isLoading} color="primary">
                    Save Changes
                  </LoadingButton>
                </div>
              </form>
            ) : selectedAsset ? (() => {
              const details = getAssetDisplayDetails(selectedAsset)
              const assignedName = selectedAsset.assignedTo
                ? `${selectedAsset.assignedTo.firstName || ''} ${selectedAsset.assignedTo.lastName || ''}`.trim() || selectedAsset.assignedTo.employeeCode || 'Assigned employee'
                : 'Unassigned'
              return (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {[
                      ['Asset code', details.code],
                      ['Category', details.category],
                      ['Status', formatAssetStatus(details.status)],
                      ['Assigned to', assignedName],
                      ['Purchase date', selectedAsset.purchaseDate ? new Date(selectedAsset.purchaseDate).toLocaleDateString() : 'Not provided'],
                      ['Purchase price', selectedAsset.purchasePrice !== undefined && selectedAsset.purchasePrice !== null ? `₹${Number(selectedAsset.purchasePrice).toLocaleString('en-IN')}` : 'Not provided'],
                      ['UIN', selectedAsset.uin || 'Not provided'],
                      ['Manufacturer', details.manufacturer || 'Not provided'],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
                        <p className="mt-1 break-words text-sm font-semibold text-gray-900 capitalize">{value}</p>
                      </div>
                    ))}
                  </div>
                  {(selectedAsset.description || selectedAsset.specs) && (
                    <div className="mt-4 space-y-3">
                      {selectedAsset.description && <div><p className="text-xs font-medium uppercase tracking-wide text-gray-500">Description</p><p className="mt-1 text-sm text-gray-700">{selectedAsset.description}</p></div>}
                      {selectedAsset.specs && <div><p className="text-xs font-medium uppercase tracking-wide text-gray-500">Specifications</p><p className="mt-1 text-sm text-gray-700">{selectedAsset.specs}</p></div>}
                    </div>
                  )}
                  {isAdmin && (
                    <div className="mt-6 flex justify-end">
                      <Button color="primary" startContent={<FaPen />} onPress={() => setIsEditingAsset(true)}>
                        Edit or Reassign
                      </Button>
                    </div>
                  )}
                </>
              )
            })() : null}
          </div>
        </div>
      </ModalPortal>

      {/* Add Asset Modal */}
      <ModalPortal isOpen={isModalOpen}>
        <div className="modal-overlay">
          <div className="bg-white rounded-[30px] animate-modal-enter w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold">Add New Asset</h2>
              <button onClick={closeModal} className="text-gray-500 hover:text-gray-700">
                <FaTimes />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Asset Name *</label>
                  <input
                    type="text"
                    name="name"
                    value={formData.name}
                    onChange={handleInputChange}
                    required
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 border p-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Asset Code *</label>
                  <input
                    type="text"
                    name="assetCode"
                    value={formData.assetCode}
                    onChange={handleInputChange}
                    required
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 border p-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">UIN</label>
                  <input
                    type="text"
                    name="uin"
                    value={formData.uin}
                    onChange={handleInputChange}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 border p-2"
                  />
                </div>
                <div>
                  <Select
                    label="Category *"
                    isRequired
                    selectedKeys={[formData.category]}
                    onSelectionChange={(keys) => handleInputChange({ target: { name: 'category', value: Array.from(keys)[0] || 'laptop' } })}
                  >
                    <SelectItem key="laptop">Laptop</SelectItem>
                    <SelectItem key="desktop">Desktop</SelectItem>
                    <SelectItem key="mobile">Mobile</SelectItem>
                    <SelectItem key="tablet">Tablet</SelectItem>
                    <SelectItem key="monitor">Monitor</SelectItem>
                    <SelectItem key="keyboard">Keyboard</SelectItem>
                    <SelectItem key="mouse">Mouse</SelectItem>
                    <SelectItem key="furniture">Furniture</SelectItem>
                    <SelectItem key="vehicle">Vehicle</SelectItem>
                    <SelectItem key="other">Other</SelectItem>
                  </Select>
                </div>
                <div className="md:col-span-2">
                  <div className="flex items-center justify-start mb-1">
                    <label className="block text-sm font-medium text-gray-700">Description</label>
                    <Button
                      size="sm"
                      variant="flat"
                      onPress={async () => {
                        if (!formData.name.trim()) { toast.error('Please enter an asset name first'); return }
                        setGeneratingDescription(true)
                        startAILoading('MIRA is writing asset description...')
                        try {
                          const token = localStorage.getItem('token')
                          const res = await fetch('/api/ai/generate-text', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                            body: JSON.stringify({ type: 'asset_description', context: { assetName: formData.name, category: formData.category } })
                          })
                          const data = await res.json()
                          if (data.success && data.text) {
                            setFormData(prev => ({ ...prev, description: data.text }))
                            toast.success('Description generated!')
                          } else { toast.error(data.message || 'Failed to generate description') }
                        } catch (err) { console.error('AI generate error:', err); toast.error('Failed to generate description') }
                        finally { setGeneratingDescription(false); stopAILoading() }
                      }}
                      isDisabled={generatingDescription || !formData.name.trim()}
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
                    rows="2"
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 border p-2"
                  ></textarea>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700">Specifications</label>
                  <textarea
                    name="specs"
                    value={formData.specs}
                    onChange={handleInputChange}
                    rows="2"
                    placeholder="Processor, RAM, Storage, etc."
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 border p-2"
                  ></textarea>
                </div>
                <div>
                  <SearchableSelect
                    label="Assigned To"
                    placeholder="Search by name or employee code"
                    options={assigneeOptions}
                    value={formData.assignedTo || 'unassigned'}
                    onValueChange={(key) => {
                      const assignedTo = key && key !== 'unassigned' ? String(key) : ''
                      setFormData((previous) => ({
                        ...previous,
                        assignedTo,
                        status: assignedTo ? 'assigned' : (previous.status === 'assigned' ? 'available' : previous.status),
                      }))
                    }}
                    getOptionKey={(employee) => employee._id}
                    getOptionLabel={(employee) => employee.displayLabel}
                    getOptionSearchText={(employee) => `${employee.displayLabel} ${employee.email || ''} ${employee.designation?.name || employee.designation?.title || ''}`}
                    emptyContent="No employees match your search"
                  />
                </div>
                <div>
                  <Select
                    label="Status"
                    selectedKeys={[formData.status]}
                    onSelectionChange={(keys) => handleInputChange({ target: { name: 'status', value: Array.from(keys)[0] || 'available' } })}
                    isDisabled={Boolean(formData.assignedTo)}
                    disabledKeys={['assigned']}
                    description={formData.assignedTo ? 'Assigned automatically when an employee is selected' : undefined}
                  >
                    <SelectItem key="available">Available</SelectItem>
                    <SelectItem key="assigned">Assigned</SelectItem>
                    <SelectItem key="under-maintenance">Under Maintenance</SelectItem>
                    <SelectItem key="damaged">Damaged</SelectItem>
                    <SelectItem key="disposed">Disposed</SelectItem>
                  </Select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Purchase Date</label>
                  <input
                    type="date"
                    name="purchaseDate"
                    value={formData.purchaseDate}
                    onChange={handleInputChange}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 border p-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Purchase Price</label>
                  <input
                    type="number"
                    name="purchasePrice"
                    value={formData.purchasePrice}
                    onChange={handleInputChange}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 border p-2"
                  />
                </div>
              </div>
              <div className="flex justify-end space-x-3 mt-6">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <LoadingButton
                  type="submit"
                  isLoading={submitMutation.isLoading}
                  color="primary"
                  className="px-4 py-2"
                >
                  Add Asset
                </LoadingButton>
              </div>
            </form>
          </div>
        </div>
      </ModalPortal>

      {/* Bulk Import Modal */}
      <ModalPortal isOpen={isBulkImportOpen}>
        <div className="modal-overlay">
          <div className="bg-white rounded-[30px] animate-modal-enter w-full max-w-3xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold">Bulk Import Assets</h2>
              <button onClick={() => { setIsBulkImportOpen(false); setBulkFile(null); setBulkPreview(null) }} className="text-gray-500 hover:text-gray-700">
                <FaTimes />
              </button>
            </div>

            {!bulkPreview ? (
              <div className="space-y-4">
                <p className="text-sm text-gray-600">
                  Upload an Excel file (.xlsx) containing your asset data. Our AI will automatically detect and map columns.
                </p>
                <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center">
                  <FaFileUpload className="mx-auto text-3xl text-gray-400 mb-3" />
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={(e) => setBulkFile(e.target.files[0])}
                    className="block mx-auto text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100"
                  />
                  {bulkFile && <p className="mt-2 text-sm text-gray-700 font-medium">{bulkFile.name}</p>}
                </div>
                <div className="flex justify-end gap-3">
                  <Button variant="flat" onPress={() => { setIsBulkImportOpen(false); setBulkFile(null) }}>Cancel</Button>
                  <Button
                    color="primary"
                    onPress={handleBulkPreview}
                    isLoading={bulkPreviewing}
                    isDisabled={!bulkFile}
                  >
                    {bulkPreviewing ? 'Analyzing...' : 'Preview'}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-3 text-sm text-gray-600">
                  <span className="font-semibold">{bulkPreview.totalRows}</span> rows detected
                  <span className="text-gray-300">|</span>
                  Showing first {bulkPreview.data?.length || 0} rows
                </div>

                <div className="overflow-x-auto max-h-[400px] overflow-y-auto border rounded-lg">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Row</th>
                        {bulkPreview.fields?.filter(f => {
                          return Object.values(bulkPreview.mapping).includes(f.key)
                        }).map(f => (
                          <th key={f.key} className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">{f.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {bulkPreview.data?.map((row, i) => (
                        <tr key={i} className="hover:bg-gray-50">
                          <td className="px-3 py-2 text-gray-400">{row._rowNum}</td>
                          {bulkPreview.fields?.filter(f => {
                            return Object.values(bulkPreview.mapping).includes(f.key)
                          }).map(f => (
                            <td key={f.key} className="px-3 py-2 text-gray-700 max-w-[200px] truncate">
                              {String(row[f.key] ?? '')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex justify-end gap-3">
                  <Button variant="flat" onPress={() => { setBulkPreview(null); setBulkFile(null) }}>Back</Button>
                  <Button
                    color="primary"
                    onPress={handleBulkImport}
                    isLoading={bulkImporting}
                  >
                    {bulkImporting ? 'Importing...' : `Import ${bulkPreview.totalRows} Assets`}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </ModalPortal>
    </div>
  )
}

