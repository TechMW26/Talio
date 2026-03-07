'use client'

import { Skeleton, Card, CardBody } from '@heroui/react'

/**
 * Per-page skeleton loaders for navigation transitions.
 * Each skeleton mirrors the actual page layout for a smooth visual transition.
 */

// ──────────────────────────────────────────
// Dashboard
// ──────────────────────────────────────────
export function DashboardSkeleton() {
    return (
        <div className="p-4 sm:p-6 space-y-6 animate-in fade-in duration-200">
            <div className="flex items-center justify-between">
                <Skeleton className="h-8 w-48 rounded-lg" />
                <Skeleton className="h-10 w-32 rounded-lg" />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[1, 2, 3, 4].map(i => (
                    <Card key={i} className="shadow-sm">
                        <CardBody className="p-4 space-y-3">
                            <Skeleton className="h-3 w-20 rounded-lg" />
                            <Skeleton className="h-8 w-24 rounded-lg" />
                            <Skeleton className="h-3 w-16 rounded-lg" />
                        </CardBody>
                    </Card>
                ))}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[1, 2, 3, 4, 5, 6].map(i => (
                    <Card key={i} className="shadow-sm">
                        <CardBody className="p-4">
                            <Skeleton className="h-4 w-32 rounded-lg mb-4" />
                            <Skeleton className="h-20 w-full rounded-lg mb-2" />
                            <Skeleton className="h-3 w-3/4 rounded-lg" />
                        </CardBody>
                    </Card>
                ))}
            </div>
        </div>
    )
}

// ──────────────────────────────────────────
// Projects list
// ──────────────────────────────────────────
export function ProjectsSkeleton() {
    return (
        <div className="p-4 sm:p-6 space-y-6 animate-in fade-in duration-200">
            <div className="flex items-center justify-between">
                <Skeleton className="h-8 w-36 rounded-lg" />
                <div className="flex gap-2">
                    <Skeleton className="h-10 w-28 rounded-lg" />
                    <Skeleton className="h-10 w-10 rounded-lg" />
                </div>
            </div>
            <div className="flex gap-2">
                {[1, 2, 3, 4].map(i => (
                    <Skeleton key={i} className="h-8 w-20 rounded-full" />
                ))}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[1, 2, 3, 4, 5, 6].map(i => (
                    <Card key={i} className="shadow-sm">
                        <CardBody className="p-4 space-y-3">
                            <Skeleton className="h-5 w-3/4 rounded-lg" />
                            <Skeleton className="h-3 w-1/2 rounded-lg" />
                            <Skeleton className="h-3 w-2/3 rounded-lg" />
                            <Skeleton className="h-2 w-full rounded-lg mt-2" />
                            <div className="flex justify-between mt-2">
                                <Skeleton className="h-6 w-16 rounded-full" />
                                <Skeleton className="h-6 w-6 rounded-full" />
                            </div>
                        </CardBody>
                    </Card>
                ))}
            </div>
        </div>
    )
}

// ──────────────────────────────────────────
// Employees list
// ──────────────────────────────────────────
export function EmployeesSkeleton() {
    return (
        <div className="p-4 sm:p-6 space-y-6 animate-in fade-in duration-200">
            <div className="flex items-center justify-between">
                <Skeleton className="h-8 w-40 rounded-lg" />
                <Skeleton className="h-10 w-36 rounded-lg" />
            </div>
            <div className="flex gap-2 flex-wrap">
                <Skeleton className="h-10 w-64 rounded-lg" />
                <Skeleton className="h-10 w-28 rounded-lg" />
                <Skeleton className="h-10 w-28 rounded-lg" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => (
                    <Card key={i} className="shadow-sm">
                        <CardBody className="p-4 flex items-center gap-4">
                            <Skeleton className="h-12 w-12 rounded-full flex-shrink-0" />
                            <div className="flex-1 space-y-2">
                                <Skeleton className="h-4 w-32 rounded-lg" />
                                <Skeleton className="h-3 w-24 rounded-lg" />
                                <Skeleton className="h-3 w-20 rounded-lg" />
                            </div>
                            <Skeleton className="h-6 w-16 rounded-full flex-shrink-0" />
                        </CardBody>
                    </Card>
                ))}
            </div>
        </div>
    )
}

