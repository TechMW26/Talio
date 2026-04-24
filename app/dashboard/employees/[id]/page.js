'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import toast from '@/utils/toast'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import { DataErrorState } from '@/components/ui/ErrorBoundary'
import BackgroundRefreshIndicator from '@/components/ui/BackgroundRefreshIndicator'
import {
  FaEnvelope,
  FaPhone,
  FaMapMarkerAlt,
  FaArrowLeft,
  FaBriefcase,
  FaCalendarAlt,
  FaBullseye,
  FaListUl,
  FaPlus,
  FaSave,
  FaTrash,
  FaEdit,
  FaUserShield,
  FaQuoteLeft,
  FaBuilding,
  FaIdBadge,
  FaUserFriends,
} from 'react-icons/fa'
import { HiOutlineSparkles } from 'react-icons/hi2'
import { formatDesignation, formatDepartments } from '@/lib/formatters'
import { Button, Chip, Skeleton, Tooltip } from '@heroui/react'

function StatTile({ icon: Icon, label, value, accent = 'sky' }) {
  const accents = {
    sky: 'from-sky-500/20 to-blue-500/10 text-sky-600 dark:text-sky-300 border-sky-200/40 dark:border-sky-500/30',
    violet: 'from-violet-500/20 to-fuchsia-500/10 text-violet-600 dark:text-violet-300 border-violet-200/40 dark:border-violet-500/30',
    emerald: 'from-emerald-500/20 to-teal-500/10 text-emerald-600 dark:text-emerald-300 border-emerald-200/40 dark:border-emerald-500/30',
    amber: 'from-amber-500/20 to-orange-500/10 text-amber-600 dark:text-amber-300 border-amber-200/40 dark:border-amber-500/30',
  }
  return (
    <div className={`relative overflow-hidden rounded-2xl border bg-gradient-to-br ${accents[accent]} p-4`}>
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-white/70 dark:bg-zinc-900/70 flex items-center justify-center">
          <Icon className="w-5 h-5" />
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wider opacity-70 font-semibold">{label}</p>
          <p className="text-base font-bold text-slate-800 dark:text-zinc-100">{value}</p>
        </div>
      </div>
    </div>
  )
}

function InfoRow({ icon: Icon, label, value }) {
  return (
    <div className="flex items-start gap-3 py-3 border-b border-slate-100 dark:border-zinc-800 last:border-0">
      <div className="w-9 h-9 rounded-lg bg-slate-100 dark:bg-zinc-800 flex items-center justify-center text-slate-500 dark:text-zinc-400 flex-shrink-0">
        <Icon className="w-4 h-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] uppercase tracking-wider text-slate-500 dark:text-zinc-400 font-semibold">{label}</p>
        <p className="text-sm font-medium text-slate-800 dark:text-zinc-100 break-words">{value || 'N/A'}</p>
      </div>
    </div>
  )
}

function computeTenure(dateOfJoining) {
  if (!dateOfJoining) return 'N/A'
  const start = new Date(dateOfJoining)
  if (isNaN(start.getTime())) return 'N/A'
  const now = new Date()
  let months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth())
  if (now.getDate() < start.getDate()) months -= 1
  if (months < 1) return '< 1 mo'
  const years = Math.floor(months / 12)
  const remMonths = months % 12
  if (years === 0) return `${remMonths} mo`
  if (remMonths === 0) return `${years} yr${years > 1 ? 's' : ''}`
  return `${years}y ${remMonths}m`
}

