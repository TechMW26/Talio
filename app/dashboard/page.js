'use client'

import { useEffect, useState } from 'react'
import AdminDashboard from '@/components/dashboards/AdminDashboard'
import HRDashboard from '@/components/dashboards/HRDashboard'
import ManagerDashboard from '@/components/dashboards/ManagerDashboard'
import EmployeeDashboard from '@/components/dashboards/EmployeeDashboard'

// Helper function to render role-based dashboard
const renderDashboardByRole = (user) => {
  switch (user?.role) {
    case 'god_admin':
    case 'admin':
    case 'department_head':
      return <AdminDashboard user={user} />
    case 'hr':
      return <HRDashboard user={user} />
    case 'manager':
      return <ManagerDashboard user={user} />
    case 'employee':
    default:
      return <EmployeeDashboard user={user} />
  }
}

export default function DashboardPage() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const userData = localStorage.getItem('user')
    if (userData) {
      setUser(JSON.parse(userData))
    }
    setLoading(false)
  }, [])

  if (loading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  return renderDashboardByRole(user)
}

