'use client'

import { useState, useEffect, useMemo } from 'react'
import toast from '@/utils/toast'
import { useSocket, REALTIME_EVENTS } from '@/contexts/SocketContext'
import { FaPlus, FaLaptop, FaCheckCircle, FaClock, FaTools, FaTimes, FaBox } from 'react-icons/fa'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import useApiMutation from '@/hooks/useApiMutation'
import LoadingButton from '@/components/ui/LoadingButton'
import { DataErrorState } from '@/components/ui/ErrorBoundary'
import BackgroundRefreshIndicator from '@/components/ui/BackgroundRefreshIndicator'
import ModalPortal from '@/components/ui/ModalPortal'
import { Select, SelectItem, Input, Textarea, Button, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Skeleton } from '@heroui/react'

export default function AssetsPage() {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [formData, setFormData] = useState({
    name: '',
    assetCode: '',
    uin: '',
    category: 'laptop',
    description: '',
    specs: '',
    assignedTo: '',
    status: 'available',
    purchaseDate: '',
    purchasePrice: ''
  })

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
  const employees = employeesRes?.data?.employees || employeesRes?.data || []

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
    setFormData({
      name: '',
      assetCode: '',
      uin: '',
      category: 'laptop',
      description: '',
      specs: '',
      assignedTo: '',
      status: 'available',
      purchaseDate: '',
      purchasePrice: ''
    })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    submitMutation.execute('/api/assets', formData)
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
        {['admin', 'hr'].includes(userRole) && (
          <Button
            onPress={() => setIsModalOpen(true)}
            color="primary"
            startContent={<FaPlus />}
          >
            Add Asset
          </Button>
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
              {assets.filter(a => a.status === 'maintenance').length}
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
              {assets.filter(a => a.status === 'maintenance').length}
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
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {assets.map((asset) => (
                  <tr key={asset._id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">
                        {asset.assetName}
                      </div>
                      <div className="text-sm text-gray-500">{asset.brand}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {asset.assetId}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {asset.assetType}
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
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${asset.status === 'assigned' ? 'bg-green-100 text-green-800' :
                          asset.status === 'available' ? 'bg-blue-100 text-blue-800' :
                            asset.status === 'maintenance' ? 'bg-orange-100 text-orange-800' :
                              'bg-red-100 text-red-800'
                        }`}>
                        {asset.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

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
                  <label className="block text-sm font-medium text-gray-700">Description</label>
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
                  <Select
                    label="Assigned To"
                    selectedKeys={formData.assignedTo ? [formData.assignedTo] : []}
                    onSelectionChange={(keys) => handleInputChange({ target: { name: 'assignedTo', value: Array.from(keys)[0] || '' } })}
                    placeholder="Unassigned"
                  >
                    {employees.map(emp => (
                      <SelectItem key={emp._id}>
                        {emp.firstName} {emp.lastName} ({emp.employeeCode})
                      </SelectItem>
                    ))}
                  </Select>
                </div>
                <div>
                  <Select
                    label="Status"
                    selectedKeys={[formData.status]}
                    onSelectionChange={(keys) => handleInputChange({ target: { name: 'status', value: Array.from(keys)[0] || 'available' } })}
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
    </div>
  )
}

