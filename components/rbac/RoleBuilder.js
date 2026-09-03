'use client'

import { useState, useMemo, useCallback } from 'react'
import { Button, Input, Textarea, Switch, Chip } from '@heroui/react'
import { FaArrowLeft, FaSave, FaToggleOn, FaToggleOff } from 'react-icons/fa'
import { toast } from '@/utils/toast'
import useApiMutation from '@/hooks/useApiMutation'
import {
    PERMISSIONS_SCHEMA,
    PAGE_SLUG_META,
    CATEGORIES,
    ACTIONS,
    actionToKey,
    buildEmptyPermissions,
    normalizePermissionsShape,
} from '@/lib/permissions.shared'

const CATEGORY_ORDER = [
    CATEGORIES.MAIN,
    CATEGORIES.ATTENDANCE_LEAVES,
    CATEGORIES.PAYROLL,
    CATEGORIES.PROJECTS_TASKS,
    CATEGORIES.PERFORMANCE,
    CATEGORIES.PEOPLE_RECRUITMENT,
    CATEGORIES.COMMUNICATION,
    CATEGORIES.RESOURCES,
    CATEGORIES.COMPANY,
    CATEGORIES.ADMINISTRATION,
]

const ACTION_LABELS = {
    [ACTIONS.VIEW]: 'View',
    [ACTIONS.CREATE]: 'Create',
    [ACTIONS.EDIT]: 'Edit',
    [ACTIONS.DELETE]: 'Delete',
    [ACTIONS.EXPORT]: 'Export',
    [ACTIONS.APPROVE]: 'Approve',
    [ACTIONS.REJECT]: 'Reject',
    [ACTIONS.ASSIGN]: 'Assign',
    [ACTIONS.MANAGE]: 'Manage',
}

const ACTION_COLORS = {
    [ACTIONS.VIEW]: 'default',
    [ACTIONS.CREATE]: 'success',
    [ACTIONS.EDIT]: 'warning',
    [ACTIONS.DELETE]: 'danger',
    [ACTIONS.EXPORT]: 'secondary',
    [ACTIONS.APPROVE]: 'success',
    [ACTIONS.REJECT]: 'danger',
    [ACTIONS.ASSIGN]: 'primary',
    [ACTIONS.MANAGE]: 'primary',
}

