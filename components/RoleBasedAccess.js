'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { FaExclamationTriangle } from 'react-icons/fa'
import Loader from '@/components/ui/Loader'
import { getPageSlugForPath, checkPermission } from '@/lib/permissions.shared'
import { getRoleDisplayLabel } from '@/hooks/useRoles'

// Define role permissions for different routes
const rolePermissions = {
  // Admin has access to everything
  admin: ['*'],
  super_admin: ['*'],

  // HR has access to HR-related functions
  hr: [
    '/dashboard',
    '/dashboard/productivity',
    '/dashboard/employees',
    '/dashboard/employees/add',
    '/dashboard/departments',
    '/dashboard/designations',
    '/dashboard/hierarchy',
    '/dashboard/attendance',
    '/dashboard/attendance/report',
    '/dashboard/attendance/checkins',
    '/dashboard/attendance/team',
    '/dashboard/leave/requests',
    '/dashboard/leave/approvals',
    '/dashboard/leave-types',
    '/dashboard/payroll/generate',
    '/dashboard/payroll/payslips',
    '/dashboard/performance/create',
    '/dashboard/performance/appraisals',
    '/dashboard/recruitment',
    '/dashboard/documents',
    '/dashboard/policies',
    '/dashboard/announcements',
    '/dashboard/holidays',
  ],

  // Manager has access to team management
  manager: [
    '/dashboard',
    '/dashboard/productivity',
    '/dashboard/employees', // View team members
    '/dashboard/departments', // View departments
    '/dashboard/hierarchy',
    '/dashboard/attendance',
    '/dashboard/attendance/report',
    '/dashboard/leave/apply',
    '/dashboard/leave/requests',
    '/dashboard/leave/approvals', // Approve team leaves
    '/dashboard/leave/balance',
    '/dashboard/performance/create',
    '/dashboard/performance/appraisals',
    '/dashboard/profile',
    '/dashboard/documents',
    '/dashboard/expenses',
    '/dashboard/travel',
    '/dashboard/announcements',
  ],

  // Team Leader has access to team monitoring + personal functions
  team_leader: [
    '/dashboard',
    '/dashboard/productivity',
    '/dashboard/employees',
    '/dashboard/profile',
    '/dashboard/attendance',
    '/dashboard/attendance/report',
    '/dashboard/attendance/team',
    '/dashboard/team/members',
    '/dashboard/team/my-teams',
    '/dashboard/hierarchy',
    '/dashboard/team/regularisation',
    '/dashboard/leave/apply',
    '/dashboard/leave/requests',
    '/dashboard/leave/approvals',
    '/dashboard/leave/balance',
    '/dashboard/performance/appraisals',
    '/dashboard/performance/reports',
    '/dashboard/performance/my-performance',
    '/dashboard/payroll/payslips',
    '/dashboard/documents',
    '/dashboard/expenses',
    '/dashboard/travel',
    '/dashboard/announcements',
    '/dashboard/helpdesk',
  ],

  // Department heads review recommendations escalated from team leaders/managers.
  department_head: [
    '/dashboard',
    '/dashboard/employees',
    '/dashboard/team/members',
    '/dashboard/performance/reports',
    '/dashboard/performance/appraisals',
    '/dashboard/profile',
  ],

  // Employee has access to personal functions only
  employee: [
    '/dashboard',
    '/dashboard/productivity',
    '/dashboard/profile',
    '/dashboard/hierarchy',
    '/dashboard/attendance',
    '/dashboard/attendance/report', // Own attendance only
    '/dashboard/leave/apply',
    '/dashboard/leave/requests', // Own requests only
    '/dashboard/leave/balance',
    '/dashboard/payroll/payslips', // Own payslips only
    '/dashboard/documents',
    '/dashboard/expenses',
    '/dashboard/travel',
    '/dashboard/announcements',
    '/dashboard/helpdesk',
  ],
}

const EMPTY_REQUIRED_ROLES = Object.freeze([])

