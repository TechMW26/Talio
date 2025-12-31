'use client'

import { useState, useEffect, useRef } from 'react'
import toast from '@/utils/toast'
import { useSocket, REALTIME_EVENTS } from '@/contexts/SocketContext'
import { FaPlus, FaFile, FaDownload, FaEye, FaTrash, FaTimes, FaSpinner, FaUpload } from 'react-icons/fa'
import { getCurrentUser, getEmployeeId } from '@/utils/userHelper'
import ModalPortal from '@/components/ui/ModalPortal'

export default function DocumentsPage() {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])
  const [documents, setDocuments] = useState([])
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState(null)
  const [employeeId, setEmployeeId] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadForm, setUploadForm] = useState({
    fileName: '',
    category: '',
  })
  const [selectedFile, setSelectedFile] = useState(null)
  const fileInputRef = useRef(null)

  // Real-time updates
  const { socket, isConnected, subscribe, onDocumentUpdate } = useSocket()

  useEffect(() => {
    const parsedUser = getCurrentUser()
    if (parsedUser) {
      setUser(parsedUser)
      const empId = getEmployeeId(parsedUser)
      setEmployeeId(empId)
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

  // Subscribe to real-time document updates
  useEffect(() => {
    if (!socket || !isConnected || !employeeId) return

    const handleDocumentUpdate = (data) => {
      console.log('🔄 [Documents] Real-time update received:', data)
      fetchDocuments(employeeId)
    }

    const unsub1 = onDocumentUpdate?.(handleDocumentUpdate)
    const unsub2 = subscribe?.(REALTIME_EVENTS.DOCUMENT_UPDATE, handleDocumentUpdate)

    return () => {
      unsub1?.()
      unsub2?.()
    }
  }, [socket, isConnected, employeeId])

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

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0]
    if (file) {
      setSelectedFile(file)
      // Auto-fill filename if empty
      if (!uploadForm.fileName) {
        setUploadForm(prev => ({
          ...prev,
          fileName: file.name.replace(/\.[^/.]+$/, '') // Remove extension
        }))
      }
    }
  }

  const resetUploadForm = () => {
    setUploadForm({ fileName: '', category: '' })
    setSelectedFile(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleUpload = async (e) => {
    e.preventDefault()

    if (!selectedFile) {
      toast.error('Please select a file to upload')
      return
    }

    if (!uploadForm.fileName.trim()) {
      toast.error('Please enter a document name')
      return
    }

    if (!uploadForm.category) {
      toast.error('Please select a category')
      return
    }

    setUploading(true)

    try {
      const token = localStorage.getItem('token')

      // First, upload the file to ImageKit via the upload API
      const formData = new FormData()
      formData.append('file', selectedFile)
      formData.append('folder', 'documents')

      const uploadResponse = await fetch('/api/upload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        body: formData,
      })

      const uploadData = await uploadResponse.json()

      if (!uploadData.success) {
        throw new Error(uploadData.message || 'Failed to upload file')
      }

      // Now create the document record
      const docResponse = await fetch('/api/documents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          fileName: uploadForm.fileName.trim(),
          category: uploadForm.category,
          fileUrl: uploadData.data.fileUrl,
          fileId: uploadData.data.fileId,
          fileType: uploadData.data.fileType || selectedFile.type,
          fileSize: uploadData.data.fileSize || selectedFile.size,
          employee: employeeId,
          uploadedBy: employeeId,
        }),
      })

      const docData = await docResponse.json()

      if (docData.success) {
        toast.success('Document uploaded successfully')
        setDocuments(prev => [docData.data, ...prev])
        setShowModal(false)
        resetUploadForm()
      } else {
        throw new Error(docData.message || 'Failed to save document')
      }
    } catch (error) {
      console.error('Upload document error:', error)
      toast.error(error.message || 'Failed to upload document')
    } finally {
      setUploading(false)
    }
  }

  const handleDelete = async (docId) => {
    if (!confirm('Are you sure you want to delete this document?')) return

    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/documents/${docId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      })

      const data = await response.json()
      if (data.success) {
        toast.success('Document deleted successfully')
        setDocuments(prev => prev.filter(doc => doc._id !== docId))
      } else {
        toast.error(data.message || 'Failed to delete document')
      }
    } catch (error) {
      console.error('Delete document error:', error)
      toast.error('Failed to delete document')
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

  // Prevent hydration mismatch
  if (!mounted) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-10 bg-gray-200 rounded w-1/4"></div>
          <div className="grid grid-cols-4 gap-4">
            {[1,2,3,4].map(i => <div key={i} className="h-24 bg-gray-200 rounded"></div>)}
          </div>
        </div>
      </div>
    )
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
                            onClick={() => window.open(doc.fileUrl, '_blank')}
                            className="text-blue-600 hover:text-blue-900"
                            title="View"
                          >
                            <FaEye />
                          </button>
                          <a
                            href={doc.fileUrl}
                            download={doc.fileName}
                            className="text-green-600 hover:text-green-900"
                            title="Download"
                          >
                            <FaDownload />
                          </a>
                          <button
                            onClick={() => handleDelete(doc._id)}
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
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && !uploading && setShowModal(false)}>
          <div className="modal-backdrop" />
          <div className="modal-container modal-md">
            <div className="modal-header">
              <h2 className="modal-title">Upload Document</h2>
              <button
                onClick={() => {
                  if (!uploading) {
                    setShowModal(false)
                    resetUploadForm()
                  }
                }}
                className="modal-close-btn"
                disabled={uploading}
              >
                <FaTimes className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleUpload}>
              <div className="modal-body space-y-4">
                <div>
                  <label className="modal-label">
                    Document Name *
                  </label>
                  <input
                    type="text"
                    className="modal-input"
                    placeholder="Enter document name"
                    value={uploadForm.fileName}
                    onChange={(e) => setUploadForm(prev => ({ ...prev, fileName: e.target.value }))}
                    disabled={uploading}
                    required
                  />
                </div>

                <div>
                  <label className="modal-label">
                    Category *
                  </label>
                  <select
                    className="modal-select"
                    value={uploadForm.category}
                    onChange={(e) => setUploadForm(prev => ({ ...prev, category: e.target.value }))}
                    disabled={uploading}
                    required
                  >
                    <option value="">Select Category</option>
                    <option value="personal">Personal</option>
                    <option value="employment">Employment</option>
                    <option value="tax">Tax</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                <div>
                  <label className="modal-label">
                    File *
                  </label>
                  <div className="relative">
                    <input
                      ref={fileInputRef}
                      type="file"
                      className="modal-input file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100"
                      onChange={handleFileSelect}
                      disabled={uploading}
                      accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.gif,.xls,.xlsx,.txt"
                    />
                    {selectedFile && (
                      <p className="text-sm text-gray-500 mt-1">
                        Selected: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
                      </p>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    Supported: PDF, DOC, DOCX, Images, Excel, TXT (Max 10MB)
                  </p>
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  onClick={() => {
                    if (!uploading) {
                      setShowModal(false)
                      resetUploadForm()
                    }
                  }}
                  className="modal-btn modal-btn-secondary"
                  disabled={uploading}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="modal-btn modal-btn-primary flex items-center gap-2"
                  disabled={uploading || !selectedFile}
                >
                  {uploading ? (
                    <>
                      <FaSpinner className="animate-spin" />
                      Uploading...
                    </>
                  ) : (
                    <>
                      <FaUpload />
                      Upload
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      </ModalPortal>
    </div>
  )
}

