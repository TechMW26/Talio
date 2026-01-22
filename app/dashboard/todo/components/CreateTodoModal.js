'use client'

import { useState, useEffect } from 'react'
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Input,
  Select,
  SelectItem,
  Chip
} from '@heroui/react'
import {
  HiOutlineFlag,
  HiOutlineCalendarDays,
  HiOutlineClock,
  HiOutlineBell,
  HiOutlineTag
} from 'react-icons/hi2'
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
    <Modal isOpen={isOpen} onOpenChange={(open) => !open && onClose()} size="lg">
      <ModalContent>
        {(onModalClose) => (
          <>
            <ModalHeader className="flex flex-col gap-1">
              Create New To-do
            </ModalHeader>
            <ModalBody>
              <form id="create-todo-form" onSubmit={handleSubmit} className="space-y-4">
                {/* Title */}
                <Input
                  label="To-do title"
                  placeholder="Enter to-do title"
                  value={formData.title}
                  onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                  autoFocus
                  isRequired
                  size="lg"
                />

                {/* Due Date & Time */}
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    type="date"
                    label="Due Date"
                    value={formData.dueDate}
                    onChange={(e) => setFormData(prev => ({ ...prev, dueDate: e.target.value }))}
                    startContent={<HiOutlineCalendarDays className="text-default-400" />}
                  />
                  <Input
                    type="time"
                    label="Time"
                    value={formData.dueTime}
                    onChange={(e) => setFormData(prev => ({ ...prev, dueTime: e.target.value }))}
                    startContent={<HiOutlineClock className="text-default-400" />}
                  />
                </div>

                {/* Priority & Category */}
                <div className="grid grid-cols-2 gap-3">
                  <Select
                    label="Priority"
                    placeholder="Select priority"
                    selectedKeys={formData.priority ? [formData.priority] : []}
                    onSelectionChange={(keys) => setFormData(prev => ({ ...prev, priority: Array.from(keys)[0] || '' }))}
                    startContent={<HiOutlineFlag className="text-default-400" />}
                  >
                    {PRIORITY_OPTIONS.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </Select>
                  <Select
                    label="Category"
                    placeholder="Select category"
                    selectedKeys={formData.category ? [formData.category] : []}
                    onSelectionChange={(keys) => setFormData(prev => ({ ...prev, category: Array.from(keys)[0] || '' }))}
                  >
                    {categories.map(cat => (
                      <SelectItem key={cat._id} value={cat._id}>
                        {cat.name}
                      </SelectItem>
                    ))}
                  </Select>
                </div>

                {/* Reminders */}
                {formData.dueDate && (
                  <div>
                    <p className="text-sm font-medium text-default-700 mb-2">
                      <HiOutlineBell className="inline w-4 h-4 mr-1" />
                      Reminders
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {REMINDER_OPTIONS.map(opt => (
                        <Chip
                          key={opt.value}
                          variant={formData.reminders.includes(opt.value) ? "solid" : "bordered"}
                          color={formData.reminders.includes(opt.value) ? "primary" : "default"}
                          className="cursor-pointer"
                          onClick={() => toggleReminder(opt.value)}
                        >
                          {opt.label}
                        </Chip>
                      ))}
                    </div>
                  </div>
                )}

                {/* Tags */}
                <Input
                  label="Tags (comma separated)"
                  placeholder="work, urgent, follow-up"
                  value={formData.tags}
                  onChange={(e) => setFormData(prev => ({ ...prev, tags: e.target.value }))}
                  startContent={<HiOutlineTag className="text-default-400" />}
                />
              </form>
            </ModalBody>
            <ModalFooter>
              <Button variant="light" onPress={onModalClose}>
                Cancel
              </Button>
              <Button
                color="primary"
                type="submit"
                form="create-todo-form"
                isLoading={loading}
                isDisabled={!formData.title.trim()}
              >
                Create To-do
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  )
}
