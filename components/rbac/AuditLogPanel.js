'use client'

import { useState } from 'react'
import { Button, Select, SelectItem, Chip } from '@heroui/react'
import { FaTimes } from 'react-icons/fa'
import useAuthedSWR from '@/hooks/useAuthedSWR'

const EVENT_TYPES = [
    { key: '', label: 'All Events' },
    { key: 'role_created', label: 'Role Created' },
    { key: 'role_updated', label: 'Role Updated' },
    { key: 'role_deleted', label: 'Role Deleted' },
    { key: 'user_role_changed', label: 'User Role Changed' },
    { key: 'permission_denied', label: 'Permission Denied' },
]

const EVENT_COLORS = {
    role_created: 'success',
    role_updated: 'warning',
    role_deleted: 'danger',
    user_role_changed: 'primary',
    permission_denied: 'danger',
}

export default function AuditLogPanel({ onClose }) {
    const [page, setPage] = useState(1)
    const [eventType, setEventType] = useState('')

    const queryParams = new URLSearchParams({ page: page.toString(), limit: '25' })
    if (eventType) queryParams.set('eventType', eventType)

    const { data, isLoading } = useAuthedSWR(`/api/rbac/audit-log?${queryParams.toString()}`)
    const logs = data?.data || []
    const pagination = data?.pagination || {}

    return (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-700">
                <h3 className="font-semibold text-gray-800 dark:text-white">RBAC Audit Log</h3>
                <div className="flex items-center gap-2">
                    <Select
                        size="sm"
                        className="w-48"
                        selectedKeys={eventType ? [eventType] : []}
                        onSelectionChange={(keys) => {
                            const val = Array.from(keys)[0] || ''
                            setEventType(val)
                            setPage(1)
                        }}
                        placeholder="Filter by event"
                    >
                        {EVENT_TYPES.filter((e) => e.key).map((e) => (
                            <SelectItem key={e.key}>{e.label}</SelectItem>
                        ))}
                    </Select>
                    <Button size="sm" variant="light" isIconOnly onPress={onClose}>
                        <FaTimes />
                    </Button>
                </div>
            </div>

            <div className="max-h-96 overflow-y-auto">
                {isLoading ? (
                    <div className="p-6 text-center text-gray-500">Loading audit logs...</div>
                ) : logs.length === 0 ? (
                    <div className="p-6 text-center text-gray-500">No audit events found</div>
                ) : (
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50 dark:bg-gray-750 sticky top-0">
                            <tr>
                                <th className="px-4 py-2 text-left text-gray-600 dark:text-gray-400 font-medium">Event</th>
                                <th className="px-4 py-2 text-left text-gray-600 dark:text-gray-400 font-medium">Actor</th>
                                <th className="px-4 py-2 text-left text-gray-600 dark:text-gray-400 font-medium">Details</th>
                                <th className="px-4 py-2 text-left text-gray-600 dark:text-gray-400 font-medium">Time</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                            {logs.map((log) => (
                                <tr key={log._id} className="hover:bg-gray-50 dark:hover:bg-gray-750">
                                    <td className="px-4 py-2">
                                        <Chip size="sm" variant="flat" color={EVENT_COLORS[log.eventType] || 'default'}>
                                            {log.eventType.replace(/_/g, ' ')}
                                        </Chip>
                                    </td>
                                    <td className="px-4 py-2 text-gray-700 dark:text-gray-300">{log.actorEmail}</td>
                                    <td className="px-4 py-2 text-gray-500 text-xs max-w-xs truncate">
                                        {log.metadata?.roleName || log.metadata?.name || log.metadata?.pageSlug || '-'}
                                    </td>
                                    <td className="px-4 py-2 text-gray-400 whitespace-nowrap">
                                        {new Date(log.createdAt).toLocaleString()}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {/* Pagination */}
            {pagination.totalPages > 1 && (
                <div className="flex items-center justify-between px-5 py-3 border-t border-gray-200 dark:border-gray-700">
                    <span className="text-sm text-gray-500">
                        Page {pagination.page} of {pagination.totalPages} ({pagination.total} total)
                    </span>
                    <div className="flex gap-1">
                        <Button
                            size="sm"
                            variant="flat"
                            isDisabled={page <= 1}
                            onPress={() => setPage((p) => p - 1)}
                        >
                            Previous
                        </Button>
                        <Button
                            size="sm"
                            variant="flat"
                            isDisabled={page >= pagination.totalPages}
                            onPress={() => setPage((p) => p + 1)}
                        >
                            Next
                        </Button>
                    </div>
                </div>
            )}
        </div>
    )
}
