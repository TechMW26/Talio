'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { Card, CardBody, Button, Skeleton, Input, Chip } from '@heroui/react'
import {
  HiOutlineKey,
  HiOutlineMagnifyingGlass,
  HiOutlineChevronLeft,
  HiOutlineChevronRight,
  HiOutlineCheckCircle,
  HiOutlineXCircle,
  HiOutlineClipboard,
  HiOutlineFunnel,
  HiOutlineArrowLeft,
  HiOutlineShieldCheck,
  HiOutlineEye,
  HiOutlineEyeSlash,
} from 'react-icons/hi2'
import { useRouter } from 'next/navigation'
import toast from '@/utils/toast'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import { DataErrorState } from '@/components/ui/ErrorBoundary'
import BackgroundRefreshIndicator from '@/components/ui/BackgroundRefreshIndicator'

/**
 * Reveal a user's full password by calling the secure reveal API.
 * This triggers an audit log entry on the server side.
 */
async function revealPassword(userId, action = 'view') {
  const token = localStorage.getItem('token')
  if (!token) throw new Error('Not authenticated')
  
  const res = await fetch('/api/employees/user-passwords/reveal', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ userId, action }),
  })
  
  const data = await res.json()
  if (!res.ok || !data.success) {
    throw new Error(data.message || 'Failed to reveal password')
  }
  
  return data
}

