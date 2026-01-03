'use client'

import { useState, useRef } from 'react'
import toast from '@/utils/toast'
import { useAILoading } from '@/contexts/AILoadingContext'
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
  FaTrash,
  FaRobot,
  FaArrowRight,
  FaEdit
} from 'react-icons/fa'

export default function BulkImportEmployees() {
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [loading, setLoading] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [downloadingTemplate, setDownloadingTemplate] = useState(false)
  const [importResult, setImportResult] = useState(null)
  const fileInputRef = useRef(null)
  
  // Bulk selection state
  const [selectedRows, setSelectedRows] = useState(new Set())
  
  // Inline editing state
  const [editingCell, setEditingCell] = useState(null) // { rowIdx, fieldKey }
  const [editValue, setEditValue] = useState('')
  
  // Global AI loading animation
  const { startAILoading, stopAILoading } = useAILoading()

  // Handle row selection toggle
  const toggleRowSelection = (rowIdx) => {
    setSelectedRows(prev => {
      const newSet = new Set(prev)
      if (newSet.has(rowIdx)) {
        newSet.delete(rowIdx)
      } else {
        newSet.add(rowIdx)
      }
      return newSet
    })
  }

  // Handle select all toggle
  const toggleSelectAll = () => {
    if (!preview?.transformedRows) return
    if (selectedRows.size === preview.transformedRows.length) {
      setSelectedRows(new Set())
    } else {
      setSelectedRows(new Set(preview.transformedRows.map((_, idx) => idx)))
    }
  }

  // Delete selected rows
  const deleteSelectedRows = () => {
    if (selectedRows.size === 0 || !preview) return
    
    const newRows = preview.transformedRows.filter((_, idx) => !selectedRows.has(idx))
    const newWarnings = preview.rowWarnings?.filter(w => !selectedRows.has(w.rowNumber - 2)) || []
    
    setPreview({
      ...preview,
      transformedRows: newRows,
      totalRows: newRows.length,
      rowWarnings: newWarnings.map((w, i) => ({ ...w, rowNumber: i + 2 }))
    })
    setSelectedRows(new Set())
    toast.success(`Removed ${selectedRows.size} row(s) from preview`)
  }

  // Delete a single row by index
  const deleteSingleRow = (rowIdx) => {
    if (!preview) return
    
    const newRows = preview.transformedRows.filter((_, idx) => idx !== rowIdx)
    const newWarnings = preview.rowWarnings?.filter(w => w.rowNumber - 2 !== rowIdx) || []
    
    setPreview({
      ...preview,
      transformedRows: newRows,
      totalRows: newRows.length,
      rowWarnings: newWarnings.map((w, i) => ({ ...w, rowNumber: i + 2 }))
    })
    // Also remove from selected if it was selected
    if (selectedRows.has(rowIdx)) {
      const newSelected = new Set(selectedRows)
      newSelected.delete(rowIdx)
      setSelectedRows(newSelected)
    }
    toast.success('Removed 1 row from preview')
  }

  // Start editing a cell
  const startEditing = (rowIdx, fieldKey, currentValue) => {
    setEditingCell({ rowIdx, fieldKey })
    setEditValue(currentValue || '')
  }

  // Save cell edit
  const saveEdit = () => {
    if (!editingCell || !preview) return
    
    const { rowIdx, fieldKey } = editingCell
    const newRows = [...preview.transformedRows]
    newRows[rowIdx] = { ...newRows[rowIdx], [fieldKey]: editValue }
    
    setPreview({ ...preview, transformedRows: newRows })
    setEditingCell(null)
    setEditValue('')
  }

  // Cancel cell edit
  const cancelEdit = () => {
    setEditingCell(null)
    setEditValue('')
  }

  // Handle key press in edit input
  const handleEditKeyPress = (e) => {
    if (e.key === 'Enter') {
      saveEdit()
    } else if (e.key === 'Escape') {
      cancelEdit()
    }
  }

  // Handle file selection - use AI preview API
  const handleFileSelect = async (e) => {
    const selectedFile = e.target.files?.[0]
    if (!selectedFile) return

    // Validate file type
    if (!selectedFile.name.match(/\.(xlsx|xls)$/i)) {
      toast.error('Please select a valid Excel file (.xlsx or .xls)')
      return
    }

    // Validate file size (max 10MB)
    if (selectedFile.size > 10 * 1024 * 1024) {
      toast.error('File size must be less than 10MB')
      return
    }

    setFile(selectedFile)
    setImportResult(null)
    setPreviewLoading(true)
    startAILoading('MIRA is analyzing your Excel file...')

    // Call preview API to get AI-mapped data
    try {
      const formData = new FormData()
      formData.append('file', selectedFile)

      const response = await fetch('/api/employees/bulk-import/preview', {
        method: 'POST',
        body: formData,
      })

      const data = await response.json()

      if (data.success) {
        setPreview(data.data)
        
        if (data.data.warnings?.length > 0) {
          data.data.warnings.forEach(w => toast.error(w, { duration: 5000 }))
        } else {
          toast.success(
            `🤖 AI analyzed ${data.data.totalRows} employees. Detected ${data.data.detectedMappings?.length || 0} field mappings.`,
            { duration: 4000, icon: '✅' }
          )
        }
      } else {
        toast.error(data.message || 'Failed to analyze file')
        setFile(null)
        setPreview(null)
      }
    } catch (error) {
      console.error('Preview error:', error)
      toast.error('Failed to analyze Excel file')
      setFile(null)
      setPreview(null)
    } finally {
      setPreviewLoading(false)
      stopAILoading()
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
      // Download the sample file directly from public folder
      const response = await fetch('/Sample File.xlsx')

      if (!response.ok) {
        throw new Error('Failed to download template')
      }

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'Employee_Import_Template.xlsx'
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

        // Show column mapping info if available
        if (data.data.detectedColumns && data.data.detectedColumns.length > 0) {
          console.log('AI detected columns:', data.data.detectedColumns)
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
    setPreviewLoading(false)
    setSelectedRows(new Set())
    setEditingCell(null)
    setEditValue('')
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
            <h3 className="font-semibold text-blue-800 mb-2">Smart Bulk Import</h3>
            <ul className="text-sm text-blue-700 space-y-1">
              <li>• Upload <strong>any Excel file</strong> with employee data - AI will auto-detect columns</li>
              <li>• No need to match exact column names - we&apos;ll figure out what each column contains</li>
              <li>• <strong>Required:</strong> Email column (used to identify employees)</li>
              <li>• <strong>Auto-detected:</strong> Name, Phone, DOB, DOJ, Department, Designation, etc.</li>
              <li>• <strong>Smart matching:</strong> Departments &amp; Designations fuzzy-matched or auto-created</li>
              <li>• <strong>Upsert:</strong> Re-importing with same email updates existing records</li>
              <li>• Excel date serial numbers (like 45628) are automatically converted</li>
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
              Supported formats: .xlsx, .xls (max 10MB)
            </p>
          </div>
        )}
      </div>

      {/* Loading State */}
      {previewLoading && (
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-6 text-center">
          <FaSpinner className="animate-spin text-3xl text-purple-600 mx-auto mb-3" />
          <p className="text-purple-800 font-medium">MIRA is analyzing your Excel file.</p>
          <p className="text-purple-600 text-sm mt-1">Detecting columns, extracting data, and mapping to our template</p>
        </div>
      )}

      {/* AI Mapping Info */}
      {preview && !importResult && preview.detectedMappings?.length > 0 && (
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
          <h4 className="font-medium text-purple-800 mb-3 flex items-center gap-2">
            <FaRobot className="text-purple-600" />
            AI Column Detection ({preview.mappingMethod === 'ai' ? 'AI Analysis' : 'Pattern Matching'})
          </h4>
          <div className="flex flex-wrap gap-2">
            {preview.detectedMappings.map((mapping, idx) => (
              <span key={idx} className="inline-flex items-center gap-1 px-3 py-1.5 bg-purple-100 text-purple-700 rounded-full text-sm">
                <span className="font-medium">{mapping.sourceColumn}</span>
                <FaArrowRight className="text-xs text-purple-400" />
                <span className="text-purple-800">{mapping.targetField}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Row Warnings */}
      {preview && !importResult && preview.rowWarnings?.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <FaExclamationTriangle className="text-yellow-600" />
            <span className="font-medium text-yellow-800">
              Warnings ({preview.rowWarnings.length} row(s))
            </span>
          </div>
          <p className="text-sm text-yellow-700 mb-3">
            These rows have issues but will still be imported. Missing data can be added later.
          </p>
          <div className="max-h-40 overflow-y-auto">
            {preview.rowWarnings.slice(0, 10).map((warning, idx) => (
              <div key={idx} className="text-sm text-yellow-700 py-1">
                <span className="font-medium">Row {warning.rowNumber}:</span> {warning.issues.join(', ')}
              </div>
            ))}
            {preview.rowWarnings.length > 10 && (
              <div className="text-sm text-yellow-600 italic">
                ...and {preview.rowWarnings.length - 10} more warnings
              </div>
            )}
          </div>
        </div>
      )}

      {/* Preview Section - Our Template */}
      {preview && !importResult && preview.templateFields && (
        <div className="bg-white border rounded-lg overflow-hidden">
          <div className="bg-gradient-to-r from-green-50 to-blue-50 px-4 py-3 border-b flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FaEye className="text-green-600" />
              <span className="font-medium text-gray-700">Extracted Data Preview</span>
              <span className="text-sm text-gray-500">
                ({preview.totalRows} employees detected)
              </span>
            </div>
            <div className="flex items-center gap-3">
              {selectedRows.size > 0 && (
                <button
                  onClick={deleteSelectedRows}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm text-red-600 hover:text-red-700 hover:bg-red-50 rounded-md transition-colors"
                >
                  <FaTrash className="text-xs" />
                  Remove {selectedRows.size} selected
                </button>
              )}
              <span className="flex items-center gap-1 text-sm text-green-600 font-medium">
                <FaCheck className="text-green-600" />
                Data mapped to Talio template
              </span>
            </div>
          </div>
          
          {/* Bulk actions bar */}
          {selectedRows.size > 0 && (
            <div className="bg-blue-50 px-4 py-2 border-b flex items-center gap-4">
              <span className="text-sm text-blue-700">
                {selectedRows.size} of {preview.transformedRows.length} row(s) selected
              </span>
              <button
                onClick={() => setSelectedRows(new Set())}
                className="text-sm text-blue-600 hover:text-blue-800 underline"
              >
                Clear selection
              </button>
            </div>
          )}
          
          <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
            <table className="w-full text-sm min-w-[1200px]">
              <thead className="bg-gray-100 sticky top-0 z-10">
                <tr>
                  {/* Select All Checkbox */}
                  <th className="px-2 py-2 text-center w-10">
                    <input
                      type="checkbox"
                      checked={preview.transformedRows.length > 0 && selectedRows.size === preview.transformedRows.length}
                      onChange={toggleSelectAll}
                      className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500 cursor-pointer"
                      title="Select all rows"
                    />
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">#</th>
                  {preview.templateFields.map((field, i) => (
                    <th 
                      key={i} 
                      className={`px-3 py-2 text-left text-xs font-medium uppercase whitespace-nowrap ${
                        field.required ? 'text-red-600' : 'text-gray-500'
                      }`}
                      title={field.description}
                    >
                      {field.label}
                      {field.required && <span className="text-red-500 ml-1">*</span>}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase w-16">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {preview.transformedRows.map((row, rowIdx) => {
                  const hasWarning = preview.rowWarnings?.some(w => w.rowNumber === rowIdx + 2)
                  const isSelected = selectedRows.has(rowIdx)
                  return (
                    <tr 
                      key={rowIdx} 
                      className={`
                        ${isSelected ? 'bg-blue-50' : hasWarning ? 'bg-yellow-50' : ''}
                        ${isSelected ? 'hover:bg-blue-100' : hasWarning ? 'hover:bg-yellow-100' : 'hover:bg-gray-50'}
                      `}
                    >
                      {/* Row Selection Checkbox */}
                      <td className="px-2 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleRowSelection(rowIdx)}
                          className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500 cursor-pointer"
                        />
                      </td>
                      <td className="px-3 py-2 text-gray-400 font-mono text-xs">
                        {rowIdx + 1}
                      </td>
                      {preview.templateFields.map((field, cellIdx) => {
                        const value = row[field.key] || ''
                        const isEmpty = !value
                        const isMissingRequired = field.required && isEmpty
                        const isEditing = editingCell?.rowIdx === rowIdx && editingCell?.fieldKey === field.key
                        
                        return (
                          <td 
                            key={cellIdx} 
                            className={`px-3 py-2 whitespace-nowrap max-w-[180px] ${
                              isMissingRequired ? 'bg-red-100 text-red-600' :
                              isEmpty ? 'text-gray-300' : 'text-gray-700'
                            }`}
                            title={isEditing ? '' : (value || 'Empty - Double click to edit')}
                            onDoubleClick={() => !isEditing && startEditing(rowIdx, field.key, value)}
                          >
                            {isEditing ? (
                              <input
                                type="text"
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onKeyDown={handleEditKeyPress}
                                onBlur={saveEdit}
                                className="w-full px-1 py-0.5 text-sm border border-primary-400 rounded focus:outline-none focus:ring-1 focus:ring-primary-500"
                                autoFocus
                              />
                            ) : (
                              <span className="truncate block">{value || '-'}</span>
                            )}
                          </td>
                        )
                      })}
                      {/* Row Actions */}
                      <td className="px-3 py-2 text-center">
                        <button
                          onClick={() => deleteSingleRow(rowIdx)}
                          className="p-1 text-gray-400 hover:text-red-600 rounded transition-colors"
                          title="Remove this row"
                        >
                          <FaTrash className="text-xs" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          
          {/* Help text */}
          <div className="bg-gray-50 px-4 py-2 border-t text-xs text-gray-500 flex items-center gap-4">
            <span className="flex items-center gap-1">
              <FaEdit className="text-gray-400" />
              Double-click a cell to edit
            </span>
            <span>•</span>
            <span>Use checkboxes to select multiple rows for bulk removal</span>
          </div>
        </div>
      )}

      {/* Import Button */}
      {file && !importResult && preview && !previewLoading && (
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
          {/* AI Column Detection Info */}
          {importResult.detectedColumns?.length > 0 && (
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
              <h4 className="font-medium text-purple-800 mb-2 flex items-center gap-2">
                <span className="text-lg">🤖</span>
                AI Detected Columns ({importResult.mappingMethod === 'ai' ? 'AI Analysis' : 'Pattern Matching'})
              </h4>
              <div className="flex flex-wrap gap-2">
                {importResult.detectedColumns.map((col, idx) => (
                  <span key={idx} className="px-2 py-1 bg-purple-100 text-purple-700 rounded text-xs">
                    <strong>{col.column}</strong> → {col.field}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Summary */}
          <div className={`rounded-lg p-4 ${
            importResult.failed?.length === 0 
              ? 'bg-green-50 border border-green-200' 
              : (importResult.created?.length > 0 || importResult.updated?.length > 0)
                ? 'bg-yellow-50 border border-yellow-200'
                : 'bg-red-50 border border-red-200'
          }`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {importResult.failed?.length === 0 ? (
                  <FaCheck className="text-2xl text-green-600" />
                ) : (
                  <FaExclamationTriangle className="text-2xl text-yellow-600" />
                )}
                <div>
                  <h3 className="font-semibold text-gray-800">Import Complete</h3>
                  <p className="text-sm text-gray-600">
                    {importResult.created?.length || 0} created • {importResult.updated?.length || 0} updated • {importResult.failed?.length || 0} failed
                  </p>
                  {(importResult.departmentsCreated > 0 || importResult.designationsCreated > 0) && (
                    <p className="text-xs text-blue-600 mt-1">
                      {importResult.departmentsCreated > 0 && `${importResult.departmentsCreated} new department(s) created`}
                      {importResult.departmentsCreated > 0 && importResult.designationsCreated > 0 && ' • '}
                      {importResult.designationsCreated > 0 && `${importResult.designationsCreated} new designation(s) created`}
                    </p>
                  )}
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

          {/* Created List */}
          {importResult.created?.length > 0 && (
            <div className="bg-white border rounded-lg overflow-hidden">
              <div className="bg-green-50 px-4 py-3 border-b">
                <h4 className="font-medium text-green-800 flex items-center gap-2">
                  <FaCheck className="text-green-600" />
                  New Employees Created ({importResult.created.length})
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
                    {importResult.created.map((item, idx) => (
                      <tr key={idx} className="hover:bg-gray-50">
                        <td className="px-4 py-2 text-gray-500">{item.rowNumber}</td>
                        <td className="px-4 py-2 font-medium text-gray-800">{item.employeeCode}</td>
                        <td className="px-4 py-2 text-gray-700">{item.name}</td>
                        <td className="px-4 py-2 text-gray-600">{item.email}</td>
                        <td className="px-4 py-2 text-gray-600 font-mono text-xs">{item.credentials?.password || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Updated List */}
          {importResult.updated?.length > 0 && (
            <div className="bg-white border border-blue-200 rounded-lg overflow-hidden">
              <div className="bg-blue-50 px-4 py-3 border-b border-blue-200">
                <h4 className="font-medium text-blue-800 flex items-center gap-2">
                  <FaInfoCircle className="text-blue-600" />
                  Existing Employees Updated ({importResult.updated.length})
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
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Warnings</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {importResult.updated.map((item, idx) => (
                      <tr key={idx} className="hover:bg-blue-50">
                        <td className="px-4 py-2 text-gray-500">{item.rowNumber}</td>
                        <td className="px-4 py-2 font-medium text-gray-800">{item.employeeCode}</td>
                        <td className="px-4 py-2 text-gray-700">{item.name}</td>
                        <td className="px-4 py-2 text-gray-600">{item.email}</td>
                        <td className="px-4 py-2">
                          {item.warnings?.length > 0 ? (
                            <ul className="text-yellow-600 text-xs list-disc list-inside">
                              {item.warnings.map((warn, warnIdx) => (
                                <li key={warnIdx}>{warn}</li>
                              ))}
                            </ul>
                          ) : (
                            <span className="text-gray-400 text-xs">No warnings</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Failure List */}
          {importResult.failed?.length > 0 && (
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
