'use client'
import { SummaryCard } from '@/components/ui/fernly'



import { UploadInput } from '@/components/ui/UploadButton'
import { Heading1, Heading3, Heading2, NativeInput } from '@/components/ui/fernly/native'
import { useState, useEffect, useRef, useMemo } from 'react'
import toast from '@/utils/toast'
import { useSocket, REALTIME_EVENTS } from '@/contexts/SocketContext'
import { FaPlus, FaFile, FaDownload, FaEye, FaTrash, FaTimes, FaUpload } from 'react-icons/fa'
import { getEmployeeId } from '@/utils/userHelper'
import { Modal as Modal } from '@/components/ui/fernly'
import { ModalContent, ModalHeader, ModalBody, ModalFooter, Button, Input, Select, SelectItem, Skeleton } from '@/components/ui/fernly'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import useApiMutation from '@/hooks/useApiMutation'
import LoadingButton from '@/components/ui/LoadingButton'
import { DataErrorState } from '@/components/ui/ErrorBoundary'
import BackgroundRefreshIndicator from '@/components/ui/BackgroundRefreshIndicator'
import { uploadAuthenticatedFile } from '@/lib/client/uploadFile'
import { fetchDocumentFile, downloadDocumentFile } from '@/lib/client/documentFile'
import EmployeeOnboardingDocuments from '@/components/employees/EmployeeOnboardingDocuments'
import DocumentFolders, { buildDocumentFolders } from '@/components/employees/DocumentFolders'
import DocumentGrid from '@/components/employees/DocumentGrid'
import FolderDocumentSurface from '@/components/employees/FolderDocumentSurface'

