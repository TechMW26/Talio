'use client'

import { useState, useRef } from 'react'
import toast from 'react-hot-toast'
import { 
  FaUpload, 
  FaFileExcel, 
  FaDownload, 
  FaCheck, 
  FaTimes, 
  FaSpinner,
  FaExclamationTriangle,
  FaInfoCircle,
  FaEye,
  FaTrash
} from 'react-icons/fa'

export default function BulkImportEmployees() {
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [loading, setLoading] = useState(false)
  const [downloadingTemplate, setDownloadingTemplate] = useState(false)
  const [importResult, setImportResult] = useState(null)
  const fileInputRef = useRef(null)

  // Handle file selection
  const handleFileSelect = async (e) => {
    const selectedFile = e.target.files?.[0]
    if (!selectedFile) return

    // Validate file type
    if (!selectedFile.name.match(/\.(xlsx|xls)$/i)) {
      toast.error('Please select a valid Excel file (.xlsx or .xls)')
      return
    }

    // Validate file size (max 5MB)
    if (selectedFile.size > 5 * 1024 * 1024) {
      toast.error('File size must be less than 5MB')
      return
    }

    setFile(selectedFile)
    setImportResult(null)

    // Preview the file
    try {
      const arrayBuffer = await selectedFile.arrayBuffer()
      const XLSX = await import('xlsx')
      const workbook = XLSX.read(arrayBuffer, { type: 'array' })
      const sheetName = workbook.SheetNames[0]
      const worksheet = workbook.Sheets[sheetName]
      const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 })

      if (data.length < 2) {
        toast.error('Excel file appears to be empty')
        setFile(null)
        return
      }

      const headers = data[0]
      const rows = data.slice(1).filter(row => row.some(cell => cell !== undefined && cell !== null && cell !== ''))

      setPreview({
        headers,
        rows: rows.slice(0, 5), // Show first 5 rows
        totalRows: rows.length,
      })

      toast.success(`File loaded: ${rows.length} employee(s) found`)
    } catch (error) {
      console.error('Error reading file:', error)
      toast.error('Failed to read Excel file')
      setFile(null)
    }
  }

  // Handle drag and drop
  const handleDrop = (e) => {
    e.preventDefault()
    const droppedFile = e.dataTransfer.files?.[0]
    if (droppedFile) {
      const event = { target: { files: [droppedFile] } }
      handleFileSelect(event)
    }
  }

  const handleDragOver = (e) => {
    e.preventDefault()
  }

  // Download template
  const handleDownloadTemplate = async () => {
    setDownloadingTemplate(true)
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/employees/bulk-import', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      })

      if (!response.ok) {
        throw new Error('Failed to download template')
      }

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'employee_import_template.xlsx'
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)

      toast.success('Template downloaded successfully')
    } catch (error) {
      console.error('Download error:', error)
      toast.error('Failed to download template')
    } finally {
      setDownloadingTemplate(false)
    }
  }

  // Submit bulk import
  const handleSubmit = async () => {
    if (!file) {
      toast.error('Please select a file first')
      return
    }

    setLoading(true)
    setImportResult(null)

    try {
      const token = localStorage.getItem('token')
      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch('/api/employees/bulk-import', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        body: formData,
      })

      const data = await response.json()

      if (data.success) {
        setImportResult(data.data)
        
        if (data.data.failed.length === 0) {
          toast.success(`All ${data.data.successful.length} employees imported successfully!`)
        } else if (data.data.successful.length > 0) {
          toast.success(`${data.data.successful.length} employees imported. ${data.data.failed.length} failed.`, {
            icon: '⚠️',
          })
        } else {
          toast.error('All imports failed. Please check the errors below.')
        }
      } else {
        toast.error(data.message || 'Import failed')
      }
    } catch (error) {
      console.error('Import error:', error)
      toast.error('An error occurred during import')
    } finally {
      setLoading(false)
    }
  }

  // Clear file
  const handleClear = () => {
    setFile(null)
    setPreview(null)
    setImportResult(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  return (
    <div className="space-y-6">
      {/* Instructions */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <FaInfoCircle className="text-blue-600 text-xl flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-blue-800 mb-2">Bulk Import Instructions</h3>
            <ul className="text-sm text-blue-700 space-y-1">
              <li>• Upload an Excel file (.xlsx or .xls) with employee data</li>
              <li>• Download the template below to see the required columns</li>
              <li>• <strong>Required fields:</strong> Employee Code, First Name, Last Name, Email, Phone, Date of Joining</li>
              <li>• Duplicate emails or employee codes will be skipped</li>
              <li>• Default password is "employee123" if not specified</li>
              <li>• All employees will be required to change password on first login</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Download Template Button */}
      <div>
        <button
          onClick={handleDownloadTemplate}
          disabled={downloadingTemplate}
          className="btn-secondary flex items-center gap-2"
        >
          {downloadingTemplate ? (
            <FaSpinner className="animate-spin" />
          ) : (
            <FaDownload />
          )}
          <span>Download Template</span>
        </button>
        <p className="text-xs text-gray-500 mt-1">
          Download a sample Excel template with all supported columns
        </p>
      </div>

      {/* File Upload Area */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
          file ? 'border-green-400 bg-green-50' : 'border-gray-300 hover:border-primary-400 hover:bg-gray-50'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls"
          onChange={handleFileSelect}
          className="hidden"
        />

        {file ? (
          <div className="space-y-3">
            <div className="flex items-center justify-center gap-3">
              <FaFileExcel className="text-4xl text-green-600" />
              <div className="text-left">
                <p className="font-semibold text-gray-800">{file.name}</p>
                <p className="text-sm text-gray-500">
                  {(file.size / 1024).toFixed(1)} KB • {preview?.totalRows || 0} row(s) found
                </p>
              </div>
            </div>
            <div className="flex justify-center gap-3">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="text-sm text-primary-600 hover:text-primary-700"
              >
                Change file
              </button>
              <button
                onClick={handleClear}
                className="text-sm text-red-600 hover:text-red-700 flex items-center gap-1"
              >
                <FaTrash className="text-xs" /> Remove
              </button>
            </div>
          </div>
        ) : (
          <div
            onClick={() => fileInputRef.current?.click()}
            className="cursor-pointer"
          >
            <FaUpload className="text-4xl text-gray-400 mx-auto mb-3" />
            <p className="text-gray-600 font-medium">
              Drag and drop an Excel file here
            </p>
            <p className="text-sm text-gray-500 mt-1">
              or <span className="text-primary-600 hover:underline">browse to upload</span>
            </p>
            <p className="text-xs text-gray-400 mt-2">
              Supported formats: .xlsx, .xls (max 5MB)
            </p>
          </div>
        )}
      </div>

      {/* Preview Section */}
      {preview && !importResult && (
        <div className="bg-white border rounded-lg overflow-hidden">
          <div className="bg-gray-50 px-4 py-3 border-b flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FaEye className="text-gray-500" />
              <span className="font-medium text-gray-700">Preview</span>
              <span className="text-sm text-gray-500">
                (showing {Math.min(5, preview.rows.length)} of {preview.totalRows} rows)
              </span>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">#</th>
                  {preview.headers.slice(0, 8).map((header, i) => (
                    <th key={i} className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">
                      {header}
                    </th>
                  ))}
                  {preview.headers.length > 8 && (
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">...</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {preview.rows.map((row, rowIdx) => (
                  <tr key={rowIdx} className="hover:bg-gray-50">
                    <td className="px-3 py-2 text-gray-500">{rowIdx + 2}</td>
                    {row.slice(0, 8).map((cell, cellIdx) => (
                      <td key={cellIdx} className="px-3 py-2 text-gray-700 whitespace-nowrap max-w-[150px] truncate">
                        {cell || '-'}
                      </td>
                    ))}
                    {row.length > 8 && (
                      <td className="px-3 py-2 text-gray-400">...</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Import Button */}
      {file && !importResult && (
        <div className="flex justify-end gap-3">
          <button
            onClick={handleClear}
            className="btn-secondary"
            disabled={loading}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="btn-primary flex items-center gap-2"
          >
            {loading ? (
              <>
                <FaSpinner className="animate-spin" />
                <span>Importing...</span>
              </>
            ) : (
              <>
                <FaUpload />
                <span>Import {preview?.totalRows || 0} Employee(s)</span>
              </>
            )}
          </button>
        </div>
      )}

      {/* Results Section */}
      {importResult && (
        <div className="space-y-4">
          {/* Summary */}
          <div className={`rounded-lg p-4 ${
            importResult.failed.length === 0 
              ? 'bg-green-50 border border-green-200' 
              : importResult.successful.length > 0 
                ? 'bg-yellow-50 border border-yellow-200'
                : 'bg-red-50 border border-red-200'
          }`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {importResult.failed.length === 0 ? (
                  <FaCheck className="text-2xl text-green-600" />
                ) : (
                  <FaExclamationTriangle className="text-2xl text-yellow-600" />
                )}
                <div>
                  <h3 className="font-semibold text-gray-800">Import Complete</h3>
                  <p className="text-sm text-gray-600">
                    {importResult.successful.length} succeeded • {importResult.failed.length} failed
                  </p>
                </div>
              </div>
              <button
                onClick={handleClear}
                className="btn-secondary text-sm"
              >
                Import More
              </button>
            </div>
          </div>

          {/* Success List */}
          {importResult.successful.length > 0 && (
            <div className="bg-white border rounded-lg overflow-hidden">
              <div className="bg-green-50 px-4 py-3 border-b">
                <h4 className="font-medium text-green-800 flex items-center gap-2">
                  <FaCheck className="text-green-600" />
                  Successfully Created ({importResult.successful.length})
                </h4>
              </div>
              <div className="overflow-x-auto max-h-60 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Row</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Employee Code</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Name</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Email</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Password</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {importResult.successful.map((item, idx) => (
                      <tr key={idx} className="hover:bg-gray-50">
                        <td className="px-4 py-2 text-gray-500">{item.rowNumber}</td>
                        <td className="px-4 py-2 font-medium text-gray-800">{item.employeeCode}</td>
                        <td className="px-4 py-2 text-gray-700">{item.name}</td>
                        <td className="px-4 py-2 text-gray-600">{item.email}</td>
                        <td className="px-4 py-2 text-gray-600 font-mono text-xs">{item.credentials?.password}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Failure List */}
          {importResult.failed.length > 0 && (
            <div className="bg-white border border-red-200 rounded-lg overflow-hidden">
              <div className="bg-red-50 px-4 py-3 border-b border-red-200">
                <h4 className="font-medium text-red-800 flex items-center gap-2">
                  <FaTimes className="text-red-600" />
                  Failed to Import ({importResult.failed.length})
                </h4>
              </div>
              <div className="overflow-x-auto max-h-60 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Row</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Employee Code</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Name</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Error(s)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {importResult.failed.map((item, idx) => (
                      <tr key={idx} className="hover:bg-red-50">
                        <td className="px-4 py-2 text-gray-500">{item.rowNumber}</td>
                        <td className="px-4 py-2 font-medium text-gray-800">{item.employeeCode}</td>
                        <td className="px-4 py-2 text-gray-700">{item.name}</td>
                        <td className="px-4 py-2">
                          <ul className="text-red-600 text-xs list-disc list-inside">
                            {item.errors.map((err, errIdx) => (
                              <li key={errIdx}>{err}</li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
