'use client'

import { useEffect, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import toast from '@/utils/toast'

export default function CompanyDetailPage({ params }) {
  const router = useRouter()
  const { id } = use(params)
  const [company, setCompany] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('overview')
  const [newNote, setNewNote] = useState({ content: '', category: 'general' })
  const [newReminder, setNewReminder] = useState({ title: '', description: '', dueDate: '', priority: 'medium' })
  const [submitting, setSubmitting] = useState(false)
  const [editingSubscription, setEditingSubscription] = useState(false)
  const [subscriptionForm, setSubscriptionForm] = useState({})
  const [showEmailModal, setShowEmailModal] = useState(false)
  const [emailForm, setEmailForm] = useState({ subject: '', body: '' })
  const [sendingEmail, setSendingEmail] = useState(false)
  // Admin management state
  const [admins, setAdmins] = useState([])
  const [loadingAdmins, setLoadingAdmins] = useState(false)
  const [showAdminModal, setShowAdminModal] = useState(false)
  const [adminForm, setAdminForm] = useState({ email: '', password: '', firstName: '', lastName: '', phone: '' })
  const [creatingAdmin, setCreatingAdmin] = useState(false)
  const [resettingPassword, setResettingPassword] = useState(null)
  const [newPassword, setNewPassword] = useState('')
  // Delete company state
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteType, setDeleteType] = useState('soft') // 'soft' or 'permanent'

  useEffect(() => {
    fetchCompany()
  }, [id])

  useEffect(() => {
    if (company?.subscription) {
      setSubscriptionForm({
        plan: company.subscription.plan || 'custom',
        billingCycle: company.subscription.billingCycle || 'monthly',
        tenureDays: company.subscription.tenureDays || 30,
        amount: company.subscription.amount || 0,
        maxUsers: company.subscription.maxUsers || 10,
        maxStorageGB: company.subscription.maxStorageGB || 1,
        startDate: company.subscription.startDate ? new Date(company.subscription.startDate).toISOString().split('T')[0] : '',
        status: company.subscription.status || 'active',
      })
    }
  }, [company])

  const fetchCompany = async () => {
    try {
      const token = localStorage.getItem('superadmin_token')
      const res = await fetch(`/api/superadmin/companies/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (data.success) {
        setCompany(data.company)
      } else {
        toast.error(data.message)
        router.push('/superadmin/companies')
      }
    } catch (error) {
      toast.error('Failed to fetch company')
    } finally {
      setLoading(false)
    }
  }

  // Fetch admins for this company
  const fetchAdmins = async () => {
    try {
      setLoadingAdmins(true)
      const token = localStorage.getItem('superadmin_token')
      const res = await fetch(`/api/superadmin/companies/${id}/admin`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (data.success) {
        setAdmins(data.admins)
      }
    } catch (error) {
      console.error('Failed to fetch admins:', error)
    } finally {
      setLoadingAdmins(false)
    }
  }

  // Create new admin
  const createAdmin = async (e) => {
    e.preventDefault()
    if (!adminForm.email || !adminForm.password || !adminForm.firstName) {
      toast.error('Email, password, and first name are required')
      return
    }
    try {
      setCreatingAdmin(true)
      const token = localStorage.getItem('superadmin_token')
      const res = await fetch(`/api/superadmin/companies/${id}/admin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(adminForm),
      })
      const data = await res.json()
      if (data.success) {
        toast.success('Admin created successfully!')
        setShowAdminModal(false)
        setAdminForm({ email: '', password: '', firstName: '', lastName: '', phone: '' })
        fetchAdmins()
        fetchCompany() // Refresh company data (setup status might have changed)
      } else {
        toast.error(data.message)
      }
    } catch (error) {
      toast.error('Failed to create admin')
    } finally {
      setCreatingAdmin(false)
    }
  }

  // Reset admin password
  const resetAdminPassword = async (userId) => {
    if (!newPassword || newPassword.length < 6) {
      toast.error('Password must be at least 6 characters')
      return
    }
    try {
      const token = localStorage.getItem('superadmin_token')
      const res = await fetch(`/api/superadmin/companies/${id}/admin`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ userId, password: newPassword }),
      })
      const data = await res.json()
      if (data.success) {
        toast.success('Password reset successfully!')
        setResettingPassword(null)
        setNewPassword('')
      } else {
        toast.error(data.message)
      }
    } catch (error) {
      toast.error('Failed to reset password')
    }
  }

  // Toggle admin active status
  const toggleAdminStatus = async (userId, currentStatus) => {
    try {
      const token = localStorage.getItem('superadmin_token')
      const res = await fetch(`/api/superadmin/companies/${id}/admin`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ userId, isActive: !currentStatus }),
      })
      const data = await res.json()
      if (data.success) {
        toast.success(`Admin ${currentStatus ? 'deactivated' : 'activated'} successfully!`)
        fetchAdmins()
      } else {
        toast.error(data.message)
      }
    } catch (error) {
      toast.error('Failed to update admin status')
    }
  }

  // Load admins when switching to admins tab
  useEffect(() => {
    if (activeTab === 'admins' && company) {
      fetchAdmins()
    }
  }, [activeTab, company])

  const updateCompany = async (updates) => {
    try {
      const token = localStorage.getItem('superadmin_token')
      const res = await fetch(`/api/superadmin/companies/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(updates),
      })
      const data = await res.json()
      if (data.success) {
        toast.success('Company updated')
        fetchCompany()
      } else {
        toast.error(data.message)
      }
    } catch (error) {
      toast.error('Failed to update company')
    }
  }

  const saveSubscription = async () => {
    try {
      setSubmitting(true)
      // Calculate new end date
      const startMs = new Date(subscriptionForm.startDate).getTime()
      const endDate = new Date(startMs + subscriptionForm.tenureDays * 24 * 60 * 60 * 1000).toISOString()
      
      await updateCompany({
        subscription: {
          ...subscriptionForm,
          endDate,
        }
      })
      setEditingSubscription(false)
    } finally {
      setSubmitting(false)
    }
  }

  const regenerateSetupCode = async () => {
    try {
      const token = localStorage.getItem('superadmin_token')
      const res = await fetch(`/api/superadmin/companies/${id}/regenerate-setup-code`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (data.success) {
        toast.success('Setup code regenerated!')
        navigator.clipboard.writeText(data.setupUrl)
        toast.success('Setup URL copied to clipboard!')
        fetchCompany()
      } else {
        toast.error(data.message)
      }
    } catch (error) {
      toast.error('Failed to regenerate setup code')
    }
  }

  const addNote = async (e) => {
    e.preventDefault()
    if (!newNote.content.trim()) return
    setSubmitting(true)
    try {
      const token = localStorage.getItem('superadmin_token')
      const res = await fetch(`/api/superadmin/companies/${id}/notes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(newNote),
      })
      const data = await res.json()
      if (data.success) {
        toast.success('Note added')
        setNewNote({ content: '', category: 'general' })
        fetchCompany()
      } else {
        toast.error(data.message)
      }
    } catch (error) {
      toast.error('Failed to add note')
    } finally {
      setSubmitting(false)
    }
  }

  const addReminder = async (e) => {
    e.preventDefault()
    if (!newReminder.title.trim() || !newReminder.dueDate) return
    setSubmitting(true)
    try {
      const token = localStorage.getItem('superadmin_token')
      const res = await fetch(`/api/superadmin/companies/${id}/reminders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(newReminder),
      })
      const data = await res.json()
      if (data.success) {
        toast.success('Reminder added')
        setNewReminder({ title: '', description: '', dueDate: '', priority: 'medium' })
        fetchCompany()
      } else {
        toast.error(data.message)
      }
    } catch (error) {
      toast.error('Failed to add reminder')
    } finally {
      setSubmitting(false)
    }
  }

  const completeReminder = async (reminderId) => {
    try {
      const token = localStorage.getItem('superadmin_token')
      const res = await fetch(`/api/superadmin/companies/${id}/reminders`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ reminderId, status: 'completed' }),
      })
      const data = await res.json()
      if (data.success) {
        toast.success('Reminder completed')
        fetchCompany()
      }
    } catch (error) {
      toast.error('Failed to update reminder')
    }
  }

  const sendEmail = async (e) => {
    e.preventDefault()
    if (!emailForm.subject.trim() || !emailForm.body.trim()) return
    setSendingEmail(true)
    try {
      const token = localStorage.getItem('superadmin_token')
      const res = await fetch('/api/superadmin/email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          companyId: id,
          to: company.primaryContact?.email,
          subject: emailForm.subject,
          body: emailForm.body,
        }),
      })
      const data = await res.json()
      if (data.success) {
        toast.success('Email sent successfully!')
        setShowEmailModal(false)
        setEmailForm({ subject: '', body: '' })
      } else {
        toast.error(data.message)
      }
    } catch (error) {
      toast.error('Failed to send email')
    } finally {
      setSendingEmail(false)
    }
  }

  // Delete company function
  const deleteCompany = async (permanent = false) => {
    if (permanent && deleteConfirmText !== company?.slug) {
      toast.error('Please type the company slug to confirm permanent deletion')
      return
    }
    try {
      setDeleting(true)
      const token = localStorage.getItem('superadmin_token')
      const url = permanent 
        ? `/api/superadmin/companies/${id}?permanent=true`
        : `/api/superadmin/companies/${id}`
      
      const res = await fetch(url, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (data.success) {
        toast.success(data.message)
        router.push('/superadmin/companies')
      } else {
        toast.error(data.message)
      }
    } catch (error) {
      toast.error('Failed to delete company')
    } finally {
      setDeleting(false)
      setShowDeleteModal(false)
      setDeleteConfirmText('')
    }
  }

  const copySetupUrl = () => {
    if (company?.setupUrl) {
      navigator.clipboard.writeText(company.setupUrl)
      toast.success('Setup URL copied!')
    }
  }

  const calculateSubscriptionProgress = () => {
    if (!company?.subscription?.startDate || !company?.subscription?.endDate) return 0
    const start = new Date(company.subscription.startDate).getTime()
    const end = new Date(company.subscription.endDate).getTime()
    const now = Date.now()
    return Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100))
  }

  const getDaysRemaining = () => {
    if (!company?.subscription?.endDate) return null
    const end = new Date(company.subscription.endDate).getTime()
    const now = Date.now()
    return Math.ceil((end - now) / (1000 * 60 * 60 * 24))
  }

  if (loading) {
    return (
      <div className="p-6 lg:p-8">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-gray-200 rounded w-48"></div>
          <div className="h-64 bg-gray-100 rounded-2xl"></div>
        </div>
      </div>
    )
  }

  if (!company) return null

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'admins', label: 'Admins' },
    { id: 'business', label: 'Business Details' },
    { id: 'subscription', label: 'Subscription' },
    { id: 'payments', label: 'Payments' },
    { id: 'technical', label: 'Technical' },
    { id: 'notes', label: 'Notes' },
    { id: 'reminders', label: 'Reminders' },
  ]

  const daysRemaining = getDaysRemaining()
  const progress = calculateSubscriptionProgress()

  return (
    <div className="p-6 lg:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div>
          <button
            onClick={() => router.back()}
            className="flex items-center gap-2 text-gray-500 hover:text-gray-900 transition-colors mb-4"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 bg-gradient-to-br from-purple-600 to-indigo-600 rounded-2xl flex items-center justify-center text-white font-bold text-2xl">
              {company.name.charAt(0)}
            </div>
            <div>
              <h1 className="text-2xl lg:text-3xl font-bold text-gray-900">{company.name}</h1>
              <p className="text-gray-500">{company.slug}</p>
            </div>
          </div>
        </div>

        {/* Status Actions */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setShowEmailModal(true)}
            className="px-4 py-2 bg-blue-100 text-blue-700 rounded-xl hover:bg-blue-200 transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            Send Email
          </button>
          {company.serviceStatus === 'active' ? (
            <button
              onClick={() => updateCompany({ serviceStatus: 'paused', servicePausedReason: 'Manual pause' })}
              className="px-4 py-2 bg-yellow-100 text-yellow-700 rounded-xl hover:bg-yellow-200 transition-colors"
            >
              Pause Service
            </button>
          ) : (
            <button
              onClick={() => updateCompany({ serviceStatus: 'active' })}
              className="px-4 py-2 bg-green-100 text-green-700 rounded-xl hover:bg-green-200 transition-colors"
            >
              Activate Service
            </button>
          )}
          <button
            onClick={() => updateCompany({ serviceStatus: 'suspended', servicePausedReason: 'Non-payment' })}
            className="px-4 py-2 bg-red-100 text-red-700 rounded-xl hover:bg-red-200 transition-colors"
          >
            Suspend
          </button>
          <button
            onClick={() => setShowDeleteModal(true)}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl hover:bg-red-100 hover:text-red-700 transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Delete
          </button>
        </div>
      </div>

      {/* Status Badges */}
      <div className="flex flex-wrap gap-3">
        <span className={`px-3 py-1.5 rounded-full text-sm font-medium ${
          company.serviceStatus === 'active' ? 'bg-green-100 text-green-700' :
          company.serviceStatus === 'paused' ? 'bg-yellow-100 text-yellow-700' :
          'bg-red-100 text-red-700'
        }`}>
          {company.serviceStatus?.toUpperCase()}
        </span>
        <span className={`px-3 py-1.5 rounded-full text-sm font-medium ${
          company.isSetupComplete ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'
        }`}>
          {company.isSetupComplete ? 'Setup Complete' : 'Pending Setup'}
        </span>
        <span className="px-3 py-1.5 rounded-full text-sm font-medium bg-purple-100 text-purple-700">
          {company.subscription?.plan?.toUpperCase()}
        </span>
        {daysRemaining !== null && (
          <span className={`px-3 py-1.5 rounded-full text-sm font-medium ${
            daysRemaining <= 7 ? 'bg-red-100 text-red-700' :
            daysRemaining <= 30 ? 'bg-yellow-100 text-yellow-700' :
            'bg-gray-100 text-gray-700'
          }`}>
            {daysRemaining > 0 ? `${daysRemaining} days remaining` : 'Expired'}
          </span>
        )}
      </div>

      {/* Setup URL (if pending) */}
      {!company.isSetupComplete && company.setupUrl && (
        <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <p className="text-orange-700 font-medium">Setup URL</p>
              <p className="text-gray-700 text-sm break-all">{company.setupUrl}</p>
              <p className="text-gray-500 text-xs mt-1">
                Expires: {new Date(company.setupCode?.expiresAt).toLocaleString()}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={copySetupUrl}
                className="px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-xl hover:bg-gray-50 transition-colors"
              >
                Copy URL
              </button>
              <button
                onClick={regenerateSetupCode}
                className="px-4 py-2 bg-orange-100 text-orange-700 rounded-xl hover:bg-orange-200 transition-colors"
              >
                Regenerate
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <div className="flex gap-1 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-purple-600 text-purple-600'
                  : 'border-transparent text-gray-500 hover:text-gray-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="min-h-[400px]">
        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Company Info */}
            <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Company Information</h2>
              <div className="space-y-3">
                <div>
                  <p className="text-sm text-gray-500">Description</p>
                  <p className="text-gray-900">{company.description || 'No description'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Database Name</p>
                  <p className="text-gray-900 font-mono text-sm">{company.databaseName}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Created At</p>
                  <p className="text-gray-900">{new Date(company.createdAt).toLocaleString()}</p>
                </div>
                {company.tags?.length > 0 && (
                  <div>
                    <p className="text-sm text-gray-500 mb-2">Tags</p>
                    <div className="flex flex-wrap gap-2">
                      {company.tags.map((tag, i) => (
                        <span key={i} className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded-full">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Primary Contact */}
            <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Primary Contact</h2>
              <div className="space-y-3">
                <div>
                  <p className="text-sm text-gray-500">Name</p>
                  <p className="text-gray-900">{company.primaryContact?.name}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Email</p>
                  <a href={`mailto:${company.primaryContact?.email}`} className="text-purple-600 hover:underline">
                    {company.primaryContact?.email}
                  </a>
                </div>
                {company.primaryContact?.phone && (
                  <div>
                    <p className="text-sm text-gray-500">Phone</p>
                    <a href={`tel:${company.primaryContact?.phone}`} className="text-purple-600 hover:underline">
                      {company.primaryContact?.phone}
                    </a>
                  </div>
                )}
              </div>
            </div>

            {/* Billing Address */}
            {company.billingAddress && (
              <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Billing Address</h2>
                <div className="text-gray-700">
                  {company.billingAddress.street && <p>{company.billingAddress.street}</p>}
                  <p>
                    {[company.billingAddress.city, company.billingAddress.state, company.billingAddress.postalCode]
                      .filter(Boolean).join(', ')}
                  </p>
                  {company.billingAddress.country && <p>{company.billingAddress.country}</p>}
                </div>
              </div>
            )}

            {/* User Stats */}
            <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">User Statistics</h2>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-50 rounded-xl p-4">
                  <p className="text-2xl font-bold text-gray-900">{company.userStats?.total || 0}</p>
                  <p className="text-sm text-gray-500">Total Users</p>
                </div>
                <div className="bg-green-50 rounded-xl p-4">
                  <p className="text-2xl font-bold text-green-700">{company.userStats?.active || 0}</p>
                  <p className="text-sm text-gray-500">Active Users</p>
                </div>
                <div className="bg-purple-50 rounded-xl p-4">
                  <p className="text-2xl font-bold text-purple-700">{company.subscription?.maxUsers || 0}</p>
                  <p className="text-sm text-gray-500">Max Users</p>
                </div>
                <div className="bg-cyan-50 rounded-xl p-4">
                  <p className="text-2xl font-bold text-cyan-700">{company.mappedUsersCount || 0}</p>
                  <p className="text-sm text-gray-500">Mapped Users</p>
                </div>
              </div>
              {/* User limit warning */}
              {company.userStats?.total >= company.subscription?.maxUsers && (
                <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-xl">
                  <p className="text-sm text-red-700 font-medium">⚠️ User limit reached! Company cannot add new users.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Admin Management Tab */}
        {activeTab === 'admins' && (
          <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Admin Users</h2>
                <p className="text-sm text-gray-500">Manage admin accounts for this company</p>
              </div>
              <button
                onClick={() => setShowAdminModal(true)}
                className="px-4 py-2 bg-purple-600 text-white rounded-xl hover:bg-purple-700 transition-colors flex items-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
                Add Admin
              </button>
            </div>

            {/* Admins List */}
            {loadingAdmins ? (
              <div className="animate-pulse space-y-4">
                {[1, 2].map((i) => (
                  <div key={i} className="bg-gray-100 rounded-2xl h-24"></div>
                ))}
              </div>
            ) : admins.length === 0 ? (
              <div className="bg-white rounded-2xl p-8 border border-gray-200 shadow-sm text-center">
                <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-orange-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <h3 className="text-lg font-medium text-gray-900 mb-2">No Admin Users</h3>
                <p className="text-gray-500 mb-4">This company doesn&apos;t have any admin users yet. Create one to allow access.</p>
                <button
                  onClick={() => setShowAdminModal(true)}
                  className="px-6 py-2 bg-purple-600 text-white rounded-xl hover:bg-purple-700 transition-colors"
                >
                  Create First Admin
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {admins.map((admin) => (
                  <div key={admin._id} className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-xl flex items-center justify-center text-white font-bold">
                          {admin.employee?.firstName?.charAt(0) || admin.email?.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <h3 className="font-medium text-gray-900">
                            {admin.employee ? `${admin.employee.firstName} ${admin.employee.lastName || ''}` : admin.email}
                          </h3>
                          <p className="text-sm text-gray-500">{admin.email}</p>
                          {admin.employee?.employeeId && (
                            <p className="text-xs text-gray-400 font-mono">{admin.employee.employeeId}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-1 text-xs rounded-full ${
                          admin.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                        }`}>
                          {admin.isActive ? 'Active' : 'Inactive'}
                        </span>
                        {admin.forcePasswordChange && (
                          <span className="px-2 py-1 text-xs rounded-full bg-orange-100 text-orange-700">
                            Password Change Required
                          </span>
                        )}
                      </div>
                    </div>
                    
                    <div className="mt-4 pt-4 border-t border-gray-100 flex flex-wrap items-center gap-3">
                      {/* Reset Password */}
                      {resettingPassword === admin._id ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="password"
                            placeholder="New password (min 6 chars)"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                          />
                          <button
                            onClick={() => resetAdminPassword(admin._id)}
                            className="px-3 py-2 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => { setResettingPassword(null); setNewPassword(''); }}
                            className="px-3 py-2 bg-gray-100 text-gray-700 text-sm rounded-lg hover:bg-gray-200"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setResettingPassword(admin._id)}
                          className="px-3 py-2 bg-blue-100 text-blue-700 text-sm rounded-lg hover:bg-blue-200 transition-colors flex items-center gap-1"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                          </svg>
                          Reset Password
                        </button>
                      )}
                      
                      {/* Toggle Active */}
                      <button
                        onClick={() => toggleAdminStatus(admin._id, admin.isActive)}
                        className={`px-3 py-2 text-sm rounded-lg transition-colors flex items-center gap-1 ${
                          admin.isActive 
                            ? 'bg-red-100 text-red-700 hover:bg-red-200'
                            : 'bg-green-100 text-green-700 hover:bg-green-200'
                        }`}
                      >
                        {admin.isActive ? (
                          <>
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                            </svg>
                            Deactivate
                          </>
                        ) : (
                          <>
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            Activate
                          </>
                        )}
                      </button>

                      {/* Last Login */}
                      <span className="text-xs text-gray-400 ml-auto">
                        Last login: {admin.lastLogin ? new Date(admin.lastLogin).toLocaleString() : 'Never'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'business' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Tax & Registration</h2>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-gray-500">GST Number</p>
                    <p className="text-gray-900 font-mono">{company.gstNumber || 'Not provided'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">PAN Number</p>
                    <p className="text-gray-900 font-mono">{company.panNumber || 'Not provided'}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-gray-500">TAN Number</p>
                    <p className="text-gray-900 font-mono">{company.tanNumber || 'Not provided'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">CIN Number</p>
                    <p className="text-gray-900 font-mono">{company.cinNumber || 'Not provided'}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Business Info</h2>
              <div className="space-y-3">
                <div>
                  <p className="text-sm text-gray-500">Business Type</p>
                  <p className="text-gray-900 capitalize">{company.businessType?.replace('_', ' ') || 'Not specified'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Industry</p>
                  <p className="text-gray-900">{company.industry || 'Not specified'}</p>
                </div>
                {company.website && (
                  <div>
                    <p className="text-sm text-gray-500">Website</p>
                    <a href={company.website} target="_blank" rel="noopener noreferrer" className="text-purple-600 hover:underline">
                      {company.website}
                    </a>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'subscription' && (
          <div className="space-y-6">
            {/* Subscription Progress */}
            <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">Subscription Progress</h2>
                <span className={`text-sm font-medium ${
                  progress >= 85 ? 'text-red-600' : progress >= 50 ? 'text-yellow-600' : 'text-green-600'
                }`}>
                  {Math.round(progress)}% used
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-3 mb-2">
                <div
                  className={`h-3 rounded-full transition-all ${
                    progress >= 85 ? 'bg-red-500' : progress >= 50 ? 'bg-yellow-500' : 'bg-green-500'
                  }`}
                  style={{ width: `${Math.min(100, progress)}%` }}
                />
              </div>
              <div className="flex justify-between text-sm text-gray-500">
                <span>{company.subscription?.startDate ? new Date(company.subscription.startDate).toLocaleDateString() : 'N/A'}</span>
                <span>{company.subscription?.endDate ? new Date(company.subscription.endDate).toLocaleDateString() : 'N/A'}</span>
              </div>
            </div>

            {/* Subscription Details */}
            <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">Subscription Details</h2>
                <button
                  onClick={() => setEditingSubscription(!editingSubscription)}
                  className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                    editingSubscription 
                      ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      : 'bg-purple-100 text-purple-700 hover:bg-purple-200'
                  }`}
                >
                  {editingSubscription ? 'Cancel' : 'Edit Subscription'}
                </button>
              </div>

              {editingSubscription ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Plan</label>
                      <select
                        value={subscriptionForm.plan}
                        onChange={(e) => setSubscriptionForm({ ...subscriptionForm, plan: e.target.value })}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500"
                      >
                        <option value="trial">Trial</option>
                        <option value="starter">Starter</option>
                        <option value="professional">Professional</option>
                        <option value="enterprise">Enterprise</option>
                        <option value="custom">Custom</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Billing Cycle</label>
                      <select
                        value={subscriptionForm.billingCycle}
                        onChange={(e) => setSubscriptionForm({ ...subscriptionForm, billingCycle: e.target.value })}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500"
                      >
                        <option value="monthly">Monthly</option>
                        <option value="quarterly">Quarterly</option>
                        <option value="yearly">Yearly</option>
                        <option value="custom">Custom</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
                      <select
                        value={subscriptionForm.status}
                        onChange={(e) => setSubscriptionForm({ ...subscriptionForm, status: e.target.value })}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500"
                      >
                        <option value="active">Active</option>
                        <option value="paused">Paused</option>
                        <option value="expired">Expired</option>
                        <option value="cancelled">Cancelled</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Amount (₹)</label>
                      <input
                        type="number"
                        value={subscriptionForm.amount}
                        onChange={(e) => setSubscriptionForm({ ...subscriptionForm, amount: Number(e.target.value) })}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Start Date</label>
                      <input
                        type="date"
                        value={subscriptionForm.startDate}
                        onChange={(e) => setSubscriptionForm({ ...subscriptionForm, startDate: e.target.value })}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Tenure (Days)</label>
                      <input
                        type="number"
                        value={subscriptionForm.tenureDays}
                        onChange={(e) => setSubscriptionForm({ ...subscriptionForm, tenureDays: Number(e.target.value) })}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Max Users</label>
                      <input
                        type="number"
                        value={subscriptionForm.maxUsers}
                        onChange={(e) => setSubscriptionForm({ ...subscriptionForm, maxUsers: Number(e.target.value) })}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Max Storage (GB)</label>
                      <input
                        type="number"
                        value={subscriptionForm.maxStorageGB}
                        onChange={(e) => setSubscriptionForm({ ...subscriptionForm, maxStorageGB: Number(e.target.value) })}
                        min="1"
                        step="1"
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-3">
                    <button
                      onClick={() => setEditingSubscription(false)}
                      className="px-6 py-2 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={saveSubscription}
                      disabled={submitting}
                      className="px-6 py-2 bg-purple-600 text-white rounded-xl hover:bg-purple-700 disabled:opacity-50 transition-colors"
                    >
                      {submitting ? 'Saving...' : 'Save Changes'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  <div>
                    <p className="text-sm text-gray-500">Plan</p>
                    <p className="text-gray-900 capitalize text-lg font-semibold">{company.subscription?.plan}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Status</p>
                    <p className={`capitalize text-lg font-semibold ${
                      company.subscription?.status === 'active' ? 'text-green-700' :
                      company.subscription?.status === 'expired' ? 'text-red-700' : 'text-yellow-700'
                    }`}>
                      {company.subscription?.status}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Billing Cycle</p>
                    <p className="text-gray-900 capitalize">{company.subscription?.billingCycle}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Amount</p>
                    <p className="text-gray-900 text-lg font-semibold">{company.subscription?.amount ? `₹${company.subscription.amount.toLocaleString()}` : 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Max Users</p>
                    <p className="text-gray-900">{company.subscription?.maxUsers || 'Unlimited'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Max Storage</p>
                    <p className="text-gray-900">{company.subscription?.maxStorageGB ? `${company.subscription.maxStorageGB} GB` : 'Unlimited'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Tenure</p>
                    <p className="text-gray-900">{company.subscription?.tenureDays || 0} days</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Start Date</p>
                    <p className="text-gray-900">{company.subscription?.startDate ? new Date(company.subscription.startDate).toLocaleDateString() : 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">End Date</p>
                    <p className="text-gray-900">{company.subscription?.endDate ? new Date(company.subscription.endDate).toLocaleDateString() : 'N/A'}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'payments' && (
          <div className="space-y-6">
            {/* Onboarding Payment */}
            <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Onboarding Payment</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-green-50 rounded-xl p-4">
                  <p className="text-2xl font-bold text-green-700">₹{(company.onboarding?.amount || 0).toLocaleString()}</p>
                  <p className="text-sm text-gray-500">Amount Received</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Payment Method</p>
                  <p className="text-gray-900 capitalize">{company.onboarding?.paymentMethod?.replace('_', ' ') || 'Not specified'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Transaction ID</p>
                  <p className="text-gray-900 font-mono text-sm">{company.onboarding?.transactionId || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Invoice Number</p>
                  <p className="text-gray-900">{company.onboarding?.invoiceNumber || 'N/A'}</p>
                </div>
              </div>
              {company.onboarding?.notes && (
                <div className="mt-4">
                  <p className="text-sm text-gray-500">Notes</p>
                  <p className="text-gray-700">{company.onboarding.notes}</p>
                </div>
              )}
            </div>

            {/* Payment History */}
            <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Payment History</h2>
              {company.paymentHistory?.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Date</th>
                        <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Amount</th>
                        <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Type</th>
                        <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Method</th>
                        <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Status</th>
                        <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Invoice</th>
                      </tr>
                    </thead>
                    <tbody>
                      {company.paymentHistory.map((payment, index) => (
                        <tr key={index} className="border-b border-gray-100">
                          <td className="py-3 px-4 text-sm text-gray-900">
                            {new Date(payment.date).toLocaleDateString()}
                          </td>
                          <td className="py-3 px-4 text-sm font-semibold text-gray-900">
                            ₹{payment.amount?.toLocaleString()}
                          </td>
                          <td className="py-3 px-4 text-sm text-gray-700 capitalize">
                            {payment.type?.replace('_', ' ')}
                          </td>
                          <td className="py-3 px-4 text-sm text-gray-700 capitalize">
                            {payment.method?.replace('_', ' ')}
                          </td>
                          <td className="py-3 px-4">
                            <span className={`px-2 py-1 text-xs rounded-full font-medium ${
                              payment.status === 'completed' ? 'bg-green-100 text-green-700' :
                              payment.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                              'bg-red-100 text-red-700'
                            }`}>
                              {payment.status}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-sm text-gray-700 font-mono">
                            {payment.invoiceNumber || '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-center text-gray-500 py-8">No payment history</p>
              )}
            </div>
          </div>
        )}

        {activeTab === 'technical' && (
          <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Technical Details</h2>
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-500">Database Name</p>
                  <p className="text-gray-900 font-mono bg-gray-100 px-3 py-2 rounded-lg text-sm">{company.databaseName}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">API Key</p>
                  <p className="text-gray-900 font-mono bg-gray-100 px-3 py-2 rounded-lg text-sm truncate">
                    {company.technicalDetails?.apiKey || 'Not generated'}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-gray-50 rounded-xl p-4 text-center">
                  <p className={`text-lg font-semibold ${company.technicalDetails?.apiAccess ? 'text-green-700' : 'text-red-700'}`}>
                    {company.technicalDetails?.apiAccess ? 'Enabled' : 'Disabled'}
                  </p>
                  <p className="text-xs text-gray-500">API Access</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-4 text-center">
                  <p className={`text-lg font-semibold ${company.technicalDetails?.sslEnabled ? 'text-green-700' : 'text-red-700'}`}>
                    {company.technicalDetails?.sslEnabled ? 'Enabled' : 'Disabled'}
                  </p>
                  <p className="text-xs text-gray-500">SSL</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-4 text-center">
                  <p className={`text-lg font-semibold ${company.technicalDetails?.backupEnabled ? 'text-green-700' : 'text-red-700'}`}>
                    {company.technicalDetails?.backupEnabled ? 'Enabled' : 'Disabled'}
                  </p>
                  <p className="text-xs text-gray-500">Backup</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-4 text-center">
                  <p className="text-lg font-semibold text-cyan-700">{company.analytics?.storageUsedMB || 0} MB</p>
                  <p className="text-xs text-gray-500">Storage Used</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'notes' && (
          <div className="space-y-6">
            {/* Add Note Form */}
            <form onSubmit={addNote} className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Add Note</h2>
              <div className="space-y-4">
                <textarea
                  value={newNote.content}
                  onChange={(e) => setNewNote({ ...newNote, content: e.target.value })}
                  rows={3}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:bg-white resize-none"
                  placeholder="Add a note..."
                />
                <div className="flex gap-4">
                  <select
                    value={newNote.category}
                    onChange={(e) => setNewNote({ ...newNote, category: e.target.value })}
                    className="px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500"
                  >
                    <option value="general">General</option>
                    <option value="billing">Billing</option>
                    <option value="support">Support</option>
                    <option value="technical">Technical</option>
                    <option value="feedback">Feedback</option>
                  </select>
                  <button
                    type="submit"
                    disabled={submitting || !newNote.content.trim()}
                    className="px-6 py-2 bg-purple-600 text-white rounded-xl hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {submitting ? 'Adding...' : 'Add Note'}
                  </button>
                </div>
              </div>
            </form>

            {/* Notes List */}
            <div className="space-y-4">
              {company.notes?.length > 0 ? (
                [...company.notes].reverse().map((note) => (
                  <div key={note._id} className="bg-white rounded-2xl p-4 border border-gray-200 shadow-sm">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <p className="text-gray-900 whitespace-pre-wrap">{note.content}</p>
                        <div className="flex items-center gap-3 mt-2">
                          <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${
                            note.category === 'billing' ? 'bg-green-100 text-green-700' :
                            note.category === 'support' ? 'bg-blue-100 text-blue-700' :
                            note.category === 'technical' ? 'bg-purple-100 text-purple-700' :
                            note.category === 'feedback' ? 'bg-yellow-100 text-yellow-700' :
                            'bg-gray-100 text-gray-600'
                          }`}>
                            {note.category}
                          </span>
                          <span className="text-xs text-gray-500">
                            {new Date(note.createdAt).toLocaleString()}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-center text-gray-500 py-8">No notes yet</p>
              )}
            </div>
          </div>
        )}

        {activeTab === 'reminders' && (
          <div className="space-y-6">
            {/* Add Reminder Form */}
            <form onSubmit={addReminder} className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Add Reminder</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <input
                  type="text"
                  value={newReminder.title}
                  onChange={(e) => setNewReminder({ ...newReminder, title: e.target.value })}
                  className="px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:bg-white"
                  placeholder="Reminder title..."
                />
                <input
                  type="date"
                  value={newReminder.dueDate}
                  onChange={(e) => setNewReminder({ ...newReminder, dueDate: e.target.value })}
                  className="px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
                <textarea
                  value={newReminder.description}
                  onChange={(e) => setNewReminder({ ...newReminder, description: e.target.value })}
                  rows={2}
                  className="md:col-span-2 px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:bg-white resize-none"
                  placeholder="Description (optional)..."
                />
                <select
                  value={newReminder.priority}
                  onChange={(e) => setNewReminder({ ...newReminder, priority: e.target.value })}
                  className="px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                  <option value="low">Low Priority</option>
                  <option value="medium">Medium Priority</option>
                  <option value="high">High Priority</option>
                  <option value="urgent">Urgent</option>
                </select>
                <button
                  type="submit"
                  disabled={submitting || !newReminder.title.trim() || !newReminder.dueDate}
                  className="px-6 py-2 bg-purple-600 text-white rounded-xl hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {submitting ? 'Adding...' : 'Add Reminder'}
                </button>
              </div>
            </form>

            {/* Reminders List */}
            <div className="space-y-4">
              {company.reminders?.length > 0 ? (
                company.reminders
                  .filter(r => r.status !== 'completed')
                  .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))
                  .map((reminder) => {
                    const isOverdue = new Date(reminder.dueDate) < new Date()
                    return (
                      <div key={reminder._id} className={`bg-white rounded-2xl p-4 border shadow-sm ${isOverdue ? 'border-red-300' : 'border-gray-200'}`}>
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <h3 className="text-gray-900 font-medium">{reminder.title}</h3>
                            {reminder.description && (
                              <p className="text-gray-500 text-sm mt-1">{reminder.description}</p>
                            )}
                            <div className="flex items-center gap-3 mt-2">
                              <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${
                                reminder.priority === 'urgent' ? 'bg-red-100 text-red-700' :
                                reminder.priority === 'high' ? 'bg-orange-100 text-orange-700' :
                                reminder.priority === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                                'bg-gray-100 text-gray-600'
                              }`}>
                                {reminder.priority}
                              </span>
                              <span className={`text-xs ${isOverdue ? 'text-red-600' : 'text-gray-500'}`}>
                                Due: {new Date(reminder.dueDate).toLocaleDateString()}
                                {isOverdue && ' (Overdue)'}
                              </span>
                            </div>
                          </div>
                          <button
                            onClick={() => completeReminder(reminder._id)}
                            className="p-2 text-green-600 hover:bg-green-100 rounded-lg transition-colors"
                            title="Mark as complete"
                          >
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    )
                  })
              ) : (
                <p className="text-center text-gray-500 py-8">No reminders</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Create Admin Modal */}
      {showAdminModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold text-gray-900">Create Admin User</h2>
                <button
                  onClick={() => setShowAdminModal(false)}
                  className="p-2 text-gray-400 hover:text-gray-600 rounded-lg"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            <form onSubmit={createAdmin} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">First Name *</label>
                  <input
                    type="text"
                    value={adminForm.firstName}
                    onChange={(e) => setAdminForm({ ...adminForm, firstName: e.target.value })}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:bg-white"
                    placeholder="John"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Last Name</label>
                  <input
                    type="text"
                    value={adminForm.lastName}
                    onChange={(e) => setAdminForm({ ...adminForm, lastName: e.target.value })}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:bg-white"
                    placeholder="Doe"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Email *</label>
                <input
                  type="email"
                  value={adminForm.email}
                  onChange={(e) => setAdminForm({ ...adminForm, email: e.target.value })}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:bg-white"
                  placeholder="admin@company.com"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Password *</label>
                <input
                  type="password"
                  value={adminForm.password}
                  onChange={(e) => setAdminForm({ ...adminForm, password: e.target.value })}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:bg-white"
                  placeholder="Min 6 characters"
                  minLength={6}
                  required
                />
                <p className="text-xs text-gray-500 mt-1">User will be required to change password on first login</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Phone</label>
                <input
                  type="tel"
                  value={adminForm.phone}
                  onChange={(e) => setAdminForm({ ...adminForm, phone: e.target.value })}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:bg-white"
                  placeholder="+91 98765 43210"
                />
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowAdminModal(false)}
                  className="px-6 py-2 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingAdmin || !adminForm.email || !adminForm.password || !adminForm.firstName}
                  className="px-6 py-2 bg-purple-600 text-white rounded-xl hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                >
                  {creatingAdmin ? (
                    <>
                      <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Creating...
                    </>
                  ) : (
                    <>Create Admin</>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Email Modal */}
      {showEmailModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold text-gray-900">Send Email</h2>
                <button
                  onClick={() => setShowEmailModal(false)}
                  className="p-2 text-gray-400 hover:text-gray-600 rounded-lg"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            <form onSubmit={sendEmail} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">To</label>
                <input
                  type="email"
                  value={company.primaryContact?.email || ''}
                  disabled
                  className="w-full px-4 py-3 bg-gray-100 border border-gray-200 rounded-xl text-gray-700 cursor-not-allowed"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Subject</label>
                <input
                  type="text"
                  value={emailForm.subject}
                  onChange={(e) => setEmailForm({ ...emailForm, subject: e.target.value })}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:bg-white"
                  placeholder="Email subject..."
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Message</label>
                <textarea
                  value={emailForm.body}
                  onChange={(e) => setEmailForm({ ...emailForm, body: e.target.value })}
                  rows={8}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:bg-white resize-none"
                  placeholder="Type your message..."
                  required
                />
              </div>
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowEmailModal(false)}
                  className="px-6 py-2 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={sendingEmail || !emailForm.subject.trim() || !emailForm.body.trim()}
                  className="px-6 py-2 bg-purple-600 text-white rounded-xl hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                >
                  {sendingEmail ? (
                    <>
                      <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Sending...
                    </>
                  ) : (
                    <>Send Email</>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Company Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full">
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold text-gray-900">Delete Company</h2>
                <button
                  onClick={() => {
                    setShowDeleteModal(false)
                    setDeleteConfirmText('')
                    setDeleteType('soft')
                  }}
                  className="p-2 text-gray-400 hover:text-gray-600 rounded-lg"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="p-6 space-y-4">
              {/* Delete Type Selection */}
              <div className="space-y-3">
                <label className="flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-colors hover:bg-gray-50"
                  style={{ borderColor: deleteType === 'soft' ? '#9333ea' : '#e5e7eb' }}
                >
                  <input
                    type="radio"
                    name="deleteType"
                    value="soft"
                    checked={deleteType === 'soft'}
                    onChange={() => setDeleteType('soft')}
                    className="mt-1 text-purple-600 focus:ring-purple-500"
                  />
                  <div>
                    <p className="font-medium text-gray-900">Soft Delete (Deactivate)</p>
                    <p className="text-sm text-gray-500">Company will be marked as inactive. Data is preserved and can be reactivated later.</p>
                  </div>
                </label>
                <label className="flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-colors hover:bg-red-50"
                  style={{ borderColor: deleteType === 'permanent' ? '#dc2626' : '#e5e7eb' }}
                >
                  <input
                    type="radio"
                    name="deleteType"
                    value="permanent"
                    checked={deleteType === 'permanent'}
                    onChange={() => setDeleteType('permanent')}
                    className="mt-1 text-red-600 focus:ring-red-500"
                  />
                  <div>
                    <p className="font-medium text-red-700">Permanent Delete (Drop Database)</p>
                    <p className="text-sm text-red-600">⚠️ This will permanently delete the company and DROP the entire database. This action CANNOT be undone!</p>
                  </div>
                </label>
              </div>

              {/* Warning for permanent delete */}
              {deleteType === 'permanent' && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-3">
                  <div className="flex items-start gap-2">
                    <svg className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <div>
                      <p className="text-red-800 font-medium">This will permanently delete:</p>
                      <ul className="text-red-700 text-sm mt-1 list-disc list-inside">
                        <li>Company record from superadmin database</li>
                        <li>Entire tenant database ({company?.databaseName})</li>
                        <li>All employees, attendance, leaves, projects, and other data</li>
                        <li>All user-tenant mappings</li>
                      </ul>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-red-800 mb-2">
                      Type <span className="font-mono bg-red-100 px-1 rounded">{company?.slug}</span> to confirm:
                    </label>
                    <input
                      type="text"
                      value={deleteConfirmText}
                      onChange={(e) => setDeleteConfirmText(e.target.value)}
                      placeholder={company?.slug}
                      className="w-full px-4 py-2 bg-white border border-red-300 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500"
                    />
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowDeleteModal(false)
                    setDeleteConfirmText('')
                    setDeleteType('soft')
                  }}
                  className="px-6 py-2 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition-colors"
                  disabled={deleting}
                >
                  Cancel
                </button>
                <button
                  onClick={() => deleteCompany(deleteType === 'permanent')}
                  disabled={deleting || (deleteType === 'permanent' && deleteConfirmText !== company?.slug)}
                  className={`px-6 py-2 rounded-xl transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed ${
                    deleteType === 'permanent' 
                      ? 'bg-red-600 text-white hover:bg-red-700'
                      : 'bg-yellow-600 text-white hover:bg-yellow-700'
                  }`}
                >
                  {deleting ? (
                    <>
                      <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Deleting...
                    </>
                  ) : deleteType === 'permanent' ? (
                    <>
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                      Permanently Delete
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                      </svg>
                      Deactivate Company
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