// Helper function to check if user has access to a route
const hasAccess = (userRole, pathname, rbacPermissions, userRecord = null) => {
  if (!userRole || !rolePermissions[userRole]) {
    return false
  }

  const permissions = rolePermissions[userRole]
  if (pathname === '/dashboard/resignations') return true
  if (pathname === '/dashboard/manpower-requests' && (
    ['admin', 'hr', 'super_admin', 'manager', 'team_leader', 'department_head'].includes(userRole)
    || userRecord?.isDepartmentHead || userRecord?.isDepartmentManager || userRecord?.teamLeaderOf?.length
  )) return true

  // Admin has access to everything
  if (permissions.includes('*')) {
    return true
  }

  const orgReviewer = Boolean(
    userRecord?.isDepartmentHead
    || userRecord?.isDepartmentManager
    || userRecord?.teamLeaderOf?.length
    || userRole === 'department_head'
  )
  if (orgReviewer && (
    pathname === '/dashboard/performance/appraisals'
    || pathname.startsWith('/dashboard/employees/')
  )) return true

  // RBAC permissions check (if available, grants access alongside legacy)
  if (rbacPermissions) {
    const slug = getPageSlugForPath(pathname)
    if (slug && checkPermission(rbacPermissions, slug, 'view')) {
      return true
    }
  }

  // Check exact match first
  if (permissions.includes(pathname)) {
    return true
  }

  // Check if any permission is a parent path of the current pathname
  return permissions.some(permission => {
    // Handle wildcard permissions like '/dashboard/employees/*'
    if (permission.endsWith('/*')) {
      const basePath = permission.slice(0, -2)
      return pathname.startsWith(basePath)
    }

    // Handle parent path permissions
    return pathname.startsWith(permission + '/')
  })
}

export default function RoleBasedAccess({ children, requiredRoles = EMPTY_REQUIRED_ROLES, pathname }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [hasPermission, setHasPermission] = useState(false)
  const router = useRouter()

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const resolveAccess = async () => {
    const userData = localStorage.getItem('user')
    if (userData) {
      const parsedUser = JSON.parse(userData)
      if (!cancelled) setUser(parsedUser)

      // Check if user has access to current route
      const currentPath = pathname || window.location.pathname
      const rbacPerms = parsedUser.permissions || parsedUser.permissionsCache || null
      let permission = hasAccess(parsedUser.role, currentPath, rbacPerms, parsedUser)

      // If specific roles are required, check against them
      if (requiredRoles.length > 0) {
        const rolePermission = requiredRoles.includes(parsedUser.role)
        permission = permission && rolePermission
      }

      // Leadership flags can be assigned independently of the base employee role.
      // Resolve those flags from the tenant API when they are not in local session data.
      const hierarchyRoute = currentPath === '/dashboard/performance/appraisals'
        || currentPath === '/dashboard/manpower-requests'
        || currentPath.startsWith('/dashboard/employees/')
      if (!permission && hierarchyRoute && requiredRoles.length === 0) {
        try {
          const response = await fetch('/api/team/check-head', {
            headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
          })
          const authority = response.ok ? await response.json() : null
          const isReviewer = Boolean(authority?.success && (
            authority.isDepartmentHead || authority.isDepartmentManager || authority.isTeamLeader
          ))
          if (isReviewer) permission = true
        } catch (error) {
          console.error('Could not verify hierarchy access:', error)
        }
      }
      if (!cancelled) setHasPermission(permission)
    } else {
      // No user data, redirect to login
      router.push('/login')
      return
    }

    if (!cancelled) setLoading(false)
    }
    resolveAccess()
    return () => { cancelled = true }
  }, [pathname, requiredRoles, router])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader size="lg" />
      </div>
    )
  }

  if (!hasPermission) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full bg-white rounded-lg shadow-md p-8 text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <FaExclamationTriangle className="w-8 h-8 text-red-500" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Access Denied</h1>
          <p className="text-gray-600 mb-6">
            You don&apos;t have permission to access this page. Your current role ({getRoleDisplayLabel(user?.role)}) doesn&apos;t allow access to this resource.
          </p>
          <div className="space-y-3">
            <button
              onClick={() => router.back()}
              className="w-full bg-primary-500 text-white py-2 px-4 rounded-lg hover:bg-primary-600 transition-colors"
            >
              Go Back
            </button>
            <button
              onClick={() => router.push('/dashboard')}
              className="w-full bg-gray-200 text-gray-800 py-2 px-4 rounded-lg hover:bg-gray-300 transition-colors"
            >
              Go to Dashboard
            </button>
          </div>

          {/* Role Information */}
          <div className="mt-6 p-4 bg-gray-50 rounded-lg">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Your Access Level:</h3>
            <div className="flex items-center justify-center space-x-2">
              <div className={`w-3 h-3 rounded-full ${user?.role === 'admin' ? 'bg-red-500' :
                user?.role === 'hr' ? 'bg-green-500' :
                  user?.role === 'manager' ? 'bg-blue-500' : 'bg-gray-500'
                }`}></div>
              <span className="text-sm font-medium text-gray-900 capitalize">
                {getRoleDisplayLabel(user?.role)} User
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Contact your administrator if you need access to this resource.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return children
}

// Export the permission checking function for use in other components
export { hasAccess, rolePermissions }
