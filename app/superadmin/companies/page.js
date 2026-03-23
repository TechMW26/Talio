'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Select, SelectItem } from '@heroui/react'
import toast from '@/utils/toast'

export default function CompaniesPage() {
  const searchParams = useSearchParams()
  const [companies, setCompanies] = useState([])
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') || '')
  const [subscriptionFilter, setSubscriptionFilter] = useState(searchParams.get('subscriptionStatus') || '')

  useEffect(() => {
    fetchCompanies()
  }, [statusFilter, subscriptionFilter])

  const fetchCompanies = async (searchQuery = '') => {
    try {
      const token = localStorage.getItem('superadmin_token')
      const params = new URLSearchParams()
      if (searchQuery || search) params.append('search', searchQuery || search)
      if (statusFilter) params.append('status', statusFilter)
      if (subscriptionFilter) params.append('subscriptionStatus', subscriptionFilter)

      const res = await fetch(`/api/superadmin/companies?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (data.success) {
        setCompanies(data.companies)
        setStats(data.stats)
      } else {
        toast.error(data.message)
      }
    } catch (error) {
      toast.error('Failed to fetch companies')
    } finally {
      setLoading(false)
    }
  }

  const handleSearch = (e) => {
    e.preventDefault()
    setLoading(true)
    fetchCompanies(search)
  }

  const getStatusBadge = (status) => {
    const styles = {
      active: 'bg-green-100 text-green-700',
      paused: 'bg-yellow-100 text-yellow-700',
      suspended: 'bg-red-100 text-red-700',
      terminated: 'bg-gray-100 text-gray-600',
    }
    return styles[status] || styles.active
  }

  const getSubscriptionBadge = (status) => {
    const styles = {
      active: 'bg-green-100 text-green-700',
      pending: 'bg-yellow-100 text-yellow-700',
      expired: 'bg-red-100 text-red-700',
      cancelled: 'bg-gray-100 text-gray-600',
      paused: 'bg-orange-100 text-orange-700',
    }
    return styles[status] || styles.pending
  }

  return (
    <div className="p-6 lg:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-gray-900">Companies</h1>
          <p className="text-gray-500 mt-1">Manage all tenant companies</p>
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

      {/* Stats Bar */}
      {stats && (
        <div className="flex flex-wrap gap-3">
          <div className="px-4 py-2 bg-white rounded-xl border border-gray-200 shadow-sm">
            <span className="text-gray-500 text-sm">Total:</span>
            <span className="text-gray-900 font-semibold ml-2">{stats.total}</span>
          </div>
          <div className="px-4 py-2 bg-green-50 rounded-xl border border-green-200">
            <span className="text-green-700 text-sm">Active:</span>
            <span className="text-green-700 font-semibold ml-2">{stats.active}</span>
          </div>
          <div className="px-4 py-2 bg-yellow-50 rounded-xl border border-yellow-200">
            <span className="text-yellow-700 text-sm">Pending Setup:</span>
            <span className="text-yellow-700 font-semibold ml-2">{stats.pendingSetup}</span>
          </div>
          <div className="px-4 py-2 bg-red-50 rounded-xl border border-red-200">
            <span className="text-red-700 text-sm">Suspended:</span>
            <span className="text-red-700 font-semibold ml-2">{stats.suspended}</span>
          </div>
        </div>
      )}

      {/* Search and Filters */}
      <div className="bg-white rounded-2xl p-4 border border-gray-200 shadow-sm">
        <div className="flex flex-col md:flex-row gap-4">
          {/* Search */}
          <form onSubmit={handleSearch} className="flex-1">
            <div className="input-with-icon">
              <svg className="input-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search companies..."
                className="input input-search"
              />
            </div>
          </form>

          {/* Status Filter */}
          <Select
            selectedKeys={statusFilter ? [statusFilter] : []}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Status Filter"
            placeholder="All Status"
            classNames={{ trigger: "bg-gray-50 min-w-[140px]" }}
          >
            <SelectItem key="active">Active</SelectItem>
            <SelectItem key="paused">Paused</SelectItem>
            <SelectItem key="suspended">Suspended</SelectItem>
          </Select>

          {/* Subscription Filter */}
          <Select
            selectedKeys={subscriptionFilter ? [subscriptionFilter] : []}
            onChange={(e) => setSubscriptionFilter(e.target.value)}
            aria-label="Subscription Filter"
            placeholder="All Subscriptions"
            classNames={{ trigger: "bg-gray-50 min-w-[160px]" }}
          >
            <SelectItem key="active">Active</SelectItem>
            <SelectItem key="pending">Pending</SelectItem>
            <SelectItem key="expired">Expired</SelectItem>
            <SelectItem key="cancelled">Cancelled</SelectItem>
          </Select>
        </div>
      </div>

      {/* Companies Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-48 bg-gray-100 rounded-2xl animate-pulse"></div>
          ))}
        </div>
      ) : companies.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">No companies found</h3>
          <p className="text-gray-500 mb-6">Get started by creating your first company</p>
          <Link
            href="/superadmin/companies/new"
            className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-xl hover:bg-purple-700 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Company
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {companies.map((company) => (
            <Link
              key={company._id}
              href={`/superadmin/companies/${company._id}`}
              className="bg-white rounded-2xl p-6 border border-gray-200 hover:border-purple-300 hover:shadow-lg transition-all group"
            >
              {/* Company Header */}
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-gradient-to-br from-purple-600 to-indigo-600 rounded-xl flex items-center justify-center text-white font-bold text-lg">
                    {company.name.charAt(0)}
                  </div>
                  <div>
                    <h3 className="text-gray-900 font-semibold group-hover:text-purple-600 transition-colors">
                      {company.name}
                    </h3>
                    <p className="text-xs text-gray-400">{company.slug}</p>
                  </div>
                </div>
              </div>

              {/* Status Badges */}
              <div className="flex flex-wrap gap-2 mb-4">
                <span className={`px-2 py-1 text-xs rounded-full font-medium ${getStatusBadge(company.serviceStatus)}`}>
                  {company.serviceStatus}
                </span>
                <span className={`px-2 py-1 text-xs rounded-full font-medium ${getSubscriptionBadge(company.subscription?.status)}`}>
                  {company.subscription?.plan}
                </span>
                {!company.isSetupComplete && (
                  <span className="px-2 py-1 text-xs rounded-full font-medium bg-orange-100 text-orange-700">
                    Pending Setup
                  </span>
                )}
              </div>

              {/* Contact */}
              <div className="text-sm text-gray-600 mb-4">
                <p className="truncate">{company.primaryContact?.name}</p>
                <p className="truncate text-xs text-gray-400">{company.primaryContact?.email}</p>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between pt-4 border-t border-gray-100">
                <span className="text-xs text-gray-400">
                  {new Date(company.createdAt).toLocaleDateString()}
                </span>
                <span className="text-xs text-purple-600 group-hover:translate-x-1 transition-transform">
                  View details →
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