export default function DocumentsPage() {
  const { user, employeeId } = useMemo(() => {
    try {
      const parsedUser = JSON.parse(localStorage.getItem('user'))
      const empId = parsedUser ? getEmployeeId(parsedUser) : null
      return { user: parsedUser, employeeId: empId }
    } catch { return { user: null, employeeId: null } }
  }, [])

  const canManageDocuments = Boolean(user && ['admin', 'super_admin', 'hr'].includes(user.role))
  const [documentScope, setDocumentScope] = useState('personal')
  const [selectedFolderId, setSelectedFolderId] = useState(null)
  const folderSource = useRef(null)
  const organisationView = canManageDocuments && documentScope === 'public'

  // SWR data fetching
  // Personal scope needs only this employee's documents, even for an admin.
  // Do not download the entire tenant archive before rendering two cards.
  const swrKey = organisationView ? '/api/documents' : employeeId ? `/api/documents?employeeId=${encodeURIComponent(employeeId)}` : null
  const { data: docsRes, error, isLoading, isValidating, mutate: refreshDocuments } = useAuthedSWR(swrKey, { keepPreviousData: false })
  const documents = (docsRes?.data || []).filter(document => organisationView || (employeeId && String(document.employee?._id || document.employee || '') === String(employeeId)))

  const [showModal, setShowModal] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadForm, setUploadForm] = useState({
    fileName: '',
    category: '',
    employee: '',
  })
  const [selectedFile, setSelectedFile] = useState(null)
  const fileInputRef = useRef(null)
  const { data: employeeOptionsRes, error: employeeOptionsError, isLoading: employeesLoading, mutate: refreshEmployees } = useAuthedSWR(
    organisationView
      ? '/api/employees?all=true&status=active,probation,on_leave&limit=1000&sortBy=firstName&sortOrder=asc'
      : null
  )
  const employeeOptions = employeeOptionsRes?.data || []
  const folders = organisationView ? buildDocumentFolders(documents, employeeOptions) : []
  const selectedFolder = folders.find(folder => folder.id === selectedFolderId)

  // Preview modal state
  const [previewDoc, setPreviewDoc] = useState(null)
  const [showPreview, setShowPreview] = useState(false)
  const [previewFile, setPreviewFile] = useState(null)
  const [previewError, setPreviewError] = useState('')
  const [previewAttempt, setPreviewAttempt] = useState(0)
  useEffect(() => {
    setPreviewFile(null)
    setPreviewError('')
    if (!showPreview || !previewDoc) return
    const controller = new AbortController()
    let objectUrl
    fetchDocumentFile(previewDoc.fileUrl || previewDoc.url, { signal: controller.signal })
      .then(blob => {
        if (controller.signal.aborted) return
        objectUrl = URL.createObjectURL(blob)
        setPreviewFile({ url: objectUrl, type: blob.type })
      })
      .catch(error => { if (!controller.signal.aborted) setPreviewError(error.message) })
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [showPreview, previewDoc, previewAttempt])
  const downloadDocument = async (document) => {
    try { await downloadDocumentFile(document) }
    catch (error) { toast.error(error.message) }
  }

  // Real-time updates
  const { socket, isConnected, subscribe, onDocumentUpdate } = useSocket()

  // Subscribe to real-time document updates
  useEffect(() => {
    if (!socket || !isConnected || !employeeId) return

    const handleDocumentUpdate = () => refreshDocuments()

    const unsub1 = onDocumentUpdate?.(handleDocumentUpdate)
    const unsub2 = subscribe?.(REALTIME_EVENTS.DOCUMENT_UPDATE, handleDocumentUpdate)

    return () => {
      unsub1?.()
      unsub2?.()
    }
  }, [socket, isConnected, employeeId, refreshDocuments])

  // Delete mutation
  const deleteMutation = useApiMutation({
    method: 'DELETE',
    invalidateKeys: [swrKey],
    onSuccess: () => toast.success('Document deleted successfully'),
    onError: (msg) => toast.error(msg || 'Failed to delete document'),
  })

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
    setUploadForm({ fileName: '', category: '', employee: '' })
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

    if (!organisationView && !employeeId) {
      toast.error('An employee profile is required to upload personal documents')
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

      const uploadData = await uploadAuthenticatedFile(selectedFile, {
        category: 'documents',
        token,
      })

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
          employee: organisationView ? uploadForm.employee || undefined : employeeId,
        }),
      })

      const docData = await docResponse.json()

      if (docData.success) {
        toast.success('Document uploaded successfully')
        refreshDocuments()
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

  const handleDelete = (docId) => {
    if (!confirm('Are you sure you want to delete this document?')) return
    deleteMutation.execute(`/api/documents/${docId}`)
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

  // Error state
  if (error) return <DataErrorState message="Failed to load documents" onRetry={() => refreshDocuments()} />

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex md:justify-between md:items-center md:flex-row flex-col mb-6">
        <div>
          <Heading1 className="text-3xl font-bold text-gray-800">Documents</Heading1>
          <p className="text-gray-600 mt-1">{canManageDocuments ? 'Manage employee and company documents' : 'Manage your documents and files'} <BackgroundRefreshIndicator isValidating={isValidating} /></p>
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
      {canManageDocuments && <div role="tablist" aria-label="Document scope" className="flex gap-2 mb-6">
        {[['personal', 'Personal'], ['public', 'Public']].map(([value, label]) => <Button key={value} role="tab" aria-selected={documentScope === value} color={documentScope === value ? 'primary' : 'default'} variant={documentScope === value ? 'solid' : 'bordered'} onPress={() => { setDocumentScope(value); setSelectedFolderId(null); resetUploadForm() }}>{label}</Button>)}
      </div>}
      {organisationView ? <p className="text-sm text-default-500 mb-6">Organisation documents · Employee files remain restricted to authorised Admin and HR users.</p> : <EmployeeOnboardingDocuments onSubmitted={refreshDocuments} />}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        {['Identity', 'Personal', 'Employment', 'Tax', 'Other'].map((category) => (
          <SummaryCard key={category} label={<>{category}</>} value={<>{documents.filter(d => d.category === category.toLowerCase()).length}</>} />
        ))}
      </div>

      {/* Employee folders and document cards */}
      {organisationView && employeeOptionsError && <DataErrorState message="Could not load the employee directory" onRetry={() => refreshEmployees()} />}
      {organisationView ? <DocumentFolders folders={folders} loading={isLoading || employeesLoading} onOpen={(id, element) => { folderSource.current = element; setSelectedFolderId(id) }} /> : <section aria-label="My documents" className="space-y-4">
        <Heading2 className="text-xl font-semibold">My documents</Heading2>
        {isLoading ? <div aria-label="Loading documents" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">{[1, 2, 3, 4].map(id => <Skeleton key={id} className="h-64 rounded-2xl" />)}</div> : <DocumentGrid documents={documents} canManage={canManageDocuments} onPreview={doc => { setPreviewDoc(doc); setShowPreview(true) }} onDownload={downloadDocument} onDelete={handleDelete} />}
      </section>}
      {selectedFolder && <FolderDocumentSurface key={selectedFolder.id} folder={selectedFolder} sourceElement={folderSource.current} onClose={() => setSelectedFolderId(null)} canManage={canManageDocuments} onPreview={doc => { setPreviewDoc(doc); setShowPreview(true) }} onDownload={downloadDocument} onDelete={handleDelete} />}

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
                    <SelectItem key="experience">Experience letter</SelectItem>
                    <SelectItem key="tax">Tax</SelectItem>
                    <SelectItem key="other">Other</SelectItem>
                  </Select>

                  {organisationView && (
                    <Select
                      label="Employee (optional)"
                      description="Leave blank for a company-wide HR document"
                      selectedKeys={uploadForm.employee ? [uploadForm.employee] : []}
                      onSelectionChange={(keys) => setUploadForm((prev) => ({ ...prev, employee: Array.from(keys)[0] || '' }))}
                      isDisabled={uploading}
                      placeholder="Company-wide document"
                    >
                      {employeeOptions.map((employee) => (
                        <SelectItem key={employee._id} textValue={`${employee.firstName} ${employee.lastName} ${employee.employeeCode || ''}`}>
                          {employee.firstName} {employee.lastName}{employee.employeeCode ? ` (${employee.employeeCode})` : ''}
                        </SelectItem>
                      ))}
                    </Select>
                  )}

                  <div>
                    <label className="text-sm font-medium text-default-700 mb-2 block">File *</label>
                    <div className="relative">
                      <UploadInput
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
                  <LoadingButton
                    type="submit"
                    color="primary"
                    isLoading={uploading}
                    loadingText="Uploading..."
                    isDisabled={!selectedFile}
                    startContent={<FaUpload />}
                  >
                    Upload
                  </LoadingButton>
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
                    {previewError ? (
                      <div role="alert" className="p-6 text-center text-default-700">
                        <p>{previewError}</p>
                        <Button className="mt-4" onPress={() => setPreviewAttempt(value => value + 1)}>Retry preview</Button>
                      </div>
                    ) : !previewFile ? (
                      <p role="status" className="p-6 text-default-600">Loading document…</p>
                    ) : (previewFile.type?.startsWith('image') || previewDoc.fileType?.startsWith('image') || previewDoc.type?.startsWith('image') || previewDoc.isAadhaarDocument) ? (
                      <img
                        src={previewFile.url}
                        onError={() => setPreviewError('This image could not be displayed. You can download the original file below.')}
                        alt={previewDoc.fileName || previewDoc.name}
                        className="max-w-full max-h-[70vh] object-contain"
                      />
                    ) : previewFile.type === 'application/pdf' || previewDoc.fileType === 'application/pdf' || previewDoc.type === 'application/pdf' ? (
                      <iframe
                        src={previewFile.url}
                        className="w-full h-[70vh]"
                        title={previewDoc.fileName || previewDoc.name}
                      />
                    ) : (
                      <div className="text-center p-8">
                        <FaFile className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                        <p className="text-gray-600 mb-4">Preview not available for this file type</p>
                        <Button onPress={() => downloadDocument(previewDoc)}>Download original file</Button>
                      </div>
                    )}
                  </div>
                )}
              </ModalBody>
              <ModalFooter>
                <Button variant="light" onPress={onClose}>
                  Close
                </Button>
                  <Button color="primary" startContent={<FaDownload />} onPress={() => previewDoc && downloadDocument(previewDoc)}>
                    Download
                  </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  )
}
