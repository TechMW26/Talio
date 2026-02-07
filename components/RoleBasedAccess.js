'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { FaExclamationTriangle } from 'react-icons/fa'
import Loader from '@/components/ui/Loader'

// Define role permissions for different routes
const rolePermissions = {
  // Admin has access to everything
  admin: ['*'],
  
  // HR has access to HR-related functions
  hr: [
    '/dashboard',
    '/dashboard/productivity',
    '/dashboard/employees',
    '/dashboard/employees/add',
    '/dashboard/departments',
    '/dashboard/designations',
    '/dashboard/attendance',
    '/dashboard/attendance/report',
    '/dashboard/attendance/checkins',
    '/dashboard/attendance/team',
    '/dashboard/leave/requests',
    '/dashboard/leave/approvals',
    '/dashboard/leave-types',
    '/dashboard/payroll/generate',
    '/dashboard/payroll/payslips',
    '/dashboard/payroll/structure',
    '/dashboard/performance/ratings',
    '/dashboard/performance/create',
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
    '/dashboard/attendance',
    '/dashboard/attendance/report',
    '/dashboard/leave/apply',
    '/dashboard/leave/requests',
    '/dashboard/leave/approvals', // Approve team leaves
    '/dashboard/leave/balance',
    '/dashboard/performance/ratings',
    '/dashboard/performance/create',
    '/dashboard/performance/goals',
    '/dashboard/profile',
    '/dashboard/documents',
    '/dashboard/expenses',
    '/dashboard/travel',
    '/dashboard/learning/trainings',
    '/dashboard/learning/certificates',
    '/dashboard/announcements',
  ],
  
  // Employee has access to personal functions only
  employee: [
    '/dashboard',
    '/dashboard/productivity',
    '/dashboard/profile',
    '/dashboard/attendance',
    '/dashboard/attendance/report', // Own attendance only
    '/dashboard/leave/apply',
    '/dashboard/leave/requests', // Own requests only
    '/dashboard/leave/balance',
    '/dashboard/payroll/payslips', // Own payslips only
    '/dashboard/documents',
    '/dashboard/expenses',
    '/dashboard/travel',
    '/dashboard/learning/trainings',
    '/dashboard/learning/certificates',
    '/dashboard/announcements',
    '/dashboard/helpdesk',
  ],
}

// Helper function to check if user has access to a route
const hasAccess = (userRole, pathname) => {
  if (!userRole || !rolePermissions[userRole]) {
    return false
  }
  
  const permissions = rolePermissions[userRole]
  
  // Admin has access to everything
  if (permissions.includes('*')) {
    return true
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

export default function RoleBasedAccess({ children, requiredRoles = [], pathname }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [hasPermission, setHasPermission] = useState(false)
  const router = useRouter()

  useEffect(() => {
    const userData = localStorage.getItem('user')
    if (userData) {
      const parsedUser = JSON.parse(userData)
      setUser(parsedUser)

      // Check if user has access to current route
      const currentPath = pathname || window.location.pathname
      const permission = hasAccess(parsedUser.role, currentPath)
      setHasPermission(permission)

      // If specific roles are required, check against them
      if (requiredRoles.length > 0) {
        const rolePermission = requiredRoles.includes(parsedUser.role)
        setHasPermission(permission && rolePermission)
      }
    } else {
      // No user data, redirect to login
      router.push('/login')
      return
    }

    setLoading(false)
  }, [pathname])

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
            You don&apos;t have permission to access this page. Your current role ({user?.role}) doesn&apos;t allow access to this resource.
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
              <div className={`w-3 h-3 rounded-full ${
                user?.role === 'admin' ? 'bg-red-500' :
                user?.role === 'hr' ? 'bg-green-500' :
                user?.role === 'manager' ? 'bg-blue-500' : 'bg-gray-500'
              }`}></div>
              <span className="text-sm font-medium text-gray-900 capitalize">
                {user?.role} User
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
