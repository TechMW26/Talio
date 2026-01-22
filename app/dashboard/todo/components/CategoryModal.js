'use client'

import { useState, useEffect } from 'react'
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Input
} from '@heroui/react'
import {
  HiOutlineTrash,
  HiOutlineSwatch
} from 'react-icons/hi2'
import toast from '@/utils/toast'

const PRESET_COLORS = [
  '#6366f1', // Indigo
  '#8b5cf6', // Violet
  '#ec4899', // Pink
  '#ef4444', // Red
  '#f97316', // Orange
  '#f59e0b', // Amber
  '#84cc16', // Lime
  '#22c55e', // Green
  '#14b8a6', // Teal
  '#06b6d4', // Cyan
  '#0ea5e9', // Sky
  '#3b82f6', // Blue
]

export default function CategoryModal({ isOpen, onClose, onSuccess, category }) {
  const [loading, setLoading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [formData, setFormData] = useState({
    name: '',
    color: '#6366f1',
    description: ''
  })

  useEffect(() => {
    if (isOpen && category) {
      setFormData({
        name: category.name || '',
        color: category.color || '#6366f1',
        description: category.description || ''
      })
    } else if (isOpen && !category) {
      setFormData({
        name: '',
        color: '#6366f1',
        description: ''
      })
    }
  }, [category, isOpen])

  const handleSubmit = async (e) => {
    e.preventDefault()
    
    if (!formData.name.trim()) {
      toast.error('Category name is required')
      return
    }

    try {
      setLoading(true)
      const token = localStorage.getItem('token')

      const url = category 
        ? `/api/personal-todos/categories/${category._id}`
        : '/api/personal-todos/categories'
      
      const response = await fetch(url, {
        method: category ? 'PATCH' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(formData)
      })

      const data = await response.json()

      if (data.success) {
        toast.success(category ? 'Category updated' : 'Category created')
        onSuccess(data.data)
      } else {
        toast.error(data.message || 'Failed to save category')
      }
    } catch (error) {
      console.error('Error saving category:', error)
      toast.error('Failed to save category')
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!category) return

    if (!confirm('Are you sure you want to delete this category? To-dos in this category will become uncategorized.')) {
      return
    }

    try {
      setDeleting(true)
      const token = localStorage.getItem('token')

      const response = await fetch(`/api/personal-todos/categories/${category._id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`
        }
      })

      const data = await response.json()

      if (data.success) {
        toast.success('Category deleted')
        onSuccess(null)
      } else {
        toast.error(data.message || 'Failed to delete category')
      }
    } catch (error) {
      console.error('Error deleting category:', error)
      toast.error('Failed to delete category')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onOpenChange={(open) => !open && onClose()} size="md">
      <ModalContent>
        {(onModalClose) => (
          <>
            <ModalHeader className="flex flex-col gap-1">
              {category ? 'Edit Category' : 'Create Category'}
            </ModalHeader>
            <ModalBody>
              <form id="category-form" onSubmit={handleSubmit} className="space-y-4">
                {/* Preview */}
                <div className="flex items-center gap-3 p-3 rounded-lg bg-default-100">
                  <div 
                    className="flex items-center justify-center w-8 h-8 font-bold text-white rounded-lg"
                    style={{ backgroundColor: formData.color }}
                  >
                    {formData.name ? formData.name[0].toUpperCase() : '?'}
                  </div>
                  <div>
                    <p className="font-medium text-default-800">
                      {formData.name || 'Category Name'}
                    </p>
                    <p className="text-sm text-default-500">
                      {formData.description || 'No description'}
                    </p>
                  </div>
                </div>

                {/* Name */}
                <Input
                  label="Name"
                  placeholder="e.g., Work, Personal, Shopping"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  autoFocus
                  isRequired
                />

                {/* Color */}
                <div>
                  <p className="text-sm font-medium text-default-700 mb-2">
                    <HiOutlineSwatch className="inline w-4 h-4 mr-1" />
                    Color
                  </p>
                  <div className="grid grid-cols-6 gap-2">
                    {PRESET_COLORS.map(color => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => setFormData(prev => ({ ...prev, color }))}
                        className={`w-10 h-10 rounded-lg transition-transform hover:scale-110 ${
                          formData.color === color ? 'ring-2 ring-offset-2 ring-primary scale-110' : ''
                        }`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-sm text-default-600">Custom:</span>
                    <input
                      type="color"
                      value={formData.color}
                      onChange={(e) => setFormData(prev => ({ ...prev, color: e.target.value }))}
                      className="w-8 h-8 rounded cursor-pointer"
                    />
                    <Input
                      size="sm"
                      value={formData.color}
                      onChange={(e) => setFormData(prev => ({ ...prev, color: e.target.value }))}
                      placeholder="#6366f1"
                      classNames={{ base: "flex-1" }}
                    />
                  </div>
                </div>

                {/* Description */}
                <Input
                  label="Description (optional)"
                  placeholder="Brief description..."
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                />
              </form>
            </ModalBody>
            <ModalFooter className="flex justify-between">
              <div>
                {category && (
                  <Button
                    color="danger"
                    variant="light"
                    onPress={handleDelete}
                    isLoading={deleting}
                    startContent={!deleting && <HiOutlineTrash className="w-4 h-4" />}
                  >
                    Delete
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="light" onPress={onModalClose}>
                  Cancel
                </Button>
                <Button
                  color="primary"
                  type="submit"
                  form="category-form"
                  isLoading={loading}
                  isDisabled={!formData.name.trim()}
                >
                  {category ? 'Save Changes' : 'Create'}
                </Button>
              </div>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  )
}
