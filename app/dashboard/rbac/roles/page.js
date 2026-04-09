'use client'

import { useState, useCallback } from 'react'
import { Button, Chip, Skeleton } from '@heroui/react'
import { FaPlus, FaEdit, FaTrash, FaUsers, FaShieldAlt, FaSync, FaHistory } from 'react-icons/fa'
import { toast } from '@/utils/toast'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import useApiMutation from '@/hooks/useApiMutation'
import RoleBasedAccess from '@/components/RoleBasedAccess'
import RoleBuilder from '@/components/rbac/RoleBuilder'
import RoleAssignModal from '@/components/rbac/RoleAssignModal'
import AuditLogPanel from '@/components/rbac/AuditLogPanel'

export default function RBACRolesPage() {
    const [showBuilder, setShowBuilder] = useState(false)
    const [editingRole, setEditingRole] = useState(null)
    const [assignRole, setAssignRole] = useState(null)
    const [showAuditLog, setShowAuditLog] = useState(false)

    const { data: rolesData, error, isLoading, mutate: refetchRoles } = useAuthedSWR('/api/rbac/roles')
    const roles = rolesData?.data || []

    const seedMutation = useApiMutation({
        method: 'POST',
        onSuccess: () => {
            toast.success('System roles seeded successfully')
            refetchRoles()
        },
        onError: (err) => toast.error(err.message || 'Failed to seed roles'),
    })

    const deleteMutation = useApiMutation({
        method: 'DELETE',
        onSuccess: () => {
            toast.success('Role deleted')
            refetchRoles()
        },
        onError: (err) => toast.error(err.message || 'Failed to delete role'),
    })

    const handleSeedRoles = useCallback(async () => {
        await seedMutation.execute('/api/rbac/seed-system-roles')
    }, [])

    const handleDelete = useCallback(async (role) => {
        if (role.isSystemRole) {
            toast.error('System roles cannot be deleted')
            return
        }
        if (!confirm(`Delete role "${role.displayLabel}"? Users assigned to this role will lose their custom permissions.`)) return
        await deleteMutation.execute(`/api/rbac/roles/${role._id}`)
    }, [])

    const handleEdit = useCallback((role) => {
        setEditingRole(role)
        setShowBuilder(true)
    }, [])

    const handleCreate = useCallback(() => {
        setEditingRole(null)
        setShowBuilder(true)
    }, [])

    const handleBuilderClose = useCallback(() => {
        setShowBuilder(false)
        setEditingRole(null)
        refetchRoles()
    }, [])

    if (showBuilder) {
        return (
            <RoleBasedAccess requiredRoles={['admin']}>
                <RoleBuilder
                    role={editingRole}
                    onClose={handleBuilderClose}
                />
            </RoleBasedAccess>
        )
    }

    return (
        <RoleBasedAccess requiredRoles={['admin']}>
            <div className="p-4 md:p-6 max-w-7xl mx-auto">
                {/* Header */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                            <FaShieldAlt className="text-primary-500" />
                            Role Management
                        </h1>
                        <p className="text-gray-500 dark:text-gray-400 mt-1">
                            Create and manage roles with granular permissions
                        </p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                        <Button
                            size="sm"
                            variant="flat"
                            startContent={<FaHistory className="w-3.5 h-3.5" />}
                            onPress={() => setShowAuditLog(!showAuditLog)}
                        >
                            Audit Log
                        </Button>
                        <Button
                            size="sm"
                            variant="flat"
                            startContent={<FaSync className="w-3.5 h-3.5" />}
                            isLoading={seedMutation.isLoading}
                            onPress={handleSeedRoles}
                        >
                            Seed System Roles
                        </Button>
                        <Button
                            size="sm"
                            color="primary"
                            startContent={<FaPlus className="w-3.5 h-3.5" />}
                            onPress={handleCreate}
                        >
                            Create Role
                        </Button>
                    </div>
                </div>

                {/* Audit Log Panel */}
                {showAuditLog && (
                    <div className="mb-6">
                        <AuditLogPanel onClose={() => setShowAuditLog(false)} />
                    </div>
                )}

                {/* Roles Grid */}
                {isLoading ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {[1, 2, 3, 4, 5, 6].map((i) => (
                            <Skeleton key={i} className="h-40 rounded-xl" />
                        ))}
                    </div>
                ) : error ? (
                    <div className="text-center py-12">
                        <p className="text-gray-500">Failed to load roles. {roles.length === 0 ? 'Click "Seed System Roles" to initialize.' : ''}</p>
                    </div>
                ) : roles.length === 0 ? (
                    <div className="text-center py-16 bg-white dark:bg-gray-800 rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700">
                        <FaShieldAlt className="mx-auto h-12 w-12 text-gray-400 mb-4" />
                        <h3 className="text-lg font-medium text-gray-800 dark:text-gray-200">No roles configured</h3>
                        <p className="text-gray-500 mt-2 mb-4">Seed system roles to get started, or create a custom role.</p>
                        <div className="flex items-center justify-center gap-3">
                            <Button color="primary" onPress={handleSeedRoles} isLoading={seedMutation.isLoading}>
                                Seed System Roles
                            </Button>
                            <Button variant="flat" onPress={handleCreate}>
                                Create Custom Role
                            </Button>
                        </div>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {roles.map((role) => (
                            <div
                                key={role._id}
                                className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 hover:shadow-md transition-shadow"
                            >
                                <div className="flex items-start justify-between mb-3">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1">
                                            <h3 className="font-semibold text-gray-900 dark:text-white truncate">
                                                {role.displayLabel}
                                            </h3>
                                            {role.isSystemRole && (
                                                <Chip size="sm" variant="flat" color="primary" className="flex-shrink-0">
                                                    System
                                                </Chip>
                                            )}
                                        </div>
                                        <p className="text-xs text-gray-400 font-mono">{role.name}</p>
                                    </div>
                                </div>

                                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4 line-clamp-2">
                                    {role.description || 'No description'}
                                </p>

                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-1 text-sm text-gray-500">
                                        <FaUsers className="w-3.5 h-3.5" />
                                        <span>{role.userCount || 0} user{role.userCount !== 1 ? 's' : ''}</span>
                                    </div>

                                    <div className="flex items-center gap-1">
                                        <Button
                                            size="sm"
                                            variant="light"
                                            isIconOnly
                                            onPress={() => setAssignRole(role)}
                                            title="Assign users"
                                        >
                                            <FaUsers className="w-3.5 h-3.5" />
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="light"
                                            isIconOnly
                                            onPress={() => handleEdit(role)}
                                            title="Edit role"
                                        >
                                            <FaEdit className="w-3.5 h-3.5" />
                                        </Button>
                                        {!role.isSystemRole && (
                                            <Button
                                                size="sm"
                                                variant="light"
                                                color="danger"
                                                isIconOnly
                                                isLoading={deleteMutation.isLoading}
                                                onPress={() => handleDelete(role)}
                                                title="Delete role"
                                            >
                                                <FaTrash className="w-3.5 h-3.5" />
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Assign Users Modal */}
                {assignRole && (
                    <RoleAssignModal
                        role={assignRole}
                        onClose={() => {
                            setAssignRole(null)
                            refetchRoles()
                        }}
                    />
                )}
            </div>
        </RoleBasedAccess>
    )
}
