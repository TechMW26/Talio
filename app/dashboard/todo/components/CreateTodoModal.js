'use client'

import { useState, useEffect, Fragment } from 'react'
import { Dialog, Transition } from '@headlessui/react'
import {
  HiOutlineXMark,
  HiOutlineFlag,
  HiOutlineCalendarDays,
  HiOutlineClock,
  HiOutlineBell,
  HiOutlineTag
} from 'react-icons/hi2'
import Loader from '@/components/ui/Loader'
import toast from '@/utils/toast'

const PRIORITY_OPTIONS = [
  { value: '', label: 'No Priority', color: 'text-gray-400' },
  { value: 'low', label: 'Low', color: 'text-green-500' },
  { value: 'medium', label: 'Medium', color: 'text-amber-500' },
  { value: 'high', label: 'High', color: 'text-red-500' },
  { value: 'urgent', label: 'Urgent', color: 'text-red-600' }
]

const REMINDER_OPTIONS = [
  { value: 'at-time', label: 'At time of due date' },
  { value: '15-min', label: '15 minutes before' },
  { value: '30-min', label: '30 minutes before' },
  { value: '1-hour', label: '1 hour before' },
  { value: '1-day', label: '1 day before' }
]

export default function CreateTodoModal({ isOpen, onClose, onSuccess, categories, defaultCategory }) {
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState({
    title: '',
    priority: '',
    category: defaultCategory || '',
    dueDate: '',
    dueTime: '',
    reminders: [],
    tags: ''
  })

  useEffect(() => {
    if (defaultCategory) {
      setFormData(prev => ({ ...prev, category: defaultCategory }))
    }
  }, [defaultCategory])

  const handleSubmit = async (e) => {
    e.preventDefault()
    
    if (!formData.title.trim()) {
      toast.error('To-do title is required')
      return
    }

    try {
      setLoading(true)
      const token = localStorage.getItem('token')

      const payload = {
        title: formData.title.trim(),
        priority: formData.priority || undefined, // Don't send if empty, will use schema default
        category: formData.category || undefined,
        dueDate: formData.dueDate ? new Date(formData.dueDate).toISOString() : undefined,
        dueTime: formData.dueTime || undefined,
        tags: formData.tags ? formData.tags.split(',').map(t => t.trim()).filter(Boolean) : []
      }

      // Process reminders - convert to schema format
      if (formData.reminders.length > 0 && formData.dueDate) {
        payload.reminders = formData.reminders.map(reminder => {
          // Convert frontend reminder format to schema format
          const reminderTypeMap = {
            'at-time': '1hour', // Treat "at-time" as close to due time
            '15-min': '15min',
            '30-min': '30min',
            '1-hour': '1hour',
            '1-day': '1day'
          }
          return {
            type: reminderTypeMap[reminder] || '1hour',
            sent: false
          }
        })
      }

      const response = await fetch('/api/personal-todos', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      })

      const data = await response.json()

      if (data.success) {
        onSuccess(data.data)
        resetForm()
      } else {
        toast.error(data.message || 'Failed to create to-do')
      }
    } catch (error) {
      console.error('Error creating todo:', error)
      toast.error('Failed to create to-do')
    } finally {
      setLoading(false)
    }
  }

  const resetForm = () => {
    setFormData({
      title: '',
      priority: '',
      category: defaultCategory || '',
      dueDate: '',
      dueTime: '',
      reminders: [],
      tags: ''
    })
  }

  const toggleReminder = (value) => {
    setFormData(prev => ({
      ...prev,
      reminders: prev.reminders.includes(value)
        ? prev.reminders.filter(r => r !== value)
        : [...prev.reminders, value]
    }))
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
              <Dialog.Panel className="w-full max-w-lg transform overflow-hidden rounded-2xl bg-white shadow-xl transition-all">
                <div className="flex items-center justify-between p-4 border-b border-gray-200">
                  <Dialog.Title className="text-lg font-semibold text-gray-900">
                    Create New To-do
                  </Dialog.Title>
                  <button
                    onClick={onClose}
                    className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
                  >
                    <HiOutlineXMark className="w-5 h-5" />
                  </button>
                </div>

                <form onSubmit={handleSubmit} className="p-4 space-y-4">
                  {/* Title */}
                  <div>
                    <input
                      type="text"
                      placeholder="To-do title"
                      value={formData.title}
                      onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg text-lg font-medium focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      autoFocus
                    />
                  </div>

                  {/* Due Date & Time */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Due Date</label>
                      <div className="relative">
                        <HiOutlineCalendarDays className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                        <input
                          type="date"
                          value={formData.dueDate}
                          onChange={(e) => setFormData(prev => ({ ...prev, dueDate: e.target.value }))}
                          className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Time</label>
                      <div className="relative">
                        <HiOutlineClock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                        <input
                          type="time"
                          value={formData.dueTime}
                          onChange={(e) => setFormData(prev => ({ ...prev, dueTime: e.target.value }))}
                          className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Priority & Category */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
                      <div className="relative">
                        <HiOutlineFlag className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                        <select
                          value={formData.priority}
                          onChange={(e) => setFormData(prev => ({ ...prev, priority: e.target.value }))}
                          className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent appearance-none bg-white"
                        >
                          {PRIORITY_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                      <select
                        value={formData.category}
                        onChange={(e) => setFormData(prev => ({ ...prev, category: e.target.value }))}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white"
                      >
                        <option value="">No Category</option>
                        {categories.map(cat => (
                          <option key={cat._id} value={cat._id}>{cat.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Reminders */}
                  {formData.dueDate && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        <HiOutlineBell className="w-4 h-4 inline mr-1" />
                        Reminders
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {REMINDER_OPTIONS.map(opt => (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => toggleReminder(opt.value)}
                            className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                              formData.reminders.includes(opt.value)
                                ? 'bg-indigo-100 border-indigo-300 text-indigo-700'
                                : 'bg-white border-gray-300 text-gray-600 hover:border-indigo-300'
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Tags */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      <HiOutlineTag className="w-4 h-4 inline mr-1" />
                      Tags (comma separated)
                    </label>
                    <input
                      type="text"
                      placeholder="work, urgent, follow-up"
                      value={formData.tags}
                      onChange={(e) => setFormData(prev => ({ ...prev, tags: e.target.value }))}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    />
                  </div>

                  {/* Actions */}
                  <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
                    <button
                      type="button"
                      onClick={onClose}
                      className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={loading || !formData.title.trim()}
                      className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                    >
                      {loading ? (
                        <>
                          <Loader size="xs" />
                          Creating...
                        </>
                      ) : (
                        'Create To-do'
                      )}
                    </button>
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