export default function RoleBuilder({ role, onClose }) {
    const isEditing = !!role

    const [name, setName] = useState(role?.name || '')
    const [displayLabel, setDisplayLabel] = useState(role?.displayLabel || '')
    const [description, setDescription] = useState(role?.description || '')
    const [permissions, setPermissions] = useState(() => {
        if (role?.permissions) return normalizePermissionsShape(role.permissions)
        return buildEmptyPermissions()
    })
    const [expandedCategories, setExpandedCategories] = useState(() => {
        const map = {}
        for (const cat of CATEGORY_ORDER) map[cat] = true
        return map
    })

    const saveMutation = useApiMutation({
        method: isEditing ? 'PUT' : 'POST',
        onSuccess: (data) => {
            toast.success(isEditing ? 'Role updated' : 'Role created')
            onClose()
        },
        onError: (err) => toast.error(err.message || 'Failed to save role'),
    })

    // Organize permissions by category
    const categorizedPages = useMemo(() => {
        const map = {}
        for (const cat of CATEGORY_ORDER) map[cat] = []

        for (const [slug, meta] of Object.entries(PAGE_SLUG_META)) {
            const actions = PERMISSIONS_SCHEMA[slug] || []
            if (!map[meta.category]) map[meta.category] = []
            map[meta.category].push({ slug, label: meta.label, actions })
        }
        return map
    }, [])

    // Stats
    const stats = useMemo(() => {
        let total = 0
        let enabled = 0
        for (const [slug, actions] of Object.entries(PERMISSIONS_SCHEMA)) {
            for (const action of actions) {
                total++
                const key = actionToKey(action)
                if (permissions[slug]?.[key] === true) enabled++
            }
        }
        return { total, enabled, percentage: total > 0 ? Math.round((enabled / total) * 100) : 0 }
    }, [permissions])

    const togglePermission = useCallback((slug, action) => {
        setPermissions((prev) => {
            const next = { ...prev }
            next[slug] = { ...next[slug] }
            const key = actionToKey(action)
            next[slug][key] = !next[slug][key]

            // If enabling a non-view action, auto-enable view
            if (action !== ACTIONS.VIEW && next[slug][key]) {
                next[slug].canView = true
            }
            // If disabling view, disable all other actions for that slug
            if (action === ACTIONS.VIEW && !next[slug][key]) {
                for (const k of Object.keys(next[slug])) {
                    next[slug][k] = false
                }
            }
            return next
        })
    }, [])

    const toggleCategory = useCallback(
        (category, enable) => {
            setPermissions((prev) => {
                const next = { ...prev }
                const pages = categorizedPages[category] || []
                for (const page of pages) {
                    next[page.slug] = { ...next[page.slug] }
                    for (const action of page.actions) {
                        next[page.slug][actionToKey(action)] = enable
                    }
                }
                return next
            })
        },
        [categorizedPages]
    )

    const toggleAll = useCallback((enable) => {
        setPermissions((prev) => {
            const next = { ...prev }
            for (const [slug, actions] of Object.entries(PERMISSIONS_SCHEMA)) {
                next[slug] = { ...next[slug] }
                for (const action of actions) {
                    next[slug][actionToKey(action)] = enable
                }
            }
            return next
        })
    }, [])

    const handleSave = useCallback(async () => {
        if (!displayLabel.trim()) {
            toast.error('Display label is required')
            return
        }
        if (!isEditing && !name.trim()) {
            toast.error('Role name is required')
            return
        }

        const url = isEditing ? `/api/rbac/roles/${role._id}` : '/api/rbac/roles'
        const body = {
            displayLabel: displayLabel.trim(),
            description: description.trim(),
            permissions,
        }
        if (!isEditing) {
            body.name = name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_')
        }

        await saveMutation.execute(url, body)
    }, [name, displayLabel, description, permissions, isEditing, role])

    return (
        <div className="p-4 md:p-6 max-w-7xl mx-auto">
            {/* Header */}
            <div className="flex items-center justify-between gap-4 mb-6">
                <div className="flex items-center gap-3">
                    <Button size="sm" variant="light" isIconOnly onPress={onClose}>
                        <FaArrowLeft />
                    </Button>
                    <div>
                        <h1 className="text-xl font-bold text-gray-900 dark:text-white">
                            {isEditing ? `Edit: ${role.displayLabel}` : 'Create New Role'}
                        </h1>
                        <p className="text-sm text-gray-500">
                            {stats.enabled}/{stats.total} permissions enabled ({stats.percentage}%)
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Button size="sm" variant="flat" onPress={() => toggleAll(false)} startContent={<FaToggleOff />}>
                        None
                    </Button>
                    <Button size="sm" variant="flat" onPress={() => toggleAll(true)} startContent={<FaToggleOn />}>
                        All
                    </Button>
                    <Button
                        size="sm"
                        color="primary"
                        startContent={<FaSave />}
                        isLoading={saveMutation.isLoading}
                        onPress={handleSave}
                    >
                        {isEditing ? 'Save Changes' : 'Create Role'}
                    </Button>
                </div>
            </div>

            {/* Metadata */}
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 mb-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {!isEditing && (
                        <Input
                            label="Role Name (slug)"
                            placeholder="e.g. sales_manager"
                            value={name}
                            onValueChange={setName}
                            description="Lowercase, underscores only. Cannot be changed later."
                            isDisabled={isEditing}
                        />
                    )}
                    <Input
                        label="Display Label"
                        placeholder="e.g. Sales Manager"
                        value={displayLabel}
                        onValueChange={setDisplayLabel}
                    />
                    <Textarea
                        label="Description"
                        placeholder="Brief description of this role..."
                        value={description}
                        onValueChange={setDescription}
                        minRows={1}
                        maxRows={2}
                    />
                </div>
            </div>

            {/* Permissions Grid */}
            <div className="space-y-4">
                {CATEGORY_ORDER.map((category) => {
                    const pages = categorizedPages[category] || []
                    if (pages.length === 0) return null

                    const isExpanded = expandedCategories[category]
                    const catEnabled = pages.every((page) =>
                        page.actions.every(
                            (action) => permissions[page.slug]?.[actionToKey(action)] === true
                        )
                    )

                    return (
                        <div
                            key={category}
                            className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden"
                        >
                            {/* Category Header */}
                            <div
                                className="flex items-center justify-between px-5 py-3 bg-gray-50 dark:bg-gray-750 cursor-pointer select-none"
                                onClick={() =>
                                    setExpandedCategories((prev) => ({
                                        ...prev,
                                        [category]: !prev[category],
                                    }))
                                }
                            >
                                <div className="flex items-center gap-3">
                                    <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                                        {isExpanded ? '▼' : '▶'} {category}
                                    </span>
                                    <Chip size="sm" variant="flat">
                                        {pages.length} page{pages.length !== 1 ? 's' : ''}
                                    </Chip>
                                </div>
                                <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                    <Button
                                        size="sm"
                                        variant="light"
                                        onPress={() => toggleCategory(category, !catEnabled)}
                                    >
                                        {catEnabled ? 'Disable All' : 'Enable All'}
                                    </Button>
                                </div>
                            </div>

                            {/* Pages */}
                            {isExpanded && (
                                <div className="divide-y divide-gray-100 dark:divide-gray-700">
                                    {pages.map(({ slug, label, actions }) => (
                                        <div
                                            key={slug}
                                            className="px-5 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4"
                                        >
                                            <div className="w-48 flex-shrink-0">
                                                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                                    {label}
                                                </span>
                                                <span className="text-xs text-gray-400 block font-mono">{slug}</span>
                                            </div>
                                            <div className="flex flex-wrap gap-2">
                                                {actions.map((action) => {
                                                    const key = actionToKey(action)
                                                    const enabled = permissions[slug]?.[key] === true
                                                    return (
                                                        <Chip
                                                            key={action}
                                                            size="sm"
                                                            variant={enabled ? 'solid' : 'bordered'}
                                                            color={enabled ? ACTION_COLORS[action] : 'default'}
                                                            className="cursor-pointer select-none"
                                                            onClick={() => togglePermission(slug, action)}
                                                        >
                                                            {ACTION_LABELS[action]}
                                                        </Chip>
                                                    )
                                                })}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
