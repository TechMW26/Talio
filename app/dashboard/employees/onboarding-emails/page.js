'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  HiOutlineEnvelope,
  HiOutlineCheckCircle,
  HiOutlineXCircle,
  HiOutlineClock,
  HiOutlineArrowPath,
  HiOutlineMagnifyingGlass,
  HiOutlineFunnel,
  HiOutlineChevronLeft,
  HiOutlineChevronRight,
  HiOutlineUser,
  HiOutlineCalendar,
  HiOutlineExclamationTriangle,
  HiOutlineBolt,
} from 'react-icons/hi2'
import toast from 'react-hot-toast'

export default function OnboardingEmailsPage() {
  const router = useRouter()
  const [emails, setEmails] = useState([])
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({ sent: 0, failed: 0, pending: 0, total: 0 })
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, pages: 0 })
  
  // Filters
  const [statusFilter, setStatusFilter] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  
  // Selection
  const [selectedEmails, setSelectedEmails] = useState([])
  const [selectAll, setSelectAll] = useState(false)
  
  // Retry state
  const [retrying, setRetrying] = useState({})
  const [bulkRetrying, setBulkRetrying] = useState(false)
  
  // Auto-send toggle state
  const [autoSendEnabled, setAutoSendEnabled] = useState(true)
  const [togglingAutoSend, setTogglingAutoSend] = useState(false)
  const [user, setUser] = useState(null)
  
  // Get user info
  useEffect(() => {
    const userData = localStorage.getItem('user')
    if (userData) {
      setUser(JSON.parse(userData))
    }
  }, [])

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery)
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  // Fetch emails
  const fetchEmails = useCallback(async () => {
    setLoading(true)
    try {
      const token = localStorage.getItem('token')
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
      })
      
      if (statusFilter) params.set('status', statusFilter)
      if (debouncedSearch) params.set('search', debouncedSearch)
      
      const res = await fetch(`/api/employees/onboarding-emails?${params}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      
      const data = await res.json()
      
      if (data.success) {
        setEmails(data.data)
        setPagination(prev => ({ ...prev, ...data.pagination }))
        setStats(data.stats)
        // Set auto-send toggle state from API response
        if (typeof data.onboardingEmailsEnabled === 'boolean') {
          setAutoSendEnabled(data.onboardingEmailsEnabled)
        }
      } else {
        toast.error(data.message || 'Failed to fetch emails')
      }
    } catch (error) {
      console.error('Fetch error:', error)
      toast.error('Failed to fetch onboarding emails')
    } finally {
      setLoading(false)
    }
  }, [pagination.page, pagination.limit, statusFilter, debouncedSearch])

  useEffect(() => {
    fetchEmails()
  }, [fetchEmails])

  // Toggle auto-send
  const handleToggleAutoSend = async () => {
    if (user?.role !== 'admin') {
      toast.error('Only admin can change this setting')
      return
    }
    
    setTogglingAutoSend(true)
    try {
      const token = localStorage.getItem('token')
      const res = await fetch('/api/employees/onboarding-emails', {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ enabled: !autoSendEnabled }),
      })
      
      const data = await res.json()
      
      if (data.success) {
        setAutoSendEnabled(data.onboardingEmailsEnabled)
        toast.success(data.message)
      } else {
        toast.error(data.message || 'Failed to update setting')
      }
    } catch (error) {
      console.error('Toggle error:', error)
      toast.error('Failed to update setting')
    } finally {
      setTogglingAutoSend(false)
    }
  }

  // Reset page when filters change
  useEffect(() => {
    setPagination(prev => ({ ...prev, page: 1 }))
  }, [statusFilter, debouncedSearch])

  // Handle selection
  const handleSelectEmail = (emailId) => {
    setSelectedEmails(prev => 
      prev.includes(emailId) 
        ? prev.filter(id => id !== emailId)
        : [...prev, emailId]
    )
  }

  const handleSelectAll = () => {
    if (selectAll) {
      setSelectedEmails([])
    } else {
      setSelectedEmails(emails.map(e => e._id))
    }
    setSelectAll(!selectAll)
  }

  // Retry single email
  const handleRetry = async (emailId) => {
    setRetrying(prev => ({ ...prev, [emailId]: true }))
    
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/employees/onboarding-emails/${emailId}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      })
      
      const data = await res.json()
      
      if (data.success) {
        toast.success('Email sent successfully!')
        // Update the email in the list
        setEmails(prev => prev.map(e => e._id === emailId ? data.data : e))
        // Refresh stats
        fetchEmails()
      } else {
        toast.error(data.message || 'Failed to send email')
      }
    } catch (error) {
      console.error('Retry error:', error)
      toast.error('Failed to retry email')
    } finally {
      setRetrying(prev => ({ ...prev, [emailId]: false }))
    }
  }

  // Bulk retry
  const handleBulkRetry = async () => {
    if (selectedEmails.length === 0) {
      toast.error('Please select emails to retry')
      return
    }
    
    setBulkRetrying(true)
    
    try {
      const token = localStorage.getItem('token')
      const res = await fetch('/api/employees/onboarding-emails/bulk-retry', {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ emailIds: selectedEmails })
      })
      
      const data = await res.json()
      
      if (data.success) {
        toast.success(data.message)
        setSelectedEmails([])
        setSelectAll(false)
        fetchEmails()
      } else {
        toast.error(data.message || 'Failed to retry emails')
      }
    } catch (error) {
      console.error('Bulk retry error:', error)
      toast.error('Failed to retry emails')
    } finally {
      setBulkRetrying(false)
    }
  }

  // Status badge component
  const StatusBadge = ({ status }) => {
    const config = {
      sent: { 
        icon: HiOutlineCheckCircle, 
        color: 'text-green-400 bg-green-500/10 border-green-500/20',
        label: 'Sent'
      },
      failed: { 
        icon: HiOutlineXCircle, 
        color: 'text-red-400 bg-red-500/10 border-red-500/20',
        label: 'Failed'
      },
      pending: { 
        icon: HiOutlineClock, 
        color: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
        label: 'Pending'
      },
    }
    
    const { icon: Icon, color, label } = config[status] || config.pending
    
    return (
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${color}`}>
        <Icon className="w-3.5 h-3.5" />
        {label}
      </span>
    )
  }

  // Format date
  const formatDate = (date) => {
    if (!date) return '-'
    return new Date(date).toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-theme-text-primary flex items-center gap-3">
            <HiOutlineEnvelope className="w-7 h-7 text-purple-500" />
            Onboarding Emails
          </h1>
          <p className="text-theme-text-secondary mt-1">
            Track and manage welcome emails sent to new employees
          </p>
        </div>
        
        {/* Auto-send Toggle */}
        <div className={`flex items-center gap-3 p-3 rounded-xl border ${
          autoSendEnabled 
            ? 'bg-green-500/10 border-green-500/30' 
            : 'bg-gray-500/10 border-gray-500/30'
        }`}>
          <div className="flex items-center gap-2">
            <HiOutlineBolt className={`w-5 h-5 ${autoSendEnabled ? 'text-green-500' : 'text-gray-400'}`} />
            <div>
              <p className={`text-sm font-medium ${autoSendEnabled ? 'text-green-600 dark:text-green-400' : 'text-gray-600 dark:text-gray-400'}`}>
                Auto-send Emails
              </p>
              <p className="text-xs text-theme-text-secondary">
                {autoSendEnabled ? 'Emails sent automatically' : 'Emails disabled'}
              </p>
            </div>
          </div>
          <button
            onClick={handleToggleAutoSend}
            disabled={togglingAutoSend || user?.role !== 'admin'}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 ${
              autoSendEnabled ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'
            } ${togglingAutoSend ? 'opacity-50 cursor-wait' : ''} ${user?.role !== 'admin' ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            title={user?.role !== 'admin' ? 'Only admin can change this setting' : (autoSendEnabled ? 'Click to disable' : 'Click to enable')}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                autoSendEnabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </div>

      {/* Warning when disabled */}
      {!autoSendEnabled && (
        <div className="mb-6 p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/30 flex items-start gap-3">
          <HiOutlineExclamationTriangle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-yellow-600 dark:text-yellow-400">
              Automatic onboarding emails are disabled
            </p>
            <p className="text-xs text-theme-text-secondary mt-1">
              New employees will not receive welcome emails automatically. You can still manually retry failed emails from this page.
            </p>
          </div>
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div 
          className={`p-4 rounded-xl border cursor-pointer transition-all ${
            statusFilter === '' 
              ? 'bg-purple-500/10 border-purple-500/30' 
              : 'bg-theme-bg-card border-theme-bg-hover hover:border-purple-500/30'
          }`}
          onClick={() => setStatusFilter('')}
        >
          <div className="flex items-center justify-between">
            <span className="text-theme-text-secondary text-sm">Total</span>
            <HiOutlineEnvelope className="w-5 h-5 text-purple-400" />
          </div>
          <p className="text-2xl font-bold text-theme-text-primary mt-1">{stats.total}</p>
        </div>
        
        <div 
          className={`p-4 rounded-xl border cursor-pointer transition-all ${
            statusFilter === 'sent' 
              ? 'bg-green-500/10 border-green-500/30' 
              : 'bg-theme-bg-card border-theme-bg-hover hover:border-green-500/30'
          }`}
          onClick={() => setStatusFilter(statusFilter === 'sent' ? '' : 'sent')}
        >
          <div className="flex items-center justify-between">
            <span className="text-theme-text-secondary text-sm">Sent</span>
            <HiOutlineCheckCircle className="w-5 h-5 text-green-400" />
          </div>
          <p className="text-2xl font-bold text-green-400 mt-1">{stats.sent}</p>
        </div>
        
        <div 
          className={`p-4 rounded-xl border cursor-pointer transition-all ${
            statusFilter === 'failed' 
              ? 'bg-red-500/10 border-red-500/30' 
              : 'bg-theme-bg-card border-theme-bg-hover hover:border-red-500/30'
          }`}
          onClick={() => setStatusFilter(statusFilter === 'failed' ? '' : 'failed')}
        >
          <div className="flex items-center justify-between">
            <span className="text-theme-text-secondary text-sm">Failed</span>
            <HiOutlineXCircle className="w-5 h-5 text-red-400" />
          </div>
          <p className="text-2xl font-bold text-red-400 mt-1">{stats.failed}</p>
        </div>
        
        <div 
          className={`p-4 rounded-xl border cursor-pointer transition-all ${
            statusFilter === 'pending' 
              ? 'bg-yellow-500/10 border-yellow-500/30' 
              : 'bg-theme-bg-card border-theme-bg-hover hover:border-yellow-500/30'
          }`}
          onClick={() => setStatusFilter(statusFilter === 'pending' ? '' : 'pending')}
        >
          <div className="flex items-center justify-between">
            <span className="text-theme-text-secondary text-sm">Pending</span>
            <HiOutlineClock className="w-5 h-5 text-yellow-400" />
          </div>
          <p className="text-2xl font-bold text-yellow-400 mt-1">{stats.pending}</p>
        </div>
      </div>

      {/* Actions Bar */}
      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        {/* Search */}
        <div className="relative flex-1">
          <HiOutlineMagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-theme-text-secondary" />
          <input
            type="text"
            placeholder="Search by name, email, or employee code..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-theme-bg-card border border-theme-bg-hover focus:border-purple-500/50 focus:ring-2 focus:ring-purple-500/20 outline-none text-theme-text-primary placeholder:text-theme-text-secondary transition-all"
          />
        </div>
        
        {/* Bulk Retry Button */}
        {selectedEmails.length > 0 && (
          <button
            onClick={handleBulkRetry}
            disabled={bulkRetrying}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-medium transition-colors disabled:opacity-50"
          >
            {bulkRetrying ? (
              <>
                <HiOutlineArrowPath className="w-5 h-5 animate-spin" />
                Retrying {selectedEmails.length}...
              </>
            ) : (
              <>
                <HiOutlineArrowPath className="w-5 h-5" />
                Retry Selected ({selectedEmails.length})
              </>
            )}
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-theme-bg-card rounded-2xl border border-theme-bg-hover overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-theme-bg-hover bg-theme-bg-hover/50">
                <th className="px-4 py-3 text-left">
                  <input
                    type="checkbox"
                    checked={selectAll}
                    onChange={handleSelectAll}
                    className="w-4 h-4 rounded border-theme-bg-hover text-purple-600 focus:ring-purple-500/20"
                  />
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-theme-text-secondary uppercase tracking-wider">
                  Employee
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-theme-text-secondary uppercase tracking-wider">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-theme-text-secondary uppercase tracking-wider">
                  Source
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-theme-text-secondary uppercase tracking-wider">
                  Sent At
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-theme-text-secondary uppercase tracking-wider">
                  Retries
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-theme-text-secondary uppercase tracking-wider">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-theme-bg-hover">
              {loading ? (
                // Loading skeleton
                [...Array(5)].map((_, i) => (
                  <tr key={i}>
                    <td colSpan={7} className="px-4 py-4">
                      <div className="animate-pulse flex items-center gap-4">
                        <div className="w-4 h-4 bg-theme-bg-hover rounded" />
                        <div className="w-10 h-10 bg-theme-bg-hover rounded-full" />
                        <div className="flex-1">
                          <div className="h-4 bg-theme-bg-hover rounded w-1/3 mb-2" />
                          <div className="h-3 bg-theme-bg-hover rounded w-1/4" />
                        </div>
                      </div>
                    </td>
                  </tr>
                ))
              ) : emails.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center">
                    <HiOutlineEnvelope className="w-12 h-12 mx-auto text-theme-text-secondary/50 mb-3" />
                    <p className="text-theme-text-secondary">No onboarding emails found</p>
                    {(statusFilter || debouncedSearch) && (
                      <button
                        onClick={() => { setStatusFilter(''); setSearchQuery('') }}
                        className="mt-2 text-purple-400 hover:text-purple-300 text-sm"
                      >
                        Clear filters
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                emails.map((email) => (
                  <tr key={email._id} className="hover:bg-theme-bg-hover/50 transition-colors">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedEmails.includes(email._id)}
                        onChange={() => handleSelectEmail(email._id)}
                        className="w-4 h-4 rounded border-theme-bg-hover text-purple-600 focus:ring-purple-500/20"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white font-medium">
                          {email.recipientName?.charAt(0)?.toUpperCase() || 'U'}
                        </div>
                        <div>
                          <p className="font-medium text-theme-text-primary">
                            {email.recipientName}
                          </p>
                          <p className="text-sm text-theme-text-secondary">
                            {email.recipientEmail}
                          </p>
                          {email.employeeCode && (
                            <p className="text-xs text-purple-400">{email.employeeCode}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={email.status} />
                      {email.status === 'failed' && email.errorMessage && (
                        <p className="text-xs text-red-400 mt-1 max-w-[200px] truncate" title={email.errorMessage}>
                          {email.errorMessage}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-theme-text-secondary capitalize">
                        {email.triggeredBy?.replace(/_/g, ' ') || 'Manual'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm">
                        {email.sentAt ? (
                          <span className="text-theme-text-primary">{formatDate(email.sentAt)}</span>
                        ) : (
                          <span className="text-theme-text-secondary">{formatDate(email.createdAt)}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {email.retryCount > 0 ? (
                        <div className="text-sm">
                          <span className="text-orange-400">{email.retryCount} retries</span>
                          {email.lastRetryAt && (
                            <p className="text-xs text-theme-text-secondary">
                              Last: {formatDate(email.lastRetryAt)}
                            </p>
                          )}
                        </div>
                      ) : (
                        <span className="text-sm text-theme-text-secondary">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleRetry(email._id)}
                        disabled={retrying[email._id] || email.status === 'pending'}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                          email.status === 'sent'
                            ? 'bg-green-500/10 text-green-400 hover:bg-green-500/20'
                            : email.status === 'failed'
                            ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20'
                            : 'bg-yellow-500/10 text-yellow-400'
                        } disabled:opacity-50`}
                      >
                        {retrying[email._id] ? (
                          <HiOutlineArrowPath className="w-4 h-4 animate-spin" />
                        ) : (
                          <HiOutlineArrowPath className="w-4 h-4" />
                        )}
                        {email.status === 'sent' ? 'Resend' : 'Retry'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pagination.pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-theme-bg-hover">
            <p className="text-sm text-theme-text-secondary">
              Showing {((pagination.page - 1) * pagination.limit) + 1} to {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} emails
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPagination(prev => ({ ...prev, page: prev.page - 1 }))}
                disabled={pagination.page === 1}
                className="p-2 rounded-lg bg-theme-bg-hover hover:bg-theme-bg-hover/80 text-theme-text-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <HiOutlineChevronLeft className="w-5 h-5" />
              </button>
              <span className="text-sm text-theme-text-primary px-3">
                Page {pagination.page} of {pagination.pages}
              </span>
              <button
                onClick={() => setPagination(prev => ({ ...prev, page: prev.page + 1 }))}
                disabled={pagination.page === pagination.pages}
                className="p-2 rounded-lg bg-theme-bg-hover hover:bg-theme-bg-hover/80 text-theme-text-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <HiOutlineChevronRight className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
