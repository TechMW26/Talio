'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react'
import { HiOutlineCalendarDays, HiOutlineClock, HiOutlinePencilSquare } from 'react-icons/hi2'
import { getDateTimePartsInTimezone, IST_TIMEZONE, parseDateTimeInTimezone } from '@/lib/timezone'
import useApiMutation from '@/hooks/useApiMutation'
import toast from '@/utils/toast'

function toDateTimeLocal(value) {
  if (!value) return ''
  const parts = getDateTimePartsInTimezone(value, IST_TIMEZONE)
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}T${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`
}

export default function EditMeetingModal({ isOpen, meeting, onClose, onSuccess }) {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    scheduledStart: '',
    duration: 60,
    location: '',
    priority: 'medium',
  })

  useEffect(() => {
    if (!isOpen || !meeting) return
    setFormData({
      title: meeting.title || '',
      description: meeting.description || '',
      scheduledStart: toDateTimeLocal(meeting.scheduledStart),
      duration: Number(meeting.duration) || 60,
      location: meeting.location || '',
      priority: meeting.priority || 'medium',
    })
  }, [isOpen, meeting])

  const scheduledEnd = useMemo(() => {
    const start = parseDateTimeInTimezone(formData.scheduledStart, IST_TIMEZONE)
    const duration = Number(formData.duration)
    if (!start || !Number.isFinite(duration)) return null
    return new Date(start.getTime() + duration * 60 * 1000)
  }, [formData.duration, formData.scheduledStart])

  const updateMutation = useApiMutation({
    method: 'PUT',
    invalidateKeys: meeting?._id ? [
      `/api/meetings/${meeting._id}`,
      /^\/api\/meetings\?/,
    ] : [],
    onError: (message) => toast.error(message || 'Unable to update meeting'),
  })

  const updateField = (field, value) => {
    setFormData((current) => ({ ...current, [field]: value }))
  }

  const handleSave = async () => {
    const title = formData.title.trim()
    const duration = Number(formData.duration)
    if (!title) return toast.error('Meeting title is required')
    if (!formData.scheduledStart || !scheduledEnd) return toast.error('Select a valid start date and time')
    if (!Number.isInteger(duration) || duration < 5 || duration > 1440) {
      return toast.error('Duration must be between 5 minutes and 24 hours')
    }
    if (meeting.type === 'offline' && !formData.location.trim()) {
      return toast.error('Location is required for an offline meeting')
    }

    const response = await updateMutation.execute(`/api/meetings/${meeting._id}`, {
      title,
      description: formData.description.trim(),
      scheduledStart: formData.scheduledStart,
      scheduledEnd: scheduledEnd.toISOString(),
      location: meeting.type === 'offline' ? formData.location.trim() : meeting.location,
      priority: formData.priority,
    })
    if (!response?.data) return

    toast.success('Meeting updated successfully')
    onSuccess?.(response.data)
    onClose()
  }

  return (
    <Modal isOpen={isOpen} onOpenChange={(open) => !open && onClose()} size="2xl" scrollBehavior="inside">
      <ModalContent>
        <>
          <ModalHeader className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300">
              <HiOutlinePencilSquare className="h-5 w-5" />
            </span>
            <span>
              <span className="block">Edit meeting</span>
              <span className="mt-0.5 block text-sm font-normal text-default-500">Changes appear for every attendee.</span>
            </span>
          </ModalHeader>
          <ModalBody className="gap-5">
            <label className="grid gap-2 text-sm font-medium text-default-700">
              Meeting title <span className="sr-only">required</span>
              <input
                value={formData.title}
                onChange={(event) => updateField('title', event.target.value)}
                maxLength={200}
                required
                className="min-h-12 rounded-xl border border-default-300 bg-content1 px-4 text-base text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            </label>

            <label className="grid gap-2 text-sm font-medium text-default-700">
              Description
              <textarea
                value={formData.description}
                onChange={(event) => updateField('description', event.target.value)}
                maxLength={4000}
                rows={4}
                className="rounded-xl border border-default-300 bg-content1 px-4 py-3 text-base text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2 text-sm font-medium text-default-700">
                <span className="flex items-center gap-2"><HiOutlineCalendarDays className="h-4 w-4" /> Start date and time</span>
                <input
                  type="datetime-local"
                  value={formData.scheduledStart}
                  onChange={(event) => updateField('scheduledStart', event.target.value)}
                  required
                  className="min-h-12 rounded-xl border border-default-300 bg-content1 px-4 text-base text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </label>

              <label className="grid gap-2 text-sm font-medium text-default-700">
                <span className="flex items-center gap-2"><HiOutlineClock className="h-4 w-4" /> Duration in minutes</span>
                <input
                  type="number"
                  min="5"
                  max="1440"
                  step="5"
                  value={formData.duration}
                  onChange={(event) => updateField('duration', event.target.value)}
                  required
                  className="min-h-12 rounded-xl border border-default-300 bg-content1 px-4 text-base text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </label>
            </div>

            {scheduledEnd && (
              <p className="rounded-xl bg-primary-50 px-4 py-3 text-sm text-primary-700 dark:bg-primary-500/10 dark:text-primary-300">
                Ends {scheduledEnd.toLocaleString('en-IN', { timeZone: IST_TIMEZONE, dateStyle: 'medium', timeStyle: 'short' })}
              </p>
            )}

            {meeting?.type === 'offline' && (
              <label className="grid gap-2 text-sm font-medium text-default-700">
                Location
                <input
                  value={formData.location}
                  onChange={(event) => updateField('location', event.target.value)}
                  maxLength={500}
                  required
                  className="min-h-12 rounded-xl border border-default-300 bg-content1 px-4 text-base text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </label>
            )}

            <label className="grid gap-2 text-sm font-medium text-default-700">
              Priority
              <select
                value={formData.priority}
                onChange={(event) => updateField('priority', event.target.value)}
                className="min-h-12 rounded-xl border border-default-300 bg-content1 px-4 text-base text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </label>
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={onClose} isDisabled={updateMutation.isLoading}>Cancel</Button>
            <Button color="primary" onPress={handleSave} isLoading={updateMutation.isLoading}>
              Save changes
            </Button>
          </ModalFooter>
        </>
      </ModalContent>
    </Modal>
  )
}
