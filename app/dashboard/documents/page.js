'use client'

import { useState, useEffect } from 'react'
import toast from '@/utils/toast'
import { FaPlus, FaFile, FaDownload, FaEye, FaTrash, FaTimes } from 'react-icons/fa'
import { getCurrentUser, getEmployeeId } from '@/utils/userHelper'
import ModalPortal from '@/components/ui/ModalPortal'

export default function DocumentsPage() {
  const [documents, setDocuments] = useState([])
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState(null)
  const [showModal, setShowModal] = useState(false)

  useEffect(() => {
    const parsedUser = getCurrentUser()
    if (parsedUser) {
      setUser(parsedUser)
      const empId = getEmployeeId(parsedUser)
      if (empId) {
        fetchDocuments(empId)
      } else {
        toast.error('Employee information not found. Please logout and login again.')
        setLoading(false)
      }
    } else {
      setLoading(false)
    }
  }, [])

  const fetchDocuments = async (employeeId) => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/documents?employeeId=${employeeId}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      const data = await response.json()
      if (data.success) {
        setDocuments(data.data)
      }
    } catch (error) {
      console.error('Fetch documents error:', error)
      toast.error('Failed to fetch documents')
    } finally {
      setLoading(false)
    }
  }

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i]
  }

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex md:justify-between md:items-center md:flex-row flex-col mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">Documents</h1>
          <p className="text-gray-600 mt-1">Manage your documents and files</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="btn-primary flex items-center space-x-2"
        >
          <FaPlus />
          <span>Upload Document</span>
        </button>
      </div>

      {/* Document Categories */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        {['Personal', 'Employment', 'Tax', 'Other'].map((category) => (
          <div key={category} className="bg-white rounded-lg shadow-md p-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-gray-600">{category}</h3>
              <FaFile className="text-primary-500" />
            </div>
            <div className="text-3xl font-bold text-gray-800">
              {documents.filter(d => d.category === category.toLowerCase()).length}
            </div>
          </div>
        ))}
      </div>

      {/* Documents Table */}
      <div className="bg-white rounded-lg shadow-md overflow-hidden">
        <div className="p-4 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-800">All Documents</h2>
        </div>

        {loading ? (
          <div className="p-8 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500 mx-auto"></div>
            <p className="mt-4 text-gray-600">Loading documents...</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Document Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Category
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Size
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Upload Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {documents.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="px-6 py-4 text-center text-gray-500">
                      No documents found
                    </td>
                  </tr>
                ) : (
                  documents.map((doc) => (
                    <tr key={doc._id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <FaFile className="text-primary-500 mr-3" />
                          <div>
                            <div className="text-sm font-medium text-gray-900">
                              {doc.fileName}
                            </div>
                            <div className="text-sm text-gray-500">{doc.fileType}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-100 text-blue-800">
                          {doc.category}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {formatFileSize(doc.fileSize || 0)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {formatDate(doc.createdAt)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <div className="flex space-x-2">
                          <button
                            className="text-blue-600 hover:text-blue-900"
                            title="View"
                          >
                            <FaEye />
                          </button>
                          <button
                            className="text-green-600 hover:text-green-900"
                            title="Download"
                          >
                            <FaDownload />
                          </button>
                          <button
                            className="text-red-600 hover:text-red-900"
                            title="Delete"
                          >
                            <FaTrash />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Upload Modal */}
      <ModalPortal isOpen={showModal}>
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal-backdrop" />
          <div className="modal-container modal-md">
            <div className="modal-header">
              <h2 className="modal-title">Upload Document</h2>
              <button onClick={() => setShowModal(false)} className="modal-close-btn">
                <FaTimes className="w-5 h-5" />
              </button>
            </div>
            <form>
              <div className="modal-body space-y-4">
                <div>
                  <label className="modal-label">
                    Document Name
                  </label>
                  <input
                    type="text"
                    className="modal-input"
                    placeholder="Enter document name"
                  />
                </div>

                <div>
                  <label className="modal-label">
                    Category
                  </label>
                  <select className="modal-select">
                    <option value="">Select Category</option>
                    <option value="personal">Personal</option>
                    <option value="employment">Employment</option>
                    <option value="tax">Tax</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                <div>
                  <label className="modal-label">
                    File
                  </label>
                  <input
                    type="file"
                    className="modal-input"
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="modal-btn modal-btn-secondary"
                >
                  Cancel
                </button>
                <button type="submit" className="modal-btn modal-btn-primary">
                  Upload
                </button>
              </div>
            </form>
          </div>
        </div>
      </ModalPortal>
    </div>
  )
}

