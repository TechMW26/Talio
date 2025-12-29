'use client'

import { useState, useEffect } from 'react'
import toast from '@/utils/toast'
import { useSocket, REALTIME_EVENTS } from '@/contexts/SocketContext'
import { FaPlus, FaLaptop, FaCheckCircle, FaClock, FaTools, FaTimes, FaBox } from 'react-icons/fa'
import { getCurrentUser } from '@/utils/userHelper'

export default function AssetsPage() {
  const [assets, setAssets] = useState([])
  const [loading, setLoading] = useState(true)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [employees, setEmployees] = useState([])
  const [userRole, setUserRole] = useState(null)
  const [currentUser, setCurrentUser] = useState(null)
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

  // Check if user is admin or HR (can manage all assets)
  const isAdmin = ['admin', 'hr', 'super_admin'].includes(userRole)

  // Real-time updates
  const { socket, isConnected, subscribe } = useSocket()

  useEffect(() => {
    const user = getCurrentUser()
    if (user) {
      setUserRole(user.role)
      setCurrentUser(user)
    }
    fetchAssets()
    fetchEmployees()
  }, [])

  // Subscribe to real-time asset updates
  useEffect(() => {
    if (!socket || !isConnected) return

    const handleAssetUpdate = (data) => {
      console.log('🔄 [Assets] Real-time update received:', data)
      fetchAssets()
    }

    const unsub = subscribe?.(REALTIME_EVENTS.ASSET_UPDATE, handleAssetUpdate)

    return () => {
      unsub?.()
    }
  }, [socket, isConnected])

  const fetchEmployees = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/employees?limit=1000', { // Fetch all employees
        headers: { 'Authorization': `Bearer ${token}` },
      })
      const data = await response.json()
      if (data.success) {
        setEmployees(data.data.employees || []) // Adjust based on actual API response structure
      }
    } catch (error) {
      console.error('Fetch employees error:', error)
    }
  }

  const handleInputChange = (e) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/assets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(formData)
      })
      const data = await response.json()
      if (data.success) {
        toast.success('Asset added successfully')
        setIsModalOpen(false)
        fetchAssets()
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
      } else {
        toast.error(data.message || 'Failed to add asset')
      }
    } catch (error) {
      console.error('Add asset error:', error)
      toast.error('Failed to add asset')
    }
  }

  const fetchAssets = async () => {
    try {
      const token = localStorage.getItem('token')
      const user = getCurrentUser()
      
      // For employees, fetch only their assigned assets
      let url = '/api/assets'
      if (user && !['admin', 'hr', 'super_admin'].includes(user.role)) {
        const employeeId = user.employeeId?._id || user.employeeId
        if (employeeId) {
          url = `/api/assets?employeeId=${employeeId}`
        }
      }
      
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      const data = await response.json()
      if (data.success) {
        setAssets(data.data)
      }
    } catch (error) {
      console.error('Fetch assets error:', error)
      toast.error('Failed to fetch assets')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex md:justify-between md:items-center md:flex-row flex-col mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">{isAdmin ? 'Assets' : 'My Assets'}</h1>
          <p className="text-gray-600 mt-1">
            {isAdmin ? 'Manage company assets and equipment' : 'View assets assigned to you'}
          </p>
        </div>
        {['admin', 'hr'].includes(userRole) && (
          <button 
            onClick={() => setIsModalOpen(true)}
            className="btn-primary flex items-center space-x-2"
          >
            <FaPlus />
            <span>Add Asset</span>
          </button>
        )}
      </div>

      {/* Stats Cards - Different view for admin vs employee */}
      {isAdmin ? (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-gray-600">Total Assets</h3>
              <FaLaptop className="text-primary-500" />
            </div>
            <div className="text-3xl font-bold text-gray-800">{assets.length}</div>
          </div>

          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-gray-600">Assigned</h3>
              <FaCheckCircle className="text-green-500" />
            </div>
            <div className="text-3xl font-bold text-gray-800">
              {assets.filter(a => a.status === 'assigned').length}
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-gray-600">Available</h3>
              <FaClock className="text-blue-500" />
            </div>
            <div className="text-3xl font-bold text-gray-800">
              {assets.filter(a => a.status === 'available').length}
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="flex items-center justify-between mb-2">
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
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-gray-600">Assets Assigned to You</h3>
              <FaBox className="text-primary-500" />
            </div>
            <div className="text-3xl font-bold text-gray-800">{assets.length}</div>
          </div>

          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="flex items-center justify-between mb-2">
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

        {loading ? (
          <div className="p-8 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500 mx-auto"></div>
            <p className="mt-4 text-gray-600">Loading assets...</p>
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
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        asset.status === 'assigned' ? 'bg-green-100 text-green-800' :
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
      {isModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold">Add New Asset</h2>
              <button onClick={() => setIsModalOpen(false)} className="text-gray-500 hover:text-gray-700">
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
                  <label className="block text-sm font-medium text-gray-700">Category *</label>
                  <select
                    name="category"
                    value={formData.category}
                    onChange={handleInputChange}
                    required
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 border p-2"
                  >
                    <option value="laptop">Laptop</option>
                    <option value="desktop">Desktop</option>
                    <option value="mobile">Mobile</option>
                    <option value="tablet">Tablet</option>
                    <option value="monitor">Monitor</option>
                    <option value="keyboard">Keyboard</option>
                    <option value="mouse">Mouse</option>
                    <option value="furniture">Furniture</option>
                    <option value="vehicle">Vehicle</option>
                    <option value="other">Other</option>
                  </select>
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
                  <label className="block text-sm font-medium text-gray-700">Assigned To</label>
                  <select
                    name="assignedTo"
                    value={formData.assignedTo}
                    onChange={handleInputChange}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 border p-2"
                  >
                    <option value="">Unassigned</option>
                    {employees.map(emp => (
                      <option key={emp._id} value={emp._id}>
                        {emp.firstName} {emp.lastName} ({emp.employeeCode})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Status</label>
                  <select
                    name="status"
                    value={formData.status}
                    onChange={handleInputChange}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 border p-2"
                  >
                    <option value="available">Available</option>
                    <option value="assigned">Assigned</option>
                    <option value="under-maintenance">Under Maintenance</option>
                    <option value="damaged">Damaged</option>
                    <option value="disposed">Disposed</option>
                  </select>
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
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700"
                >
                  Add Asset
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

