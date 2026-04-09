'use client'

import { useState, useMemo, useCallback } from 'react'
import { Button, Input, Checkbox, Chip } from '@heroui/react'
import { FaTimes, FaSearch, FaCheck } from 'react-icons/fa'
import { toast } from '@/utils/toast'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import useApiMutation from '@/hooks/useApiMutation'
import { getRoleDisplayLabel } from '@/hooks/useRoles'
import Modal from '@/components/ui/Modal'

export default function RoleAssignModal({ role, onClose }) {
    const [search, setSearch] = useState('')
    const [selectedIds, setSelectedIds] = useState(new Set())

    const { data: usersData, isLoading } = useAuthedSWR('/api/users?includeAll=true')
    const users = usersData?.data || usersData?.users || []

    const assignMutation = useApiMutation({
        method: 'PUT',
        onSuccess: (data) => {
            toast.success(data?.message || 'Role assigned')
            onClose()
        },
        onError: (err) => toast.error(err.message || 'Failed to assign role'),
    })

    const filteredUsers = useMemo(() => {
        if (!search.trim()) return users
        const q = search.toLowerCase()
        return users.filter(
            (u) =>
                u.email?.toLowerCase().includes(q) ||
                u.name?.toLowerCase().includes(q) ||
                u.role?.toLowerCase().includes(q)
        )
    }, [users, search])

    const toggleUser = useCallback((userId) => {
        setSelectedIds((prev) => {
            const next = new Set(prev)
            if (next.has(userId)) {
                next.delete(userId)
            } else {
                next.add(userId)
            }
            return next
        })
    }, [])

    const handleAssign = useCallback(async () => {
        if (selectedIds.size === 0) {
            toast.error('Select at least one user')
            return
        }
        await assignMutation.execute(`/api/rbac/roles/${role._id}/assign`, {
            userIds: Array.from(selectedIds),
        })
    }, [selectedIds, role])

    return (
        <Modal isOpen onClose={onClose} title={`Assign "${role.displayLabel}" to Users`} size="lg">
            <div className="space-y-4">
                {/* Search */}
                <Input
                    placeholder="Search users by name or email..."
                    value={search}
                    onValueChange={setSearch}
                    startContent={<FaSearch className="text-gray-400 w-3.5 h-3.5" />}
                    size="sm"
                />

                {/* Selected count */}
                {selectedIds.size > 0 && (
                    <div className="flex items-center gap-2">
                        <Chip size="sm" color="primary">{selectedIds.size} selected</Chip>
                        <Button size="sm" variant="light" onPress={() => setSelectedIds(new Set())}>
                            Clear
                        </Button>
                    </div>
                )}

                {/* User List */}
                <div className="max-h-80 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-100 dark:divide-gray-700">
                    {isLoading ? (
                        <div className="p-4 text-center text-gray-500">Loading users...</div>
                    ) : filteredUsers.length === 0 ? (
                        <div className="p-4 text-center text-gray-500">No users found</div>
                    ) : (
                        filteredUsers.map((u) => {
                            const isSelected = selectedIds.has(u._id)
                            const alreadyAssigned = u.roleId?.toString() === role._id?.toString()
                            return (
                                <div
                                    key={u._id}
                                    className={`px-4 py-2.5 flex items-center gap-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors ${isSelected ? 'bg-primary-50 dark:bg-primary-900/20' : ''
                                        }`}
                                    onClick={() => toggleUser(u._id)}
                                >
                                    <Checkbox
                                        isSelected={isSelected}
                                        size="sm"
                                        onValueChange={() => toggleUser(u._id)}
                                    />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
                                            {u.email}
                                        </p>
                                        <p className="text-xs text-gray-500 capitalize">{getRoleDisplayLabel(u.role)}</p>
                                    </div>
                                    {alreadyAssigned && (
                                        <Chip size="sm" variant="flat" color="success" startContent={<FaCheck className="w-2.5 h-2.5" />}>
                                            Current
                                        </Chip>
                                    )}
                                </div>
                            )
                        })
                    )}
                </div>

                {/* Actions */}
                <div className="flex items-center justify-end gap-2 pt-2">
                    <Button size="sm" variant="flat" onPress={onClose}>
                        Cancel
                    </Button>
                    <Button
                        size="sm"
                        color="primary"
                        isLoading={assignMutation.isLoading}
                        isDisabled={selectedIds.size === 0}
                        onPress={handleAssign}
                    >
                        Assign to {selectedIds.size} User{selectedIds.size !== 1 ? 's' : ''}
                    </Button>
                </div>
            </div>
        </Modal>
    )
}
