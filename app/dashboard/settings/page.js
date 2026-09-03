'use client'

import { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Select, SelectItem, Button, Skeleton } from '@heroui/react'
import { FaBuilding, FaBriefcase, FaCalendarAlt, FaUmbrellaBeach, FaCog, FaMapMarkerAlt, FaClock, FaImage, FaPalette, FaCheck, FaBell, FaMoneyBillWave, FaArrowLeft, FaSun, FaMoon, FaDesktop, FaFingerprint, FaSearch } from 'react-icons/fa'
import { HiOutlineOfficeBuilding, HiOutlineCog, HiOutlineArrowLeft } from 'react-icons/hi2'
import { toast } from '@/utils/toast'
import dynamic from 'next/dynamic'
import { useTheme } from '@/contexts/ThemeContext'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import useApiMutation from '@/hooks/useApiMutation'
import LoadingButton, { SubmitButton } from '@/components/ui/LoadingButton'
import { uploadAuthenticatedFile } from '@/lib/client/uploadFile'
import AttendanceMachinesSettings from '@/components/settings/AttendanceMachinesSettings'
import { useCompanyFeatures } from '@/contexts/CompanyFeaturesContext'

// Dynamically import map component (client-side only)
const GeofenceMap = dynamic(() => import('@/components/GeofenceMap'), { ssr: false })

