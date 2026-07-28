'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Spinner,
} from '@heroui/react'
import {
  HiOutlineCheck,
  HiOutlineClipboardDocument,
  HiOutlineMagnifyingGlass,
  HiOutlineUserPlus,
} from 'react-icons/hi2'
import { apiMutate } from '@/hooks/useApiMutation'
import toast from '@/utils/toast'
import { copyTextToClipboard } from '@/utils/clipboard'

export default function AddMeetingParticipantsModal({
  isOpen,
  meeting,
  onClose,
  onAdded,
}) {
  const [employees, setEmployees] = useState([])
  const [selectedIds, setSelectedIds] = useState([])
  const [search, setSearch] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isInviting, setIsInviting] = useState(false)
  const [error, setError] = useState('')
  const [guestAccess, setGuestAccess] = useState(null)

  useEffect(() => {
    if (!isOpen || !meeting?._id) return

    let cancelled = false
    const loadOptions = async () => {
      setIsLoading(true)
      setError('')
      setSelectedIds([])
      setSearch('')

      try {
        const token = localStorage.getItem('token')
        const [inviteesResponse, guestResponse] = await Promise.all([
          fetch('/api/meetings/invitees', {
            headers: { Authorization: `Bearer ${token}` },
          }),
          meeting.type === 'online'
            ? fetch(`/api/meetings/${meeting._id}/guest-access`, {
              headers: { Authorization: `Bearer ${token}` },
            })
            : Promise.resolve(null),
        ])

        const inviteesData = await inviteesResponse.json()
        if (!inviteesResponse.ok || !inviteesData.success) {
          throw new Error(inviteesData.message || 'Failed to load employees')
        }

        const uniqueEmployees = new Map()
        for (const group of inviteesData.data?.departmentGroups || []) {
          for (const employee of group.employees || []) {
            uniqueEmployees.set(String(employee._id), {
              ...employee,
              departmentName: group.department?.name || 'No department',
            })
          }
        }

        if (!cancelled) {
          setEmployees([...uniqueEmployees.values()])
        }

        if (guestResponse) {
          const guestData = await guestResponse.json()
          if (!cancelled && guestResponse.ok && guestData.success) {
            setGuestAccess(guestData.data)
          }
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError.message || 'Failed to load participants')
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void loadOptions()
    return () => {
      cancelled = true
    }
  }, [isOpen, meeting?._id, meeting?.type])

  const unavailableIds = useMemo(() => new Set([
    String(meeting?.organizer?._id || meeting?.organizer || ''),
    ...(meeting?.invitees || []).map(invitee => String(invitee.employee?._id || invitee.employee || '')),
  ]), [meeting])

  const filteredEmployees = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase()
    return employees.filter(employee => {
      if (unavailableIds.has(String(employee._id))) return false
      if (!normalizedSearch) return true
      return [
        employee.fullName,
        employee.email,
        employee.designation,
        employee.departmentName,
      ].some(value => value?.toLowerCase().includes(normalizedSearch))
    })
  }, [employees, search, unavailableIds])

  const toggleEmployee = (employeeId) => {
    const normalizedId = String(employeeId)
    setSelectedIds(current => (
      current.includes(normalizedId)
        ? current.filter(id => id !== normalizedId)
        : [...current, normalizedId]
    ))
  }

  const inviteSelected = async () => {
    if (selectedIds.length === 0 || isInviting) return

    setIsInviting(true)
    setError('')
    try {
      const response = await apiMutate(`/api/meetings/${meeting._id}`, {
        method: 'PUT',
        body: { addInvitees: selectedIds },
      })
      toast.success(`${selectedIds.length} participant${selectedIds.length === 1 ? '' : 's'} invited`)
      onAdded?.(response.data)
      onClose()
    } catch (inviteError) {
      setError(inviteError.message || 'Failed to invite participants')
    } finally {
      setIsInviting(false)
    }
  }

  const copyGuestLink = async () => {
    try {
      let nextGuestAccess = guestAccess
      if (!nextGuestAccess?.guestUrl) {
        const response = await apiMutate(`/api/meetings/${meeting._id}/guest-access`, {
          method: 'POST',
          body: { enabled: true },
        })
        nextGuestAccess = response.data
        setGuestAccess(nextGuestAccess)
      }

      await copyTextToClipboard(nextGuestAccess.guestUrl)
      toast.success('Guest join link copied')
    } catch (copyError) {
      setError(copyError.message || 'Failed to create guest link')
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={open => !open && onClose()}
      size="2xl"
      scrollBehavior="inside"
      classNames={{
        backdrop: 'z-[190]',
        wrapper: 'z-[200]',
      }}
    >
      <ModalContent>
        <ModalHeader className="flex flex-col gap-1">
          <span>Add participants</span>
          <span className="text-sm font-normal text-default-500">
            Invite employees while the meeting is in progress.
          </span>
        </ModalHeader>
        <ModalBody>
          <div className="relative">
            <HiOutlineMagnifyingGlass className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-default-400" />
            <input
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Search by name, email, role, or department"
              className="w-full rounded-xl border border-default-200 bg-default-50 py-2.5 pl-10 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              aria-label="Search employees"
            />
          </div>

          {error && (
            <div className="rounded-xl border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700">
              {error}
            </div>
          )}

          {isLoading ? (
            <div className="flex min-h-48 items-center justify-center">
              <Spinner label="Loading employees" />
            </div>
          ) : filteredEmployees.length === 0 ? (
            <div className="flex min-h-40 flex-col items-center justify-center text-center text-default-500">
              <HiOutlineUserPlus className="mb-2 h-8 w-8" />
              <p className="text-sm">
                {search ? 'No matching employees found.' : 'Everyone available is already invited.'}
              </p>
            </div>
          ) : (
            <div className="max-h-80 space-y-2 overflow-y-auto">
              {filteredEmployees.map(employee => {
                const isSelected = selectedIds.includes(String(employee._id))
                return (
                  <button
                    key={employee._id}
                    type="button"
                    onClick={() => toggleEmployee(employee._id)}
                    className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition ${
                      isSelected
                        ? 'border-primary bg-primary-50'
                        : 'border-default-200 hover:border-primary-300 hover:bg-default-50'
                    }`}
                  >
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-primary-100 font-semibold text-primary-700">
                      {employee.firstName?.[0]}{employee.lastName?.[0]}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-default-800">{employee.fullName}</p>
                      <p className="truncate text-xs text-default-500">
                        {employee.designation} · {employee.departmentName}
                      </p>
                    </div>
                    <span className={`flex h-6 w-6 items-center justify-center rounded-full border ${
                      isSelected ? 'border-primary bg-primary text-white' : 'border-default-300'
                    }`}>
                      {isSelected && <HiOutlineCheck className="h-4 w-4" />}
                    </span>
                  </button>
                )
              })}
            </div>
          )}

          {meeting?.type === 'online' && (
            <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                <p className="text-sm font-medium text-indigo-900">Invite an external guest</p>
                <p className="text-xs text-indigo-700">Create a secure guest link that opens the Talio pre-join screen.</p>
                </div>
                <Button
                  size="sm"
                  color="primary"
                  variant="flat"
                  startContent={<HiOutlineClipboardDocument key="copy-guest-link-icon" className="h-4 w-4" />}
                  onPress={copyGuestLink}
                >
                  Copy link
                </Button>
              </div>
              {guestAccess?.guestUrl && (
                <input
                  readOnly
                  value={guestAccess.guestUrl}
                  onFocus={event => event.target.select()}
                  className="mt-3 w-full rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs text-indigo-900 outline-none"
                  aria-label="Guest meeting link"
                />
              )}
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="light" onPress={onClose}>Cancel</Button>
          <Button
            color="primary"
            onPress={inviteSelected}
            isLoading={isInviting}
            isDisabled={selectedIds.length === 0}
            startContent={isInviting ? null : <HiOutlineUserPlus key="invite-participants-icon" className="h-4 w-4" />}
          >
            Invite {selectedIds.length || ''}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
