'use client'

import { useState, useEffect } from 'react'
import { Button } from '@heroui/react'
import toast from '@/utils/toast'
import { useSocket, REALTIME_EVENTS } from '@/contexts/SocketContext'
import { FaPlus, FaEdit, FaTrash, FaBriefcase } from 'react-icons/fa'
import Loader from '@/components/ui/Loader'
import ModalPortal from '@/components/ui/ModalPortal'

export default function DesignationsPage() {
  const [designations, setDesignations] = useState([])

  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingDesig, setEditingDesig] = useState(null)
  const [formData, setFormData] = useState({
    title: '',
    description: '',
  })

  // Real-time updates
  const { socket, isConnected, subscribe } = useSocket()

  useEffect(() => {
    fetchDesignations()
  }, [])

  // Subscribe to real-time designation updates
  useEffect(() => {
    if (!socket || !isConnected) return

    const handleDesignationUpdate = (data) => {
      console.log('🔄 [Designations] Real-time update received:', data)
      fetchDesignations()
    }

    // Listen for generic dashboard refresh or designation-specific events
    const unsub = subscribe?.('designation-updated', handleDesignationUpdate)

    return () => {
      unsub?.()
    }
  }, [socket, isConnected])

  const fetchDesignations = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/designations', {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      const data = await response.json()
      if (data.success) {
        setDesignations(data.data)
      }
    } catch (error) {
      console.error('Fetch designations error:', error)
      toast.error('Failed to fetch designations')
    } finally {
      setLoading(false)
    }
  }



  const handleSubmit = async (e) => {
    e.preventDefault()

    try {
      const token = localStorage.getItem('token')
      const url = editingDesig
        ? `/api/designations/${editingDesig._id}`
        : '/api/designations'
      const method = editingDesig ? 'PUT' : 'POST'

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
        setEditingDesig(null)
        setFormData({ title: '', description: '' })
        fetchDesignations()
      } else {
        toast.error(data.message)
      }
    } catch (error) {
      console.error('Submit error:', error)
      toast.error('Failed to save designation')
    }
  }

  const handleEdit = (desig) => {
    setEditingDesig(desig)
    setFormData({
      title: desig.title,
      description: desig.description || '',
    })
    setShowModal(true)
  }

  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to delete this designation?')) return

    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/designations/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      })

      const data = await response.json()

      if (data.success) {
        toast.success(data.message)
        fetchDesignations()
      } else {
        toast.error(data.message)
      }
    } catch (error) {
      console.error('Delete error:', error)
      toast.error('Failed to delete designation')
    }
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
          <h1 className="text-3xl font-bold text-gray-800">Designations</h1>
          <p className="text-gray-600 mt-1">Manage job designations and roles</p>
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
        <div className="bg-white rounded-lg shadow-md p-3 sm:p-6">
          <div className="flex items-center justify-start mb-2">
            <h3 className="text-xs sm:text-sm font-medium text-gray-600 truncate">Total Designations</h3>
            <FaBriefcase className="text-primary-500 flex-shrink-0" />
          </div>
          <div className="text-2xl sm:text-3xl font-bold text-gray-800">{designations.length}</div>
        </div>



        <div className="bg-white rounded-lg shadow-md p-3 sm:p-6">
          <div className="flex items-center justify-start mb-2">
            <h3 className="text-xs sm:text-sm font-medium text-gray-600 truncate">Active Roles</h3>
            <FaBriefcase className="text-blue-500 flex-shrink-0" />
          </div>
          <div className="text-2xl sm:text-3xl font-bold text-gray-800">
            {designations.filter(d => d.isActive !== false).length}
          </div>
        </div>
      </div>

      {/* Designations Table */}
      <div className="bg-white rounded-lg shadow-md overflow-hidden">
        <div className="p-4 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-800">All Designations</h2>
        </div>

        {loading ? (
          <div className="p-8 text-center">
            <Loader size="lg" />
            <p className="mt-4 text-gray-600">Loading designations...</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Title
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Description
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
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
                        <button
                          onClick={() => handleEdit(desig)}
                          className="text-blue-600 hover:text-blue-900 mr-4"
                        >
                          <FaEdit />
                        </button>
                        <button
                          onClick={() => handleDelete(desig._id)}
                          className="text-red-600 hover:text-red-900"
                        >
                          <FaTrash />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      <ModalPortal isOpen={showModal}>
        <div className="modal-overlay">
          <div className="bg-white rounded-[30px] animate-modal-enter p-6 w-full max-w-md">
            <h2 className="text-2xl font-bold text-gray-800 mb-4">
              {editingDesig ? 'Edit Designation' : 'Add Designation'}
            </h2>
            <form onSubmit={handleSubmit}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Title *
                  </label>
                  <input
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
                  <textarea
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
                <Button type="submit" color="primary">
                  {editingDesig ? 'Update' : 'Create'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      </ModalPortal>
    </div>
  )
}