export default function UserPasswordsPage() {
  const router = useRouter()

  // Filters & pagination
  const [page, setPage] = useState(1)
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [filter, setFilter] = useState('all') // 'all', 'with-password', 'without-password'
  
  // Track which passwords are revealed (by userId)
  const [revealedPasswords, setRevealedPasswords] = useState({})
  const [loadingReveal, setLoadingReveal] = useState({})

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery)
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  // Reset page when filters change
  useEffect(() => {
    setPage(1)
  }, [debouncedSearch, filter])

  // SWR key for fetching users
  const swrKey = useMemo(() => {
    const params = new URLSearchParams({
      page: page.toString(),
      limit: '50',
      filter,
    })
    if (debouncedSearch) params.set('search', debouncedSearch)
    return `/api/employees/user-passwords?${params}`
  }, [page, debouncedSearch, filter])

  const { data: swrData, error, isLoading, isValidating, mutate: refreshUsers } = useAuthedSWR(swrKey)

  const users = swrData?.data || []
  const stats = swrData?.stats || { total: 0, withPassword: 0, withoutPassword: 0 }
  const pagination = swrData?.pagination || { page: 1, limit: 50, total: 0, pages: 0 }

  // Reveal a password (calls secure API)
  const handleRevealPassword = useCallback(async (userId) => {
    if (revealedPasswords[userId]) {
      // Toggle off — hide the revealed password
      setRevealedPasswords(prev => {
        const next = { ...prev }
        delete next[userId]
        return next
      })
      return
    }
    
    setLoadingReveal(prev => ({ ...prev, [userId]: true }))
    try {
      const data = await revealPassword(userId, 'view')
      setRevealedPasswords(prev => ({ ...prev, [userId]: data.password }))
    } catch (err) {
      toast.error(err.message)
    } finally {
      setLoadingReveal(prev => ({ ...prev, [userId]: false }))
    }
  }, [revealedPasswords])

  // Copy password to clipboard (calls reveal API if not already revealed)
  const copyPassword = useCallback(async (userId, email) => {
    try {
      let password = revealedPasswords[userId]
      if (!password) {
        const data = await revealPassword(userId, 'copy')
        password = data.password
        setRevealedPasswords(prev => ({ ...prev, [userId]: password }))
      }
      await navigator.clipboard.writeText(password)
      toast.success(`Password copied for ${email}`)
    } catch (err) {
      toast.error(err.message)
    }
  }, [revealedPasswords])

  // Copy credentials (email + password)
  const copyCredentials = useCallback(async (userId, email) => {
    try {
      let password = revealedPasswords[userId]
      if (!password) {
        const data = await revealPassword(userId, 'copy_credentials')
        password = data.password
        setRevealedPasswords(prev => ({ ...prev, [userId]: password }))
      }
      await navigator.clipboard.writeText(`Email: ${email}\nPassword: ${password}`)
      toast.success('Credentials copied!')
    } catch (err) {
      toast.error(err.message)
    }
  }, [revealedPasswords])

  const formatDate = (dateString) => {
    if (!dateString) return '-'
    return new Date(dateString).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  // Get display password — either revealed (full) or masked from API
  const getDisplayPassword = (user) => {
    if (revealedPasswords[user._id]) {
      return revealedPasswords[user._id]
    }
    return user.password // This is already masked from the API
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button
            isIconOnly
            variant="light"
            onPress={() => router.push('/dashboard/employees')}
          >
            <HiOutlineArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-theme-text-primary flex items-center gap-2">
              <HiOutlineKey className="w-7 h-7 text-warning" />
              User Passwords
              <HiOutlineShieldCheck className="w-5 h-5 text-success ml-1" title="Passwords are encrypted at rest" />
            </h1>
            <p className="text-theme-text-secondary mt-1">
              View onboarding credentials (encrypted at rest, audit-logged)
            </p>
            <BackgroundRefreshIndicator isValidating={isValidating} />
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card shadow="sm" className="bg-default-50">
          <CardBody className="flex flex-row items-center gap-4">
            <div className="p-3 rounded-xl bg-primary/10">
              <HiOutlineKey className="w-6 h-6 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold text-default-800">{stats.total}</p>
              <p className="text-sm text-default-500">Total Users</p>
            </div>
          </CardBody>
        </Card>
        <Card shadow="sm" className="bg-success-50">
          <CardBody className="flex flex-row items-center gap-4">
            <div className="p-3 rounded-xl bg-success/10">
              <HiOutlineCheckCircle className="w-6 h-6 text-success" />
            </div>
            <div>
              <p className="text-2xl font-bold text-success">{stats.withPassword}</p>
              <p className="text-sm text-default-500">With Password</p>
            </div>
          </CardBody>
        </Card>
        <Card shadow="sm" className="bg-danger-50">
          <CardBody className="flex flex-row items-center gap-4">
            <div className="p-3 rounded-xl bg-danger/10">
              <HiOutlineXCircle className="w-6 h-6 text-danger" />
            </div>
            <div>
              <p className="text-2xl font-bold text-danger">{stats.withoutPassword}</p>
              <p className="text-sm text-default-500">Without Password</p>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Filters */}
      <Card shadow="sm">
        <CardBody className="flex flex-col md:flex-row gap-4">
          <Input
            placeholder="Search by name, email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            startContent={<HiOutlineMagnifyingGlass className="w-5 h-5 text-default-400" />}
            className="md:max-w-xs"
          />

          <div className="flex items-center gap-2">
            <HiOutlineFunnel className="w-5 h-5 text-default-400" />
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={filter === 'all' ? 'solid' : 'flat'}
                color={filter === 'all' ? 'primary' : 'default'}
                onPress={() => { setFilter('all'); setPage(1) }}
              >
                All
              </Button>
              <Button
                size="sm"
                variant={filter === 'with-password' ? 'solid' : 'flat'}
                color={filter === 'with-password' ? 'success' : 'default'}
                onPress={() => { setFilter('with-password'); setPage(1) }}
              >
                With Password
              </Button>
              <Button
                size="sm"
                variant={filter === 'without-password' ? 'solid' : 'flat'}
                color={filter === 'without-password' ? 'danger' : 'default'}
                onPress={() => { setFilter('without-password'); setPage(1) }}
              >
                Without Password
              </Button>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Table */}
      <Card shadow="sm" className="overflow-hidden">
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-default-200 bg-default-50">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-default-500 uppercase tracking-wider">
                    Employee
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-default-500 uppercase tracking-wider">
                    Email
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-default-500 uppercase tracking-wider">
                    Onboarding Password
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-default-500 uppercase tracking-wider">
                    Password Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-default-500 uppercase tracking-wider">
                    Last Updated
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-default-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-default-200 bg-content1">
                {error && !swrData ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12">
                      <DataErrorState message={error.message} onRetry={() => refreshUsers()} />
                    </td>
                  </tr>
                ) : isLoading ? (
                  [...Array(10)].map((_, i) => (
                    <tr key={i}>
                      <td colSpan={6} className="px-4 py-4">
                        <div className="flex items-center gap-4">
                          <Skeleton className="w-10 h-10 rounded-full" />
                          <div className="flex-1 space-y-2">
                            <Skeleton className="h-4 w-1/3 rounded" />
                            <Skeleton className="h-3 w-1/4 rounded" />
                          </div>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : users.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center">
                      <HiOutlineKey className="w-12 h-12 mx-auto text-default-300 mb-3" />
                      <p className="text-default-500">No users found</p>
                    </td>
                  </tr>
                ) : (
                  users.map((user) => (
                    <tr key={user._id} className="hover:bg-default-50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center text-white font-medium">
                            {(user.firstName || user.email)?.charAt(0)?.toUpperCase() || 'U'}
                          </div>
                          <div>
                            <p className="font-medium text-default-800">
                              {user.firstName} {user.lastName}
                            </p>
                            {user.employeeCode && (
                              <p className="text-xs text-primary">{user.employeeCode}</p>
                            )}
                            {user.designation && (
                              <p className="text-xs text-default-500">{user.designation}</p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-sm text-default-800">{user.email}</p>
                        <Chip size="sm" variant="flat" color="secondary" className="mt-1">
                          {user.role}
                        </Chip>
                      </td>
                      <td className="px-4 py-3">
                        {user.passwordStatus === 'changed_by_user' ? (
                          <span className="text-sm text-success-600 italic flex items-center gap-1">
                            <HiOutlineShieldCheck className="w-4 h-4" />
                            Password changed by user
                          </span>
                        ) : user.hasPassword ? (
                          <div className="flex items-center gap-2">
                            <code className={`px-3 py-1.5 border rounded-lg text-sm font-mono font-semibold ${
                              revealedPasswords[user._id]
                                ? 'bg-warning-50 border-warning-200 text-warning-700'
                                : 'bg-default-100 border-default-200 text-default-600'
                            }`}>
                              {getDisplayPassword(user)}
                            </code>
                            <Button
                              isIconOnly
                              size="sm"
                              variant="light"
                              isLoading={loadingReveal[user._id]}
                              onPress={() => handleRevealPassword(user._id)}
                              title={revealedPasswords[user._id] ? 'Hide password' : 'Show password'}
                            >
                              {revealedPasswords[user._id] 
                                ? <HiOutlineEyeSlash className="w-4 h-4 text-default-500" />
                                : <HiOutlineEye className="w-4 h-4 text-default-500" />
                              }
                            </Button>
                          </div>
                        ) : (
                          <span className="text-sm text-danger-500 italic">Not available</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {user.passwordStatus === 'changed_by_user' ? (
                          <Chip size="sm" variant="flat" color="success">
                            Changed
                          </Chip>
                        ) : user.passwordStatus === 'must_change' ? (
                          <Chip size="sm" variant="flat" color="warning">
                            Must Change
                          </Chip>
                        ) : user.hasPassword ? (
                          <Chip size="sm" variant="flat" color="success">
                            Active
                          </Chip>
                        ) : (
                          <Chip size="sm" variant="flat" color="default">
                            Unknown
                          </Chip>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-default-500">
                          {formatDate(user.updatedAt)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {user.hasPassword ? (
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              size="sm"
                              variant="flat"
                              color="primary"
                              onPress={() => copyPassword(user._id, user.email)}
                              startContent={<HiOutlineClipboard className="w-4 h-4" />}
                            >
                              Copy
                            </Button>
                            <Button
                              size="sm"
                              variant="flat"
                              color="secondary"
                              onPress={() => copyCredentials(user._id, user.email)}
                            >
                              Copy All
                            </Button>
                          </div>
                        ) : (
                          <span className="text-sm text-default-400">-</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {pagination.pages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-default-200">
              <p className="text-sm text-default-500">
                Showing {((page - 1) * pagination.limit) + 1} to {Math.min(page * pagination.limit, pagination.total)} of {pagination.total}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  isIconOnly
                  variant="flat"
                  size="sm"
                  onPress={() => setPage(p => p - 1)}
                  isDisabled={page === 1}
                >
                  <HiOutlineChevronLeft className="w-4 h-4" />
                </Button>
                <span className="text-sm text-default-600">
                  Page {page} of {pagination.pages}
                </span>
                <Button
                  isIconOnly
                  variant="flat"
                  size="sm"
                  onPress={() => setPage(p => p + 1)}
                  isDisabled={page === pagination.pages}
                >
                  <HiOutlineChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
