'use client'

import { useState, useEffect, useRef } from 'react'
import toast from '@/utils/toast'
import { useSocket, REALTIME_EVENTS } from '@/contexts/SocketContext'
import { FaPlus, FaFile, FaDownload, FaEye, FaTrash, FaTimes, FaUpload } from 'react-icons/fa'
import { getCurrentUser, getEmployeeId } from '@/utils/userHelper'
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button, Input, Select, SelectItem } from '@heroui/react'
import Loader from '@/components/ui/Loader'

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
  
  // Preview modal state
  const [previewDoc, setPreviewDoc] = useState(null)
  const [showPreview, setShowPreview] = useState(false)

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
        <Button
          onPress={() => setShowModal(true)}
          color="primary"
          startContent={<FaPlus />}
        >
          Upload Document
        </Button>
      </div>

      {/* Document Categories */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        {['Identity', 'Personal', 'Employment', 'Tax', 'Other'].map((category) => (
          <div key={category} className="bg-white rounded-lg shadow-md p-6">
            <div className="flex items-center justify-start mb-2">
              <h3 className="text-sm font-medium text-gray-600">{category}</h3>
              <FaFile className={`ml-2 ${category === 'Identity' ? 'text-green-500' : 'text-primary-500'}`} />
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
            <Loader size="lg" className="mx-auto" />
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
                          <FaFile className={`mr-3 ${doc.isAadhaarDocument ? 'text-green-500' : 'text-primary-500'}`} />
                          <div>
                            <div className="text-sm font-medium text-gray-900 flex items-center gap-2">
                              {doc.fileName || doc.name}
                              {doc.isAadhaarDocument && (
                                <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-700">
                                  Verified
                                </span>
                              )}
                            </div>
                            <div className="text-sm text-gray-500">{doc.fileType || doc.type}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                          doc.category === 'identity' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'
                        }`}>
                          {doc.category}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {doc.isAadhaarDocument ? '-' : formatFileSize(doc.fileSize || 0)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {formatDate(doc.createdAt)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <div className="flex space-x-2">
                          <button
                            onClick={() => {
                              setPreviewDoc(doc)
                              setShowPreview(true)
                            }}
                            className="text-blue-600 hover:text-blue-900"
                            title="View"
                          >
                            <FaEye />
                          </button>
                          <a
                            href={doc.fileUrl || doc.url}
                            download={doc.fileName || doc.name}
                            className="text-green-600 hover:text-green-900"
                            title="Download"
                          >
                            <FaDownload />
                          </a>
                          {!doc.isAadhaarDocument && (
                            <button
                              onClick={() => handleDelete(doc._id)}
                              className="text-red-600 hover:text-red-900"
                              title="Delete"
                            >
                              <FaTrash />
                            </button>
                          )}
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
      <Modal isOpen={showModal} onOpenChange={(open) => { if (!open && !uploading) { setShowModal(false); resetUploadForm(); } }} size="lg">
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>Upload Document</ModalHeader>
              <form onSubmit={handleUpload}>
                <ModalBody className="space-y-4">
                  <Input
                    type="text"
                    label="Document Name"
                    isRequired
                    placeholder="Enter document name"
                    value={uploadForm.fileName}
                    onChange={(e) => setUploadForm(prev => ({ ...prev, fileName: e.target.value }))}
                    isDisabled={uploading}
                  />

                  <Select
                    label="Category"
                    isRequired
                    selectedKeys={uploadForm.category ? [uploadForm.category] : []}
                    onSelectionChange={(keys) => setUploadForm(prev => ({ ...prev, category: Array.from(keys)[0] || '' }))}
                    isDisabled={uploading}
                    placeholder="Select Category"
                  >
                    <SelectItem key="personal">Personal</SelectItem>
                    <SelectItem key="employment">Employment</SelectItem>
                    <SelectItem key="tax">Tax</SelectItem>
                    <SelectItem key="other">Other</SelectItem>
                  </Select>

                  <div>
                    <label className="text-sm font-medium text-default-700 mb-2 block">File *</label>
                    <div className="relative">
                      <input
                        ref={fileInputRef}
                        type="file"
                        className="w-full p-2 border border-default-200 rounded-lg file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100"
                        onChange={handleFileSelect}
                        disabled={uploading}
                        accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.gif,.xls,.xlsx,.txt"
                      />
                      {selectedFile && (
                        <p className="text-sm text-default-500 mt-1">
                          Selected: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
                        </p>
                      )}
                    </div>
                    <p className="text-xs text-default-400 mt-1">
                      Supported: PDF, DOC, DOCX, Images, Excel, TXT (Max 10MB)
                    </p>
                  </div>
                </ModalBody>

                <ModalFooter>
                  <Button
                    variant="light"
                    onPress={() => {
                      if (!uploading) {
                        onClose()
                        resetUploadForm()
                      }
                    }}
                    isDisabled={uploading}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    color="primary"
                    isLoading={uploading}
                    isDisabled={uploading || !selectedFile}
                    startContent={!uploading && <FaUpload />}
                  >
                    {uploading ? 'Uploading...' : 'Upload'}
                  </Button>
                </ModalFooter>
              </form>
            </>
          )}
        </ModalContent>
      </Modal>

      {/* Document Preview Modal */}
      <Modal 
        isOpen={showPreview} 
        onOpenChange={(open) => {
          setShowPreview(open)
          if (!open) setPreviewDoc(null)
        }} 
        size="4xl"
        scrollBehavior="inside"
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex flex-col gap-1">
                <span>{previewDoc?.fileName || previewDoc?.name || 'Document Preview'}</span>
                <span className="text-sm font-normal text-gray-500 capitalize">{previewDoc?.category}</span>
              </ModalHeader>
              <ModalBody className="p-0">
                {previewDoc && (
                  <div className="flex items-center justify-center bg-gray-100 min-h-[400px] max-h-[70vh]">
                    {(previewDoc.fileType?.startsWith('image') || previewDoc.type?.startsWith('image') || previewDoc.isAadhaarDocument) ? (
                      <img 
                        src={previewDoc.fileUrl || previewDoc.url} 
                        alt={previewDoc.fileName || previewDoc.name}
                        className="max-w-full max-h-[70vh] object-contain"
                      />
                    ) : previewDoc.fileType === 'application/pdf' || previewDoc.type === 'application/pdf' ? (
                      <iframe
                        src={previewDoc.fileUrl || previewDoc.url}
                        className="w-full h-[70vh]"
                        title={previewDoc.fileName || previewDoc.name}
                      />
                    ) : (
                      <div className="text-center p-8">
                        <FaFile className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                        <p className="text-gray-600 mb-4">Preview not available for this file type</p>
                        <a
                          href={previewDoc.fileUrl || previewDoc.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary-600 hover:text-primary-700 underline"
                        >
                          Open in new tab
                        </a>
                      </div>
                    )}
                  </div>
                )}
              </ModalBody>
              <ModalFooter>
                <Button variant="light" onPress={onClose}>
                  Close
                </Button>
                <a
                  href={previewDoc?.fileUrl || previewDoc?.url}
                  download={previewDoc?.fileName || previewDoc?.name}
                >
                  <Button color="primary" startContent={<FaDownload />}>
                    Download
                  </Button>
                </a>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  )
}