export default function EmployeeDetailPage() {
  const params = useParams()
  const router = useRouter()
  const { data: res, error, isLoading, isValidating, mutate: refresh } = useAuthedSWR(params.id ? `/api/employees/${params.id}` : null)
  const { data: kriKpiRes, mutate: refreshKriKpi } = useAuthedSWR(params.id ? `/api/employees/${params.id}/kri-kpi` : null)
  const employee = res?.data || null

  const [activeTab, setActiveTab] = useState('overview')
  const [canManageKriKpi, setCanManageKriKpi] = useState(false)
  const [manualKRIs, setManualKRIs] = useState([])
  const [manualKPIs, setManualKPIs] = useState([])
  const [newKri, setNewKri] = useState('')
  const [newKpi, setNewKpi] = useState({ name: '', target: '', unit: '', notes: '' })
  const [savingKriKpi, setSavingKriKpi] = useState(false)

  useEffect(() => {
    const storedUser = JSON.parse(localStorage.getItem('user') || '{}')
    const role = storedUser?.role
    setCanManageKriKpi(['admin', 'hr', 'manager', 'department_head'].includes(role))
  }, [])

  useEffect(() => {
    if (kriKpiRes?.data) {
      setManualKRIs(kriKpiRes.data.manualKRIs || [])
      setManualKPIs(kriKpiRes.data.manualKPIs || [])
    }
  }, [kriKpiRes])

  const aiGeneratedKRIs = useMemo(() => kriKpiRes?.data?.aiGeneratedKRIs || [], [kriKpiRes])

  const initials = useMemo(() => {
    if (!employee) return '?'
    return `${(employee.firstName?.[0] || '').toUpperCase()}${(employee.lastName?.[0] || '').toUpperCase()}` || '?'
  }, [employee])

  const tenure = useMemo(() => computeTenure(employee?.dateOfJoining), [employee?.dateOfJoining])

  const handleSaveKriKpi = async () => {
    try {
      setSavingKriKpi(true)
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/employees/${params.id}/kri-kpi`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ manualKRIs, manualKPIs }),
      })
      const result = await response.json()
      if (!result.success) {
        toast.error(result.message || 'Failed to save KRIs/KPIs')
        return
      }
      toast.success('KRI/KPI updated successfully')
      refreshKriKpi()
      refresh()
    } catch (e) {
      console.error('Save KRI/KPI error:', e)
      toast.error('Failed to save KRIs/KPIs')
    } finally {
      setSavingKriKpi(false)
    }
  }

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-48 w-full rounded-3xl" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}
        </div>
        <Skeleton className="h-64 w-full rounded-3xl" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <DataErrorState message="Failed to load employee details" onRetry={() => refresh()} />
      </div>
    )
  }

  if (!employee) return null

  return (
    <div className="px-4 sm:px-6 lg:px-8 pb-24 md:pb-10 max-w-6xl mx-auto">
      {/* Top bar */}
      <div className="flex items-center justify-between py-4">
        <Button
          variant="light"
          size="sm"
          onPress={() => router.push('/dashboard/employees')}
          startContent={<FaArrowLeft />}
        >
          Back
        </Button>
        <div className="flex items-center gap-2">
          <BackgroundRefreshIndicator isValidating={isValidating && !isLoading} position="inline" />
          <Button
            color="primary"
            size="sm"
            onPress={() => router.push(`/dashboard/employees/edit/${employee._id}`)}
            startContent={<FaEdit />}
          >
            Edit
          </Button>
        </div>
      </div>

      {/* Hero banner */}
      <div className="relative overflow-hidden rounded-3xl border border-slate-200/60 dark:border-zinc-800">
        {/* Gradient cover */}
        <div className="h-44 sm:h-52 bg-gradient-to-br from-sky-500 via-indigo-500 to-fuchsia-500 relative">
          <div className="absolute inset-0 opacity-30 mix-blend-overlay" style={{ backgroundImage: 'radial-gradient(circle at 30% 30%, white 1px, transparent 1px)', backgroundSize: '20px 20px' }} />
          <div className="absolute -bottom-12 -right-10 w-72 h-72 rounded-full bg-white/10 blur-3xl" />
          <div className="absolute top-4 right-4 flex gap-2">
            <Chip
              size="sm"
              variant="solid"
              className="bg-white/25 backdrop-blur text-white border border-white/30"
            >
              {employee.status || 'active'}
            </Chip>
            {employee.role && (
              <Chip
                size="sm"
                variant="solid"
                className="bg-white/25 backdrop-blur text-white border border-white/30"
                startContent={<FaUserShield className="w-3 h-3" />}
              >
                {employee.role}
              </Chip>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="bg-white dark:bg-zinc-950 px-6 sm:px-10 pb-6 pt-4 relative">
          {/* Avatar */}
          <div className="absolute -top-16 left-6 sm:left-10">
            <div className="w-32 h-32 rounded-[100%] ring-4 ring-white dark:ring-zinc-950 overflow-hidden bg-gradient-to-br from-slate-700 to-slate-900 flex items-center justify-center text-white text-4xl font-black shadow-2xl">
              {employee.profilePicture ? (
                <img
                  src={employee.profilePicture}
                  alt={`${employee.firstName} ${employee.lastName}`}
                  className="w-full h-full object-cover"
                  onError={(e) => { e.currentTarget.style.display = 'none' }}
                />
              ) : (
                <span>{initials}</span>
              )}
            </div>
          </div>

          <div className="ml-0 sm:ml-44 mt-20 sm:mt-2">
            <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-slate-900 dark:text-zinc-50">
              {employee.firstName} {employee.lastName}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-slate-600 dark:text-zinc-300">
                {formatDesignation(employee.designation, employee) || 'No designation'}
              </span>
              <span className="text-slate-300 dark:text-zinc-600">·</span>
              <span className="text-sm text-slate-500 dark:text-zinc-400">
                {formatDepartments(employee) || 'No department'}
              </span>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {employee.email && (
                <a
                  href={`mailto:${employee.email}`}
                  className="inline-flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-full bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-200 hover:bg-slate-200 dark:hover:bg-zinc-700 transition-colors"
                >
                  <FaEnvelope className="w-3 h-3" />
                  {employee.email}
                </a>
              )}
              {employee.phone && (
                <a
                  href={`tel:${employee.phone}`}
                  className="inline-flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-full bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-200 hover:bg-slate-200 dark:hover:bg-zinc-700 transition-colors"
                >
                  <FaPhone className="w-3 h-3" />
                  {employee.phone}
                </a>
              )}
              {employee.employeeCode && (
                <span className="inline-flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-full bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-200">
                  <FaIdBadge className="w-3 h-3" />
                  {employee.employeeCode}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6">
        <StatTile icon={FaCalendarAlt} label="Tenure" value={tenure} accent="sky" />
        <StatTile icon={FaBriefcase} label="Designation" value={formatDesignation(employee.designation, employee) || '—'} accent="violet" />
        <StatTile icon={FaBuilding} label="Department" value={formatDepartments(employee) || '—'} accent="emerald" />
        <StatTile icon={FaUserFriends} label="Reports To" value={employee.reportingManager?.firstName ? `${employee.reportingManager.firstName} ${employee.reportingManager.lastName || ''}`.trim() : '—'} accent="amber" />
      </div>

      {/* Tabs */}
      <div className="mt-6 flex items-center gap-2 p-1 rounded-2xl bg-slate-100 dark:bg-zinc-900 w-fit">
        <button
          type="button"
          onClick={() => setActiveTab('overview')}
          className={`px-5 py-2 rounded-xl text-sm font-semibold transition-all ${activeTab === 'overview' ? 'bg-white dark:bg-zinc-700 text-slate-900 dark:text-white shadow' : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200'}`}
        >
          Overview
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('kri-kpi')}
          className={`px-5 py-2 rounded-xl text-sm font-semibold transition-all flex items-center gap-1.5 ${activeTab === 'kri-kpi' ? 'bg-white dark:bg-zinc-700 text-slate-900 dark:text-white shadow' : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200'}`}
        >
          <HiOutlineSparkles className="w-4 h-4" />
          KRI · KPI
        </button>
      </div>

      {activeTab === 'overview' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
          {/* Bio */}
          <div className="lg:col-span-2 rounded-3xl border border-slate-200/60 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-6 sm:p-8 relative overflow-hidden">
            <FaQuoteLeft className="absolute top-4 right-4 w-12 h-12 text-slate-100 dark:text-zinc-800" />
            <h2 className="text-xs uppercase tracking-widest font-bold text-slate-400 dark:text-zinc-500 mb-3">About</h2>
            <p className="text-base leading-relaxed text-slate-700 dark:text-zinc-200 whitespace-pre-line">
              {employee.bio || `${employee.firstName} hasn’t added a bio yet. Once added it will appear here as a quick introduction.`}
            </p>
          </div>

          {/* Personal info card */}
          <div className="rounded-3xl border border-slate-200/60 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-6">
            <h2 className="text-xs uppercase tracking-widest font-bold text-slate-400 dark:text-zinc-500 mb-2">Contact & Personal</h2>
            <InfoRow icon={FaEnvelope} label="Email" value={employee.email} />
            <InfoRow icon={FaPhone} label="Phone" value={employee.phone} />
            <InfoRow icon={FaCalendarAlt} label="Date of Birth" value={employee.dateOfBirth ? new Date(employee.dateOfBirth).toLocaleDateString() : null} />
            <InfoRow icon={FaMapMarkerAlt} label="Address" value={employee.address} />
          </div>

          {/* Employment info card */}
          <div className="rounded-3xl border border-slate-200/60 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-6">
            <h2 className="text-xs uppercase tracking-widest font-bold text-slate-400 dark:text-zinc-500 mb-2">Employment</h2>
            <InfoRow icon={FaBriefcase} label="Designation" value={formatDesignation(employee.designation, employee)} />
            <InfoRow icon={FaBuilding} label="Department(s)" value={formatDepartments(employee)} />
            <InfoRow icon={FaCalendarAlt} label="Joined On" value={employee.dateOfJoining ? new Date(employee.dateOfJoining).toLocaleDateString() : null} />
            <InfoRow icon={FaBriefcase} label="Employment Type" value={employee.employmentType} />
            <InfoRow icon={FaMapMarkerAlt} label="Work Location" value={employee.workLocation} />
          </div>

          {/* Emergency */}
          {employee.emergencyContact && (
            <div className="rounded-3xl border border-slate-200/60 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-6">
              <h2 className="text-xs uppercase tracking-widest font-bold text-slate-400 dark:text-zinc-500 mb-2">Emergency Contact</h2>
              <InfoRow icon={FaUserFriends} label="Name" value={employee.emergencyContact.name} />
              <InfoRow icon={FaUserFriends} label="Relationship" value={employee.emergencyContact.relationship} />
              <InfoRow icon={FaPhone} label="Phone" value={employee.emergencyContact.phone} />
            </div>
          )}

          {/* Bank details */}
          {employee.bankDetails && (
            <div className="rounded-3xl border border-slate-200/60 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-6">
              <h2 className="text-xs uppercase tracking-widest font-bold text-slate-400 dark:text-zinc-500 mb-2">Bank Details</h2>
              <InfoRow icon={FaBuilding} label="Bank Name" value={employee.bankDetails.bankName} />
              <InfoRow icon={FaIdBadge} label="Account No." value={employee.bankDetails.accountNumber} />
              <InfoRow icon={FaIdBadge} label="IFSC" value={employee.bankDetails.ifscCode} />
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mt-6">
          {/* Manual KRIs */}
          <div className="rounded-3xl border border-slate-200/60 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-slate-800 dark:text-zinc-100 flex items-center gap-2">
                <FaListUl className="text-sky-500" /> Manual KRIs
              </h2>
              {canManageKriKpi && (
                <Button
                  size="sm"
                  color="primary"
                  variant="flat"
                  onPress={() => {
                    if (!newKri.trim()) return
                    setManualKRIs((prev) => [...prev, newKri.trim()])
                    setNewKri('')
                  }}
                  startContent={<FaPlus />}
                >
                  Add
                </Button>
              )}
            </div>
            {canManageKriKpi && (
              <input
                value={newKri}
                onChange={(e) => setNewKri(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 text-sm mb-3"
                placeholder="Add a key responsibility…"
              />
            )}
            <div className="space-y-2">
              {manualKRIs.map((kri, idx) => (
                <div
                  key={`${kri}-${idx}`}
                  className="flex items-start justify-between gap-3 px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-zinc-900 border border-slate-200/60 dark:border-zinc-800"
                >
                  <p className="text-sm text-slate-800 dark:text-zinc-200 flex-1">{kri}</p>
                  {canManageKriKpi && (
                    <Tooltip content="Remove" placement="top">
                      <button
                        type="button"
                        onClick={() => setManualKRIs((prev) => prev.filter((_, i) => i !== idx))}
                        className="text-rose-500 hover:text-rose-700 text-xs"
                      >
                        <FaTrash />
                      </button>
                    </Tooltip>
                  )}
                </div>
              ))}
              {manualKRIs.length === 0 && (
                <p className="text-sm text-slate-500 dark:text-zinc-400">No manual KRIs added yet.</p>
              )}
            </div>
          </div>

          {/* Manual KPIs */}
          <div className="rounded-3xl border border-slate-200/60 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-slate-800 dark:text-zinc-100 flex items-center gap-2">
                <FaBullseye className="text-amber-500" /> Manual KPIs
              </h2>
              {canManageKriKpi && (
                <Button
                  size="sm"
                  color="warning"
                  variant="flat"
                  onPress={() => {
                    if (!newKpi.name.trim()) return
                    setManualKPIs((prev) => [...prev, { ...newKpi, name: newKpi.name.trim() }])
                    setNewKpi({ name: '', target: '', unit: '', notes: '' })
                  }}
                  startContent={<FaPlus />}
                >
                  Add
                </Button>
              )}
            </div>
            {canManageKriKpi && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-3">
                <input value={newKpi.name} onChange={(e) => setNewKpi((p) => ({ ...p, name: e.target.value }))} className="px-3 py-2 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 text-sm" placeholder="KPI name" />
                <input value={newKpi.target} onChange={(e) => setNewKpi((p) => ({ ...p, target: e.target.value }))} className="px-3 py-2 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 text-sm" placeholder="Target" />
                <input value={newKpi.unit} onChange={(e) => setNewKpi((p) => ({ ...p, unit: e.target.value }))} className="px-3 py-2 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 text-sm" placeholder="Unit" />
                <input value={newKpi.notes} onChange={(e) => setNewKpi((p) => ({ ...p, notes: e.target.value }))} className="px-3 py-2 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 text-sm" placeholder="Notes" />
              </div>
            )}
            <div className="space-y-2">
              {manualKPIs.map((kpi, idx) => (
                <div
                  key={`${kpi.name}-${idx}`}
                  className="px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-zinc-900 border border-slate-200/60 dark:border-zinc-800"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <p className="font-semibold text-slate-800 dark:text-zinc-100 text-sm">{kpi.name}</p>
                      <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
                        Target: <span className="font-semibold text-slate-700 dark:text-zinc-300">{kpi.target || 'N/A'} {kpi.unit || ''}</span>
                      </p>
                      {kpi.notes && <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1 italic">{kpi.notes}</p>}
                    </div>
                    {canManageKriKpi && (
                      <Tooltip content="Remove" placement="top">
                        <button
                          type="button"
                          onClick={() => setManualKPIs((prev) => prev.filter((_, i) => i !== idx))}
                          className="text-rose-500 hover:text-rose-700 text-xs"
                        >
                          <FaTrash />
                        </button>
                      </Tooltip>
                    )}
                  </div>
                </div>
              ))}
              {manualKPIs.length === 0 && (
                <p className="text-sm text-slate-500 dark:text-zinc-400">No manual KPIs added yet.</p>
              )}
            </div>
          </div>

          {/* AI suggested */}
          <div className="xl:col-span-2 rounded-3xl border border-slate-200/60 dark:border-zinc-800 bg-gradient-to-br from-indigo-50/60 to-fuchsia-50/40 dark:from-indigo-950/30 dark:to-fuchsia-950/20 p-6">
            <h2 className="text-base font-bold text-slate-800 dark:text-zinc-100 flex items-center gap-2 mb-4">
              <HiOutlineSparkles className="text-indigo-500" /> AI Suggested KRIs
            </h2>
            {aiGeneratedKRIs.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-zinc-400">
                No AI-generated responsibilities yet. They will be created automatically when this employee is added or promoted.
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {aiGeneratedKRIs.map((kri, idx) => (
                  <div
                    key={`${kri.title}-${idx}`}
                    className="p-4 rounded-2xl bg-white/80 dark:bg-zinc-900/80 border border-white/60 dark:border-zinc-800/60 backdrop-blur"
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <p className="font-semibold text-slate-800 dark:text-zinc-100 text-sm">{kri.title}</p>
                      <Chip size="sm" variant="flat" color={kri.importance === 'high' ? 'danger' : kri.importance === 'medium' ? 'warning' : 'default'}>
                        {kri.importance || 'medium'}
                      </Chip>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-zinc-400 leading-relaxed">{kri.description}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {canManageKriKpi && (
            <div className="xl:col-span-2 flex justify-end">
              <Button color="primary" onPress={handleSaveKriKpi} isLoading={savingKriKpi} startContent={!savingKriKpi ? <FaSave /> : undefined}>
                Save KRIs &amp; KPIs
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
