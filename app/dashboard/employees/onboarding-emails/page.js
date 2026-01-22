'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardBody, Button, Chip, Skeleton, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Input, Checkbox } from '@heroui/react'
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
  HiOutlinePaperAirplane,
  HiOutlinePlus,
  HiOutlineXMark,
  HiOutlineInformationCircle,
} from 'react-icons/hi2'
import toast from '@/utils/toast'

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
  
  // Send new email modal state
  const [showSendModal, setShowSendModal] = useState(false)
  const [sendEmailAddress, setSendEmailAddress] = useState('')
  const [resetPassword, setResetPassword] = useState(true)
  const [sendingEmail, setSendingEmail] = useState(false)
  
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

  // Send new onboarding email
  const handleSendOnboardingEmail = async () => {
    if (!sendEmailAddress.trim()) {
      toast.error('Please enter an email address')
      return
    }
    
    setSendingEmail(true)
    try {
      const token = localStorage.getItem('token')
      const res = await fetch('/api/employees/send-onboarding-email', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: sendEmailAddress.trim(),
          resetPassword: resetPassword,
        }),
      })
      
      const data = await res.json()
      
      if (data.success) {
        toast.success(data.message)
        if (data.data?.newPassword) {
          toast.success(`New password: ${data.data.newPassword}`, { duration: 10000 })
        }
        setShowSendModal(false)
        setSendEmailAddress('')
        fetchEmails() // Refresh the list
      } else {
        toast.error(data.message || 'Failed to send email')
      }
    } catch (error) {
      console.error('Send email error:', error)
      toast.error('Failed to send onboarding email')
    } finally {
      setSendingEmail(false)
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

  // Queue all failed emails for auto-retry
  const [queuingFailed, setQueuingFailed] = useState(false)
  
  const handleQueueAllFailed = async () => {
    if (stats.failed === 0) {
      toast.error('No failed emails to queue')
      return
    }
    
    setQueuingFailed(true)
    
    try {
      const token = localStorage.getItem('token')
      const res = await fetch('/api/employees/onboarding-emails/queue-failed', {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ delayMinutes: 5 })
      })
      
      const data = await res.json()
      
      if (data.success) {
        toast.success(data.message)
        fetchEmails()
      } else {
        toast.error(data.message || 'Failed to queue emails')
      }
    } catch (error) {
      console.error('Queue failed emails error:', error)
      toast.error('Failed to queue emails')
    } finally {
      setQueuingFailed(false)
    }
  }

  // Status badge component
  const StatusBadge = ({ status, queued, scheduledFor }) => {
    // Special handling for queued/rate-limited emails
    if (queued && scheduledFor) {
      const scheduledTime = new Date(scheduledFor)
      const now = new Date()
      const isReady = scheduledTime <= now
      
      return (
        <div className="flex flex-col gap-1">
          <Chip 
            color={isReady ? "primary" : "warning"} 
            variant="flat" 
            size="sm"
            startContent={<HiOutlineClock className="w-3.5 h-3.5" />}
          >
            {isReady ? 'Ready to Retry' : 'Scheduled'}
          </Chip>
          <span className="text-[10px] text-default-500">
            {isReady ? 'Processing soon...' : `Retry at ${formatDate(scheduledFor)}`}
          </span>
        </div>
      )
    }
    
    const config = {
      sent: { 
        icon: HiOutlineCheckCircle, 
        color: 'success',
        label: 'Sent'
      },
      failed: { 
        icon: HiOutlineXCircle, 
        color: 'danger',
        label: 'Failed'
      },
      pending: { 
        icon: HiOutlineClock, 
        color: 'warning',
        label: 'Pending'
      },
    }
    
    const { icon: Icon, color, label } = config[status] || config.pending
    
    return (
      <Chip 
        color={color} 
        variant="flat" 
        size="sm"
        startContent={<Icon className="w-3.5 h-3.5" />}
      >
        {label}
      </Chip>
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
        
        <div className="flex items-center gap-3">
          {/* Send New Email Button */}
          <Button
            color="secondary"
            onPress={() => setShowSendModal(true)}
            startContent={<HiOutlinePaperAirplane className="w-5 h-5" />}
            className="font-medium"
          >
            Send Email
          </Button>
          
          {/* Auto-send Toggle */}
          <div className={`flex items-center gap-3 p-3 rounded-xl border ${
          autoSendEnabled 
            ? 'bg-success-50 border-success/30' 
            : 'bg-default-100 border-default-300'
        }`}>
          <div className="flex items-center gap-2">
            <HiOutlineBolt className={`w-5 h-5 ${autoSendEnabled ? 'text-success' : 'text-default-400'}`} />
            <div>
              <p className={`text-sm font-medium ${autoSendEnabled ? 'text-success' : 'text-default-600'}`}>
                Auto-send Emails
              </p>
              <p className="text-xs text-default-500">
                {autoSendEnabled ? 'Emails sent automatically' : 'Emails disabled'}
              </p>
            </div>
          </div>
          <button
            onClick={handleToggleAutoSend}
            disabled={togglingAutoSend || user?.role !== 'admin'}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 ${
              autoSendEnabled ? 'bg-success' : 'bg-default-300'
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
      </div>

      {/* Warning when disabled */}
      {!autoSendEnabled && (
        <div className="mb-6 p-4 rounded-xl bg-warning-50 border border-warning/30 flex items-start gap-3">
          <HiOutlineExclamationTriangle className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-warning">
              Automatic onboarding emails are disabled
            </p>
            <p className="text-xs text-default-500 mt-1">
              New employees will not receive welcome emails automatically. You can still manually retry failed emails from this page.
            </p>
          </div>
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card 
          shadow="sm"
          isPressable
          onPress={() => setStatusFilter('')}
          className={`cursor-pointer transition-all ${
            statusFilter === '' 
              ? 'bg-secondary-50 border-secondary/30' 
              : 'border-default-200 hover:border-secondary/30'
          }`}
        >
          <CardBody className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-default-500 text-sm">Total</span>
              <HiOutlineEnvelope className="w-5 h-5 text-secondary" />
            </div>
            <p className="text-2xl font-bold text-default-800 mt-1">{stats.total}</p>
          </CardBody>
        </Card>
        
        <Card 
          shadow="sm"
          isPressable
          onPress={() => setStatusFilter(statusFilter === 'sent' ? '' : 'sent')}
          className={`cursor-pointer transition-all ${
            statusFilter === 'sent' 
              ? 'bg-success-50 border-success/30' 
              : 'border-default-200 hover:border-success/30'
          }`}
        >
          <CardBody className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-default-500 text-sm">Sent</span>
              <HiOutlineCheckCircle className="w-5 h-5 text-success" />
            </div>
            <p className="text-2xl font-bold text-success mt-1">{stats.sent}</p>
          </CardBody>
        </Card>
        
        <Card 
          shadow="sm"
          isPressable
          onPress={() => setStatusFilter(statusFilter === 'failed' ? '' : 'failed')}
          className={`cursor-pointer transition-all ${
            statusFilter === 'failed' 
              ? 'bg-danger-50 border-danger/30' 
              : 'border-default-200 hover:border-danger/30'
          }`}
        >
          <CardBody className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-default-500 text-sm">Failed</span>
              <HiOutlineXCircle className="w-5 h-5 text-danger" />
            </div>
            <p className="text-2xl font-bold text-danger mt-1">{stats.failed}</p>
          </CardBody>
        </Card>
        
        <Card 
          shadow="sm"
          isPressable
          onPress={() => setStatusFilter(statusFilter === 'pending' ? '' : 'pending')}
          className={`cursor-pointer transition-all ${
            statusFilter === 'pending' 
              ? 'bg-warning-50 border-warning/30' 
              : 'border-default-200 hover:border-warning/30'
          }`}
        >
          <CardBody className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-default-500 text-sm">Pending</span>
              <HiOutlineClock className="w-5 h-5 text-warning" />
            </div>
            <p className="text-2xl font-bold text-warning mt-1">{stats.pending}</p>
          </CardBody>
        </Card>
      </div>

      {/* Actions Bar */}
      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        {/* Search */}
        <div className="relative flex-1">
          <HiOutlineMagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-default-400" />
          <input
            type="text"
            placeholder="Search by name, email, or employee code..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-content1 border border-default-200 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none text-default-800 placeholder:text-default-400 transition-all"
          />
        </div>
        
        {/* Bulk Retry Button */}
        {selectedEmails.length > 0 && (
          <Button
            color="secondary"
            onPress={handleBulkRetry}
            isLoading={bulkRetrying}
            isDisabled={bulkRetrying}
            startContent={!bulkRetrying && <HiOutlineArrowPath className="w-5 h-5" />}
            className="font-medium"
          >
            {bulkRetrying ? `Retrying ${selectedEmails.length}...` : `Retry Selected (${selectedEmails.length})`}
          </Button>
        )}
        
        {/* Queue All Failed Button */}
        {stats.failed > 0 && selectedEmails.length === 0 && (
          <Button
            color="warning"
            onPress={handleQueueAllFailed}
            isLoading={queuingFailed}
            isDisabled={queuingFailed}
            startContent={!queuingFailed && <HiOutlineClock className="w-5 h-5" />}
            className="font-medium"
            title="Queue all failed emails for automatic retry with rate limit protection"
          >
            {queuingFailed ? 'Queueing...' : `Auto-Retry Failed (${stats.failed})`}
          </Button>
        )}
      </div>

      {/* Rate Limit Info */}
      {stats.failed > 0 && (
        <Card shadow="sm" className="mb-4 bg-primary-50 border border-primary/20">
          <CardBody className="p-4">
            <div className="flex items-start gap-3">
              <HiOutlineInformationCircle className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-primary">Rate Limit Protection</p>
                <p className="text-primary/80 text-sm mt-1">
                  Failed emails are automatically queued for retry with exponential backoff to avoid rate limits. 
                  Use "Auto-Retry Failed" to queue all failed emails, or the system will process them automatically.
                </p>
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Table */}
      <Card shadow="sm" className="overflow-hidden">
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-default-200 bg-default-50">
                <th className="px-4 py-3 text-left">
                  <input
                    type="checkbox"
                    checked={selectAll}
                    onChange={handleSelectAll}
                    className="w-4 h-4 rounded border-default-300 text-primary focus:ring-primary/20"
                  />
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-default-500 uppercase tracking-wider">
                  Employee
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-default-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-default-500 uppercase tracking-wider">
                  Source
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-default-500 uppercase tracking-wider">
                  Sent At
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-default-500 uppercase tracking-wider">
                  Retries
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-default-500 uppercase tracking-wider">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-default-200 bg-content1">
              {loading ? (
                // Loading skeleton
                [...Array(5)].map((_, i) => (
                  <tr key={i}>
                    <td colSpan={7} className="px-4 py-4">
                      <div className="flex items-center gap-4">
                        <Skeleton className="w-4 h-4 rounded" />
                        <Skeleton className="w-10 h-10 rounded-full" />
                        <div className="flex-1 space-y-2">
                          <Skeleton className="h-4 w-1/3 rounded" />
                          <Skeleton className="h-3 w-1/4 rounded" />
                        </div>
                      </div>
                    </td>
                  </tr>
                ))
              ) : emails.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center">
                    <HiOutlineEnvelope className="w-12 h-12 mx-auto text-default-300 mb-3" />
                    <p className="text-default-500">No onboarding emails found</p>
                    {(statusFilter || debouncedSearch) && (
                      <Button
                        variant="light"
                        color="secondary"
                        size="sm"
                        onPress={() => { setStatusFilter(''); setSearchQuery('') }}
                        className="mt-2"
                      >
                        Clear filters
                      </Button>
                    )}
                  </td>
                </tr>
              ) : (
                emails.map((email) => (
                  <tr key={email._id} className="hover:bg-default-50 transition-colors">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedEmails.includes(email._id)}
                        onChange={() => handleSelectEmail(email._id)}
                        className="w-4 h-4 rounded border-default-300 text-primary focus:ring-primary/20"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-secondary to-pink-500 flex items-center justify-center text-white font-medium">
                          {email.recipientName?.charAt(0)?.toUpperCase() || 'U'}
                        </div>
                        <div>
                          <p className="font-medium text-default-800">
                            {email.recipientName}
                          </p>
                          <p className="text-sm text-default-500">
                            {email.recipientEmail}
                          </p>
                          {email.employeeCode && (
                            <p className="text-xs text-secondary">{email.employeeCode}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={email.status} queued={email.queued} scheduledFor={email.scheduledFor} />
                      {email.status === 'failed' && email.errorMessage && !email.queued && (
                        <p className="text-xs text-danger mt-1 max-w-[200px] truncate" title={email.errorMessage}>
                          {email.errorMessage}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-default-500 capitalize">
                        {email.triggeredBy?.replace(/_/g, ' ') || 'Manual'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm">
                        {email.sentAt ? (
                          <span className="text-default-800">{formatDate(email.sentAt)}</span>
                        ) : (
                          <span className="text-default-500">{formatDate(email.createdAt)}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {(email.retryCount > 0 || email.autoRetryCount > 0) ? (
                        <div className="text-sm">
                          {email.retryCount > 0 && (
                            <span className="text-warning">{email.retryCount} manual</span>
                          )}
                          {email.autoRetryCount > 0 && (
                            <span className={`${email.retryCount > 0 ? 'ml-1' : ''} text-primary`}>
                              {email.retryCount > 0 ? '+ ' : ''}{email.autoRetryCount} auto
                            </span>
                          )}
                          {email.lastRetryAt && (
                            <p className="text-xs text-default-500">
                              Last: {formatDate(email.lastRetryAt)}
                            </p>
                          )}
                        </div>
                      ) : (
                        <span className="text-sm text-default-500">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        size="sm"
                        variant="flat"
                        color={email.status === 'sent' ? 'success' : email.status === 'failed' ? 'danger' : 'warning'}
                        onPress={() => handleRetry(email._id)}
                        isLoading={retrying[email._id]}
                        isDisabled={retrying[email._id] || email.status === 'pending'}
                        startContent={!retrying[email._id] && <HiOutlineArrowPath className="w-4 h-4" />}
                      >
                        {email.status === 'sent' ? 'Resend' : 'Retry'}
                      </Button>
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
              Showing {((pagination.page - 1) * pagination.limit) + 1} to {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} emails
            </p>
            <div className="flex items-center gap-2">
              <Button
                isIconOnly
                variant="flat"
                size="sm"
                onPress={() => setPagination(prev => ({ ...prev, page: prev.page - 1 }))}
                isDisabled={pagination.page === 1}
              >
                <HiOutlineChevronLeft className="w-5 h-5" />
              </Button>
              <span className="text-sm text-default-800 px-3">
                Page {pagination.page} of {pagination.pages}
              </span>
              <Button
                isIconOnly
                variant="flat"
                size="sm"
                onPress={() => setPagination(prev => ({ ...prev, page: prev.page + 1 }))}
                isDisabled={pagination.page === pagination.pages}
              >
                <HiOutlineChevronRight className="w-5 h-5" />
              </Button>
            </div>
          </div>
        )}
        </CardBody>
      </Card>

      {/* Send Email Modal */}
      <Modal 
        isOpen={showSendModal} 
        onOpenChange={(open) => {
          if (!open) {
            setShowSendModal(false)
            setSendEmailAddress('')
          }
        }}
        size="md"
      >
        <ModalContent>
          <ModalHeader className="flex items-center gap-2">
            <HiOutlinePaperAirplane className="w-5 h-5 text-secondary" />
            Send Onboarding Email
          </ModalHeader>
          <ModalBody>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-default-500 mb-2">
                  Employee Email Address
                </label>
                <input
                  type="email"
                  value={sendEmailAddress}
                  onChange={(e) => setSendEmailAddress(e.target.value)}
                  placeholder="employee@company.com"
                  className="w-full px-4 py-2.5 rounded-xl border border-default-300 bg-content2 text-default-800 placeholder-default-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                />
              </div>
              
              <div className="flex items-center gap-3 p-3 rounded-xl bg-default-100 border border-default-200">
                <Checkbox
                  id="resetPassword"
                  isSelected={resetPassword}
                  onValueChange={setResetPassword}
                  color="secondary"
                >
                  Reset password and send new credentials
                </Checkbox>
              </div>
              
              <p className="text-xs text-default-500">
                {resetPassword 
                  ? "A new random password will be generated and sent to the employee. They will be required to change it on first login."
                  : "The email will be sent with the default password (employee123). Enable password reset for security."}
              </p>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button
              variant="bordered"
              onPress={() => {
                setShowSendModal(false)
                setSendEmailAddress('')
              }}
            >
              Cancel
            </Button>
            <Button
              color="secondary"
              onPress={handleSendOnboardingEmail}
              isLoading={sendingEmail}
              isDisabled={sendingEmail || !sendEmailAddress.trim()}
              startContent={!sendingEmail && <HiOutlinePaperAirplane className="w-4 h-4" />}
            >
              {sendingEmail ? 'Sending...' : 'Send Email'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  )
}