// ──────────────────────────────────────────
// Attendance
// ──────────────────────────────────────────
export function AttendanceSkeleton() {
    return (
        <div className="p-4 sm:p-6 space-y-6 animate-in fade-in duration-200">
            <div className="flex items-center justify-between">
                <Skeleton className="h-8 w-40 rounded-lg" />
                <Skeleton className="h-10 w-32 rounded-lg" />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[1, 2, 3, 4].map(i => (
                    <Card key={i} className="shadow-sm">
                        <CardBody className="p-4 space-y-2">
                            <Skeleton className="h-3 w-20 rounded-lg" />
                            <Skeleton className="h-7 w-16 rounded-lg" />
                        </CardBody>
                    </Card>
                ))}
            </div>
            <Card className="shadow-sm">
                <CardBody className="p-4 space-y-3">
                    {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
                        <div key={i} className="flex items-center gap-4">
                            <Skeleton className="h-4 w-24 rounded-lg" />
                            <Skeleton className="h-4 w-20 rounded-lg" />
                            <Skeleton className="h-4 w-20 rounded-lg" />
                            <Skeleton className="h-4 flex-1 rounded-lg" />
                            <Skeleton className="h-6 w-16 rounded-full" />
                        </div>
                    ))}
                </CardBody>
            </Card>
        </div>
    )
}

// ──────────────────────────────────────────
// Leave
// ──────────────────────────────────────────
export function LeaveSkeleton() {
    return (
        <div className="p-4 sm:p-6 space-y-6 animate-in fade-in duration-200">
            <div className="flex items-center justify-between">
                <Skeleton className="h-8 w-32 rounded-lg" />
                <Skeleton className="h-10 w-36 rounded-lg" />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[1, 2, 3, 4].map(i => (
                    <Card key={i} className="shadow-sm">
                        <CardBody className="p-4 space-y-2">
                            <Skeleton className="h-3 w-24 rounded-lg" />
                            <Skeleton className="h-7 w-12 rounded-lg" />
                            <Skeleton className="h-2 w-full rounded-lg" />
                        </CardBody>
                    </Card>
                ))}
            </div>
            <div className="space-y-3">
                {[1, 2, 3, 4, 5].map(i => (
                    <Card key={i} className="shadow-sm">
                        <CardBody className="p-4 flex items-center gap-4">
                            <Skeleton className="h-10 w-10 rounded-full flex-shrink-0" />
                            <div className="flex-1 space-y-2">
                                <Skeleton className="h-4 w-40 rounded-lg" />
                                <Skeleton className="h-3 w-32 rounded-lg" />
                            </div>
                            <Skeleton className="h-6 w-20 rounded-full flex-shrink-0" />
                        </CardBody>
                    </Card>
                ))}
            </div>
        </div>
    )
}

// ──────────────────────────────────────────
// Departments
// ──────────────────────────────────────────
export function DepartmentsSkeleton() {
    return (
        <div className="p-4 sm:p-6 space-y-6 animate-in fade-in duration-200">
            <div className="flex items-center justify-between">
                <Skeleton className="h-8 w-44 rounded-lg" />
                <Skeleton className="h-10 w-44 rounded-lg" />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[1, 2, 3, 4].map(i => (
                    <Card key={i} className="shadow-sm"><CardBody className="p-4 space-y-2"><Skeleton className="h-3 w-28 rounded-lg" /><Skeleton className="h-7 w-12 rounded-lg" /></CardBody></Card>
                ))}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[1, 2, 3, 4, 5, 6].map(i => (
                    <Card key={i} className="shadow-sm">
                        <CardBody className="p-4 space-y-3">
                            <div className="flex items-center gap-3">
                                <Skeleton className="h-10 w-10 rounded-lg flex-shrink-0" />
                                <div className="flex-1 space-y-1">
                                    <Skeleton className="h-4 w-36 rounded-lg" />
                                    <Skeleton className="h-3 w-16 rounded-lg" />
                                </div>
                            </div>
                            <Skeleton className="h-3 w-full rounded-lg" />
                            <div className="flex justify-between">
                                <Skeleton className="h-3 w-24 rounded-lg" />
                                <Skeleton className="h-3 w-20 rounded-lg" />
                            </div>
                        </CardBody>
                    </Card>
                ))}
            </div>
        </div>
    )
}

// ──────────────────────────────────────────
// Settings
// ──────────────────────────────────────────
export function SettingsSkeleton() {
    return (
        <div className="p-4 sm:p-6 space-y-6 animate-in fade-in duration-200">
            <Skeleton className="h-8 w-32 rounded-lg" />
            <div className="flex gap-2">
                {[1, 2, 3, 4].map(i => (
                    <Skeleton key={i} className="h-10 w-28 rounded-lg" />
                ))}
            </div>
            <Card className="shadow-sm">
                <CardBody className="p-6 space-y-6">
                    {[1, 2, 3, 4, 5].map(i => (
                        <div key={i} className="space-y-2">
                            <Skeleton className="h-3 w-24 rounded-lg" />
                            <Skeleton className="h-10 w-full rounded-lg" />
                        </div>
                    ))}
                    <Skeleton className="h-10 w-32 rounded-lg" />
                </CardBody>
            </Card>
        </div>
    )
}