// Reusable Company Selector Component
function CompanySelector({ companies, selectedCompany, onSelect, onBack, loading }) {
  if (loading) {
    return (
      <div className="py-6 space-y-4">
        {[1, 2, 3].map(i => (
          <Skeleton key={i} className="h-16 w-full rounded-xl" />
        ))}
      </div>
    )
  }

  if (selectedCompany) {
    return (
      <div className="mb-6">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-800 mb-4 transition-colors"
        >
          <HiOutlineArrowLeft className="w-5 h-5" />
          <span>Back to Companies</span>
        </button>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex items-center gap-4">
          <div className="w-12 h-12 rounded-lg bg-gray-100 flex items-center justify-center overflow-hidden flex-shrink-0">
            {selectedCompany.logo ? (
              <img src={selectedCompany.logo} alt={selectedCompany.name} className="w-full h-full object-contain" />
            ) : (
              <FaBuilding className="w-6 h-6 text-gray-400" />
            )}
          </div>
          <div>
            <h3 className="font-semibold text-gray-800">{selectedCompany.name}</h3>
            <p className="text-sm text-gray-500">{selectedCompany.code}</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-2">Select a Company</h3>
        <p className="text-gray-600 text-sm">Choose a company to configure its settings</p>
      </div>

      {companies.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border-2 border-dashed border-gray-200">
          <FaBuilding className="mx-auto h-12 w-12 text-gray-400 mb-4" />
          <h3 className="text-lg font-medium text-gray-800">No companies found</h3>
          <p className="text-gray-500 mt-2">Create a company first in the Company Settings tab.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {companies.map((company) => (
            <button
              key={company._id}
              onClick={() => onSelect(company)}
              className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 hover:shadow-md hover:border-blue-200 transition-all text-left group overflow-hidden"
            >
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-lg bg-gray-100 flex items-center justify-center overflow-hidden flex-shrink-0 group-hover:bg-blue-50 transition-colors">
                  {company.logo ? (
                    <img src={company.logo} alt={company.name} className="w-full h-full object-contain" />
                  ) : (
                    <FaBuilding className="w-6 h-6 text-gray-400 group-hover:text-blue-500 transition-colors" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-semibold text-gray-800 truncate group-hover:text-blue-600 transition-colors">{company.name}</h4>
                  <p className="text-sm text-gray-500 uppercase">{company.code}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function SettingsPage() {
  const [mounted, setMounted] = useState(false)
  const [activeTab, setActiveTab] = useState('company')
  const [settingsQuery, setSettingsQuery] = useState('')

  useEffect(() => {
    setMounted(true)
  }, [])

  const user = useMemo(() => {
    if (typeof window === 'undefined') return null
    const userData = localStorage.getItem('user')
    return userData ? JSON.parse(userData) : null
  }, [])
  const userRole = user?.role || ''
  const { isFeatureEnabled } = useCompanyFeatures()

  const { data: deptHeadData } = useAuthedSWR('/api/team/check-head')
  const isDepartmentHead = deptHeadData?.success && deptHeadData?.isDepartmentHead

  const tabs = useMemo(() => {
    const baseTabs = []

    // Admin and HR get company settings
    if (userRole === 'admin' || userRole === 'hr') {
      baseTabs.push(
        { id: 'company', name: 'Organisation', description: 'Companies, identity and workplace defaults', group: 'Organisation', icon: FaBuilding },
        { id: 'recruitment', name: 'Recruitment', description: 'Hiring channels and candidate workflows', group: 'People & lifecycle', icon: FaBriefcase },
        { id: 'geofencing', name: 'Work locations', description: 'Geofences and attendance boundaries', group: 'Attendance & workplace', icon: FaMapMarkerAlt },
        ...(isFeatureEnabled('attendanceMachines')
          ? [{ id: 'attendance-machines', name: 'Attendance machines', description: 'Organisation and company biometric devices', group: 'Attendance & workplace', icon: FaFingerprint }]
          : []),
        { id: 'payroll', name: 'Payroll', description: 'Salary, deductions and processing rules', group: 'Payroll & finance', icon: FaMoneyBillWave },
      )
    }

    // Admin, HR, and Department Heads get notifications (check both role and isDepartmentHead flag)
    if (userRole === 'admin' || userRole === 'hr' || userRole === 'department_head' || isDepartmentHead) {
      baseTabs.push(
        { id: 'notifications', name: 'Notifications', description: 'Delivery channels and alerts', group: 'Communication', icon: FaBell }
      )
    }

    // All users get personalization
    baseTabs.push(
      { id: 'personalization', name: 'Appearance', description: 'Theme and personal display preferences', group: 'Personal', icon: FaPalette }
    )

    return baseTabs
  }, [userRole, isDepartmentHead, isFeatureEnabled])

  const visibleTabs = useMemo(() => {
    const query = settingsQuery.trim().toLocaleLowerCase()
    if (!query) return tabs
    return tabs.filter((tab) => [tab.name, tab.description, tab.group]
      .some((value) => value?.toLocaleLowerCase().includes(query)))
  }, [settingsQuery, tabs])

  const groupedTabs = useMemo(() => visibleTabs.reduce((groups, tab) => {
    if (!groups[tab.group]) groups[tab.group] = []
    groups[tab.group].push(tab)
    return groups
  }, {}), [visibleTabs])

  const selectTab = (tabId) => {
    setActiveTab(tabId)
    if (typeof window === 'undefined') return
    const searchParams = new URLSearchParams(window.location.search)
    searchParams.set('tab', tabId)
    window.history.replaceState({}, '', `${window.location.pathname}?${searchParams.toString()}`)
  }

  // Set default active tab based on role
  useEffect(() => {
    const requestedTab = typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('tab')
      : null

    if (requestedTab && tabs.some((tab) => tab.id === requestedTab)) {
      setActiveTab(requestedTab)
    } else if (userRole === 'admin' || userRole === 'hr') {
      setActiveTab('company')
    } else if (userRole === 'department_head' || isDepartmentHead) {
      setActiveTab('notifications')
    } else {
      setActiveTab('personalization')
    }
  }, [userRole, isDepartmentHead, tabs])

  useEffect(() => {
    if (!mounted || typeof window === 'undefined') {
      return
    }

    const searchParams = new URLSearchParams(window.location.search)
    const linkedinState = searchParams.get('linkedin')
    if (!linkedinState) {
      return
    }

    const linkedinAccount = searchParams.get('linkedinAccount')
    const linkedinError = searchParams.get('linkedinError')
    const errorMessageMap = {
      missing_state: 'The LinkedIn callback did not include a valid state token.',
      invalid_state: 'LinkedIn state validation failed. Try connecting again.',
      missing_code: 'LinkedIn did not return an authorization code.',
      unauthorized: 'Your session is no longer authorized for this tenant.',
      callback_failed: 'LinkedIn connection could not be completed.',
    }

    setActiveTab('recruitment')

    if (linkedinState === 'connected') {
      toast.success(linkedinAccount ? `LinkedIn connected as ${linkedinAccount}` : 'LinkedIn connected successfully')
    } else if (linkedinState === 'error') {
      toast.error(errorMessageMap[linkedinError] || 'LinkedIn connection failed')
    }

    searchParams.delete('linkedin')
    searchParams.delete('linkedinAccount')
    searchParams.delete('linkedinError')
    const nextQuery = searchParams.toString()
    const nextUrl = nextQuery ? `${window.location.pathname}?${nextQuery}` : window.location.pathname
    window.history.replaceState({}, '', nextUrl)
  }, [mounted])

  // Show loading state while detecting device
  if (!mounted) {
    return (
      <div className="page-container">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <Skeleton className="h-8 w-40 rounded-lg mb-2" />
            <Skeleton className="h-4 w-56 rounded-lg" />
          </div>
        </div>
        <Skeleton className="h-12 w-full rounded-xl mb-6" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    )
  }

  return (
    <div className="page-container talio-settings-page">
      {/* Header */}
      <div className="page-header mb-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary-600">Workspace controls</p>
          <h1 className="page-title mt-1">Settings</h1>
          <p className="page-subtitle">Manage organisation policies, integrations, and your preferences.</p>
        </div>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <label className="talio-surface block lg:hidden">
          <span className="mb-2 block text-xs font-bold uppercase tracking-[0.14em] text-default-400">Settings section</span>
          <select
            value={activeTab}
            onChange={(event) => selectTab(event.target.value)}
            className="w-full rounded-xl border border-default-200 bg-default-50 px-3 py-3 text-sm font-semibold text-foreground outline-none focus:border-primary-500"
          >
            {tabs.map((tab) => <option key={tab.id} value={tab.id}>{tab.name}</option>)}
          </select>
        </label>

        <aside className="talio-surface hidden lg:sticky lg:top-5 lg:block">
          <label className="flex items-center gap-2 rounded-xl border border-default-200 bg-default-50 px-3 py-2.5">
            <FaSearch className="h-3.5 w-3.5 flex-shrink-0 text-default-400" />
            <input
              value={settingsQuery}
              onChange={(event) => setSettingsQuery(event.target.value)}
              placeholder="Search settings"
              aria-label="Search settings"
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-default-400"
            />
          </label>

          <nav className="mt-4 space-y-4" aria-label="Settings sections">
            {Object.entries(groupedTabs).map(([group, groupTabs]) => (
              <div key={group}>
                <p className="mb-1.5 px-2 text-[10px] font-bold uppercase tracking-[0.14em] text-default-400">{group}</p>
                <div className="space-y-1">
                  {groupTabs.map((tab) => {
                    const Icon = tab.icon
                    const selected = activeTab === tab.id
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => selectTab(tab.id)}
                        aria-current={selected ? 'page' : undefined}
                        className={`w-full rounded-xl px-3 py-2.5 text-left transition-colors ${selected ? 'bg-primary-500 text-white' : 'text-foreground hover:bg-default-100'}`}
                      >
                        <span className="flex items-start gap-3">
                          <Icon className={`mt-0.5 h-4 w-4 flex-shrink-0 ${selected ? 'text-white' : 'text-primary-500'}`} />
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold">{tab.name}</span>
                            <span className={`mt-0.5 block text-xs leading-4 ${selected ? 'text-white/75' : 'text-default-500'}`}>{tab.description}</span>
                          </span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </nav>

          {visibleTabs.length === 0 && (
            <div className="py-8 text-center">
              <p className="text-sm font-medium text-foreground">No settings found</p>
              <button type="button" onClick={() => setSettingsQuery('')} className="mt-2 text-xs font-semibold text-primary-600">Clear search</button>
            </div>
          )}
        </aside>

        {/* Content */}
        <section className="talio-surface min-w-0" aria-live="polite">
          <div className="mb-6 border-b border-default-200 pb-4">
            <h2 className="text-xl font-bold text-foreground">{tabs.find((tab) => tab.id === activeTab)?.name}</h2>
            <p className="mt-1 text-sm text-default-500">{tabs.find((tab) => tab.id === activeTab)?.description}</p>
          </div>
          {activeTab === 'company' && <CompanySettingsTab />}
          {activeTab === 'recruitment' && <RecruitmentSettingsTab />}
          {activeTab === 'geofencing' && <GeofencingTab />}
          {activeTab === 'attendance-machines' && <AttendanceMachinesSettings />}
          {activeTab === 'payroll' && <PayrollSettingsTab />}
          {activeTab === 'notifications' && <NotificationsTab />}
          {activeTab === 'personalization' && <PersonalizationTab />}
        </section>
      </div>
    </div>
  )
}

function formatRecruitmentSettingDate(value) {
  if (!value) {
    return 'Not available'
  }

  try {
    return new Intl.DateTimeFormat('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value))
  } catch {
    return 'Not available'
  }
}

function RecruitmentSettingsTab() {
  const [isConnecting, setIsConnecting] = useState(false)
  const { isDarkMode } = useTheme()
  const { data: statusResponse, error, isLoading, mutate } = useAuthedSWR('/api/recruitment/linkedin/status')
  const status = statusResponse?.data || {}

  const sectionClass = isDarkMode
    ? 'border border-slate-800 bg-slate-950/80'
    : 'border border-slate-200 bg-white'
  const insetClass = isDarkMode
    ? 'border border-slate-800 bg-slate-900/70'
    : 'border border-slate-200 bg-slate-50'
  const titleClass = isDarkMode ? 'text-slate-100' : 'text-gray-900'
  const bodyClass = isDarkMode ? 'text-slate-400' : 'text-gray-600'
  const mutedClass = isDarkMode ? 'text-slate-500' : 'text-gray-500'

  const requiredEnvKeys = [
    {
      key: 'LINKEDIN_CLIENT_ID',
      description: 'Public app identifier from your LinkedIn developer app.',
      note: 'Copy it from the LinkedIn app Auth tab.',
    },
    {
      key: 'LINKEDIN_CLIENT_SECRET',
      description: 'Private secret paired with the LinkedIn client ID.',
      note: 'Treat this like a password and keep it only on the server.',
    },
    {
      key: 'APP_URL',
      description: 'Base URL used to build the callback path when no explicit redirect URI is set.',
      note: 'Set this to your app domain. For local development, use your localhost URL if needed.',
    },
    {
      key: 'LINKEDIN_REDIRECT_URI',
      description: 'Optional explicit callback URL for LinkedIn OAuth.',
      note: 'If left blank, the app falls back to APP_URL + /api/recruitment/linkedin/callback.',
    },
    {
      key: 'INTEGRATION_TOKEN_ENCRYPTION_KEY',
      description: 'AES encryption key used to protect stored LinkedIn access and refresh tokens.',
      note: 'Generate with openssl rand -hex 32.',
    },
  ]

  const optionalEnvKeys = [
    {
      key: 'LINKEDIN_WEBHOOK_SECRET',
      description: 'Used to verify signed webhook payloads from LinkedIn.',
    },
    {
      key: 'LINKEDIN_WEBHOOK_VERIFY_TOKEN',
      description: 'Optional verification token for webhook handshake routes.',
    },
    {
      key: 'LINKEDIN_APPLICANTS_API_URL',
      description: 'Optional backend sync endpoint template supporting {jobPostingId}, {jobId}, {since}, and {limit}.',
    },
  ]

  const setupSteps = [
    {
      title: 'Open LinkedIn Developers',
      body: 'Go to linkedin.com/developers/apps and create a new app or open the one your company will use.',
    },
    {
      title: 'Associate the correct company page',
      body: 'LinkedIn app creation typically requires a company page. Make sure you are using the company page that should own recruitment access.',
    },
    {
      title: 'Enable the auth product',
      body: 'In the Products section, enable the LinkedIn sign-in or OpenID product required for OAuth access.',
    },
    {
      title: 'Copy Client ID and Client Secret',
      body: 'Open the Auth tab of the LinkedIn app and copy the Client ID and Client Secret into the env keys listed on this page.',
    },
    {
      title: 'Add your redirect URL exactly',
      body: 'In LinkedIn Auth settings, add the callback URL shown below. The redirect URI must match exactly, including protocol and path.',
    },
  ]

  const statusCards = [
    {
      label: 'Connection',
      value: status.isConnected ? 'Connected' : 'Not connected',
      detail: status.connectedAccountName || 'No LinkedIn account linked yet',
      emphasis: status.isConnected ? 'text-emerald-500' : titleClass,
    },
    {
      label: 'Token Health',
      value: status.isConnected ? (status.isTokenExpired ? 'Expired' : 'Active') : 'Unavailable',
      detail: `Expires ${formatRecruitmentSettingDate(status.tokenExpiresAt)}`,
      emphasis: status.isConnected && status.isTokenExpired ? 'text-amber-500' : titleClass,
    },
    {
      label: 'Connected At',
      value: formatRecruitmentSettingDate(status.connectedAt),
      detail: 'Tenant-wide LinkedIn OAuth status',
      emphasis: titleClass,
    },
    {
      label: 'Last Sync',
      value: formatRecruitmentSettingDate(status.lastSyncAt),
      detail: 'Updated when manual sync finishes successfully',
      emphasis: titleClass,
    },
  ]

  const disconnectMutation = useApiMutation({
    method: 'DELETE',
    invalidateKeys: ['/api/recruitment/linkedin/status'],
    onSuccess: (response) => toast.success(response?.message || 'LinkedIn disconnected successfully'),
    onError: (message) => toast.error(message || 'Failed to disconnect LinkedIn'),
  })

  const handleConnect = async () => {
    try {
      setIsConnecting(true)
      const token = localStorage.getItem('token')
      const returnTo = encodeURIComponent('/dashboard/settings?tab=recruitment')
      const response = await fetch(`/api/recruitment/linkedin/auth-url?returnTo=${returnTo}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })
      const data = await response.json()

      if (!response.ok || data?.success === false || !data?.data?.url) {
        throw new Error(data?.message || 'Failed to initialize LinkedIn connection')
      }

      window.location.href = data.data.url
    } catch (connectError) {
      console.error('LinkedIn connect error:', connectError)
      toast.error(connectError.message || 'Failed to initialize LinkedIn connection')
      setIsConnecting(false)
    }
  }

  const handleDisconnect = async () => {
    if (!window.confirm('Disconnect LinkedIn for this tenant? Applicant sync and webhook processing will stop until you reconnect.')) {
      return
    }

    const response = await disconnectMutation.execute('/api/recruitment/linkedin/disconnect')
    if (response?.success) {
      mutate()
    }
  }

  return (
    <div className="space-y-6">
      <div className="mb-6">
        <h2 className={`text-xl font-bold flex items-center gap-2 ${titleClass}`}>
          <FaBriefcase className="text-sky-600" />
          Recruitment Integrations
        </h2>
        <p className={`mt-1 ${bodyClass}`}>Connect LinkedIn, monitor sync health, and keep setup instructions visible for the current env-based flow.</p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error.message || 'Failed to load LinkedIn status'}
        </div>
      )}

      <div className={`overflow-hidden rounded-[28px] ${sectionClass}`}>
        <div className={`border-b px-6 py-6 sm:px-8 ${isDarkMode ? 'border-slate-800 bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.18),_transparent_45%),linear-gradient(180deg,rgba(15,23,42,0.95),rgba(2,6,23,0.98))]' : 'border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.16),_transparent_40%),linear-gradient(180deg,#ffffff,#f8fbff)]'}`}>
          <div className="grid gap-6 xl:grid-cols-[1.4fr_0.95fr] xl:items-start">
            <div className="space-y-4">
              <div className="inline-flex items-center rounded-full bg-sky-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-sky-500">
                LinkedIn Direct
              </div>
              <div>
                <h3 className={`text-2xl font-semibold ${titleClass}`}>Professional setup for your current env-based LinkedIn flow</h3>
                <p className={`mt-2 max-w-2xl text-sm ${bodyClass}`}>
                  The current implementation uses server environment variables. This panel shows the health of the connection, the exact keys you need, and the steps your team should follow to obtain them.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <div className={`rounded-xl px-3 py-2 text-sm ${insetClass} ${bodyClass}`}>
                  Current mode: shared server env credentials
                </div>
                <div className={`rounded-xl px-3 py-2 text-sm ${insetClass} ${bodyClass}`}>
                  Ready for OAuth callback, sync, import, and webhook routes
                </div>
              </div>
            </div>

            <div className={`rounded-2xl p-5 ${insetClass}`}>
              <p className={`text-xs font-semibold uppercase tracking-wide ${mutedClass}`}>Action Panel</p>
              <p className={`mt-2 text-sm ${bodyClass}`}>
                Connect once the env keys are filled correctly. Disconnect only clears the stored LinkedIn tokens for this tenant.
              </p>
              <div className="mt-5 flex flex-col gap-3">
                <button
                  type="button"
                  onClick={handleConnect}
                  disabled={isConnecting}
                  className="inline-flex items-center justify-center rounded-xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-sky-300"
                >
                  {isConnecting ? 'Redirecting to LinkedIn...' : status.isConnected ? 'Reconnect LinkedIn' : 'Connect LinkedIn'}
                </button>

                <button
                  type="button"
                  onClick={handleDisconnect}
                  disabled={!status.isConnected || disconnectMutation.isLoading}
                  className={`inline-flex items-center justify-center rounded-xl border px-4 py-3 text-sm font-semibold transition-colors disabled:cursor-not-allowed ${isDarkMode ? 'border-slate-700 bg-slate-950 text-slate-200 hover:bg-slate-900 disabled:text-slate-500' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:text-gray-400'}`}
                >
                  {disconnectMutation.isLoading ? 'Disconnecting...' : 'Disconnect LinkedIn'}
                </button>
              </div>

              <div className={`mt-5 rounded-xl p-4 text-sm ${isDarkMode ? 'border border-slate-800 bg-slate-950 text-slate-400' : 'border border-slate-200 bg-white text-gray-600'}`}>
                Before connecting, make sure the env keys below are filled and the redirect URL has been added to your LinkedIn app.
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className={`rounded-[28px] p-6 sm:p-8 ${sectionClass}`}>
        {isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[1, 2, 3, 4].map((item) => (
              <Skeleton key={item} className="h-24 w-full rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {statusCards.map((card) => (
              <div key={card.label} className={`rounded-2xl p-4 ${insetClass}`}>
                <p className={`text-xs font-semibold uppercase tracking-wide ${mutedClass}`}>{card.label}</p>
                <p className={`mt-2 text-lg font-semibold ${card.emphasis}`}>{card.value}</p>
                <p className={`mt-1 text-sm ${bodyClass}`}>{card.detail}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_1.08fr]">
        <div className={`rounded-[28px] p-6 sm:p-8 ${sectionClass}`}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className={`text-lg font-semibold ${titleClass}`}>Required .env Keys</h3>
              <p className={`mt-1 text-sm ${bodyClass}`}>Copy these keys into your server env for the current LinkedIn setup.</p>
            </div>
            <div className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${isDarkMode ? 'bg-slate-900 text-slate-300' : 'bg-slate-100 text-slate-700'}`}>
              Env Setup
            </div>
          </div>

          <div className="mt-5 space-y-3">
            {requiredEnvKeys.map((item) => (
              <div key={item.key} className={`rounded-2xl p-4 ${insetClass}`}>
                <code className={`text-sm font-semibold ${isDarkMode ? 'text-sky-400' : 'text-sky-700'}`}>{item.key}</code>
                <p className={`mt-2 text-sm ${bodyClass}`}>{item.description}</p>
                <p className={`mt-1 text-xs ${mutedClass}`}>{item.note}</p>
              </div>
            ))}
          </div>

          <div className={`mt-5 rounded-2xl p-4 ${insetClass}`}>
            <p className={`text-sm font-semibold ${titleClass}`}>Optional keys</p>
            <div className="mt-3 space-y-2">
              {optionalEnvKeys.map((item) => (
                <div key={item.key} className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                  <code className={`text-sm font-semibold ${isDarkMode ? 'text-slate-200' : 'text-slate-800'}`}>{item.key}</code>
                  <p className={`text-sm sm:max-w-[70%] ${bodyClass}`}>{item.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className={`rounded-[28px] p-6 sm:p-8 ${sectionClass}`}>
          <h3 className={`text-lg font-semibold ${titleClass}`}>How To Grab The Credentials</h3>
          <p className={`mt-1 text-sm ${bodyClass}`}>Give these steps to the person who owns the company LinkedIn app or page access.</p>

          <div className="mt-5 space-y-4">
            {setupSteps.map((step, index) => (
              <div key={step.title} className="flex gap-4">
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-sky-500/15 text-sm font-semibold text-sky-500">
                  {index + 1}
                </div>
                <div>
                  <p className={`text-sm font-semibold ${titleClass}`}>{step.title}</p>
                  <p className={`mt-1 text-sm ${bodyClass}`}>{step.body}</p>
                </div>
              </div>
            ))}
          </div>

          <div className={`mt-6 rounded-2xl p-5 ${insetClass}`}>
            <p className={`text-sm font-semibold ${titleClass}`}>Redirect URI to add in LinkedIn</p>
            <code className={`mt-3 block rounded-xl px-4 py-3 text-sm ${isDarkMode ? 'bg-slate-950 text-sky-400' : 'bg-slate-900 text-sky-300'}`}>
              https://your-domain.com/api/recruitment/linkedin/callback
            </code>
            <p className={`mt-3 text-sm ${bodyClass}`}>
              If you are testing locally and your LinkedIn app allows it, use your local callback URL instead, for example http://localhost:3000/api/recruitment/linkedin/callback.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

// Company Settings Tab (Admin/HR only)
function CompanySettingsTab() {
  const [showModal, setShowModal] = useState(false)
  const [editingCompany, setEditingCompany] = useState(null)
  const [saving, setSaving] = useState(false)
  const [logoFile, setLogoFile] = useState(null)
  const [logoPreview, setLogoPreview] = useState(null)
  const [isMounted, setIsMounted] = useState(false)
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    description: '',
    logo: '',
    email: '',
    phone: '',
    website: '',
    address: {
      street: '',
      city: '',
      state: '',
      country: '',
      zipCode: ''
    },
    workingHours: {
      checkInTime: '09:00',
      checkOutTime: '18:00',
      lateThresholdMinutes: 15,
      absentThresholdMinutes: 60,
      halfDayHours: 4,
      fullDayHours: 8,
      workingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']
    }
  })

  const { data: companiesData, isLoading: loading, mutate: mutateCompanies } = useAuthedSWR('/api/companies')
  const companies = companiesData?.data || []

  const deleteMutation = useApiMutation({
    method: 'DELETE',
    invalidateKeys: ['/api/companies'],
    onSuccess: () => toast.success('Company deleted successfully!'),
    onError: (error) => toast.error(error.message || 'Failed to delete company')
  })

  useEffect(() => {
    setIsMounted(true)
  }, [])

  const handleOpenModal = (company = null) => {
    if (company) {
      setEditingCompany(company)
      setFormData({
        name: company.name || '',
        code: company.code || '',
        description: company.description || '',
        logo: company.logo || '',
        email: company.email || '',
        phone: company.phone || '',
        website: company.website || '',
        timezone: company.timezone || 'Asia/Kolkata',
        address: company.address || {
          street: '',
          city: '',
          state: '',
          country: '',
          zipCode: ''
        },
        workingHours: company.workingHours || {
          checkInTime: '09:00',
          checkOutTime: '18:00',
          lateThresholdMinutes: 15,
          absentThresholdMinutes: 60,
          halfDayHours: 4,
          fullDayHours: 8,
          workingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']
        }
      })
      setLogoPreview(company.logo || null)
    } else {
      setEditingCompany(null)
      setFormData({
        name: '',
        code: '',
        description: '',
        logo: '',
        email: '',
        phone: '',
        website: '',
        timezone: 'Asia/Kolkata',
        address: {
          street: '',
          city: '',
          state: '',
          country: '',
          zipCode: ''
        },
        workingHours: {
          checkInTime: '09:00',
          checkOutTime: '18:00',
          lateThresholdMinutes: 15,
          absentThresholdMinutes: 60,
          halfDayHours: 4,
          fullDayHours: 8,
          workingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']
        }
      })
      setLogoPreview(null)
    }
    setLogoFile(null)
    setShowModal(true)
  }

  const handleCloseModal = () => {
    setShowModal(false)
    setEditingCompany(null)
    setLogoFile(null)
    setLogoPreview(null)
  }

  const handleLogoChange = (e) => {
    const file = e.target.files[0]
    if (file) {
      setLogoFile(file)
      const reader = new FileReader()
      reader.onloadend = () => {
        setLogoPreview(reader.result)
      }
      reader.readAsDataURL(file)
    }
  }

  const uploadLogo = async () => {
    if (!logoFile) return null

    try {
      const token = localStorage.getItem('token')
      const data = await uploadAuthenticatedFile(logoFile, { category: 'company', token })
      if (data.success) {
        // Handle both response formats (direct fileUrl or nested in data object)
        return data.fileUrl || (data.data && data.data.fileUrl)
      } else {
        toast.error(data.message || 'Failed to upload logo')
        return null
      }
    } catch (error) {
      console.error('Error uploading logo:', error)
      toast.error('Error uploading logo')
    }
    return null
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    console.log('Submitting company form:', formData) // Debug log
    setSaving(true)

    try {
      let logoUrl = formData.logo

      // Upload logo if changed
      if (logoFile) {
        const uploadedUrl = await uploadLogo()
        if (uploadedUrl) {
          logoUrl = uploadedUrl
        }
      }

      const submitData = {
        ...formData,
        logo: logoUrl
      }

      const token = localStorage.getItem('token')
      const url = editingCompany
        ? `/api/companies/${editingCompany._id}`
        : '/api/companies'

      console.log('Sending request to:', url, 'with data:', submitData)
      const response = await fetch(url, {
        method: editingCompany ? 'PUT' : 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(submitData)
      })

      const data = await response.json()
      if (data.success) {
        toast.success(editingCompany ? 'Company updated successfully!' : 'Company created successfully!')
        mutateCompanies()
        handleCloseModal()
      } else {
        toast.error(data.message || 'Failed to save company')
      }
    } catch (error) {
      console.error('Error saving company:', error)
      toast.error('Failed to save company')
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteCompany = async (companyId) => {
    if (!confirm('Are you sure you want to delete this company?')) return
    await deleteMutation.execute(`/api/companies/${companyId}`)
  }

  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const handleAddressChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      address: { ...prev.address, [field]: value }
    }))
  }

  const handleWorkingHoursChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      workingHours: { ...prev.workingHours, [field]: value }
    }))
  }

  const handleWorkingDaysChange = (day, checked) => {
    setFormData(prev => {
      const currentDays = prev.workingHours.workingDays || []
      const newDays = checked
        ? [...currentDays, day]
        : currentDays.filter(d => d !== day)
      return {
        ...prev,
        workingHours: { ...prev.workingHours, workingDays: newDays }
      }
    })
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 gap-4">
          <div>
            <Skeleton className="h-7 w-48 rounded-lg mb-2" />
            <Skeleton className="h-4 w-72 rounded-lg" />
          </div>
          <Skeleton className="h-10 w-36 rounded-lg" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <Skeleton key={i} className="h-48 w-full rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <FaBuilding className="text-indigo-600" />
            Company Settings
          </h2>
          <p className="text-gray-600 mt-1">Manage your companies and their individual settings</p>
        </div>
        <Button
          onPress={() => handleOpenModal()}
          color="primary"
          startContent={<FaBuilding className="w-4 h-4" />}
        >
          Add Company
        </Button>
      </div>

      {/* Companies Grid */}
      {companies.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border-2 border-dashed border-gray-200">
          <FaBuilding className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-4 text-lg font-medium text-gray-800">No companies yet</h3>
          <p className="mt-2 text-sm text-gray-500">Get started by adding your first company.</p>
          <Button
            onPress={() => handleOpenModal()}
            color="primary"
            className="mt-4"
          >
            Add Company
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {companies.map((company) => (
            <div
              key={company._id}
              className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 hover:shadow-md hover:border-indigo-200 transition-all cursor-pointer overflow-hidden"
              onClick={() => handleOpenModal(company)}
            >
              <div className="flex items-start gap-4">
                {/* Company Logo */}
                <div className="w-16 h-16 rounded-lg bg-gray-100 flex items-center justify-center overflow-hidden flex-shrink-0">
                  {company.logo ? (
                    <img src={company.logo} alt={company.name} className="w-full h-full object-contain" />
                  ) : (
                    <FaBuilding className="w-8 h-8 text-gray-400" />
                  )}
                </div>

                {/* Company Info */}
                <div className="flex-1 min-w-0 overflow-hidden">
                  <h3 className="font-semibold text-lg truncate text-gray-800">{company.name}</h3>
                  <p className="text-sm text-gray-500 uppercase">{company.code}</p>
                  {company.description && (
                    <p className="text-sm text-gray-600 mt-1 line-clamp-2">{company.description}</p>
                  )}
                </div>
              </div>

              {/* Quick Info */}
              <div className="mt-4 pt-4 border-t border-gray-100 space-y-2">
                {company.workingHours && (
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <FaClock className="w-4 h-4 text-gray-400" />
                    <span>{company.workingHours.checkInTime || '09:00'} - {company.workingHours.checkOutTime || '18:00'}</span>
                  </div>
                )}
                {company.address?.city && (
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <FaMapMarkerAlt className="w-4 h-4 text-gray-400" />
                    <span className="truncate">{company.address.city}{company.address.country ? `, ${company.address.country}` : ''}</span>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="mt-4 flex gap-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleOpenModal(company)
                  }}
                  className="flex-1 px-3 py-2 text-sm font-medium rounded-lg bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-colors"
                >
                  Edit Settings
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDeleteCompany(company._id)
                  }}
                  className="px-3 py-2 text-sm font-medium rounded-lg bg-red-50 text-red-600 hover:bg-red-100 transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Company Settings Modal */}
      {isMounted && showModal && createPortal(
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && handleCloseModal()}>
          <div className="modal-backdrop" />
          <div className="modal-container modal-4xl">
            <div className="modal-header">
              <h2 className="modal-title">
                {editingCompany ? 'Edit Company Settings' : 'Add New Company'}
              </h2>
              <button onClick={handleCloseModal} className="modal-close-btn">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="modal-body space-y-6 overflow-y-auto max-h-[70vh]">
                {/* Company Logo */}
                <div className="bg-gray-50 rounded-lg p-4">
                  <div className="text-base font-semibold mb-4 flex items-center gap-2 text-gray-800">
                    <FaImage className="text-indigo-600" />
                    <span>Company Logo</span>
                  </div>
                  <div className="flex items-center gap-6">
                    <div className="w-24 h-24 border-2 border-gray-200 rounded-lg overflow-hidden bg-white flex items-center justify-center">
                      {logoPreview ? (
                        <img src={logoPreview} alt="Company Logo" className="max-w-full max-h-full object-contain" />
                      ) : (
                        <FaBuilding className="w-8 h-8 text-gray-400" />
                      )}
                    </div>
                    <div className="flex-1">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleLogoChange}
                        className="block w-full text-sm text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 cursor-pointer"
                      />
                      <p className="text-xs text-gray-500 mt-2">Recommended: Square image, max 10MB</p>
                    </div>
                  </div>
                </div>

                {/* Company Basic Info */}
                <div>
                  <h3 className="text-lg font-semibold mb-4 flex items-center gap-2 text-gray-800">
                    <FaBuilding className="text-indigo-600" />
                    <span>Company Information</span>
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-semibold mb-2 text-gray-700">Company Name *</label>
                      <input
                        type="text"
                        value={formData.name}
                        onChange={(e) => handleInputChange('name', e.target.value)}
                        required
                        className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-gray-800"
                        placeholder="Enter company name"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold mb-2 text-gray-700">Company Code *</label>
                      <input
                        type="text"
                        value={formData.code}
                        onChange={(e) => handleInputChange('code', e.target.value.toUpperCase())}
                        required
                        maxLength={10}
                        className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 uppercase text-gray-800"
                        placeholder="e.g., ACME"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-sm font-semibold mb-2 text-gray-700">Description</label>
                      <textarea
                        value={formData.description}
                        onChange={(e) => handleInputChange('description', e.target.value)}
                        rows={2}
                        className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-gray-800"
                        placeholder="Brief description of the company"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold mb-2 text-gray-700">Email</label>
                      <input
                        type="email"
                        value={formData.email}
                        onChange={(e) => handleInputChange('email', e.target.value)}
                        className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-gray-800"
                        placeholder="company@example.com"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold mb-2 text-gray-700">Phone</label>
                      <input
                        type="tel"
                        value={formData.phone}
                        onChange={(e) => handleInputChange('phone', e.target.value)}
                        className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-gray-800"
                        placeholder="+1 (555) 123-4567"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-sm font-semibold mb-2 text-gray-700">Website</label>
                      <input
                        type="url"
                        value={formData.website}
                        onChange={(e) => handleInputChange('website', e.target.value)}
                        className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-gray-800"
                        placeholder="https://www.example.com"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-sm font-semibold mb-2 text-gray-700">Timezone *</label>
                      <select
                        value={formData.timezone || 'Asia/Kolkata'}
                        onChange={(e) => {
                          console.log('Timezone changed to:', e.target.value);
                          handleInputChange('timezone', e.target.value);
                        }}
                        required
                        className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-gray-800"
                      >
                        {/* Show Asia/Kolkata (India) first, then other common timezones, then the rest alphabetically */}
                        <option value="Asia/Kolkata">Asia/Kolkata (India Standard Time)</option>
                        <optgroup label="Common Timezones">
                          <option value="UTC">UTC</option>
                          <option value="America/New_York">America/New_York (Eastern)</option>
                          <option value="America/Los_Angeles">America/Los_Angeles (Pacific)</option>
                          <option value="Europe/London">Europe/London (GMT/BST)</option>
                          <option value="Asia/Dubai">Asia/Dubai (Gulf)</option>
                          <option value="Asia/Singapore">Asia/Singapore</option>
                          <option value="Asia/Tokyo">Asia/Tokyo (Japan)</option>
                          <option value="Australia/Sydney">Australia/Sydney</option>
                        </optgroup>
                        <optgroup label="All Timezones">
                          {(typeof Intl !== 'undefined' && Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : [])
                            .filter(tz => !['Asia/Kolkata', 'UTC', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Asia/Dubai', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney'].includes(tz))
                            .map((tz) => (
                              <option key={tz} value={tz}>{tz}</option>
                            ))}
                        </optgroup>
                      </select>
                      <p className="text-xs text-gray-500 mt-1">All attendance records and notifications will use this timezone.</p>
                    </div>
                  </div>
                </div>

                {/* Company Address */}
                <div>
                  <h3 className="text-lg font-semibold mb-4 flex items-center gap-2 text-gray-800">
                    <FaMapMarkerAlt className="text-indigo-600" />
                    <span>Company Address</span>
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="md:col-span-2">
                      <label className="block text-sm font-semibold mb-2 text-gray-700">Street Address</label>
                      <input
                        type="text"
                        value={formData.address.street}
                        onChange={(e) => handleAddressChange('street', e.target.value)}
                        className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-gray-800"
                        placeholder="123 Main Street"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold mb-2 text-gray-700">City</label>
                      <input
                        type="text"
                        value={formData.address.city}
                        onChange={(e) => handleAddressChange('city', e.target.value)}
                        className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-gray-800"
                        placeholder="New York"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold mb-2 text-gray-700">State / Province</label>
                      <input
                        type="text"
                        value={formData.address.state}
                        onChange={(e) => handleAddressChange('state', e.target.value)}
                        className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-gray-800"
                        placeholder="NY"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold mb-2 text-gray-700">Country</label>
                      <input
                        type="text"
                        value={formData.address.country}
                        onChange={(e) => handleAddressChange('country', e.target.value)}
                        className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-gray-800"
                        placeholder="United States"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold mb-2 text-gray-700">Zip / Postal Code</label>
                      <input
                        type="text"
                        value={formData.address.zipCode}
                        onChange={(e) => handleAddressChange('zipCode', e.target.value)}
                        className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-gray-800"
                        placeholder="10001"
                      />
                    </div>
                  </div>
                </div>

                {/* Working Hours & Attendance Settings */}
                <div>
                  <h3 className="text-lg font-semibold mb-4 flex items-center gap-2 text-gray-800">
                    <FaClock className="text-indigo-600" />
                    <span>Working Hours & Attendance Settings</span>
                  </h3>

                  {/* Check-in/Check-out Times */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                    <div>
                      <label className="block text-sm font-semibold mb-2 text-gray-700">Check-in Time *</label>
                      <input
                        type="time"
                        value={formData.workingHours.checkInTime}
                        onChange={(e) => handleWorkingHoursChange('checkInTime', e.target.value)}
                        required
                        className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-gray-800"
                      />
                      <p className="text-xs text-gray-500 mt-1">Official start time for the workday</p>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold mb-2 text-gray-700">Check-out Time *</label>
                      <input
                        type="time"
                        value={formData.workingHours.checkOutTime}
                        onChange={(e) => handleWorkingHoursChange('checkOutTime', e.target.value)}
                        required
                        className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-gray-800"
                      />
                      <p className="text-xs text-gray-500 mt-1">Official end time for the workday</p>
                    </div>
                  </div>

                  {/* Attendance Thresholds */}
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                    <div>
                      <label className="block text-sm font-semibold mb-2 text-gray-700">Late Threshold (min)</label>
                      <input
                        type="number"
                        value={formData.workingHours.lateThresholdMinutes}
                        onChange={(e) => handleWorkingHoursChange('lateThresholdMinutes', parseInt(e.target.value) || 15)}
                        min="0"
                        max="120"
                        className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-gray-800"
                      />
                      <p className="text-xs text-gray-500 mt-1">Grace period</p>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold mb-2 text-gray-700">Absent Threshold (min)</label>
                      <input
                        type="number"
                        value={formData.workingHours.absentThresholdMinutes}
                        onChange={(e) => handleWorkingHoursChange('absentThresholdMinutes', parseInt(e.target.value) || 60)}
                        min="15"
                        max="480"
                        className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-gray-800"
                      />
                      <p className="text-xs text-gray-500 mt-1">Auto-mark absent</p>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold mb-2 text-gray-700">Half Day Hours</label>
                      <input
                        type="number"
                        value={formData.workingHours.halfDayHours}
                        onChange={(e) => handleWorkingHoursChange('halfDayHours', parseFloat(e.target.value) || 4)}
                        min="1"
                        max="12"
                        step="0.5"
                        className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-gray-800"
                      />
                      <p className="text-xs text-gray-500 mt-1">Min hours</p>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold mb-2 text-gray-700">Full Day Hours</label>
                      <input
                        type="number"
                        value={formData.workingHours.fullDayHours}
                        onChange={(e) => handleWorkingHoursChange('fullDayHours', parseFloat(e.target.value) || 8)}
                        min="1"
                        max="24"
                        step="0.5"
                        className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-gray-800"
                      />
                      <p className="text-xs text-gray-500 mt-1">Min hours</p>
                    </div>
                  </div>

                  {/* Working Days */}
                  <div>
                    <label className="block text-sm font-semibold mb-3 text-gray-700">Working Days *</label>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map(day => (
                        <label key={day} className="flex items-center space-x-2 cursor-pointer group">
                          <input
                            type="checkbox"
                            checked={formData.workingHours.workingDays?.includes(day)}
                            onChange={(e) => handleWorkingDaysChange(day, e.target.checked)}
                            className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 focus:ring-2 cursor-pointer"
                          />
                          <span className="text-sm font-medium capitalize text-gray-700 group-hover:text-indigo-600 transition-colors">{day}</span>
                        </label>
                      ))}
                    </div>
                    <p className="text-xs text-gray-500 mt-2">Select the days employees are expected to work</p>
                  </div>
                </div>
              </div>

              {/* Form Actions */}
              <div className="modal-footer">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="px-6 py-2.5 border border-gray-300 rounded-lg font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <LoadingButton
                  type="submit"
                  isLoading={saving}
                  loadingText="Saving..."
                  color="primary"
                >
                  {editingCompany ? 'Update Company' : 'Create Company'}
                </LoadingButton>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}


// Geofence Locations Manager Component (must be defined before GeofencingTab)
function GeofenceLocationsManager({ companyId }) {
  const [showModal, setShowModal] = useState(false)
  const [editingLocation, setEditingLocation] = useState(null)
  const [isMounted, setIsMounted] = useState(false)
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    address: '',
    center: { latitude: 28.6139, longitude: 77.2090 },
    radius: 100,
    isActive: true,
    isPrimary: false,
    strictMode: false,
  })

  const locationsUrl = companyId
    ? `/api/geofence/locations?activeOnly=true&company=${companyId}`
    : '/api/geofence/locations?activeOnly=true'
  const { data: locationsData, isLoading: loading, mutate: mutateLocations } = useAuthedSWR(locationsUrl)
  const locations = locationsData?.data || []

  const deleteLocationMutation = useApiMutation({
    method: 'DELETE',
    invalidateKeys: [locationsUrl],
    onSuccess: () => toast.success('Location deleted successfully'),
    onError: (error) => toast.error(error.message || 'Failed to delete location')
  })

  // Check if component is mounted (client-side)
  useEffect(() => {
    setIsMounted(true)
  }, [])

  useEffect(() => {
    console.log('🟢 showModal state changed to:', showModal)
  }, [showModal])

  const handleOpenModal = (location = null) => {
    if (location) {
      // Editing existing location
      setEditingLocation(location)
      setFormData({
        name: location.name || '',
        description: location.description || '',
        address: location.address || '',
        center: location.center || { latitude: 28.6139, longitude: 77.2090 },
        radius: location.radius || 100,
        isActive: location.isActive !== undefined ? location.isActive : true,
        isPrimary: location.isPrimary || false,
        strictMode: location.strictMode || false,
      })
      setShowModal(true)
    } else {
      // Adding new location
      setEditingLocation(null)

      // Set default form data first
      const defaultFormData = {
        name: '',
        description: '',
        address: '',
        center: { latitude: 28.6139, longitude: 77.2090 },
        radius: 100,
        isActive: true,
        isPrimary: false,
        strictMode: false,
      }

      setFormData(defaultFormData)

      // Show modal immediately
      setShowModal(true)

      // Try to get current location in the background
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            // Update form data with current location
            setFormData(prev => ({
              ...prev,
              center: {
                latitude: position.coords.latitude,
                longitude: position.coords.longitude
              }
            }))
          },
          (error) => {
            // Keep default location if geolocation fails
            console.error('Error getting location:', error)
          }
        )
      }
    }
  }

  const handleSave = async () => {
    // Validate required fields
    if (!formData.name || !formData.name.trim()) {
      toast.error('Please enter a location name')
      return
    }

    if (!formData.center || !Number.isFinite(Number(formData.center.latitude)) || !Number.isFinite(Number(formData.center.longitude))) {
      toast.error('Please set valid coordinates')
      return
    }

    if (!formData.radius || formData.radius < 10) {
      toast.error('Radius must be at least 10 meters')
      return
    }

    try {
      const token = localStorage.getItem('token')
      const url = editingLocation
        ? `/api/geofence/locations/${editingLocation._id}`
        : '/api/geofence/locations'

      const response = await fetch(url, {
        method: editingLocation ? 'PUT' : 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ ...formData, company: companyId || null })
      })

      const data = await response.json()
      if (data.success) {
        toast.success(editingLocation ? 'Location updated successfully' : 'Location added successfully')
        mutateLocations()
        setShowModal(false)
        // Reset form data
        setFormData({
          name: '',
          description: '',
          address: '',
          center: { latitude: 28.6139, longitude: 77.2090 },
          radius: 100,
          isActive: true,
          isPrimary: false,
          strictMode: false,
        })
        setEditingLocation(null)
      } else {
        toast.error(data.message || 'Failed to save location')
      }
    } catch (error) {
      console.error('Error saving location:', error)
      toast.error('Failed to save location')
    }
  }

  const handleDelete = async (locationId) => {
    if (!confirm('Are you sure you want to delete this location?')) return
    await deleteLocationMutation.execute(`/api/geofence/locations/${locationId}`)
  }

  const handleMapUpdate = async (newPos, newRadius) => {
    console.log('Map updated:', newPos, newRadius)

    // newPos is an object { lat, lng }
    // First update coordinates and radius
    setFormData(prev => ({
      ...prev,
      center: { latitude: newPos.lat, longitude: newPos.lng },
      radius: newRadius
    }))

    // Reverse geocoding to get address
    try {
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?latlng=${newPos.lat},${newPos.lng}&key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}`
      )
      const data = await response.json()

      console.log('Geocoding response:', data)

      if (data.status === 'OK' && data.results && data.results.length > 0) {
        const result = data.results[0]
        const address = result.formatted_address

        // Extract location name from address components
        let locationName = ''
        const addressComponents = result.address_components

        // Try to get a meaningful location name
        const locality = addressComponents.find(c => c.types.includes('locality'))
        const sublocality = addressComponents.find(c => c.types.includes('sublocality') || c.types.includes('sublocality_level_1'))
        const neighborhood = addressComponents.find(c => c.types.includes('neighborhood'))
        const premise = addressComponents.find(c => c.types.includes('premise'))

        if (premise) {
          locationName = premise.long_name
        } else if (neighborhood) {
          locationName = neighborhood.long_name
        } else if (sublocality) {
          locationName = sublocality.long_name
        } else if (locality) {
          locationName = locality.long_name
        }

        console.log('Extracted location name:', locationName)
        console.log('Extracted address:', address)

        // Update form data with address and location name
        setFormData(prev => ({
          ...prev,
          center: { latitude: newPos.lat, longitude: newPos.lng },
          radius: newRadius,
          address: address,
          name: prev.name || locationName // Only update name if it's empty
        }))
      } else {
        console.error('Geocoding failed:', data.status, data.error_message)
      }
    } catch (error) {
      console.error('Error fetching address:', error)
    }
  }

  return (
    <div className="bg-white rounded-lg">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <FaMapMarkerAlt className="text-primary-500" />
            <span>Office Locations</span>
          </h3>
          <p className="text-sm text-gray-600 mt-1">Manage multiple office locations. Employees can check in from any configured location.</p>
        </div>
        <Button
          onPress={() => handleOpenModal()}
          color="primary"
          startContent={<FaMapMarkerAlt />}
        >
          Add Location
        </Button>
      </div>

      {loading ? (
        <div className="text-center py-8 text-gray-500">Loading locations...</div>
      ) : locations.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
          <FaMapMarkerAlt className="mx-auto text-4xl text-gray-400 mb-3" />
          <p className="text-gray-600 mb-4">No locations configured yet</p>
          <Button
            onPress={() => handleOpenModal()}
            color="primary"
          >
            Add Your First Location
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {locations.map((location) => (
            <div
              key={location._id}
              className={`border-2 rounded-lg p-4 ${location.isPrimary ? 'border-yellow-400 bg-yellow-50' : 'border-gray-200 bg-white'
                } hover:shadow-md transition-shadow`}
            >
              <div className="flex justify-between items-start mb-3">
                <div className="flex items-center gap-2">
                  <h4 className="font-semibold text-gray-900">{location.name}</h4>
                  {location.isPrimary && (
                    <span className="text-yellow-500" title="Primary Location">⭐</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleOpenModal(location)}
                    className="text-blue-600 hover:text-blue-800"
                    title="Edit"
                  >
                    ✏️
                  </button>
                  {!location.isPrimary && (
                    <button
                      onClick={() => handleDelete(location._id)}
                      className="text-red-600 hover:text-red-800"
                      title="Delete"
                    >
                      🗑️
                    </button>
                  )}
                </div>
              </div>

              {location.address && (
                <p className="text-sm text-gray-600 mb-2">{location.address}</p>
              )}

              <div className="text-xs text-gray-500 space-y-1">
                <div>📍 {location.center?.latitude?.toFixed(6)}, {location.center?.longitude?.toFixed(6)}</div>
                <div>📏 Radius: {location.radius}m</div>
                <div className="flex gap-2 mt-2">
                  {location.isActive ? (
                    <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs">Active</span>
                  ) : (
                    <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs">Inactive</span>
                  )}
                  {location.strictMode && (
                    <span className="px-2 py-1 bg-red-100 text-red-700 rounded text-xs">Strict</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal - Rendered using Portal */}
      {isMounted && showModal && createPortal(
        <div
          className="modal-overlay"
          onClick={() => {
            setShowModal(false)
            setEditingLocation(null)
          }}
        >
          <div
            className="rounded-[30px] animate-modal-enter shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col bg-white border border-gray-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between bg-gray-50 dark:bg-gray-800">
              <h3 className="text-xl font-bold flex items-center gap-3 text-gray-900">
                <div className="p-2 rounded-lg bg-blue-500/10">
                  <FaMapMarkerAlt className="text-blue-500" size={20} />
                </div>
                {editingLocation ? 'Edit Location' : 'Add New Location'}
              </h3>
              <button
                onClick={() => {
                  setShowModal(false)
                  setEditingLocation(null)
                }}
                className="p-2 rounded-lg transition-all hover:rotate-90 hover:bg-red-100 text-gray-500 bg-gray-100"
              >
                <span className="text-xl">✕</span>
              </button>
            </div>

            <div className="p-6 space-y-5 overflow-y-auto flex-1 bg-white">
              {/* Name & Address Row */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  <label className="block text-sm font-semibold mb-2 text-gray-900">
                    Location Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-lg text-sm transition-all focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50 bg-gray-50 border border-gray-300 text-gray-900 outline-none"
                    placeholder="e.g., Main Office, Branch 1"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-2 text-gray-900">
                    Address
                  </label>
                  <input
                    type="text"
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-lg text-sm transition-all focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50 bg-gray-50 border border-gray-300 text-gray-900 outline-none"
                    placeholder="Full address (auto-filled from map)"
                  />
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-semibold mb-2 text-gray-900">
                  Description
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-lg text-sm transition-all focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50 resize-none bg-gray-50 border border-gray-300 text-gray-900 outline-none"
                  rows="2"
                  placeholder="Optional description for this location"
                />
              </div>

              {/* Coordinates & Radius Row */}
              <div className="p-4 rounded-lg bg-gray-100">
                <h4 className="text-sm font-semibold mb-3 text-gray-900">
                  Geofence Coordinates
                </h4>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-medium mb-1.5 text-gray-500">
                      Latitude
                    </label>
                    <input
                      type="number"
                      step="any"
                      value={formData.center.latitude}
                      onChange={(e) => setFormData({
                        ...formData,
                        center: { ...formData.center, latitude: parseFloat(e.target.value) || 0 }
                      })}
                      className="w-full px-3 py-2 rounded-lg text-sm transition-all focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50 bg-white border border-gray-300 text-gray-900 outline-none"
                      placeholder="28.6139"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1.5 text-gray-500">
                      Longitude
                    </label>
                    <input
                      type="number"
                      step="any"
                      value={formData.center.longitude}
                      onChange={(e) => setFormData({
                        ...formData,
                        center: { ...formData.center, longitude: parseFloat(e.target.value) || 0 }
                      })}
                      className="w-full px-3 py-2 rounded-lg text-sm transition-all focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50 bg-white border border-gray-300 text-gray-900 outline-none"
                      placeholder="77.2090"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1.5 text-gray-500">
                      Radius (meters)
                    </label>
                    <input
                      type="number"
                      min="10"
                      step="10"
                      value={formData.radius}
                      onChange={(e) => setFormData({ ...formData, radius: parseInt(e.target.value) || 100 })}
                      className="w-full px-3 py-2 rounded-lg text-sm transition-all focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50 bg-white border border-gray-300 text-gray-900 outline-none"
                      placeholder="100"
                    />
                  </div>
                </div>
                <p className="text-xs mt-2 text-gray-500">
                  💡 Drag the marker or resize the circle on the map to adjust the geofence area. Address will auto-fill!
                </p>
              </div>

              {/* Map */}
              <div className="rounded-xl overflow-hidden shadow-lg h-[400px] border-2 border-gray-300">
                <GeofenceMap
                  center={{
                    lat: parseFloat(formData.center.latitude) || 28.6139,
                    lng: parseFloat(formData.center.longitude) || 77.2090
                  }}
                  radius={parseInt(formData.radius) || 100}
                  onUpdate={handleMapUpdate}
                />
              </div>

              {/* Options - Compact */}
              <div className="flex flex-wrap gap-6 p-4 rounded-lg bg-gray-100">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.isActive}
                    onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                    className="w-4 h-4 rounded accent-blue-500"
                  />
                  <span className="text-sm font-semibold text-gray-900">
                    Active
                  </span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.isPrimary}
                    onChange={(e) => setFormData({ ...formData, isPrimary: e.target.checked })}
                    className="w-4 h-4 rounded accent-blue-500"
                  />
                  <span className="text-sm font-semibold text-gray-900">
                    Primary Location
                  </span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.strictMode}
                    onChange={(e) => setFormData({ ...formData, strictMode: e.target.checked })}
                    className="w-4 h-4 rounded accent-blue-500"
                  />
                  <span className="text-sm font-semibold text-gray-900">
                    Strict Mode
                  </span>
                </label>
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3 bg-gray-50">
              <button
                onClick={() => {
                  setShowModal(false)
                  setEditingLocation(null)
                }}
                className="px-6 py-2.5 rounded-lg text-sm font-semibold transition-all hover:scale-105 hover:bg-gray-100 bg-white text-gray-500 border border-gray-300"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="px-6 py-2.5 rounded-lg text-sm font-semibold text-white transition-all hover:scale-105 hover:bg-blue-600 shadow-lg bg-blue-500"
              >
                {editingLocation ? '✓ Update Location' : '+ Add Location'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

// Geofencing Tab (Admin/HR only)
function GeofencingTab() {
  const [selectedCompany, setSelectedCompany] = useState(null)
  const [saving, setSaving] = useState(false)
  const [breakTimings, setBreakTimings] = useState([])

  const { data: companiesData, isLoading: companiesLoading } = useAuthedSWR('/api/companies')
  const companies = companiesData?.data || []

  const { data: companyDetailData, isLoading: detailLoading, mutate: mutateCompanyDetail } = useAuthedSWR(
    selectedCompany ? `/api/companies/${selectedCompany._id}` : null
  )
  const settings = companyDetailData?.data || null
  const loading = companiesLoading || detailLoading

  // Sync breakTimings when settings data arrives
  useEffect(() => {
    if (settings) {
      setBreakTimings(Array.isArray(settings.breakTimings) ? settings.breakTimings : [])
    }
  }, [settings])

  const handleSelectCompany = (company) => {
    setSelectedCompany(company)
  }

  const addBreakTiming = () => {
    setBreakTimings([
      ...breakTimings,
      {
        name: '',
        startTime: '13:00',
        endTime: '14:00',
        days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
        isActive: true
      }
    ])
  }

  const updateBreakTiming = (index, field, value) => {
    const updated = [...breakTimings]
    updated[index] = { ...updated[index], [field]: value }
    setBreakTimings(updated)
  }

  const toggleBreakDay = (index, day) => {
    const updated = [...breakTimings]
    const days = updated[index].days || []
    if (days.includes(day)) {
      updated[index].days = days.filter(d => d !== day)
    } else {
      updated[index].days = [...days, day]
    }
    setBreakTimings(updated)
  }

  const removeBreakTiming = (index) => {
    setBreakTimings(breakTimings.filter((_, i) => i !== index))
  }

  const handleSave = async (e) => {
    e.preventDefault()
    if (!selectedCompany) {
      toast.error('Please select a company first')
      return
    }
    setSaving(true)

    try {
      const formData = new FormData(e.target)
      const updatedSettings = {
        geofence: {
          enabled: formData.get('enabled') === 'on',
          strictMode: formData.get('strictMode') === 'on',
          notifyOnExit: formData.get('notifyOnExit') === 'on',
          requireApproval: formData.get('requireApproval') === 'on',
          maxAccuracyMeters: Math.min(5000, Math.max(10, Number(formData.get('maxAccuracyMeters')) || 150)),
          useMultipleLocations: true, // Always use multiple locations
        },
        breakTimings: breakTimings
      }

      const token = localStorage.getItem('token')
      // Save to the specific company
      const response = await fetch(`/api/companies/${selectedCompany._id}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(updatedSettings)
      })

      const data = await response.json()
      if (data.success) {
        toast.success('Geofencing settings saved successfully!')
        mutateCompanyDetail()
        setSelectedCompany(data.data)
      } else {
        toast.error(data.message || 'Failed to save settings')
      }
    } catch (error) {
      console.error('Error saving settings:', error)
      toast.error('Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-7 w-48 rounded-lg mb-2" />
        <Skeleton className="h-4 w-72 rounded-lg mb-6" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <Skeleton key={i} className="h-32 w-full rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  if (!selectedCompany) {
    return (
      <div>
        <div className="mb-6">
          <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <FaMapMarkerAlt className="text-indigo-600" />
            Geofencing Settings
          </h2>
          <p className="text-gray-600 mt-1">Configure location tracking and office premises boundaries per company</p>
        </div>
        <CompanySelector
          companies={companies}
          selectedCompany={null}
          onSelect={handleSelectCompany}
          loading={loading}
        />
      </div>
    )
  }

  return (
    <div>
      <CompanySelector
        companies={companies}
        selectedCompany={selectedCompany}
        onSelect={handleSelectCompany}
        onBack={() => setSelectedCompany(null)}
        loading={false}
      />

      <h2 className="text-xl font-bold text-gray-800 mb-2 flex items-center gap-2">
        <FaMapMarkerAlt className="text-indigo-600" />
        <span>Geofencing Settings</span>
      </h2>
      <p className="text-gray-600 mb-6">Configure location tracking and office premises boundaries</p>

      <form onSubmit={handleSave} className="space-y-8">
        {/* Enable Geofencing */}
        <div className="bg-blue-50 dark:bg-blue-950/30 border-2 border-primary-200 dark:border-primary-800 rounded-lg p-6">
          <label className="flex items-start space-x-4 cursor-pointer group">
            <input
              type="checkbox"
              name="enabled"
              defaultChecked={settings?.geofence?.enabled}
              className="w-6 h-6 mt-1 rounded text-primary-500 focus:ring-primary-500 focus:ring-2 cursor-pointer"
            />
            <div className="flex-1">
              <span className="text-base font-bold text-gray-900 group-hover:text-primary-700 transition-colors">Enable Geofencing</span>
              <p className="text-sm text-gray-700 mt-1">Track employee locations and enforce office premises boundaries during work hours</p>
            </div>
          </label>
        </div>

        {/* Office Locations */}
        <GeofenceLocationsManager companyId={selectedCompany._id} />

        {/* Geofence Options */}
        <div className="bg-white rounded-lg">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <FaCog className="text-primary-500" />
            <span>Geofence Enforcement Options</span>
          </h3>
          <div className="space-y-4">
            <label className="flex items-start space-x-4 p-4 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors group">
              <input
                type="checkbox"
                name="strictMode"
                defaultChecked={settings?.geofence?.strictMode}
                className="mt-1 w-5 h-5 rounded text-primary-500 focus:ring-primary-500 focus:ring-2 cursor-pointer"
              />
              <div className="flex-1">
                <span className="text-sm font-semibold text-gray-900 group-hover:text-primary-700 transition-colors">Strict Mode</span>
                <p className="text-sm text-gray-600 mt-1">Employees must be within the geofence boundary to check in or check out</p>
              </div>
            </label>

            <label className="flex items-start space-x-4 p-4 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors group">
              <input
                type="checkbox"
                name="notifyOnExit"
                defaultChecked={settings?.geofence?.notifyOnExit}
                className="mt-1 w-5 h-5 rounded text-primary-500 focus:ring-primary-500 focus:ring-2 cursor-pointer"
              />
              <div className="flex-1">
                <span className="text-sm font-semibold text-gray-900 group-hover:text-primary-700 transition-colors">Notify on Exit</span>
                <p className="text-sm text-gray-600 mt-1">Send push notification to employee when they exit the geofence during work hours</p>
              </div>
            </label>

            <label className="flex items-start space-x-4 p-4 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors group">
              <input
                type="checkbox"
                name="requireApproval"
                defaultChecked={settings?.geofence?.requireApproval}
                className="mt-1 w-5 h-5 rounded text-primary-500 focus:ring-primary-500 focus:ring-2 cursor-pointer"
              />
              <div className="flex-1">
                <span className="text-sm font-semibold text-gray-900 group-hover:text-primary-700 transition-colors">Require Manager Approval</span>
                <p className="text-sm text-gray-600 mt-1">Require department head approval when employee is detected outside geofence during work hours</p>
              </div>
            </label>

            <div className="p-4 bg-gray-50 rounded-lg">
              <label htmlFor="maxAccuracyMeters" className="block text-sm font-semibold text-gray-900">
                Required GPS accuracy
              </label>
              <p className="text-sm text-gray-600 mt-1 mb-3">
                In strict mode, readings less accurate than this are rejected.
              </p>
              <div className="flex items-center gap-3 max-w-sm">
                <input
                  id="maxAccuracyMeters"
                  name="maxAccuracyMeters"
                  type="number"
                  min="10"
                  max="5000"
                  step="10"
                  defaultValue={settings?.geofence?.maxAccuracyMeters || 150}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-900 focus:ring-2 focus:ring-primary-500"
                />
                <span className="text-sm text-gray-600">meters</span>
              </div>
            </div>
          </div>
        </div>

        {/* Break Timings */}
        <div className="bg-white rounded-lg">
          <div className="flex justify-between items-center mb-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <FaClock className="text-primary-500" />
                <span>Break Timings</span>
              </h3>
              <p className="text-sm text-gray-600 mt-1">Configure break times when geofencing tracking is paused</p>
            </div>
            <button
              type="button"
              onClick={addBreakTiming}
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-primary-600 transition-colors flex items-center gap-2"
            >
              <span>+</span> Add Break
            </button>
          </div>

          {breakTimings.length === 0 ? (
            <div className="text-center py-8 bg-gray-50 rounded-lg">
              <FaClock className="mx-auto text-gray-400 text-4xl mb-3" />
              <p className="text-gray-600">No break timings configured</p>
              <p className="text-sm text-gray-500 mt-1">Click &quot;Add Break&quot; to configure break times</p>
            </div>
          ) : (
            <div className="space-y-4">
              {breakTimings.map((breakTiming, index) => (
                <div key={index} className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                  <div className="flex justify-between items-start mb-3">
                    <input
                      type="text"
                      value={breakTiming.name}
                      onChange={(e) => updateBreakTiming(index, 'name', e.target.value)}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg mr-2 focus:ring-2 focus:ring-primary-500"
                      placeholder="Break name (e.g., Lunch Break)"
                    />
                    <label className="flex items-center gap-2 mr-2">
                      <input
                        type="checkbox"
                        checked={breakTiming.isActive}
                        onChange={(e) => updateBreakTiming(index, 'isActive', e.target.checked)}
                        className="w-4 h-4 rounded text-primary-500 focus:ring-primary-500"
                      />
                      <span className="text-sm text-gray-700">Active</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => removeBreakTiming(index)}
                      className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      title="Remove"
                    >
                      ✕
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div>
                      <label className="block text-xs text-gray-600 mb-1.5">Start Time</label>
                      <input
                        type="time"
                        value={breakTiming.startTime}
                        onChange={(e) => updateBreakTiming(index, 'startTime', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-1.5">End Time</label>
                      <input
                        type="time"
                        value={breakTiming.endTime}
                        onChange={(e) => updateBreakTiming(index, 'endTime', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs text-gray-600 mb-2">Active Days</label>
                    <div className="flex flex-wrap gap-2">
                      {['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map(day => (
                        <button
                          key={day}
                          type="button"
                          onClick={() => toggleBreakDay(index, day)}
                          className={`px-3 py-1 text-xs rounded-lg transition-colors ${breakTiming.days?.includes(day)
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                            }`}
                        >
                          {day.charAt(0).toUpperCase() + day.slice(1, 3)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end pt-4 border-t border-gray-200">
          <LoadingButton
            type="submit"
            isLoading={saving}
            loadingText="Saving..."
            color="primary"
            startContent={!saving ? <FaCheck /> : undefined}
          >
            Save Geofencing Settings
          </LoadingButton>
        </div>
      </form>
    </div>
  )
}

function DepartmentsTab() {
  return (
    <div>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4 sm:mb-6">
        <h2 className="text-xl sm:text-2xl font-bold text-gray-800">Departments</h2>
        <Button color="primary" size="sm" className="w-full sm:w-auto">Add Department</Button>
      </div>
      <div className="text-gray-600">
        <p className="text-sm sm:text-base mb-3 sm:mb-4">Manage organization departments here.</p>
        <div className="space-y-2 sm:space-y-3">
          <div className="p-3 sm:p-4 border border-gray-200 rounded-lg flex justify-between items-center hover:bg-gray-50 transition-colors">
            <div>
              <h3 className="font-semibold text-sm sm:text-base">Engineering</h3>
              <p className="text-xs sm:text-sm text-gray-500">50 employees</p>
            </div>
            <button className="text-primary-500 hover:text-primary-700 text-sm">Edit</button>
          </div>
          <div className="p-3 sm:p-4 border border-gray-200 rounded-lg flex justify-between items-center hover:bg-gray-50 transition-colors">
            <div>
              <h3 className="font-semibold text-sm sm:text-base">Human Resources</h3>
              <p className="text-xs sm:text-sm text-gray-500">10 employees</p>
            </div>
            <button className="text-primary-500 hover:text-primary-700 text-sm">Edit</button>
          </div>
          <div className="p-3 sm:p-4 border border-gray-200 rounded-lg flex justify-between items-center hover:bg-gray-50 transition-colors">
            <div>
              <h3 className="font-semibold text-sm sm:text-base">Sales</h3>
              <p className="text-xs sm:text-sm text-gray-500">25 employees</p>
            </div>
            <button className="text-primary-500 hover:text-primary-700 text-sm">Edit</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function DesignationsTab() {
  return (
    <div>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4 sm:mb-6">
        <h2 className="text-xl sm:text-2xl font-bold text-gray-800">Designations</h2>
        <Button color="primary" size="sm" className="w-full sm:w-auto">Add Designation</Button>
      </div>
      <div className="text-gray-600">
        <p className="text-sm sm:text-base mb-3 sm:mb-4">Manage job designations and titles here.</p>
        <div className="space-y-2 sm:space-y-3">
          <div className="p-3 sm:p-4 border border-gray-200 rounded-lg flex justify-between items-center hover:bg-gray-50 transition-colors">
            <div>
              <h3 className="font-semibold text-sm sm:text-base">Software Engineer</h3>
              <p className="text-xs sm:text-sm text-gray-500">Engineering Department</p>
            </div>
            <button className="text-primary-500 hover:text-primary-700 text-sm">Edit</button>
          </div>
          <div className="p-3 sm:p-4 border border-gray-200 rounded-lg flex justify-between items-center hover:bg-gray-50 transition-colors">
            <div>
              <h3 className="font-semibold text-sm sm:text-base">HR Manager</h3>
              <p className="text-xs sm:text-sm text-gray-500">Human Resources Department</p>
            </div>
            <button className="text-primary-500 hover:text-primary-700 text-sm">Edit</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function HolidaysTab() {
  return (
    <div>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4 sm:mb-6">
        <h2 className="text-xl sm:text-2xl font-bold text-gray-800">Holidays</h2>
        <Button color="primary" size="sm" className="w-full sm:w-auto">Add Holiday</Button>
      </div>
      <div className="text-gray-600">
        <p className="text-sm sm:text-base mb-3 sm:mb-4">Manage company holidays and observances.</p>
        <div className="space-y-2 sm:space-y-3">
          <div className="p-3 sm:p-4 border border-gray-200 rounded-lg flex justify-between items-center hover:bg-gray-50 transition-colors">
            <div>
              <h3 className="font-semibold text-sm sm:text-base">New Year&apos;s Day</h3>
              <p className="text-xs sm:text-sm text-gray-500">January 1, 2025</p>
            </div>
            <button className="text-primary-500 hover:text-primary-700 text-sm">Edit</button>
          </div>
          <div className="p-3 sm:p-4 border border-gray-200 rounded-lg flex justify-between items-center hover:bg-gray-50 transition-colors">
            <div>
              <h3 className="font-semibold text-sm sm:text-base">Independence Day</h3>
              <p className="text-xs sm:text-sm text-gray-500">July 4, 2025</p>
            </div>
            <button className="text-primary-500 hover:text-primary-700 text-sm">Edit</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function LeaveTypesTab() {
  return (
    <div>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4 sm:mb-6">
        <h2 className="text-xl sm:text-2xl font-bold text-gray-800">Leave Types</h2>
        <Button color="primary" size="sm" className="w-full sm:w-auto">Add Leave Type</Button>
      </div>
      <div className="text-gray-600">
        <p className="text-sm sm:text-base mb-3 sm:mb-4">Configure different types of leaves available.</p>
        <div className="space-y-2 sm:space-y-3">
          <div className="p-3 sm:p-4 border border-gray-200 rounded-lg flex justify-between items-center hover:bg-gray-50 transition-colors">
            <div>
              <h3 className="font-semibold text-sm sm:text-base">Casual Leave</h3>
              <p className="text-xs sm:text-sm text-gray-500">12 days per year</p>
            </div>
            <button className="text-primary-500 hover:text-primary-700 text-sm">Edit</button>
          </div>
          <div className="p-3 sm:p-4 border border-gray-200 rounded-lg flex justify-between items-center hover:bg-gray-50 transition-colors">
            <div>
              <h3 className="font-semibold text-sm sm:text-base">Sick Leave</h3>
              <p className="text-xs sm:text-sm text-gray-500">10 days per year</p>
            </div>
            <button className="text-primary-500 hover:text-primary-700 text-sm">Edit</button>
          </div>
          <div className="p-3 sm:p-4 border border-gray-200 rounded-lg flex justify-between items-center hover:bg-gray-50 transition-colors">
            <div>
              <h3 className="font-semibold text-sm sm:text-base">Paid Time Off</h3>
              <p className="text-xs sm:text-sm text-gray-500">15 days per year</p>
            </div>
            <button className="text-primary-500 hover:text-primary-700 text-sm">Edit</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function GeneralTab() {
  return (
    <div>
      <h2 className="text-xl sm:text-2xl font-bold text-gray-800 mb-4 sm:mb-6">General Settings</h2>
      <div className="space-y-4 sm:space-y-6">
        <div>
          <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-2">
            Company Name
          </label>
          <input
            type="text"
            defaultValue="My Company"
            className="w-full px-3 sm:px-4 py-2 text-sm sm:text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-2">
            Company Email
          </label>
          <input
            type="email"
            defaultValue="info@company.com"
            className="w-full px-3 sm:px-4 py-2 text-sm sm:text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-2">
            Time Zone
          </label>
          <Select
            defaultSelectedKeys={["UTC"]}
            aria-label="Time Zone"
            classNames={{ trigger: "bg-white" }}
          >
            <SelectItem key="UTC">UTC</SelectItem>
            <SelectItem key="America/New_York">America/New_York</SelectItem>
            <SelectItem key="America/Los_Angeles">America/Los_Angeles</SelectItem>
            <SelectItem key="Europe/London">Europe/London</SelectItem>
            <SelectItem key="Asia/Kolkata">Asia/Kolkata</SelectItem>
          </Select>
        </div>

        <div>
          <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-2">
            Currency
          </label>
          <Select
            defaultSelectedKeys={["USD"]}
            aria-label="Currency"
            classNames={{ trigger: "bg-white" }}
          >
            <SelectItem key="USD">USD - US Dollar</SelectItem>
            <SelectItem key="EUR">EUR - Euro</SelectItem>
            <SelectItem key="GBP">GBP - British Pound</SelectItem>
            <SelectItem key="INR">INR - Indian Rupee</SelectItem>
          </Select>
        </div>

        <div className="flex justify-end pt-2">
          <Button color="primary" size="sm" className="w-full sm:w-auto">Save Changes</Button>
        </div>
      </div>
    </div>
  )
}

function PersonalizationTab() {
  const { currentTheme, changeTheme, themes, isDarkMode, darkModePref, setDarkModePreference } = useTheme()

  const themeColors = {
    default: {
      primary: '#3B82F6',
      secondary: '#2563EB',
      border: '#3B82F6',
      bgLight: '#EFF6FF',
    },
    purple: {
      primary: '#A855F7',
      secondary: '#9333EA',
      border: '#A855F7',
      bgLight: '#FAF5FF',
    },
    green: {
      primary: '#22C55E',
      secondary: '#16A34A',
      border: '#22C55E',
      bgLight: '#F0FDF4',
    },
    orange: {
      primary: '#F97316',
      secondary: '#EA580C',
      border: '#F97316',
      bgLight: '#FFF7ED',
    },
    teal: {
      primary: '#14B8A6',
      secondary: '#0D9488',
      border: '#14B8A6',
      bgLight: '#F0FDFA',
    },
  }

  return (
    <div>
      <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-2 flex items-center gap-2">
        <FaPalette style={{ color: 'var(--color-primary-500)' }} />
        <span>Personalization</span>
      </h2>
      <p className="text-gray-600 mb-6">Customize the look and feel of your dashboard</p>

      {/* Appearance Mode Selector */}
      <div className="rounded-xl border p-5 mb-6" style={{
        backgroundColor: 'var(--color-bg-card)',
        borderColor: isDarkMode ? '#27272a' : '#E5E7EB'
      }}>
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-4">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{
                backgroundColor: isDarkMode ? '#27272a' : '#F1F5F9',
                color: isDarkMode ? '#F59E0B' : '#F59E0B',
              }}
            >
              {darkModePref === 'auto' ? <FaDesktop className="text-lg" /> : isDarkMode ? <FaMoon className="text-lg" /> : <FaSun className="text-lg" />}
            </div>
            <div>
              <h3 className="text-lg font-semibold" style={{ color: isDarkMode ? '#F1F5F9' : '#111827' }}>Appearance</h3>
              <p className="text-sm text-gray-500">
                {darkModePref === 'auto'
                  ? 'Automatically matches your device settings'
                  : isDarkMode
                    ? 'Dark mode is always on'
                    : 'Light mode is always on'}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 p-1 rounded-xl" style={{ backgroundColor: isDarkMode ? '#09090b' : '#F1F5F9' }}>
            {[
              { key: 'auto', label: 'Auto', icon: <FaDesktop className="text-sm" /> },
              { key: 'light', label: 'Light', icon: <FaSun className="text-sm" /> },
              { key: 'dark', label: 'Dark', icon: <FaMoon className="text-sm" /> },
            ].map((opt) => (
              <button
                key={opt.key}
                onClick={() => {
                  setDarkModePreference(opt.key)
                  const msgs = { auto: 'Following device settings', light: 'Switched to Light Mode!', dark: 'Switched to Dark Mode!' }
                  toast.success(msgs[opt.key], { duration: 2000 })
                }}
                className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${darkModePref === opt.key ? 'shadow-md' : ''}`}
                style={{
                  backgroundColor: darkModePref === opt.key ? (isDarkMode ? '#27272a' : '#FFFFFF') : 'transparent',
                  color: darkModePref === opt.key ? (isDarkMode ? '#F1F5F9' : '#111827') : (isDarkMode ? '#94A3B8' : '#6B7280'),
                }}
              >
                {opt.icon}
                <span>{opt.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-lg" style={{ backgroundColor: 'var(--color-bg-card)' }}>
        <h3 className="text-lg font-semibold mb-4" style={{ color: isDarkMode ? '#F1F5F9' : '#111827' }}>Choose Your Theme</h3>
        <p className="text-sm text-gray-600 mb-6">Select a color theme that suits your preference. The theme will be applied across the entire application.</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Object.keys(themes).map((themeKey) => {
            const theme = themes[themeKey]
            const colors = themeColors[themeKey]
            const isActive = currentTheme === themeKey

            return (
              <button
                key={themeKey}
                onClick={() => {
                  changeTheme(themeKey)
                  toast.success(`Theme changed to ${theme.name}!`, {
                    icon: '🎨',
                    duration: 2000,
                  })
                }}
                className="relative p-6 rounded-xl border-2 transition-all hover:shadow-lg"
                style={{
                  borderColor: isActive ? colors.border : (isDarkMode ? '#27272a' : '#E5E7EB'),
                  backgroundColor: isActive ? (isDarkMode ? '#27272a' : colors.bgLight) : (isDarkMode ? '#18181b' : '#FFFFFF'),
                }}
              >
                {/* Active Indicator */}
                {isActive && (
                  <div className="absolute top-3 right-3">
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center shadow-md"
                      style={{
                        background: `linear-gradient(135deg, ${colors.primary} 0%, ${colors.secondary} 100%)`
                      }}
                    >
                      <FaCheck className="w-4 h-4 text-white" />
                    </div>
                  </div>
                )}

                {/* Theme Preview */}
                <div className="flex items-center gap-4 mb-4">
                  <div
                    className="w-14 h-14 rounded-lg shadow-md flex-shrink-0"
                    style={{
                      background: `linear-gradient(135deg, ${colors.primary} 0%, ${colors.secondary} 100%)`
                    }}
                  ></div>
                  <div className="flex flex-col gap-1.5 flex-1">
                    <div
                      className="h-3 rounded-full"
                      style={{
                        background: `linear-gradient(90deg, ${colors.primary} 0%, ${colors.secondary} 100%)`,
                        width: '100%'
                      }}
                    ></div>
                    <div
                      className="h-3 rounded-full"
                      style={{
                        background: `linear-gradient(90deg, ${colors.primary} 0%, ${colors.secondary} 100%)`,
                        opacity: 0.6,
                        width: '75%'
                      }}
                    ></div>
                    <div
                      className="h-3 rounded-full"
                      style={{
                        background: `linear-gradient(90deg, ${colors.primary} 0%, ${colors.secondary} 100%)`,
                        opacity: 0.3,
                        width: '50%'
                      }}
                    ></div>
                  </div>
                </div>

                {/* Theme Name */}
                <div className="text-left">
                  <h4 className={`font-bold text-lg mb-1 ${isActive ? 'text-gray-900' : 'text-gray-800'}`}>
                    {theme.name}
                  </h4>
                  <p className="text-sm text-gray-600">
                    {isActive ? 'Currently Active' : 'Click to apply'}
                  </p>
                </div>
              </button>
            )
          })}
        </div>

        <div
          className="mt-8 p-4 border rounded-lg"
          style={{
            backgroundColor: 'var(--color-primary-50)',
            borderColor: 'var(--color-primary-200)'
          }}
        >
          <div className="flex items-start gap-3">
            <FaPalette
              className="w-5 h-5 mt-0.5 flex-shrink-0"
              style={{ color: 'var(--color-primary-500)' }}
            />
            <div>
              <h4
                className="font-semibold mb-1"
                style={{ color: 'var(--color-primary-900)' }}
              >
                Theme Preview
              </h4>
              <p
                className="text-sm"
                style={{ color: 'var(--color-primary-700)' }}
              >
                Your selected theme will be applied immediately across all pages. The theme preference is saved in your browser and will persist across sessions.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// Payroll Settings Tab (Admin/HR only)
function PayrollSettingsTab() {
  const [selectedCompany, setSelectedCompany] = useState(null)
  const [saving, setSaving] = useState(false)

  const { data: companiesData, isLoading: companiesLoading } = useAuthedSWR('/api/companies')
  const companies = companiesData?.data || []

  const { data: companyDetailData, isLoading: detailLoading, mutate: mutateCompanyDetail } = useAuthedSWR(
    selectedCompany ? `/api/companies/${selectedCompany._id}` : null
  )
  const settings = companyDetailData?.data || null
  const loading = companiesLoading || detailLoading

  const handleSelectCompany = (company) => {
    setSelectedCompany(company)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    if (!selectedCompany) {
      toast.error('Please select a company first')
      return
    }
    setSaving(true)

    try {
      const formData = new FormData(e.target)

      const payrollSettings = {
        payroll: {
          workingDaysPerMonth: parseInt(formData.get('workingDaysPerMonth')) || 26,

          lateDeduction: {
            enabled: formData.get('lateDeductionEnabled') === 'on',
            type: formData.get('lateDeductionType') || 'fixed',
            value: parseFloat(formData.get('lateDeductionValue')) || 100,
            graceLatesPerMonth: parseInt(formData.get('graceLatesPerMonth')) || 3,
          },

          halfDayDeduction: {
            enabled: formData.get('halfDayDeductionEnabled') === 'on',
            type: formData.get('halfDayDeductionType') || 'half-day-salary',
            value: parseFloat(formData.get('halfDayDeductionValue')) || 50,
          },

          absentDeduction: {
            enabled: formData.get('absentDeductionEnabled') === 'on',
            type: formData.get('absentDeductionType') || 'full-day-salary',
            value: parseFloat(formData.get('absentDeductionValue')) || 100,
          },

          overtime: {
            enabled: formData.get('overtimeEnabled') === 'on',
            rateMultiplier: parseFloat(formData.get('overtimeRateMultiplier')) || 1.5,
            minHoursForOvertime: parseFloat(formData.get('minHoursForOvertime')) || 1,
          },

          pfEnabled: formData.get('pfEnabled') === 'on',
          pfPercentage: parseFloat(formData.get('pfPercentage')) || 12,
          esiEnabled: formData.get('esiEnabled') === 'on',
          esiPercentage: parseFloat(formData.get('esiPercentage')) || 0.75,
          professionalTax: {
            enabled: formData.get('professionalTaxEnabled') === 'on',
            amount: parseFloat(formData.get('professionalTaxAmount')) || 200,
          },
          tdsEnabled: formData.get('tdsEnabled') === 'on',
          tdsPercentage: parseFloat(formData.get('tdsPercentage')) || 10,
        }
      }

      const token = localStorage.getItem('token')
      // Save to the specific company
      const response = await fetch(`/api/companies/${selectedCompany._id}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payrollSettings)
      })

      const data = await response.json()
      if (data.success) {
        toast.success('Payroll settings saved successfully!')
        mutateCompanyDetail()
        setSelectedCompany(data.data)
      } else {
        toast.error(data.message || 'Failed to save payroll settings')
      }
    } catch (error) {
      console.error('Error saving payroll settings:', error)
      toast.error('Failed to save payroll settings')
    } finally {
      setSaving(false)
    }
  }

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0
    }).format(amount || 0)
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-7 w-48 rounded-lg mb-2" />
        <Skeleton className="h-4 w-72 rounded-lg mb-6" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <Skeleton key={i} className="h-32 w-full rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  if (!selectedCompany) {
    return (
      <div>
        <div className="mb-6">
          <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <FaMoneyBillWave className="text-green-600" />
            Payroll Settings
          </h2>
          <p className="text-gray-600 mt-1">Configure payroll deductions and statutory compliance per company</p>
        </div>
        <CompanySelector
          companies={companies}
          selectedCompany={null}
          onSelect={handleSelectCompany}
          loading={loading}
        />
      </div>
    )
  }

  const payroll = settings?.payroll || {}

  return (
    <div>
      <CompanySelector
        companies={companies}
        selectedCompany={selectedCompany}
        onSelect={handleSelectCompany}
        onBack={() => setSelectedCompany(null)}
        loading={false}
      />

      <h2 className="text-xl font-bold text-gray-800 mb-2 flex items-center gap-2">
        <FaMoneyBillWave className="text-green-600" />
        <span>Payroll Settings</span>
      </h2>
      <p className="text-gray-600 mb-6">Configure salary deductions, overtime rules, and statutory compliance</p>

      <form onSubmit={handleSave} className="space-y-6">
        {/* General Settings */}
        <div className="bg-white rounded-lg">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <FaCog className="text-blue-500" />
            General Settings
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Working Days Per Month
              </label>
              <input
                type="number"
                name="workingDaysPerMonth"
                defaultValue={payroll.workingDaysPerMonth || 26}
                min="20"
                max="31"
                className="w-full px-4 py-2.5 text-gray-900 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
              <p className="text-xs text-gray-500 mt-1">Used to calculate daily salary rate</p>
            </div>
          </div>
        </div>

        {/* Attendance-Based Deductions */}
        <div className="bg-white rounded-lg">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <FaClock className="text-orange-500" />
            Attendance-Based Deductions
          </h3>

          {/* Late Deduction */}
          <div className="mb-6 p-4 bg-yellow-50 rounded-lg border border-yellow-200">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h4 className="font-semibold text-gray-900">Late Arrival Deduction</h4>
                <p className="text-sm text-gray-600">Deduct from salary when employee arrives late</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  name="lateDeductionEnabled"
                  defaultChecked={payroll.lateDeduction?.enabled !== false}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-300 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500"></div>
              </label>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Deduction Type</label>
                <select
                  name="lateDeductionType"
                  defaultValue={payroll.lateDeduction?.type || 'fixed'}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                >
                  <option value="fixed">Fixed Amount (₹)</option>
                  <option value="percentage">Percentage of Salary (%)</option>
                  <option value="per-day-salary">% of Daily Salary</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Value</label>
                <input
                  type="number"
                  name="lateDeductionValue"
                  defaultValue={payroll.lateDeduction?.value || 100}
                  min="0"
                  step="0.01"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Grace Lates/Month</label>
                <input
                  type="number"
                  name="graceLatesPerMonth"
                  defaultValue={payroll.lateDeduction?.graceLatesPerMonth || 3}
                  min="0"
                  max="31"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                />
                <p className="text-xs text-gray-500 mt-1">No deduction for first N lates</p>
              </div>
            </div>
          </div>

          {/* Half-Day Deduction */}
          <div className="mb-6 p-4 bg-orange-50 rounded-lg border border-orange-200">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h4 className="font-semibold text-gray-900">Half-Day Deduction</h4>
                <p className="text-sm text-gray-600">Deduct when employee works less than full day hours</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  name="halfDayDeductionEnabled"
                  defaultChecked={payroll.halfDayDeduction?.enabled !== false}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-300 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500"></div>
              </label>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Deduction Type</label>
                <select
                  name="halfDayDeductionType"
                  defaultValue={payroll.halfDayDeduction?.type || 'half-day-salary'}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                >
                  <option value="fixed">Fixed Amount (₹)</option>
                  <option value="percentage">Percentage of Monthly Salary (%)</option>
                  <option value="half-day-salary">% of Daily Salary (50% = half day)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Value</label>
                <input
                  type="number"
                  name="halfDayDeductionValue"
                  defaultValue={payroll.halfDayDeduction?.value || 50}
                  min="0"
                  step="0.01"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                />
              </div>
            </div>
          </div>

          {/* Absent Deduction */}
          <div className="p-4 bg-red-50 rounded-lg border border-red-200">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h4 className="font-semibold text-gray-900">Absent Day Deduction</h4>
                <p className="text-sm text-gray-600">Deduct when employee is absent without approved leave</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  name="absentDeductionEnabled"
                  defaultChecked={payroll.absentDeduction?.enabled !== false}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-300 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500"></div>
              </label>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Deduction Type</label>
                <select
                  name="absentDeductionType"
                  defaultValue={payroll.absentDeduction?.type || 'full-day-salary'}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                >
                  <option value="fixed">Fixed Amount (₹)</option>
                  <option value="percentage">Percentage of Monthly Salary (%)</option>
                  <option value="full-day-salary">% of Daily Salary (100% = full day)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Value</label>
                <input
                  type="number"
                  name="absentDeductionValue"
                  defaultValue={payroll.absentDeduction?.value || 100}
                  min="0"
                  step="0.01"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Overtime Settings */}
        <div className="bg-white rounded-lg">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <FaClock className="text-green-500" />
            Overtime Settings
          </h3>
          <div className="p-4 bg-green-50 rounded-lg border border-green-200">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h4 className="font-semibold text-gray-900">Enable Overtime Pay</h4>
                <p className="text-sm text-gray-600">Pay extra for hours worked beyond regular shift</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  name="overtimeEnabled"
                  defaultChecked={payroll.overtime?.enabled !== false}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-300 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500"></div>
              </label>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Rate Multiplier</label>
                <input
                  type="number"
                  name="overtimeRateMultiplier"
                  defaultValue={payroll.overtime?.rateMultiplier || 1.5}
                  min="1"
                  max="3"
                  step="0.1"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                />
                <p className="text-xs text-gray-500 mt-1">1.5 = 150% of hourly rate</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Minimum Hours</label>
                <input
                  type="number"
                  name="minHoursForOvertime"
                  defaultValue={payroll.overtime?.minHoursForOvertime || 1}
                  min="0.5"
                  max="4"
                  step="0.5"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                />
                <p className="text-xs text-gray-500 mt-1">Min extra hours to qualify for OT</p>
              </div>
            </div>
          </div>
        </div>

        {/* Statutory Deductions */}
        <div className="bg-white rounded-lg">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <FaMoneyBillWave className="text-purple-500" />
            Statutory Deductions
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* PF */}
            <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-semibold text-gray-900">Provident Fund (PF)</h4>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    name="pfEnabled"
                    defaultChecked={payroll.pfEnabled !== false}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-300 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-500"></div>
                </label>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">PF Percentage (%)</label>
                <input
                  type="number"
                  name="pfPercentage"
                  defaultValue={payroll.pfPercentage || 12}
                  min="0"
                  max="20"
                  step="0.1"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                />
              </div>
            </div>

            {/* ESI */}
            <div className="p-4 bg-indigo-50 rounded-lg border border-indigo-200">
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-semibold text-gray-900">ESI (Employee State Insurance)</h4>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    name="esiEnabled"
                    defaultChecked={payroll.esiEnabled !== false}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-300 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-500"></div>
                </label>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">ESI Percentage (%)</label>
                <input
                  type="number"
                  name="esiPercentage"
                  defaultValue={payroll.esiPercentage || 0.75}
                  min="0"
                  max="5"
                  step="0.01"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                />
              </div>
            </div>

            {/* Professional Tax */}
            <div className="p-4 bg-purple-50 rounded-lg border border-purple-200">
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-semibold text-gray-900">Professional Tax</h4>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    name="professionalTaxEnabled"
                    defaultChecked={payroll.professionalTax?.enabled !== false}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-300 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-500"></div>
                </label>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Fixed Amount (₹)</label>
                <input
                  type="number"
                  name="professionalTaxAmount"
                  defaultValue={payroll.professionalTax?.amount || 200}
                  min="0"
                  max="2500"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                />
              </div>
            </div>

            {/* TDS */}
            <div className="p-4 bg-pink-50 rounded-lg border border-pink-200">
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-semibold text-gray-900">TDS (Tax Deducted at Source)</h4>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    name="tdsEnabled"
                    defaultChecked={payroll.tdsEnabled !== false}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-300 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-pink-500"></div>
                </label>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">TDS Percentage (%)</label>
                <input
                  type="number"
                  name="tdsPercentage"
                  defaultValue={payroll.tdsPercentage || 10}
                  min="0"
                  max="30"
                  step="0.1"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Summary Preview */}
        <div className="bg-blue-50 dark:bg-blue-950/30 rounded-lg p-6 border border-blue-200 dark:border-blue-800">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">📊 Settings Summary</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div className="bg-white p-3 rounded-lg">
              <p className="text-gray-500">Working Days</p>
              <p className="font-semibold text-gray-900">{payroll.workingDaysPerMonth || 26} days/month</p>
            </div>
            <div className="bg-white p-3 rounded-lg">
              <p className="text-gray-500">Grace Lates</p>
              <p className="font-semibold text-gray-900">{payroll.lateDeduction?.graceLatesPerMonth || 3} per month</p>
            </div>
            <div className="bg-white p-3 rounded-lg">
              <p className="text-gray-500">Overtime Rate</p>
              <p className="font-semibold text-gray-900">{payroll.overtime?.rateMultiplier || 1.5}x</p>
            </div>
            <div className="bg-white p-3 rounded-lg">
              <p className="text-gray-500">PF Rate</p>
              <p className="font-semibold text-gray-900">{payroll.pfPercentage || 12}%</p>
            </div>
          </div>
        </div>

        {/* Save Button */}
        <div className="flex justify-end">
          <LoadingButton
            type="submit"
            isLoading={saving}
            loadingText="Saving..."
            color="success"
            startContent={!saving ? <FaCheck /> : undefined}
          >
            Save Payroll Settings
          </LoadingButton>
        </div>
      </form>
    </div>
  )
}

// Notifications Tab (Admin/HR/Department Head only)
function NotificationsTab() {
  const [selectedCompany, setSelectedCompany] = useState(null)
  const [settings, setSettings] = useState(null)
  const [originalSettings, setOriginalSettings] = useState(null)
  const [saving, setSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)

  const NotificationManagement = dynamic(() => import('@/components/NotificationManagement'), { ssr: false })

  const { data: companiesData, isLoading: companiesLoading } = useAuthedSWR('/api/companies')
  const companies = companiesData?.data || []

  const { data: companyDetailData, isLoading: detailLoading, mutate: mutateCompanyDetail } = useAuthedSWR(
    selectedCompany ? `/api/companies/${selectedCompany._id}` : null
  )
  const loading = companiesLoading || detailLoading

  // Sync settings when company detail data arrives
  useEffect(() => {
    if (companyDetailData?.data) {
      setSettings(companyDetailData.data)
      setOriginalSettings(JSON.parse(JSON.stringify(companyDetailData.data)))
    }
  }, [companyDetailData])

  const handleSelectCompany = (company) => {
    setSelectedCompany(company)
  }

  useEffect(() => {
    // Check if there are unsaved changes
    if (settings && originalSettings) {
      const currentEmailNotifications = settings.notifications?.emailNotifications
      const originalEmailNotifications = originalSettings.notifications?.emailNotifications
      const currentEmailEvents = JSON.stringify(settings.notifications?.emailEvents || {})
      const originalEmailEvents = JSON.stringify(originalSettings.notifications?.emailEvents || {})

      setHasChanges(
        currentEmailNotifications !== originalEmailNotifications ||
        currentEmailEvents !== originalEmailEvents
      )
    }
  }, [settings, originalSettings])

  const handleEmailToggleChange = (eventKey) => (e) => {
    const checked = e.target.checked
    setSettings((prev) => {
      if (!prev) return prev

      // Deep clone to avoid mutation
      const newSettings = JSON.parse(JSON.stringify(prev))

      if (!newSettings.notifications) {
        newSettings.notifications = {}
      }
      if (!newSettings.notifications.emailEvents) {
        newSettings.notifications.emailEvents = {}
      }

      newSettings.notifications.emailEvents[eventKey] = checked

      return newSettings
    })
  }

  const handleGlobalEmailToggleChange = (e) => {
    const checked = e.target.checked
    setSettings((prev) => {
      if (!prev) return prev

      // Deep clone to avoid mutation
      const newSettings = JSON.parse(JSON.stringify(prev))

      if (!newSettings.notifications) {
        newSettings.notifications = {}
      }

      newSettings.notifications.emailNotifications = checked

      return newSettings
    })
  }

  const handleSave = async (e) => {
    e.preventDefault()
    if (!settings || !selectedCompany) {
      toast.error('Please select a company first')
      return
    }
    setSaving(true)

    try {
      const token = localStorage.getItem('token')

      // Get the current value - if undefined, treat as true (default), otherwise use the actual value
      const emailNotifications = settings.notifications?.emailNotifications !== false
      const emailEvents = settings.notifications?.emailEvents || {}

      console.log('Saving email notification settings:', {
        emailNotifications,
        emailEvents
      })

      // Save to the specific company
      const response = await fetch(`/api/companies/${selectedCompany._id}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          notifications: {
            emailNotifications: emailNotifications,
            emailEvents: emailEvents,
          },
        }),
      })

      const data = await response.json()
      console.log('Save response:', data)

      if (data.success) {
        // Update both settings and original settings with the response
        const updatedSettings = JSON.parse(JSON.stringify(data.data))
        setSettings(updatedSettings)
        setOriginalSettings(updatedSettings)
        setSelectedCompany(data.data)
        setHasChanges(false)
        mutateCompanyDetail()
        toast.success('Email notification settings saved successfully!')
      } else {
        toast.error(data.message || 'Failed to save notification settings')
      }
    } catch (error) {
      console.error('Error saving notification settings:', error)
      toast.error('Failed to save notification settings')
    } finally {
      setSaving(false)
    }
  }

  const handleReset = () => {
    if (originalSettings) {
      setSettings(JSON.parse(JSON.stringify(originalSettings)))
      setHasChanges(false)
      toast.success('Changes discarded')
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-7 w-56 rounded-lg mb-2" />
        <Skeleton className="h-4 w-80 rounded-lg mb-6" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <Skeleton key={i} className="h-32 w-full rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  if (!selectedCompany) {
    return (
      <div>
        <div className="mb-6">
          <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <FaBell className="text-indigo-600" />
            Notification Settings
          </h2>
          <p className="text-gray-600 mt-1">Configure email and push notification preferences per company</p>
        </div>
        <CompanySelector
          companies={companies}
          selectedCompany={null}
          onSelect={handleSelectCompany}
          loading={loading}
        />
      </div>
    )
  }

  // Master toggle: default is true (from schema), only false if explicitly set to false
  const emailNotificationsEnabled = settings?.notifications?.emailNotifications !== false
  const emailEvents = settings?.notifications?.emailEvents || {}

  const attendanceStatusEvents = [
    {
      key: 'attendanceStatusPresent',
      label: 'Present days',
      description: 'Send an email summary when an employee is marked present.',
    },
    {
      key: 'attendanceStatusHalfDay',
      label: 'Half-day days',
      description: 'Send an email summary when an employee is marked half-day.',
    },
    {
      key: 'attendanceStatusAbsent',
      label: 'Absent days',
      description: 'Send an email summary when an employee is marked absent.',
    },
  ]

  // Check if individual event is enabled
  // Default to true if not explicitly set to false (for backward compatibility)
  const isEventEnabled = (key) => {
    const value = emailEvents[key]
    // If undefined or true, return true. If false, return false.
    return value !== false
  }

  return (
    <div className="space-y-6">
      <CompanySelector
        companies={companies}
        selectedCompany={selectedCompany}
        onSelect={handleSelectCompany}
        onBack={() => setSelectedCompany(null)}
        loading={false}
      />

      {/* Unsaved changes banner */}
      {hasChanges && (
        <div className="bg-amber-50 border-l-4 border-amber-400 p-4 rounded-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-amber-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />

                </svg>
              </div>
              <p className="text-sm font-medium text-amber-800">
                You have unsaved changes
              </p>
            </div>
            <button
              type="button"
              onClick={handleReset}
              className="text-sm font-medium text-amber-800 hover:text-amber-900 underline"
            >
              Discard changes
            </button>
          </div>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-4">
        <div className="bg-white rounded-lg p-4 sm:p-6 border border-gray-200 shadow-sm">
          <h2 className="text-lg sm:text-xl font-semibold text-gray-900 mb-2">Email Notifications</h2>
          <p className="text-sm text-gray-600 mb-6">
            Choose which activities should send emails to employees.
          </p>

          <div className="space-y-5">
            {/* Master toggle */}
            <div className="flex items-start justify-between p-4 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-primary-100 dark:border-primary-800">
              <div className="flex-1">
                <p className="text-sm font-bold text-gray-900">Enable email notifications</p>
                <p className="text-xs text-gray-600 mt-1">
                  Master switch to enable or disable all email notifications system-wide.
                </p>
              </div>
              <label className="inline-flex items-center cursor-pointer ml-4 flex-shrink-0">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={emailNotificationsEnabled}
                  onChange={handleGlobalEmailToggleChange}
                />
                <div className={`relative w-11 h-6 rounded-full transition-all duration-500 ease-in-out ${emailNotificationsEnabled
                  ? 'bg-blue-600'
                  : 'bg-gray-300'
                  }`}>
                  <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-md transition-all duration-500 ease-in-out ${emailNotificationsEnabled
                    ? 'translate-x-5'
                    : 'translate-x-0.5'
                    }`} />
                </div>
              </label>
            </div>

            {/* Per-event toggles */}
            <div className="border-t border-gray-200 pt-4 space-y-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Authentication Events</p>
              {[
                {
                  key: 'login',
                  label: 'Login',
                  description: 'Send an email to employees when they log in.',
                },
              ].map((event) => {
                const isEnabled = isEventEnabled(event.key)
                const canToggle = emailNotificationsEnabled

                return (
                  <div key={event.key} className="flex items-start justify-between p-3 hover:bg-gray-50 rounded-lg transition-colors">
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-gray-900">{event.label}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{event.description}</p>
                    </div>
                    <label className={`inline-flex items-center ml-4 flex-shrink-0 ${canToggle ? 'cursor-pointer' : 'cursor-not-allowed'}`}>
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={isEnabled}
                        onChange={handleEmailToggleChange(event.key)}
                        disabled={!canToggle}
                      />
                      <div className={`relative w-11 h-6 rounded-full transition-all duration-500 ease-in-out ${!canToggle
                        ? 'bg-gray-200 opacity-50'
                        : isEnabled
                          ? 'bg-blue-600'
                          : 'bg-gray-300'
                        }`}>
                        <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-md transition-all duration-500 ease-in-out ${isEnabled
                          ? 'translate-x-5'
                          : 'translate-x-0.5'
                          }`} />
                      </div>
                    </label>
                  </div>
                )
              })}
            </div>

            <div className="border-t border-gray-200 pt-4 space-y-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Attendance Events</p>
              {[
                {
                  key: 'attendanceClockIn',
                  label: 'Clock in',
                  description: 'Send an email when an employee clocks in.',
                },
              ].map((event) => {
                const isEnabled = isEventEnabled(event.key)
                const canToggle = emailNotificationsEnabled

                return (
                  <div key={event.key} className="flex items-start justify-between p-3 hover:bg-gray-50 rounded-lg transition-colors">
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-gray-900">{event.label}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{event.description}</p>
                    </div>
                    <label className={`inline-flex items-center ml-4 flex-shrink-0 ${canToggle ? 'cursor-pointer' : 'cursor-not-allowed'}`}>
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={isEnabled}
                        onChange={handleEmailToggleChange(event.key)}
                        disabled={!canToggle}
                      />
                      <div className={`relative w-11 h-6 rounded-full transition-all duration-500 ease-in-out ${!canToggle
                        ? 'bg-gray-200 opacity-50'
                        : isEnabled
                          ? 'bg-blue-600'
                          : 'bg-gray-300'
                        }`}>
                        <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-md transition-all duration-500 ease-in-out ${isEnabled
                          ? 'translate-x-5'
                          : 'translate-x-0.5'
                          }`} />
                      </div>
                    </label>
                  </div>
                )
              })}
            </div>

            <div className="border-t border-gray-200 pt-4 space-y-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Daily Attendance Status (on clock-out)</p>
              {attendanceStatusEvents.map((event) => {
                const isEnabled = isEventEnabled(event.key)
                const canToggle = emailNotificationsEnabled

                return (
                  <div key={event.key} className="flex items-start justify-between p-3 hover:bg-gray-50 rounded-lg transition-colors">
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-gray-900">{event.label}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{event.description}</p>
                    </div>
                    <label className={`inline-flex items-center ml-4 flex-shrink-0 ${canToggle ? 'cursor-pointer' : 'cursor-not-allowed'}`}>
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={isEnabled}
                        onChange={handleEmailToggleChange(event.key)}
                        disabled={!canToggle}
                      />
                      <div className={`relative w-11 h-6 rounded-full transition-all duration-500 ease-in-out ${!canToggle
                        ? 'bg-gray-200 opacity-50'
                        : isEnabled
                          ? 'bg-blue-600'
                          : 'bg-gray-300'
                        }`}>
                        <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-md transition-all duration-500 ease-in-out ${isEnabled
                          ? 'translate-x-5'
                          : 'translate-x-0.5'
                          }`} />
                      </div>
                    </label>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={handleReset}
            disabled={!hasChanges || saving}
            className="px-4 py-2.5 rounded-lg text-sm font-semibold text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Reset
          </button>
          <LoadingButton
            type="submit"
            isLoading={saving}
            loadingText="Saving..."
            color="primary"
            isDisabled={!hasChanges}
          >
            Save Changes
          </LoadingButton>
        </div>
      </form>

      <div className="bg-white rounded-lg p-4 sm:p-6 border border-gray-200 shadow-sm">
        <h2 className="text-lg sm:text-xl font-semibold text-gray-900 mb-4">Push Notifications</h2>
        <NotificationManagement />
      </div>
    </div>
  )
}

