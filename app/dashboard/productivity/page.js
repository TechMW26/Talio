'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Button,
  Tabs,
  Tab,
  Skeleton,
  Modal,
  ModalContent,
  ModalBody,
} from '@heroui/react'
import {
  HiOutlineSparkles,
  HiOutlineChevronLeft,
  HiOutlineChevronRight,
  HiOutlinePhoto,
  HiOutlineCalendarDays,
  HiOutlineXMark,
  HiOutlineArrowPath,
  HiOutlineUser,
  HiOutlineUsers,
  HiOutlineTrophy,
  HiOutlineExclamationCircle,
  HiOutlineChartBar,
  HiOutlineMagnifyingGlass,
  HiOutlineComputerDesktop,
} from 'react-icons/hi2'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import { useAILoading } from '@/contexts/AILoadingContext'

/* ------------------------------------------------------------------ */
/* Small presentational helpers (matched to meetings page styling)    */
/* ------------------------------------------------------------------ */

function getScoreTone(score) {
  if (score == null) return { text: 'text-gray-500', bg: 'bg-gray-100' }
  if (score >= 80) return { text: 'text-green-700', bg: 'bg-green-100' }
  if (score >= 60) return { text: 'text-blue-700', bg: 'bg-blue-100' }
  if (score >= 40) return { text: 'text-amber-700', bg: 'bg-amber-100' }
  return { text: 'text-red-700', bg: 'bg-red-100' }
}

function ScorePill({ score, label = 'Score' }) {
  if (score == null) return null
  const tone = getScoreTone(score)
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${tone.bg} ${tone.text}`}>
      {label} {score}/100
    </span>
  )
}

function StatCard({ icon: Icon, label, value, iconBg = 'bg-blue-100', iconText = 'text-blue-600' }) {
  return (
    <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${iconBg}`}>
          <Icon className={`w-5 h-5 ${iconText}`} />
        </div>
        <div>
          <p className="text-2xl font-bold text-gray-800">{value}</p>
          <p className="text-sm text-gray-500">{label}</p>
        </div>
      </div>
    </div>
  )
}

function ScreenshotTile({ shot, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative aspect-video overflow-hidden rounded-xl border border-gray-100 bg-gray-50 shadow-sm transition hover:shadow-md hover:border-indigo-300"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={shot.imageUrl}
        alt={shot.formattedTime}
        className="size-full object-cover"
        loading="lazy"
      />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/70 via-black/30 to-transparent px-2 py-1.5 text-[11px] text-white">
        <span>{shot.formattedTime}</span>
        {shot.analyzed ? (
          <span className="rounded bg-green-500/90 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">Analyzed</span>
        ) : (
          <span className="rounded bg-amber-500/90 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">Pending</span>
        )}
      </div>
    </button>
  )
}

function ScreenshotGrid({ screenshots, emptyHint, onPick }) {
  if (screenshots.length === 0) {
    return (
      <div className="text-center py-10 bg-white rounded-xl shadow-sm border border-dashed border-gray-200">
        <HiOutlinePhoto className="w-10 h-10 mx-auto text-gray-300 mb-2" />
        <p className="text-sm text-gray-500">{emptyHint}</p>
      </div>
    )
  }
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {screenshots.map((s) => (
        <ScreenshotTile key={s.id} shot={s} onClick={() => onPick(s)} />
      ))}
    </div>
  )
}

function ListBlock({ title, items, icon: Icon, iconColor = 'text-indigo-500' }) {
  if (!items || items.length === 0) return null
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-700">
        {Icon ? <Icon className={`w-4 h-4 ${iconColor}`} /> : null}
        <span>{title}</span>
      </div>
      <ul className="space-y-1.5">
        {items.map((item, i) => (
          <li key={i} className="rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-700 border border-gray-100">
            {item}
          </li>
        ))}
      </ul>
    </div>
  )
}