// ──────────────────────────────────────────
// Chat
// ──────────────────────────────────────────
export function ChatSkeleton() {
    return (
        <div className="flex h-full animate-in fade-in duration-200">
            <div className="w-80 border-r border-divider p-4 space-y-3 hidden md:block">
                <Skeleton className="h-10 w-full rounded-lg" />
                {[1, 2, 3, 4, 5, 6].map(i => (
                    <div key={i} className="flex items-center gap-3">
                        <Skeleton className="h-10 w-10 rounded-full flex-shrink-0" />
                        <div className="flex-1 space-y-1">
                            <Skeleton className="h-4 w-28 rounded-lg" />
                            <Skeleton className="h-3 w-40 rounded-lg" />
                        </div>
                    </div>
                ))}
            </div>
            <div className="flex-1 flex flex-col p-4 space-y-4">
                <div className="flex items-center gap-3 pb-3 border-b border-divider">
                    <Skeleton className="h-10 w-10 rounded-full" />
                    <Skeleton className="h-5 w-32 rounded-lg" />
                </div>
                <div className="flex-1" />
                <Skeleton className="h-12 w-full rounded-lg" />
            </div>
        </div>
    )
}

// ──────────────────────────────────────────
// Generic table/list page (Expenses, Helpdesk, Meetings, etc.)
// ──────────────────────────────────────────
export function TablePageSkeleton() {
    return (
        <div className="p-4 sm:p-6 space-y-6 animate-in fade-in duration-200">
            <div className="flex items-center justify-between">
                <Skeleton className="h-8 w-40 rounded-lg" />
                <Skeleton className="h-10 w-32 rounded-lg" />
            </div>
            <div className="flex gap-2 flex-wrap">
                <Skeleton className="h-10 w-64 rounded-lg" />
                <Skeleton className="h-10 w-28 rounded-lg" />
            </div>
            <Card className="shadow-sm">
                <CardBody className="p-0">
                    {/* Table header */}
                    <div className="flex gap-4 p-4 border-b border-divider">
                        {[1, 2, 3, 4, 5].map(i => (
                            <Skeleton key={i} className="h-4 flex-1 rounded-lg" />
                        ))}
                    </div>
                    {/* Table rows */}
                    {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
                        <div key={i} className="flex gap-4 p-4 border-b border-divider last:border-b-0">
                            {[1, 2, 3, 4, 5].map(j => (
                                <Skeleton key={j} className="h-4 flex-1 rounded-lg" />
                            ))}
                        </div>
                    ))}
                </CardBody>
            </Card>
        </div>
    )
}

// ──────────────────────────────────────────
// Profile page
// ──────────────────────────────────────────
export function ProfileSkeleton() {
    return (
        <div className="p-4 sm:p-6 space-y-6 animate-in fade-in duration-200">
            <Card className="shadow-sm">
                <CardBody className="p-6 flex flex-col sm:flex-row items-center gap-6">
                    <Skeleton className="h-24 w-24 rounded-full flex-shrink-0" />
                    <div className="flex-1 space-y-2 text-center sm:text-left">
                        <Skeleton className="h-6 w-48 rounded-lg mx-auto sm:mx-0" />
                        <Skeleton className="h-4 w-36 rounded-lg mx-auto sm:mx-0" />
                        <Skeleton className="h-4 w-44 rounded-lg mx-auto sm:mx-0" />
                    </div>
                    <Skeleton className="h-10 w-28 rounded-lg flex-shrink-0" />
                </CardBody>
            </Card>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {[1, 2].map(i => (
                    <Card key={i} className="shadow-sm">
                        <CardBody className="p-6 space-y-4">
                            <Skeleton className="h-5 w-32 rounded-lg" />
                            {[1, 2, 3, 4].map(j => (
                                <div key={j} className="space-y-1">
                                    <Skeleton className="h-3 w-20 rounded-lg" />
                                    <Skeleton className="h-4 w-full rounded-lg" />
                                </div>
                            ))}
                        </CardBody>
                    </Card>
                ))}
            </div>
        </div>
    )
}

