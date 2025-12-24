'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import toast from '@/utils/toast'

export default function SuperAdminDashboard() {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchStats()
  }, [])

  const fetchStats = async () => {
    try {
      const token = localStorage.getItem('superadmin_token')
      const res = await fetch('/api/superadmin/stats', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (data.success) {
        setStats(data.stats)
      } else {
        toast.error(data.message)
      }
    } catch (error) {
      toast.error('Failed to fetch dashboard stats')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="p-6 lg:p-8">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-gray-200 rounded w-48"></div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-32 bg-gray-100 rounded-2xl"></div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  const statCards = [
    {
      title: 'Total Companies',
      value: stats?.companies?.total || 0,
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
        </svg>
      ),
      color: 'from-blue-500 to-cyan-500',
      bgColor: 'bg-blue-50',
      textColor: 'text-blue-600',
    },
    {
      title: 'Active',
      value: stats?.companies?.active || 0,
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      color: 'from-green-500 to-emerald-500',
      bgColor: 'bg-green-50',
      textColor: 'text-green-600',
    },
    {
      title: 'Pending Setup',
      value: stats?.companies?.pendingSetup || 0,
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      color: 'from-yellow-500 to-orange-500',
      bgColor: 'bg-yellow-50',
      textColor: 'text-yellow-600',
    },
    {
      title: 'Overdue Reminders',
      value: stats?.reminders?.overdue || 0,
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
      ),
      color: 'from-red-500 to-pink-500',
      bgColor: 'bg-red-50',
      textColor: 'text-red-600',
    },
  ]

  return (
    <div className="p-6 lg:p-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-500 mt-1">Welcome back to Talio Platform Management</p>
        </div>
        <Link
          href="/superadmin/companies/new"
          className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-medium rounded-xl hover:from-purple-700 hover:to-indigo-700 transition-all shadow-lg shadow-purple-500/25"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Company
        </Link>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((stat, index) => (
          <div
            key={index}
            className={`relative overflow-hidden rounded-2xl p-6 ${stat.bgColor} border border-gray-100`}
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-gray-500 text-sm">{stat.title}</p>
                <p className={`text-3xl font-bold ${stat.textColor} mt-1`}>{stat.value}</p>
              </div>
              <div className={`p-3 rounded-xl bg-gradient-to-br ${stat.color} text-white`}>
                {stat.icon}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Subscription Stats & Recent Companies */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Subscription Overview */}
        <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Subscription Overview</h2>
          <div className="space-y-4">
            {Object.entries(stats?.subscriptions?.byPlan || {}).map(([plan, count]) => (
              <div key={plan} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${
                    plan === 'enterprise' ? 'bg-purple-500' :
                    plan === 'professional' ? 'bg-blue-500' :
                    plan === 'starter' ? 'bg-green-500' :
                    'bg-gray-400'
                  }`} />
                  <span className="text-gray-700 capitalize">{plan}</span>
                </div>
                <span className="text-gray-900 font-semibold">{count}</span>
              </div>
            ))}
            <div className="pt-4 border-t border-gray-100 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-yellow-600">Expiring (30 days)</span>
                <span className="text-yellow-600 font-semibold">{stats?.subscriptions?.expiring || 0}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-red-600">Expired</span>
                <span className="text-red-600 font-semibold">{stats?.subscriptions?.expired || 0}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Recent Companies */}
        <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Recent Companies</h2>
            <Link href="/superadmin/companies" className="text-sm text-purple-600 hover:text-purple-700">
              View all →
            </Link>
          </div>
          <div className="space-y-3">
            {stats?.recentCompanies?.length > 0 ? (
              stats.recentCompanies.map((company) => (
                <Link
                  key={company._id}
                  href={`/superadmin/companies/${company._id}`}
                  className="flex items-center justify-between p-3 rounded-xl hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-br from-purple-600 to-indigo-600 rounded-xl flex items-center justify-center text-white font-semibold">
                      {company.name.charAt(0)}
                    </div>
                    <div>
                      <p className="text-gray-900 font-medium">{company.name}</p>
                      <p className="text-xs text-gray-500">{company.slug}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {company.isSetupComplete ? (
                      <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded-full font-medium">Active</span>
                    ) : (
                      <span className="px-2 py-1 bg-yellow-100 text-yellow-700 text-xs rounded-full font-medium">Pending</span>
                    )}
                  </div>
                </Link>
              ))
            ) : (
              <p className="text-gray-400 text-center py-4">No companies yet</p>
            )}
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <Link
            href="/superadmin/companies/new"
            className="flex flex-col items-center gap-2 p-4 rounded-xl bg-purple-50 hover:bg-purple-100 transition-colors text-center"
          >
            <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center">
              <svg className="w-6 h-6 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </div>
            <span className="text-sm text-gray-700 font-medium">New Company</span>
          </Link>
          <Link
            href="/superadmin/email"
            className="flex flex-col items-center gap-2 p-4 rounded-xl bg-blue-50 hover:bg-blue-100 transition-colors text-center"
          >
            <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
              <svg className="w-6 h-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <span className="text-sm text-gray-700 font-medium">Send Email</span>
          </Link>
          <Link
            href="/superadmin/analytics"
            className="flex flex-col items-center gap-2 p-4 rounded-xl bg-cyan-50 hover:bg-cyan-100 transition-colors text-center"
          >
            <div className="w-12 h-12 bg-cyan-100 rounded-xl flex items-center justify-center">
              <svg className="w-6 h-6 text-cyan-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <span className="text-sm text-gray-700 font-medium">Analytics</span>
          </Link>
          <Link
            href="/superadmin/reminders"
            className="flex flex-col items-center gap-2 p-4 rounded-xl bg-yellow-50 hover:bg-yellow-100 transition-colors text-center"
          >
            <div className="w-12 h-12 bg-yellow-100 rounded-xl flex items-center justify-center">
              <svg className="w-6 h-6 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
            </div>
            <span className="text-sm text-gray-700 font-medium">Reminders</span>
          </Link>
          <Link
            href="/superadmin/companies?status=suspended"
            className="flex flex-col items-center gap-2 p-4 rounded-xl bg-red-50 hover:bg-red-100 transition-colors text-center"
          >
            <div className="w-12 h-12 bg-red-100 rounded-xl flex items-center justify-center">
              <svg className="w-6 h-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
              </svg>
            </div>
            <span className="text-sm text-gray-700 font-medium">Suspended</span>
          </Link>
          <Link
            href="/superadmin/companies?subscriptionStatus=expired"
            className="flex flex-col items-center gap-2 p-4 rounded-xl bg-orange-50 hover:bg-orange-100 transition-colors text-center"
          >
            <div className="w-12 h-12 bg-orange-100 rounded-xl flex items-center justify-center">
              <svg className="w-6 h-6 text-orange-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <span className="text-sm text-gray-700 font-medium">Expired Subs</span>
          </Link>
        </div>
      </div>
    </div>
  )
}
