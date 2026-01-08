'use client'

import { useState, useEffect, Fragment } from 'react'
import { Dialog, Transition } from '@headlessui/react'
import {
  HiOutlineXMark,
  HiOutlineTrash,
  HiOutlineSwatch
} from 'react-icons/hi2'
import Loader from '@/components/ui/Loader'
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
    if (category) {
      setFormData({
        name: category.name || '',
        color: category.color || '#6366f1',
        description: category.description || ''
      })
    } else {
      setFormData({
        name: '',
        color: '#6366f1',
        description: ''
      })
    }
  }, [category])

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
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/30 backdrop-blur-sm" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-md transform overflow-hidden rounded-2xl bg-white shadow-xl transition-all">
                <div className="flex items-center justify-between p-4 border-b border-gray-200">
                  <Dialog.Title className="text-lg font-semibold text-gray-900">
                    {category ? 'Edit Category' : 'Create Category'}
                  </Dialog.Title>
                  <button
                    onClick={onClose}
                    className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
                  >
                    <HiOutlineXMark className="w-5 h-5" />
                  </button>
                </div>

                <form onSubmit={handleSubmit} className="p-4 space-y-4">
                  {/* Preview */}
                  <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                    <div 
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold"
                      style={{ backgroundColor: formData.color }}
                    >
                      {formData.name ? formData.name[0].toUpperCase() : '?'}
                    </div>
                    <div>
                      <p className="font-medium text-gray-800">
                        {formData.name || 'Category Name'}
                      </p>
                      <p className="text-sm text-gray-500">
                        {formData.description || 'No description'}
                      </p>
                    </div>
                  </div>

                  {/* Name */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Name
                    </label>
                    <input
                      type="text"
                      placeholder="e.g., Work, Personal, Shopping"
                      value={formData.name}
                      onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      autoFocus
                    />
                  </div>

                  {/* Color */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      <HiOutlineSwatch className="w-4 h-4 inline mr-1" />
                      Color
                    </label>
                    <div className="grid grid-cols-6 gap-2">
                      {PRESET_COLORS.map(color => (
                        <button
                          key={color}
                          type="button"
                          onClick={() => setFormData(prev => ({ ...prev, color }))}
                          className={`w-10 h-10 rounded-lg transition-transform hover:scale-110 ${
                            formData.color === color ? 'ring-2 ring-offset-2 ring-gray-400 scale-110' : ''
                          }`}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <label className="text-sm text-gray-600">Custom:</label>
                      <input
                        type="color"
                        value={formData.color}
                        onChange={(e) => setFormData(prev => ({ ...prev, color: e.target.value }))}
                        className="w-8 h-8 rounded cursor-pointer"
                      />
                      <input
                        type="text"
                        value={formData.color}
                        onChange={(e) => setFormData(prev => ({ ...prev, color: e.target.value }))}
                        className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm font-mono"
                        placeholder="#6366f1"
                      />
                    </div>
                  </div>

                  {/* Description */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Description (optional)
                    </label>
                    <input
                      type="text"
                      placeholder="Brief description..."
                      value={formData.description}
                      onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    />
                  </div>

                  {/* Actions */}
                  <div className="flex items-center justify-between pt-4 border-t border-gray-200">
                    {category ? (
                      <button
                        type="button"
                        onClick={handleDelete}
                        disabled={deleting}
                        className="px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg text-sm flex items-center gap-2 disabled:opacity-50"
                      >
                        {deleting ? (
                          <>
                            <Loader size="xs" />
                            Deleting...
                          </>
                        ) : (
                          <>
                            <HiOutlineTrash className="w-4 h-4" />
                            Delete
                          </>
                        )}
                      </button>
                    ) : (
                      <div></div>
                    )}

                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={loading || !formData.name.trim()}
                        className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                      >
                        {loading ? (
                          <>
                            <Loader size="xs" />
                            Saving...
                          </>
                        ) : (
                          category ? 'Save Changes' : 'Create'
                        )}
                      </button>
                    </div>
                  </div>
                </form>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  )
}