// ──────────────────────────────────────────
// Calendar / Holidays
// ──────────────────────────────────────────
export function CalendarSkeleton() {
    return (
        <div className="p-4 sm:p-6 space-y-6 animate-in fade-in duration-200">
            <div className="flex items-center justify-between">
                <Skeleton className="h-8 w-36 rounded-lg" />
                <div className="flex gap-2">
                    <Skeleton className="h-10 w-10 rounded-lg" />
                    <Skeleton className="h-10 w-32 rounded-lg" />
                    <Skeleton className="h-10 w-10 rounded-lg" />
                </div>
            </div>
            <Card className="shadow-sm">
                <CardBody className="p-4">
                    <div className="grid grid-cols-7 gap-1">
                        {[...Array(7)].map((_, i) => (
                            <Skeleton key={`h${i}`} className="h-8 rounded-lg" />
                        ))}
                        {[...Array(35)].map((_, i) => (
                            <Skeleton key={i} className="h-20 rounded-lg" />
                        ))}
                    </div>
                </CardBody>
            </Card>
        </div>
    )
}

// ──────────────────────────────────────────
// Payroll
// ──────────────────────────────────────────
export function PayrollSkeleton() {
    return (
        <div className="p-4 sm:p-6 space-y-6 animate-in fade-in duration-200">
            <div className="flex items-center justify-between">
                <Skeleton className="h-8 w-32 rounded-lg" />
                <div className="flex gap-2">
                    <Skeleton className="h-10 w-36 rounded-lg" />
                    <Skeleton className="h-10 w-28 rounded-lg" />
                </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[1, 2, 3, 4].map(i => (
                    <Card key={i} className="shadow-sm"><CardBody className="p-4 space-y-2"><Skeleton className="h-3 w-20 rounded-lg" /><Skeleton className="h-7 w-24 rounded-lg" /></CardBody></Card>
                ))}
            </div>
            <Card className="shadow-sm">
                <CardBody className="p-0">
                    {[1, 2, 3, 4, 5, 6].map(i => (
                        <div key={i} className="flex gap-4 p-4 border-b border-divider last:border-b-0">
                            <Skeleton className="h-4 w-24 rounded-lg" />
                            <Skeleton className="h-4 flex-1 rounded-lg" />
                            <Skeleton className="h-4 w-20 rounded-lg" />
                            <Skeleton className="h-6 w-16 rounded-full" />
                        </div>
                    ))}
                </CardBody>
            </Card>
        </div>
    )
}

// ──────────────────────────────────────────
// Route → Skeleton mapping
// ──────────────────────────────────────────
const ROUTE_SKELETON_MAP = {
    '/dashboard': DashboardSkeleton,
    '/dashboard/projects': ProjectsSkeleton,
    '/dashboard/employees': EmployeesSkeleton,
    '/dashboard/attendance': AttendanceSkeleton,
    '/dashboard/leave': LeaveSkeleton,
    '/dashboard/departments': DepartmentsSkeleton,
    '/dashboard/settings': SettingsSkeleton,
    '/dashboard/chat': ChatSkeleton,
    '/dashboard/profile': ProfileSkeleton,
    '/dashboard/calendar': CalendarSkeleton,
    '/dashboard/holidays': CalendarSkeleton,
    '/dashboard/payroll': PayrollSkeleton,
    '/dashboard/expenses': TablePageSkeleton,
    '/dashboard/helpdesk': TablePageSkeleton,
    '/dashboard/meetings': TablePageSkeleton,
    '/dashboard/announcements': TablePageSkeleton,
    '/dashboard/reports': TablePageSkeleton,
    '/dashboard/team': TablePageSkeleton,
    '/dashboard/todo': TablePageSkeleton,
    '/dashboard/documents': TablePageSkeleton,
    '/dashboard/assets': TablePageSkeleton,
    '/dashboard/designations': TablePageSkeleton,
    '/dashboard/leave-types': TablePageSkeleton,
    '/dashboard/policies': TablePageSkeleton,
    '/dashboard/recruitment': TablePageSkeleton,
    '/dashboard/performance': TablePageSkeleton,
    '/dashboard/productivity': TablePageSkeleton,
    '/dashboard/learning': TablePageSkeleton,
    '/dashboard/mail': TablePageSkeleton,
    '/dashboard/users': TablePageSkeleton,
    '/dashboard/talioboard': TablePageSkeleton,
    '/dashboard/admin': TablePageSkeleton,
}

/**
 * Get skeleton component for a given route.
 * Matches exact path first, then tries prefix match.
 */
export function getSkeletonForRoute(path) {
    if (!path) return TablePageSkeleton

    // Exact match
    if (ROUTE_SKELETON_MAP[path]) return ROUTE_SKELETON_MAP[path]

    // Prefix match (e.g. /dashboard/projects/my-tasks → ProjectsSkeleton)
    const segments = path.split('/')
    for (let i = segments.length; i >= 2; i--) {
        const prefix = segments.slice(0, i).join('/')
        if (ROUTE_SKELETON_MAP[prefix]) return ROUTE_SKELETON_MAP[prefix]
    }

    return TablePageSkeleton
}
