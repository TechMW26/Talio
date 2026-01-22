'use client'

import { useState, useEffect } from 'react'
import { FaMoneyBillWave, FaPlus, FaEdit, FaTrash, FaSave, FaTimes } from 'react-icons/fa'
import toast from '@/utils/toast'
import { useDisclosure, Divider } from '@heroui/react'
import { PageLoader } from '@/components/ui/heroui/Loading'
import { HRMSCard, HRMSCardHeader, HRMSCardBody } from '@/components/ui/heroui/Card'
import { HRMSInput, HRMSTextarea, HRMSSelect, HRMSSelectItem } from '@/components/ui/heroui/Input'
import { PrimaryButton, SecondaryButton, GhostButton, DangerButton } from '@/components/ui/heroui/Button'
import { HRMSModal, HRMSModalContent, HRMSModalHeader, HRMSModalBody, HRMSModalFooter } from '@/components/ui/heroui/Modal'

export default function SalaryStructurePage() {
  const [structures, setStructures] = useState([])
  const [loading, setLoading] = useState(true)
  const { isOpen: showModal, onOpen: openModal, onClose: closeModal } = useDisclosure()
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
        closeModal()
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
    openModal()
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
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground flex items-center gap-2">
            <FaMoneyBillWave className="text-success" />
            Salary Structure
          </h1>
          <p className="text-sm sm:text-base text-default-500 mt-1">
            Define salary components, allowances, and deductions
          </p>
        </div>
        <PrimaryButton
          onPress={() => {
            resetForm()
            setEditingStructure(null)
            openModal()
          }}
          startContent={<FaPlus />}
        >
          <span className="hidden sm:inline">Add Structure</span>
        </PrimaryButton>
      </div>

      {/* Structures List */}
      {loading ? (
        <PageLoader message="Loading salary structures..." />
      ) : structures.length === 0 ? (
        <HRMSCard>
          <HRMSCardBody className="text-center py-12">
            <FaMoneyBillWave className="text-6xl text-default-300 mx-auto mb-4" />
            <p className="text-default-600 text-lg mb-4">No salary structures defined yet</p>
            <PrimaryButton onPress={openModal}>
              Create First Structure
            </PrimaryButton>
          </HRMSCardBody>
        </HRMSCard>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {structures.map((structure) => (
            <HRMSCard key={structure._id}>
              <HRMSCardHeader className="flex justify-between items-start">
                <div>
                  <h3 className="text-xl font-bold text-foreground">{structure.name}</h3>
                  {structure.description && (
                    <p className="text-sm text-default-500 mt-1">{structure.description}</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <GhostButton
                    onPress={() => handleEdit(structure)}
                    isIconOnly
                    size="sm"
                    className="text-primary"
                  >
                    <FaEdit />
                  </GhostButton>
                  <GhostButton
                    onPress={() => handleDelete(structure._id)}
                    isIconOnly
                    size="sm"
                    className="text-danger"
                  >
                    <FaTrash />
                  </GhostButton>
                </div>
              </HRMSCardHeader>
              <Divider />
              <HRMSCardBody className="space-y-4">
                <div className="bg-default-50 rounded-lg p-4">
                  <p className="text-sm text-default-500 mb-1">Basic Salary</p>
                  <p className="text-2xl font-bold text-foreground">
                    {formatCurrency(structure.basicSalary)}
                  </p>
                </div>

                <div>
                  <p className="text-sm font-semibold text-default-700 mb-2">Allowances</p>
                  <div className="space-y-2">
                    {structure.allowances?.map((allowance, index) => (
                      <div key={index} className="flex justify-between items-center text-sm">
                        <span className="text-default-600">{allowance.name}</span>
                        <span className="font-medium text-foreground">
                          {allowance.type === 'percentage'
                            ? `${allowance.value}%`
                            : formatCurrency(allowance.value)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-sm font-semibold text-default-700 mb-2">Deductions</p>
                  <div className="space-y-2">
                    {structure.deductions?.map((deduction, index) => (
                      <div key={index} className="flex justify-between items-center text-sm">
                        <span className="text-default-600">{deduction.name}</span>
                        <span className="font-medium text-danger">
                          -{deduction.type === 'percentage'
                            ? `${deduction.value}%`
                            : formatCurrency(deduction.value)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <Divider />
                <div className="flex justify-between items-center">
                  <span className="text-sm font-semibold text-default-700">Estimated Gross</span>
                  <span className="text-lg font-bold text-success">
                    {formatCurrency(
                      calculateGrossSalary(structure.basicSalary, structure.allowances || [])
                    )}
                  </span>
                </div>
              </HRMSCardBody>
            </HRMSCard>
          ))}
        </div>
      )}

      {/* Modal */}
      <HRMSModal isOpen={showModal} onClose={() => { closeModal(); setEditingStructure(null); resetForm(); }} size="4xl">
        <HRMSModalContent>
          <HRMSModalHeader>
            <h2 className="text-xl font-bold text-foreground">
              {editingStructure ? 'Edit' : 'Create'} Salary Structure
            </h2>
          </HRMSModalHeader>
          <HRMSModalBody>
            <form onSubmit={handleSubmit} id="structure-form" className="space-y-6">
              {/* Basic Info */}
              <div className="space-y-4">
                <HRMSInput
                  label="Structure Name"
                  isRequired
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., Standard Structure"
                />

                <HRMSTextarea
                  label="Description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Optional description"
                  minRows={2}
                />

                <HRMSInput
                  type="number"
                  label="Basic Salary"
                  isRequired
                  value={formData.basicSalary}
                  onChange={(e) => setFormData({ ...formData, basicSalary: e.target.value })}
                  placeholder="Enter basic salary"
                />
              </div>

              {/* Allowances */}
              <div>
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-semibold text-foreground">Allowances</h3>
                  <PrimaryButton
                    type="button"
                    size="sm"
                    onPress={addAllowance}
                    startContent={<FaPlus className="w-3 h-3" />}
                    color="success"
                  >
                    Add Allowance
                  </PrimaryButton>
                </div>

                <div className="space-y-3">
                  {formData.allowances.map((allowance, index) => (
                    <div key={index} className="grid grid-cols-12 gap-2 items-end bg-default-50 p-3 rounded-lg">
                      <div className="col-span-3">
                        <HRMSInput
                          label="Name"
                          size="sm"
                          value={allowance.name}
                          onChange={(e) => updateAllowance(index, 'name', e.target.value)}
                          placeholder="HRA"
                        />
                      </div>
                      <div className="col-span-2">
                        <HRMSSelect
                          label="Type"
                          size="sm"
                          selectedKeys={[allowance.type]}
                          onSelectionChange={(keys) => updateAllowance(index, 'type', Array.from(keys)[0])}
                        >
                          <HRMSSelectItem key="fixed" textValue="Fixed">Fixed</HRMSSelectItem>
                          <HRMSSelectItem key="percentage" textValue="%">%</HRMSSelectItem>
                        </HRMSSelect>
                      </div>
                      <div className="col-span-2">
                        <HRMSInput
                          type="number"
                          label="Value"
                          size="sm"
                          step="0.01"
                          value={allowance.value}
                          onChange={(e) => updateAllowance(index, 'value', e.target.value)}
                        />
                      </div>
                      <div className="col-span-4">
                        <HRMSInput
                          label="Description"
                          size="sm"
                          value={allowance.description}
                          onChange={(e) => updateAllowance(index, 'description', e.target.value)}
                        />
                      </div>
                      <div className="col-span-1">
                        <GhostButton
                          type="button"
                          onPress={() => removeAllowance(index)}
                          isIconOnly
                          className="text-danger"
                        >
                          <FaTrash />
                        </GhostButton>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Deductions */}
              <div>
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-semibold text-foreground">Deductions</h3>
                  <DangerButton
                    type="button"
                    size="sm"
                    onPress={addDeduction}
                    startContent={<FaPlus className="w-3 h-3" />}
                  >
                    Add Deduction
                  </DangerButton>
                </div>

                <div className="space-y-3">
                  {formData.deductions.map((deduction, index) => (
                    <div key={index} className="grid grid-cols-12 gap-2 items-end bg-default-50 p-3 rounded-lg">
                      <div className="col-span-3">
                        <HRMSInput
                          label="Name"
                          size="sm"
                          value={deduction.name}
                          onChange={(e) => updateDeduction(index, 'name', e.target.value)}
                          placeholder="PF"
                        />
                      </div>
                      <div className="col-span-2">
                        <HRMSSelect
                          label="Type"
                          size="sm"
                          selectedKeys={[deduction.type]}
                          onSelectionChange={(keys) => updateDeduction(index, 'type', Array.from(keys)[0])}
                        >
                          <HRMSSelectItem key="fixed" textValue="Fixed">Fixed</HRMSSelectItem>
                          <HRMSSelectItem key="percentage" textValue="%">%</HRMSSelectItem>
                        </HRMSSelect>
                      </div>
                      <div className="col-span-2">
                        <HRMSInput
                          type="number"
                          label="Value"
                          size="sm"
                          step="0.01"
                          value={deduction.value}
                          onChange={(e) => updateDeduction(index, 'value', e.target.value)}
                        />
                      </div>
                      <div className="col-span-4">
                        <HRMSInput
                          label="Description"
                          size="sm"
                          value={deduction.description}
                          onChange={(e) => updateDeduction(index, 'description', e.target.value)}
                        />
                      </div>
                      <div className="col-span-1">
                        <GhostButton
                          type="button"
                          onPress={() => removeDeduction(index)}
                          isIconOnly
                          className="text-danger"
                        >
                          <FaTrash />
                        </GhostButton>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </form>
          </HRMSModalBody>
          <HRMSModalFooter>
            <SecondaryButton
              onPress={() => {
                closeModal()
                setEditingStructure(null)
                resetForm()
              }}
            >
              Cancel
            </SecondaryButton>
            <PrimaryButton
              type="submit"
              form="structure-form"
              startContent={<FaSave />}
            >
              {editingStructure ? 'Update' : 'Create'} Structure
            </PrimaryButton>
          </HRMSModalFooter>
        </HRMSModalContent>
      </HRMSModal>
    </div>
  )
}