function TimeDistribution({ td }) {
  if (!td) return null
  const entries = [
    ['Deep Work', td.deepWork, 'bg-green-500'],
    ['Collaboration', td.collaboration, 'bg-blue-500'],
    ['Administrative', td.administrative, 'bg-purple-500'],
    ['Unfocused', td.unfocused, 'bg-amber-500'],
    ['Idle', td.idle, 'bg-red-500'],
  ].filter(([, v]) => Number.isFinite(Number(v)))
  if (entries.length === 0) return null
  return (
    <div>
      <div className="mb-2 text-sm font-semibold text-gray-700">Time Distribution</div>
      <div className="space-y-2">
        {entries.map(([label, value, bar]) => (
          <div key={label}>
            <div className="mb-1 flex justify-between text-xs text-gray-600">
              <span>{label}</span>
              <span>{value}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
              <div className={`h-full ${bar}`} style={{ width: `${Math.min(100, Math.max(0, Number(value) || 0))}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function AnalysisCard({ analysis, lastAnalyzedAt }) {
  if (!analysis) return null
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="p-5 bg-gradient-to-r from-indigo-50 via-white to-white border-b border-gray-100">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
              <HiOutlineSparkles className="w-5 h-5 text-indigo-600" />
              {analysis.sessionTitle || 'MIRA Daily Analysis'}
            </h3>
            {lastAnalyzedAt ? (
              <p className="mt-0.5 text-xs text-gray-500">
                Last analyzed {new Date(lastAnalyzedAt).toLocaleString()}
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <ScorePill score={analysis.score} />
            {analysis.focusScore != null ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-3 py-1 text-xs font-semibold text-indigo-700">
                Focus {analysis.focusScore}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="p-5 space-y-5">
        {analysis.summary ? (
          <p className="whitespace-pre-line text-sm leading-relaxed text-gray-700">{analysis.summary}</p>
        ) : null}

        <TimeDistribution td={analysis.timeDistribution} />

        <div className="grid gap-4 md:grid-cols-2">
          <ListBlock title="Achievements" items={analysis.achievements} icon={HiOutlineTrophy} iconColor="text-green-500" />
          <ListBlock title="Suggestions" items={analysis.suggestions} icon={HiOutlineChartBar} iconColor="text-blue-500" />
          <ListBlock title="Insights" items={analysis.insights} icon={HiOutlineSparkles} iconColor="text-purple-500" />
          <ListBlock title="Concerns" items={analysis.concerns} icon={HiOutlineExclamationCircle} iconColor="text-amber-500" />
        </div>

        {analysis.redFlags?.length ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3">
            <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-red-700">
              <HiOutlineExclamationCircle className="w-4 h-4" />
              Red Flags
            </div>
            <ul className="list-disc space-y-1 pl-5 text-sm text-red-700">
              {analysis.redFlags.map((rf, i) => (<li key={i}>{rf}</li>))}
            </ul>
          </div>
        ) : null}

        {analysis.overallAssessment?.recommendation ? (
          <div className="rounded-md border border-gray-100 bg-gray-50 p-3 text-sm">
            <div className="mb-1 font-semibold text-gray-700">Overall Recommendation</div>
            <p className="text-gray-600">{analysis.overallAssessment.recommendation}</p>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function Lightbox({ shot, onClose }) {
  if (!shot) return null
  return (
    <Modal isOpen={!!shot} onClose={onClose} size="4xl" backdrop="blur" scrollBehavior="inside">
      <ModalContent>
        {(close) => (
          <ModalBody className="p-2">
            <div className="flex items-center justify-between px-2 pb-2">
              <div className="text-sm font-medium text-gray-700">
                {shot.formattedTime}
                {shot.analyzed ? <span className="ml-2 rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-green-700">Analyzed</span>
                  : <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-700">Pending</span>}
              </div>
              <Button isIconOnly variant="light" size="sm" onPress={close}>
                <HiOutlineXMark className="w-5 h-5" />
              </Button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={shot.imageUrl} alt={shot.formattedTime} className="mx-auto max-h-[78vh] w-auto rounded-md" />
          </ModalBody>
        )}
      </ModalContent>
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* Main page                                                          */
/* ------------------------------------------------------------------ */

export default function ProductivityPage() {
  const [user, setUser] = useState(null)
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0])
  const [activeTab, setActiveTab] = useState('my')
  const [selectedTeamUserId, setSelectedTeamUserId] = useState(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [lightbox, setLightbox] = useState(null)
  const [teamSearch, setTeamSearch] = useState('')

  const { startAILoading, stopAILoading } = useAILoading()

  useEffect(() => {
    try {
      const data = localStorage.getItem('user')
      if (data) setUser(JSON.parse(data))
    } catch (_) { /* ignore */ }
  }, [])

  const userRole = user?.role
  const isAdminOrHR = ['admin', 'hr'].includes(userRole)
  const { data: deptHeadRes } = useAuthedSWR(user ? '/api/team/check-head' : null)
  const isDepartmentHead = !!deptHeadRes?.isDepartmentHead
  const isTeamLeader = !!deptHeadRes?.isTeamLeader
  const canViewTeam = isAdminOrHR || isDepartmentHead || isTeamLeader

  // Default admins to the team tab
  useEffect(() => {
    if (userRole === 'admin') setActiveTab('team')
  }, [userRole])

  const targetUserId = activeTab === 'team' ? (selectedTeamUserId || null) : (user?._id || user?.userId || null)

  const dailyKey = useMemo(() => {
    if (activeTab === 'team' && !selectedTeamUserId) return null
    if (!targetUserId && activeTab === 'my') return null
    if (activeTab === 'my') return `/api/productivity/daily?date=${selectedDate}`
    return `/api/productivity/daily?date=${selectedDate}&userId=${selectedTeamUserId}`
  }, [activeTab, selectedDate, selectedTeamUserId, targetUserId])

  const { data: dailyRes, isLoading: dailyLoading, isValidating: dailyValidating, mutate: mutateDaily } = useAuthedSWR(dailyKey)

  const teamUrl = useMemo(() => {
    if (!canViewTeam || activeTab !== 'team') return null
    return `/api/productivity/team?date=${selectedDate}`
  }, [canViewTeam, activeTab, selectedDate])
  const { data: teamRes, isLoading: teamLoading, mutate: mutateTeam } = useAuthedSWR(teamUrl)

  const screenshots = dailyRes?.screenshots || []
  const analysis = dailyRes?.analysis?.aiAnalysis || null
  const lastAnalyzedAt = dailyRes?.analysis?.lastAnalyzedAt || null
  const stats = dailyRes?.stats || { total: 0, analyzed: 0, pending: 0 }
  const pendingShots = screenshots.filter((s) => !s.analyzed)
  const analyzedShots = screenshots.filter((s) => s.analyzed)
  const today = new Date().toISOString().split('T')[0]
  const isFutureDisabled = selectedDate >= today

  const changeDate = (delta) => {
    const d = new Date(selectedDate)
    d.setDate(d.getDate() + delta)
    setSelectedDate(d.toISOString().split('T')[0])
  }

  const handleAnalyze = useCallback(async () => {
    if (!dailyKey || analyzing) return
    setAnalyzing(true)
    startAILoading('MIRA is analyzing today\u2019s screenshots...')
    try {
      const token = localStorage.getItem('token')
      const body = { date: selectedDate }
      if (activeTab === 'team' && selectedTeamUserId) body.userId = selectedTeamUserId
      const res = await fetch('/api/productivity/daily/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data?.success === false) {
        console.error('Daily analyze failed:', data)
      }
      await mutateDaily()
      if (activeTab === 'team') await mutateTeam()
    } catch (err) {
      console.error('Daily analyze error:', err)
    } finally {
      stopAILoading()
      setAnalyzing(false)
    }
  }, [dailyKey, analyzing, selectedDate, activeTab, selectedTeamUserId, mutateDaily, mutateTeam, startAILoading, stopAILoading])

  /* -------------------- Team list -------------------- */

  const teamMembers = useMemo(() => {
    const list = teamRes?.data || []
    if (!teamSearch.trim()) return list
    const q = teamSearch.trim().toLowerCase()
    return list.filter((m) => {
      const name = `${m.firstName || ''} ${m.lastName || ''} ${m.email || ''}`.toLowerCase()
      return name.includes(q)
    })
  }, [teamRes, teamSearch])

  const renderTeamGrid = () => (
    <div className="space-y-4">
      {/* Filters / search bar — matches meetings filter card */}
      <div className="bg-white rounded-lg shadow-md p-4">
        <div className="flex flex-col md:flex-row gap-4 md:items-center md:justify-between">
          <div className="flex items-center gap-2 text-gray-600">
            <HiOutlineUsers className="w-5 h-5 text-indigo-600" />
            <span className="text-sm font-medium">
              {teamMembers.length} team member{teamMembers.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="input-with-icon md:w-80">
            <HiOutlineMagnifyingGlass className="input-icon w-5 h-5" />
            <input
              type="text"
              value={teamSearch}
              onChange={(e) => setTeamSearch(e.target.value)}
              placeholder="Search team..."
              className="input input-search"
            />
          </div>
        </div>
      </div>

      {teamLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 space-y-3">
              <Skeleton className="h-4 w-3/4 rounded" />
              <Skeleton className="h-3 w-1/2 rounded" />
              <Skeleton className="h-3 w-2/3 rounded" />
            </div>
          ))}
        </div>
      ) : teamMembers.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl shadow-sm border border-gray-100">
          <HiOutlineUsers className="w-16 h-16 mx-auto text-gray-300 mb-4" />
          <h3 className="text-lg font-medium text-gray-800 mb-2">No team members found</h3>
          <p className="text-gray-500">Try adjusting your search or pick a different date.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {teamMembers.map((m) => {
            const memberStats = m.dailyStats || m.sessionsSummary || {}
            const total = memberStats.totalCaptures ?? memberStats.totalScreenshots ?? memberStats.totalSessions ?? 0
            const analyzed = memberStats.analyzedCaptures ?? memberStats.analyzedScreenshots ?? 0
            const score = memberStats.score ?? memberStats.avgScore ?? null
            return (
              <button
                key={m.userId || m._id}
                type="button"
                onClick={() => setSelectedTeamUserId(m.userId || m._id)}
                className="bg-white rounded-xl shadow-sm p-4 border border-gray-100 text-left transition hover:shadow-md hover:border-indigo-200"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-gray-800 truncate">
                      {`${m.firstName || ''} ${m.lastName || ''}`.trim() || m.email}
                    </div>
                    <div className="text-xs text-gray-500 truncate">{m.designation || m.email}</div>
                  </div>
                  {score != null ? <ScorePill score={score} /> : null}
                </div>
                <div className="mt-3 flex items-center gap-4 text-xs text-gray-500">
                  <span className="flex items-center gap-1">
                    <HiOutlinePhoto className="w-4 h-4" /> {total} captures
                  </span>
                  <span className="flex items-center gap-1">
                    <HiOutlineSparkles className="w-4 h-4" /> {analyzed} analyzed
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )

  /* -------------------- Render -------------------- */

  const showDailyBody = activeTab === 'my' || (activeTab === 'team' && selectedTeamUserId)

  return (
    <div className="page-container">
      {/* Header — matches meetings page header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <HiOutlineComputerDesktop className="w-7 h-7 text-indigo-600" />
            Productivity
          </h1>
          <p className="text-gray-600 mt-1">
            Screenshots from your work day, analyzed by MIRA.
          </p>
        </div>

        {/* Date picker bar (right side, like the "Schedule Meeting" CTA position) */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => changeDate(-1)}
            aria-label="Previous day"
            className="p-2 rounded-lg border border-gray-200 hover:bg-gray-100"
          >
            <HiOutlineChevronLeft className="w-5 h-5 text-gray-600" />
          </button>
          <div className="flex items-center gap-2 px-3 py-2 bg-white rounded-lg border border-gray-200 shadow-sm">
            <HiOutlineCalendarDays className="w-4 h-4 text-gray-500" />
            <input
              type="date"
              value={selectedDate}
              max={today}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="bg-transparent text-sm text-gray-700 focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={() => changeDate(1)}
            disabled={isFutureDisabled}
            aria-label="Next day"
            className="p-2 rounded-lg border border-gray-200 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
          >
            <HiOutlineChevronRight className="w-5 h-5 text-gray-600" />
          </button>
        </div>
      </div>

      {/* Stats Cards — same layout/treatment as meetings */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard
          icon={HiOutlinePhoto}
          label="Total Captures"
          value={stats.total}
          iconBg="bg-blue-100"
          iconText="text-blue-600"
        />
        <StatCard
          icon={HiOutlineSparkles}
          label="Analyzed"
          value={stats.analyzed}
          iconBg="bg-green-100"
          iconText="text-green-600"
        />
        <StatCard
          icon={HiOutlineExclamationCircle}
          label="Pending"
          value={stats.pending}
          iconBg="bg-amber-100"
          iconText="text-amber-600"
        />
        <StatCard
          icon={HiOutlineChartBar}
          label="Score"
          value={analysis?.score ?? '—'}
          iconBg="bg-purple-100"
          iconText="text-purple-600"
        />
      </div>

      {/* Tabs */}
      {canViewTeam ? (
        <div className="bg-white rounded-lg shadow-md p-2 mb-6">
          <Tabs
            selectedKey={activeTab}
            onSelectionChange={(k) => { setActiveTab(k); setSelectedTeamUserId(null); }}
            variant="light"
          >
            <Tab key="my" title={(<span className="flex items-center gap-1.5"><HiOutlineUser className="w-4 h-4" /> My Day</span>)} />
            <Tab key="team" title={(<span className="flex items-center gap-1.5"><HiOutlineUsers className="w-4 h-4" /> Team</span>)} />
          </Tabs>
        </div>
      ) : null}

      {/* Team grid (when in team tab and no member selected) */}
      {activeTab === 'team' && !selectedTeamUserId ? (
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-2">
            <HiOutlineUsers className="w-5 h-5 text-indigo-500" />
            Team
          </h2>
          {renderTeamGrid()}
        </div>
      ) : null}

      {/* Selected team-member back button */}
      {activeTab === 'team' && selectedTeamUserId ? (
        <div className="mb-4">
          <Button
            variant="flat"
            size="sm"
            onPress={() => setSelectedTeamUserId(null)}
            startContent={<HiOutlineChevronLeft className="w-4 h-4" />}
          >
            Back to team
          </Button>
        </div>
      ) : null}

      {/* Daily body */}
      {showDailyBody ? (
        <div className="space-y-6">
          {/* Action bar — sits in a meetings-style filter card */}
          <div className="bg-white rounded-lg shadow-md p-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="text-sm text-gray-600">
                {dailyRes?.user ? (
                  <span className="flex items-center gap-2">
                    <HiOutlineUser className="w-4 h-4 text-indigo-500" />
                    Viewing:&nbsp;
                    <span className="font-semibold text-gray-800">
                      {dailyRes.user.name || dailyRes.user.email}
                    </span>
                  </span>
                ) : (
                  <span className="text-gray-500">Captures are taken every 3 minutes during configured office hours.</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => mutateDaily()}
                  className="p-2 rounded-lg border border-gray-200 hover:bg-gray-100"
                  aria-label="Refresh"
                >
                  <HiOutlineArrowPath className={`w-5 h-5 text-gray-600 ${dailyValidating && !dailyLoading ? 'animate-spin' : ''}`} />
                </button>
                <Button
                  color="primary"
                  onPress={handleAnalyze}
                  isLoading={analyzing}
                  isDisabled={analyzing || stats.pending === 0}
                  startContent={!analyzing ? <HiOutlineSparkles className="w-5 h-5" /> : null}
                >
                  {analysis
                    ? `Analyse ${stats.pending} new with MIRA`
                    : `Analyse ${stats.pending} captures with MIRA`}
                </Button>
              </div>
            </div>
          </div>

          {/* Loading skeleton */}
          {dailyLoading ? (
            <div className="space-y-4">
              <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 space-y-3">
                <Skeleton className="h-5 w-1/3 rounded" />
                <Skeleton className="h-4 w-2/3 rounded" />
                <Skeleton className="h-3 w-full rounded" />
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {[...Array(10)].map((_, i) => (
                  <Skeleton key={i} className="aspect-video rounded-xl" />
                ))}
              </div>
            </div>
          ) : (
            <>
              {/* Analysis card */}
              <AnalysisCard analysis={analysis} lastAnalyzedAt={lastAnalyzedAt} />

              {/* Pending captures */}
              {pendingShots.length > 0 ? (
                <div>
                  <h2 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-2">
                    <HiOutlineExclamationCircle className="w-5 h-5 text-amber-500" />
                    Pending Captures ({pendingShots.length})
                  </h2>
                  <ScreenshotGrid
                    screenshots={pendingShots}
                    emptyHint="No pending captures."
                    onPick={setLightbox}
                  />
                </div>
              ) : null}

              {/* Analyzed captures */}
              {analyzedShots.length > 0 ? (
                <div>
                  <h2 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-2">
                    <HiOutlineSparkles className="w-5 h-5 text-green-500" />
                    Analyzed Captures ({analyzedShots.length})
                  </h2>
                  <ScreenshotGrid
                    screenshots={analyzedShots}
                    emptyHint="No analyzed captures yet."
                    onPick={setLightbox}
                  />
                </div>
              ) : null}

              {/* Truly empty */}
              {screenshots.length === 0 ? (
                <div className="text-center py-12 bg-white rounded-xl shadow-sm border border-gray-100">
                  <HiOutlinePhoto className="w-16 h-16 mx-auto text-gray-300 mb-4" />
                  <h3 className="text-lg font-medium text-gray-800 mb-2">No captures for this day</h3>
                  <p className="text-gray-500">
                    Screenshots are captured every 3 minutes during your company&apos;s office hours.
                  </p>
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      <Lightbox shot={lightbox} onClose={() => setLightbox(null)} />
    </div>
  )
}
