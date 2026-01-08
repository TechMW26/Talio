'use client'

import { useState, useEffect } from 'react'
import { FaMoneyBillWave, FaPlus, FaEdit, FaTrash, FaSave, FaTimes } from 'react-icons/fa'
import toast from '@/utils/toast'
import Loader from '@/components/ui/Loader'

export default function SalaryStructurePage() {
  const [structures, setStructures] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingStructure, setEditingStructure] = useState(null)
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    basicSalary: '',
    allowances: [
      { name: 'HRA', type: 'percentage', value: '40', description: 'House Rent Allowance' },
      { name: 'DA', type: 'percentage', value: '10', description: 'Dearness Allowance' },
      { name: 'Travel Allowance', type: 'fixed', value: '1600', description: 'Travel Allowance' },
      { name: 'Medical Allowance', type: 'fixed', value: '1250', description: 'Medical Allowance' },
    ],
    deductions: [
      { name: 'PF', type: 'percentage', value: '12', description: 'Provident Fund' },
      { name: 'ESI', type: 'percentage', value: '0.75', description: 'Employee State Insurance' },
      { name: 'Professional Tax', type: 'fixed', value: '200', description: 'Professional Tax' },
      { name: 'TDS', type: 'percentage', value: '10', description: 'Tax Deducted at Source' },
    ]
  })

  useEffect(() => {
    fetchStructures()
  }, [])

  const fetchStructures = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/payroll/structure', {
        headers: { 'Authorization': `Bearer ${token}` }
      })

      const data = await response.json()
      if (data.success) {
        setStructures(data.data || [])
      }
    } catch (error) {
      console.error('Error fetching salary structures:', error)
      toast.error('Failed to load salary structures')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    try {
      const token = localStorage.getItem('token')
      const url = editingStructure
        ? `/api/payroll/structure/${editingStructure._id}`
        : '/api/payroll/structure'

      const response = await fetch(url, {
        method: editingStructure ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(formData)
      })

      const data = await response.json()
      if (data.success) {
        toast.success(editingStructure ? 'Structure updated successfully' : 'Structure created successfully')
        setShowModal(false)
        setEditingStructure(null)
        resetForm()
        fetchStructures()
      } else {
        toast.error(data.message || 'Operation failed')
      }
    } catch (error) {
      console.error('Error:', error)
      toast.error('Failed to save salary structure')
    }
  }

  const handleEdit = (structure) => {
    setEditingStructure(structure)
    setFormData({
      name: structure.name,
      description: structure.description || '',
      basicSalary: structure.basicSalary.toString(),
      allowances: structure.allowances || [],
      deductions: structure.deductions || []
    })
    setShowModal(true)
  }

  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to delete this salary structure?')) return

    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/payroll/structure/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      })

      const data = await response.json()
      if (data.success) {
        toast.success('Structure deleted successfully')
        fetchStructures()
      } else {
        toast.error(data.message || 'Failed to delete')
      }
    } catch (error) {
      console.error('Error:', error)
      toast.error('Failed to delete salary structure')
    }
  }

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      basicSalary: '',
      allowances: [
        { name: 'HRA', type: 'percentage', value: '40', description: 'House Rent Allowance' },
        { name: 'DA', type: 'percentage', value: '10', description: 'Dearness Allowance' },
        { name: 'Travel Allowance', type: 'fixed', value: '1600', description: 'Travel Allowance' },
        { name: 'Medical Allowance', type: 'fixed', value: '1250', description: 'Medical Allowance' },
      ],
      deductions: [
        { name: 'PF', type: 'percentage', value: '12', description: 'Provident Fund' },
        { name: 'ESI', type: 'percentage', value: '0.75', description: 'Employee State Insurance' },
        { name: 'Professional Tax', type: 'fixed', value: '200', description: 'Professional Tax' },
        { name: 'TDS', type: 'percentage', value: '10', description: 'Tax Deducted at Source' },
      ]
    })
  }

  const addAllowance = () => {
    setFormData({
      ...formData,
      allowances: [...formData.allowances, { name: '', type: 'fixed', value: '', description: '' }]
    })
  }

  const removeAllowance = (index) => {
    setFormData({
      ...formData,
      allowances: formData.allowances.filter((_, i) => i !== index)
    })
  }

  const updateAllowance = (index, field, value) => {
    const updated = [...formData.allowances]
    updated[index][field] = value
    setFormData({ ...formData, allowances: updated })
  }

  const addDeduction = () => {
    setFormData({
      ...formData,
      deductions: [...formData.deductions, { name: '', type: 'fixed', value: '', description: '' }]
    })
  }

  const removeDeduction = (index) => {
    setFormData({
      ...formData,
      deductions: formData.deductions.filter((_, i) => i !== index)
    })
  }

  const updateDeduction = (index, field, value) => {
    const updated = [...formData.deductions]
    updated[index][field] = value
    setFormData({ ...formData, deductions: updated })
  }

  const calculateGrossSalary = (basic, allowances) => {
    let gross = parseFloat(basic) || 0
    allowances.forEach(allowance => {
      const value = parseFloat(allowance.value) || 0
      if (allowance.type === 'percentage') {
        gross += (gross * value) / 100
      } else {
        gross += value
      }
    })
    return gross
  }

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
    }).format(amount || 0)
  }

  return (
    <div className="p-3 sm:p-6 pb-20 md:pb-6">
      {/* Header */}
      <div className="mb-6 flex justify-between items-center">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 flex items-center gap-2">
            <FaMoneyBillWave className="text-green-600" />
            Salary Structure
          </h1>
          <p className="text-sm sm:text-base text-gray-600 mt-1">
            Define salary components, allowances, and deductions
          </p>
        </div>
        <button
          onClick={() => {
            resetForm()
            setEditingStructure(null)
            setShowModal(true)
          }}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <FaPlus />
          <span className="hidden sm:inline">Add Structure</span>
        </button>
      </div>

      {/* Structures List */}
      {loading ? (
        <div className="text-center py-12">
          <Loader size="lg" />
          <p className="text-gray-600 mt-4">Loading salary structures...</p>
        </div>
      ) : structures.length === 0 ? (
        <div className="bg-white rounded-lg shadow-md p-8 text-center">
          <FaMoneyBillWave className="text-6xl text-gray-300 mx-auto mb-4" />
          <p className="text-gray-600 text-lg mb-4">No salary structures defined yet</p>
          <button
            onClick={() => setShowModal(true)}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Create First Structure
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {structures.map((structure) => (
            <div key={structure._id} className="bg-white rounded-lg shadow-md p-6">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="text-xl font-bold text-gray-800">{structure.name}</h3>
                  {structure.description && (
                    <p className="text-sm text-gray-600 mt-1">{structure.description}</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleEdit(structure)}
                    className="p-2 text-blue-600 hover:bg-blue-50 rounded"
                  >
                    <FaEdit />
                  </button>
                  <button
                    onClick={() => handleDelete(structure._id)}
                    className="p-2 text-red-600 hover:bg-red-50 rounded"
                  >
                    <FaTrash />
                  </button>
                </div>
              </div>

              <div className="space-y-4">
                <div className="bg-gray-50 rounded-lg p-4">
                  <p className="text-sm text-gray-600 mb-1">Basic Salary</p>
                  <p className="text-2xl font-bold text-gray-800">
                    {formatCurrency(structure.basicSalary)}
                  </p>
                </div>

                <div>
                  <p className="text-sm font-semibold text-gray-700 mb-2">Allowances</p>
                  <div className="space-y-2">
                    {structure.allowances?.map((allowance, index) => (
                      <div key={index} className="flex justify-between items-center text-sm">
                        <span className="text-gray-600">{allowance.name}</span>
                        <span className="font-medium text-gray-800">
                          {allowance.type === 'percentage'
                            ? `${allowance.value}%`
                            : formatCurrency(allowance.value)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-sm font-semibold text-gray-700 mb-2">Deductions</p>
                  <div className="space-y-2">
                    {structure.deductions?.map((deduction, index) => (
                      <div key={index} className="flex justify-between items-center text-sm">
                        <span className="text-gray-600">{deduction.name}</span>
                        <span className="font-medium text-red-600">
                          -{allowance.type === 'percentage'
                            ? `${deduction.value}%`
                            : formatCurrency(deduction.value)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="border-t pt-4">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-semibold text-gray-700">Estimated Gross</span>
                    <span className="text-lg font-bold text-green-600">
                      {formatCurrency(
                        calculateGrossSalary(structure.basicSalary, structure.allowances || [])
                      )}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9100] p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b px-6 py-4 flex justify-between items-center">
              <h2 className="text-2xl font-bold text-gray-800">
                {editingStructure ? 'Edit' : 'Create'} Salary Structure
              </h2>
              <button
                onClick={() => {
                  setShowModal(false)
                  setEditingStructure(null)
                  resetForm()
                }}
                className="text-gray-500 hover:text-gray-700"
              >
                <FaTimes className="w-6 h-6" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6">
              {/* Basic Info */}
              <div className="space-y-4 mb-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Structure Name *
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Description
                  </label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    rows="2"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Basic Salary *
                  </label>
                  <input
                    type="number"
                    value={formData.basicSalary}
                    onChange={(e) => setFormData({ ...formData, basicSalary: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>
              </div>

              {/* Allowances */}
              <div className="mb-6">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-semibold text-gray-800">Allowances</h3>
                  <button
                    type="button"
                    onClick={addAllowance}
                    className="px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700 text-sm"
                  >
                    + Add Allowance
                  </button>
                </div>

                <div className="space-y-3">
                  {formData.allowances.map((allowance, index) => (
                    <div key={index} className="grid grid-cols-12 gap-2 items-end">
                      <div className="col-span-3">
                        <label className="block text-xs text-gray-600 mb-1">Name</label>
                        <input
                          type="text"
                          value={allowance.name}
                          onChange={(e) => updateAllowance(index, 'name', e.target.value)}
                          className="w-full px-3 py-2 border rounded-lg text-sm"
                          placeholder="HRA"
                        />
                      </div>
                      <div className="col-span-2">
                        <label className="block text-xs text-gray-600 mb-1">Type</label>
                        <select
                          value={allowance.type}
                          onChange={(e) => updateAllowance(index, 'type', e.target.value)}
                          className="w-full px-3 py-2 border rounded-lg text-sm"
                        >
                          <option value="fixed">Fixed</option>
                          <option value="percentage">%</option>
                        </select>
                      </div>
                      <div className="col-span-2">
                        <label className="block text-xs text-gray-600 mb-1">Value</label>
                        <input
                          type="number"
                          step="0.01"
                          value={allowance.value}
                          onChange={(e) => updateAllowance(index, 'value', e.target.value)}
                          className="w-full px-3 py-2 border rounded-lg text-sm"
                        />
                      </div>
                      <div className="col-span-4">
                        <label className="block text-xs text-gray-600 mb-1">Description</label>
                        <input
                          type="text"
                          value={allowance.description}
                          onChange={(e) => updateAllowance(index, 'description', e.target.value)}
                          className="w-full px-3 py-2 border rounded-lg text-sm"
                        />
                      </div>
                      <div className="col-span-1">
                        <button
                          type="button"
                          onClick={() => removeAllowance(index)}
                          className="p-2 text-red-600 hover:bg-red-50 rounded w-full"
                        >
                          <FaTrash className="mx-auto" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Deductions */}
              <div className="mb-6">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-semibold text-gray-800">Deductions</h3>
                  <button
                    type="button"
                    onClick={addDeduction}
                    className="px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700 text-sm"
                  >
                    + Add Deduction
                  </button>
                </div>

                <div className="space-y-3">
                  {formData.deductions.map((deduction, index) => (
                    <div key={index} className="grid grid-cols-12 gap-2 items-end">
                      <div className="col-span-3">
                        <label className="block text-xs text-gray-600 mb-1">Name</label>
                        <input
                          type="text"
                          value={deduction.name}
                          onChange={(e) => updateDeduction(index, 'name', e.target.value)}
                          className="w-full px-3 py-2 border rounded-lg text-sm"
                          placeholder="PF"
                        />
                      </div>
                      <div className="col-span-2">
                        <label className="block text-xs text-gray-600 mb-1">Type</label>
                        <select
                          value={deduction.type}
                          onChange={(e) => updateDeduction(index, 'type', e.target.value)}
                          className="w-full px-3 py-2 border rounded-lg text-sm"
                        >
                          <option value="fixed">Fixed</option>
                          <option value="percentage">%</option>
                        </select>
                      </div>
                      <div className="col-span-2">
                        <label className="block text-xs text-gray-600 mb-1">Value</label>
                        <input
                          type="number"
                          step="0.01"
                          value={deduction.value}
                          onChange={(e) => updateDeduction(index, 'value', e.target.value)}
                          className="w-full px-3 py-2 border rounded-lg text-sm"
                        />
                      </div>
                      <div className="col-span-4">
                        <label className="block text-xs text-gray-600 mb-1">Description</label>
                        <input
                          type="text"
                          value={deduction.description}
                          onChange={(e) => updateDeduction(index, 'description', e.target.value)}
                          className="w-full px-3 py-2 border rounded-lg text-sm"
                        />
                      </div>
                      <div className="col-span-1">
                        <button
                          type="button"
                          onClick={() => removeDeduction(index)}
                          className="p-2 text-red-600 hover:bg-red-50 rounded w-full"
                        >
                          <FaTrash className="mx-auto" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Submit Buttons */}
              <div className="flex justify-end gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false)
                    setEditingStructure(null)
                    resetForm()
                  }}
                  className="px-6 py-2 border border-gray-300 text-gray-700 bg-white rounded-lg hover:bg-gray-50 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2 font-medium"
                >
                  <FaSave />
                  {editingStructure ? 'Update' : 'Create'} Structure
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
