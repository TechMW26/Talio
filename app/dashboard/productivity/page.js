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
import AnalyzedComposite from '@/components/productivity/AnalyzedComposite'
import { getDateKeyInTimezone, getTodayDateString } from '@/lib/timezone'

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

function ScoreTile({ label, value, accent = 'green' }) {
  if (value == null || value === '') return null
  const palette = {
    green: 'bg-green-50 text-green-700 border-green-100',
    blue: 'bg-blue-50 text-blue-700 border-blue-100',
    amber: 'bg-amber-50 text-amber-700 border-amber-100',
    purple: 'bg-purple-50 text-purple-700 border-purple-100',
    red: 'bg-red-50 text-red-700 border-red-100',
    indigo: 'bg-indigo-50 text-indigo-700 border-indigo-100',
  }[accent] || 'bg-gray-50 text-gray-700 border-gray-100'
  return (
    <div className={`rounded-lg border p-4 text-center ${palette}`}>
      <div className="text-3xl font-bold">{value}</div>
      <div className="mt-1 text-xs font-medium uppercase tracking-wide opacity-80">{label}</div>
    </div>
  )
}

function MetricTile({ label, value, accent = 'indigo' }) {
  if (value == null || value === '') return null
  const palette = {
    indigo: 'bg-indigo-50 text-indigo-700 border-indigo-100',
    amber: 'bg-amber-50 text-amber-700 border-amber-100',
    red: 'bg-red-50 text-red-700 border-red-100',
    green: 'bg-green-50 text-green-700 border-green-100',
  }[accent] || 'bg-gray-50 text-gray-700 border-gray-100'
  return (
    <div className={`rounded-lg border p-4 text-center ${palette}`}>
      <div className="text-xl font-bold leading-tight">{value}</div>
      <div className="mt-1 text-xs font-medium uppercase tracking-wide opacity-80">{label}</div>
    </div>
  )
}

function PercentBar({ label, value, color = 'bg-blue-500' }) {
  const pct = Math.min(100, Math.max(0, Number(value) || 0))
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs text-gray-600">
        <span className="font-medium text-gray-700">{label}</span>
        <span>{pct}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function BulletList({ title, items, icon: Icon, iconColor = 'text-indigo-500', tone = 'gray', bullet = 'check' }) {
  if (!items || items.length === 0) return null
  const toneClass = {
    gray: 'text-gray-700',
    green: 'text-green-700',
    red: 'text-red-700',
    amber: 'text-amber-700',
    blue: 'text-blue-700',
    purple: 'text-purple-700',
  }[tone] || 'text-gray-700'
  return (
    <div>
      <div className={`mb-2 flex items-center gap-2 text-sm font-semibold ${toneClass}`}>
        {Icon ? <Icon className={`w-4 h-4 ${iconColor}`} /> : null}
        <span>{title}</span>
      </div>
      <ul className="space-y-1.5">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
            <span className={`mt-0.5 inline-block ${bullet === 'dot' ? 'h-1.5 w-1.5 rounded-full bg-current opacity-60' : ''}`}>
              {bullet === 'check' ? '✓' : bullet === 'warn' ? '!' : ''}
            </span>
            <span className="flex-1">{typeof item === 'string' ? item : (item?.text || JSON.stringify(item))}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Chips({ items, color = 'indigo' }) {
  if (!items || items.length === 0) return null
  const palette = {
    indigo: 'bg-indigo-50 text-indigo-700 border-indigo-100',
    green: 'bg-green-50 text-green-700 border-green-100',
    red: 'bg-red-50 text-red-700 border-red-100',
    amber: 'bg-amber-50 text-amber-700 border-amber-100',
    blue: 'bg-blue-50 text-blue-700 border-blue-100',
  }[color] || 'bg-gray-50 text-gray-700 border-gray-100'
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((it, i) => (
        <span key={i} className={`rounded-full border px-3 py-1 text-xs font-medium ${palette}`}>
          {it}
        </span>
      ))}
    </div>
  )
}

function SectionTitle({ icon: Icon, children, iconColor = 'text-indigo-500' }) {
  return (
    <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-700">
      {Icon ? <Icon className={`w-4 h-4 ${iconColor}`} /> : null}
      <span>{children}</span>
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
  ].filter(([, v]) => Number.isFinite(Number(v)) && Number(v) > 0)
  if (entries.length === 0) return null
  return (
    <div>
      <SectionTitle icon={HiOutlineChartBar} iconColor="text-blue-500">Time Distribution</SectionTitle>
      <div className="space-y-2">
        {entries.map(([label, value, bar]) => (
          <PercentBar key={label} label={label} value={value} color={bar} />
        ))}
      </div>
    </div>
  )
}

function WorkBreakdown({ categories }) {
  if (!Array.isArray(categories) || categories.length === 0) return null
  const palette = ['bg-indigo-500', 'bg-blue-500', 'bg-purple-500', 'bg-amber-500', 'bg-red-500', 'bg-green-500']
  const filtered = categories
    .filter((c) => Number.isFinite(Number(c?.percentage)) && Number(c.percentage) > 0)
    .slice(0, 6)
  if (filtered.length === 0) return null
  return (
    <div>
      <SectionTitle icon={HiOutlineComputerDesktop} iconColor="text-indigo-500">Work Breakdown</SectionTitle>
      <div className="space-y-2">
        {filtered.map((c, i) => (
          <PercentBar key={c.category || i} label={c.category || 'Unknown'} value={c.percentage} color={palette[i % palette.length]} />
        ))}
      </div>
    </div>
  )
}

function AppsList({ applications }) {
  if (!Array.isArray(applications) || applications.length === 0) return null
  const items = applications.slice(0, 8).map((a) => {
    const name = a?.name || a
    const mins = Number(a?.estimatedMinutes)
    return Number.isFinite(mins) && mins > 0 ? `${name} (${mins}m)` : `${name}`
  })
  return (
    <div>
      <SectionTitle icon={HiOutlineComputerDesktop} iconColor="text-green-500">Applications Used</SectionTitle>
      <Chips items={items} color="green" />
    </div>
  )
}

function SitesList({ websites }) {
  if (!Array.isArray(websites) || websites.length === 0) return null
  const items = websites.slice(0, 8).map((w) => {
    const dom = w?.domain || w
    const mins = Number(w?.estimatedMinutes)
    return Number.isFinite(mins) && mins > 0 ? `${dom} (${mins}m)` : `${dom}`
  })
  return (
    <div>
      <SectionTitle icon={HiOutlineMagnifyingGlass} iconColor="text-blue-500">Websites Visited</SectionTitle>
      <Chips items={items} color="blue" />
    </div>
  )
}

function AnalysisCard({ analysis, lastAnalyzedAt }) {
  if (!analysis) return null
  const oa = analysis.overallAssessment || {}
  const fm = analysis.focusMetrics || {}
  const taskAlignment = oa.taskAlignmentPercentage
  const genuineWork = oa.genuineWorkPercentage

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      {/* Header — flat (no gradient) */}
      <div className="p-5 border-b border-gray-100">
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

      <div className="p-5 space-y-6">
        {/* Score tiles row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <ScoreTile label="Productivity" value={analysis.score ?? null} accent="green" />
          <ScoreTile label="Focus" value={analysis.focusScore ?? null} accent="blue" />
          <ScoreTile label="Task Progress" value={analysis.taskCompletionIndicators ?? null} accent="amber" />
        </div>

        {/* AI Summary */}
        {analysis.summary ? (
          <div>
            <SectionTitle icon={HiOutlineSparkles} iconColor="text-indigo-500">AI Summary</SectionTitle>
            <p className="whitespace-pre-line rounded-lg border border-gray-100 bg-gray-50 p-3 text-sm leading-relaxed text-gray-700">
              {analysis.summary}
            </p>
          </div>
        ) : null}

        {/* Task Alignment banner */}
        {Number.isFinite(Number(taskAlignment)) ? (
          <div className="rounded-lg border border-purple-100 bg-purple-50 p-4">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-purple-700">
                <HiOutlineTrophy className="w-4 h-4" />
                Task Alignment
              </div>
              <span className="text-sm font-bold text-purple-700">{Number(taskAlignment)}%</span>
            </div>
            {analysis.taskRelativity?.assessment ? (
              <p className="text-sm text-gray-700">{analysis.taskRelativity.assessment}</p>
            ) : null}
          </div>
        ) : null}

        {/* Time distribution */}
        <TimeDistribution td={analysis.timeDistribution} />

        {/* Focus metric tiles */}
        {(fm.longestFocusStreak || fm.contextSwitches != null || fm.distractionCount != null) ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <MetricTile label="Focus Streak" value={fm.longestFocusStreak || '—'} accent="indigo" />
            <MetricTile label="Context Switches" value={fm.contextSwitches ?? '—'} accent="amber" />
            <MetricTile label="Distractions" value={fm.distractionCount ?? '—'} accent="red" />
          </div>
        ) : null}

        {/* Work breakdown */}
        <WorkBreakdown categories={analysis.workCategories} />

        {/* Achievements + Suggestions */}
        <div className="grid gap-4 md:grid-cols-2">
          <BulletList
            title="Achievements"
            items={analysis.achievements}
            icon={HiOutlineTrophy}
            iconColor="text-green-500"
            tone="green"
            bullet="check"
          />
          <BulletList
            title="Suggestions for Improvement"
            items={analysis.suggestions}
            icon={HiOutlineChartBar}
            iconColor="text-blue-500"
            tone="blue"
            bullet="dot"
          />
        </div>

        {/* Strengths + Concerns + Improvements */}
        <div className="grid gap-4 md:grid-cols-3">
          <BulletList
            title="Strengths"
            items={oa.strengths}
            icon={HiOutlineSparkles}
            iconColor="text-green-500"
            tone="green"
            bullet="check"
          />
          <BulletList
            title="Major Concerns"
            items={oa.majorConcerns}
            icon={HiOutlineExclamationCircle}
            iconColor="text-red-500"
            tone="red"
            bullet="warn"
          />
          <BulletList
            title="Areas for Improvement"
            items={oa.areasForImprovement}
            icon={HiOutlineChartBar}
            iconColor="text-amber-500"
            tone="amber"
            bullet="dot"
          />
        </div>

        {/* Insights */}
        <BulletList
          title="Key Insights"
          items={analysis.insights}
          icon={HiOutlineSparkles}
          iconColor="text-purple-500"
          tone="purple"
          bullet="dot"
        />

        {/* Red flags */}
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

        {/* Apps & sites */}
        <div className="grid gap-4 md:grid-cols-2">
          <AppsList applications={analysis.applications} />
          <SitesList websites={analysis.websites} />
        </div>

        {/* Genuine work + recommendation */}
        {(Number.isFinite(Number(genuineWork)) || oa.recommendation) ? (
          <div className="rounded-lg border border-indigo-100 bg-indigo-50/40 p-4 space-y-3">
            {Number.isFinite(Number(genuineWork)) ? (
              <PercentBar label="Genuine Work" value={genuineWork} color="bg-green-500" />
            ) : null}
            {oa.recommendation ? (
              <div>
                <div className="mb-1 text-sm font-semibold text-indigo-700">Recommendation</div>
                <p className="text-sm italic text-gray-700">{oa.recommendation}</p>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function Lightbox({ shots, index, onClose, onIndexChange }) {
  const total = shots?.length || 0
  // `index` is null when closed. Treat any non-numeric / out-of-range value
  // as closed so calling `onClose()` (which sets index = null) actually hides
  // the modal instead of rendering shots[0].
  const isOpenRequest = typeof index === 'number' && index >= 0 && index < total
  const safeIndex = isOpenRequest ? index : 0
  const shot = isOpenRequest ? shots[safeIndex] : null
  const open = !!shot

  // Keyboard navigation: ←/→ to change image, Esc handled by Modal itself.
  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (e.key === 'ArrowLeft' && safeIndex > 0) onIndexChange(safeIndex - 1)
      else if (e.key === 'ArrowRight' && safeIndex < total - 1) onIndexChange(safeIndex + 1)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, safeIndex, total, onIndexChange])

  if (!shot) return null

  const goPrev = () => safeIndex > 0 && onIndexChange(safeIndex - 1)
  const goNext = () => safeIndex < total - 1 && onIndexChange(safeIndex + 1)

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      size="full"
      backdrop="blur"
      hideCloseButton
      classNames={{
        wrapper: 'items-center justify-center',
        base: 'bg-transparent shadow-none m-0 max-w-none',
      }}
    >
      <ModalContent>
        <ModalBody className="p-0 flex items-center justify-center">
          <div className="relative w-[90vw] h-[90vh] flex items-center justify-center">
            {/* Header overlay */}
            <div className="absolute top-3 left-4 right-4 z-20 flex items-center justify-between">
              <div className="flex items-center gap-2 rounded-full bg-black/50 px-3 py-1.5 text-sm font-medium text-white backdrop-blur">
                <span>{shot.formattedTime}</span>
                {shot.analyzed
                  ? <span className="rounded bg-green-500/90 px-1.5 py-0.5 text-[10px] font-semibold uppercase">Analyzed</span>
                  : <span className="rounded bg-amber-500/90 px-1.5 py-0.5 text-[10px] font-semibold uppercase">Pending</span>}
                {total > 1 ? (
                  <span className="text-xs text-white/70 ml-1">{safeIndex + 1} / {total}</span>
                ) : null}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="rounded-full bg-black/50 p-2 text-white hover:bg-black/70 backdrop-blur transition"
              >
                <HiOutlineXMark className="w-5 h-5" />
              </button>
            </div>

            {/* Prev arrow */}
            {total > 1 ? (
              <button
                type="button"
                onClick={goPrev}
                disabled={safeIndex === 0}
                aria-label="Previous screenshot"
                className="absolute left-4 z-20 rounded-full bg-black/50 p-3 text-white hover:bg-black/70 backdrop-blur transition disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <HiOutlineChevronLeft className="w-6 h-6" />
              </button>
            ) : null}

            {/* Next arrow */}
            {total > 1 ? (
              <button
                type="button"
                onClick={goNext}
                disabled={safeIndex === total - 1}
                aria-label="Next screenshot"
                className="absolute right-4 z-20 rounded-full bg-black/50 p-3 text-white hover:bg-black/70 backdrop-blur transition disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <HiOutlineChevronRight className="w-6 h-6" />
              </button>
            ) : null}

            {/* Image */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={shot.imageUrl}
              alt={shot.formattedTime}
              className="max-w-full max-h-full object-contain rounded-md shadow-2xl"
            />
          </div>
        </ModalBody>
      </ModalContent>
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* Main page                                                          */
/* ------------------------------------------------------------------ */

export default function ProductivityPage() {
  const [user, setUser] = useState(null)
  const [selectedDate, setSelectedDate] = useState(getTodayDateString())
  const [activeTab, setActiveTab] = useState('my')
  const [selectedTeamUserId, setSelectedTeamUserId] = useState(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState(null)
  // Bumped each time a fresh analysis completes so the composite viewer
  // forcibly refetches.
  const [compositeRefreshSignal, setCompositeRefreshSignal] = useState(0)
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
  const dailyStats = dailyRes?.stats || { total: 0, analyzed: 0, pending: 0 }

  // Aggregate stats across the visible team when on Team tab with no member
  // selected — so "Total Captures" reflects the whole organisation/team for
  // the day instead of staying at 0.
  const teamAggregate = useMemo(() => {
    const list = teamRes?.data || []
    if (list.length === 0) return null
    let total = 0
    let analyzed = 0
    let pending = 0
    let scoreSum = 0
    let scoreCount = 0
    for (const m of list) {
      const ds = m.dailyStats || {}
      total += ds.totalCaptures || 0
      analyzed += ds.analyzedCaptures || 0
      pending += ds.pendingCaptures || 0
      if (typeof ds.productivityScore === 'number') {
        scoreSum += ds.productivityScore
        scoreCount += 1
      }
    }
    return {
      total,
      analyzed,
      pending,
      avgScore: scoreCount > 0 ? Math.round(scoreSum / scoreCount) : null,
    }
  }, [teamRes])

  // Decide which stats to show in the top cards.
  const showTeamAggregate = activeTab === 'team' && !selectedTeamUserId && !!teamAggregate
  const stats = showTeamAggregate
    ? { total: teamAggregate.total, analyzed: teamAggregate.analyzed, pending: teamAggregate.pending }
    : dailyStats
  const headlineScore = showTeamAggregate
    ? (teamAggregate.avgScore ?? '—')
    : (analysis?.score ?? '—')

  // The Analyse button always operates on a SINGLE user — never on the team
  // aggregate. So its enable/label state must come from the per-target
  // `dailyStats`, not the aggregated `stats`.
  const targetPendingCount = dailyStats.pending || 0
  const needsTeamSelection = activeTab === 'team' && !selectedTeamUserId
  const analyseDisabled = analyzing || needsTeamSelection || targetPendingCount === 0
  const pendingShots = screenshots.filter((s) => !s.analyzed)
  const analyzedShots = screenshots.filter((s) => s.analyzed)
  // Unified ordering for the lightbox slider: pending first (matches UI order),
  // then analyzed.
  const lightboxShots = [...pendingShots, ...analyzedShots]
  const openLightbox = (shot) => {
    const idx = lightboxShots.findIndex((s) => s.id === shot.id)
    setLightboxIndex(idx >= 0 ? idx : 0)
  }
  const today = getTodayDateString()
  const isFutureDisabled = selectedDate >= today

  const changeDate = (delta) => {
    const d = new Date(selectedDate)
    d.setDate(d.getDate() + delta)
    setSelectedDate(getDateKeyInTimezone(d))
  }

  const handleAnalyze = useCallback(async () => {
    // Always require a concrete target user. On Team tab the user must pick a
    // member first; on My Day we fall back to the viewer.
    const target = activeTab === 'team' ? selectedTeamUserId : (user?._id || user?.userId)
    if (!target || analyzing) return
    setAnalyzing(true)
    startAILoading('MIRA is analyzing screenshots...')
    try {
      const token = localStorage.getItem('token')
      const body = { date: selectedDate, userId: target }
      const res = await fetch('/api/productivity/daily/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      })
      console.log('[handleAnalyze] Response status:', res.status);
      const text = await res.text().catch(() => '');
      console.log('[handleAnalyze] Response text:', text.slice(0, 1000));
      const data = (() => {
        try {
          return text ? JSON.parse(text) : {};
        } catch (parseErr) {
          console.error('[handleAnalyze] JSON parse error:', parseErr, 'response:', text.slice(0, 500));
          return {};
        }
      })();
      if (!res.ok || data?.success === false) {
        console.error('Daily analyze failed:', { 
          status: res.status, 
          statusText: res.statusText,
          responseBody: text.slice(0, 500),
          data 
        });
      }
      await mutateDaily()
      if (activeTab === 'team') await mutateTeam()
      // Tell the AnalyzedComposite to refetch — the composite was just
      // re-stitched and old screenshots were deleted from the daily payload.
      setCompositeRefreshSignal((n) => n + 1)
    } catch (err) {
      console.error('Daily analyze error:', err)
    } finally {
      stopAILoading()
      setAnalyzing(false)
    }
  }, [analyzing, selectedDate, activeTab, selectedTeamUserId, user, mutateDaily, mutateTeam, startAILoading, stopAILoading])

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
          value={headlineScore}
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
                  isDisabled={analyseDisabled}
                  startContent={!analyzing ? <HiOutlineSparkles className="w-5 h-5" /> : null}
                >
                  {needsTeamSelection
                    ? 'Select a team member to analyse'
                    : analysis
                      ? `Analyse ${targetPendingCount} new with MIRA`
                      : `Analyse ${targetPendingCount} captures with MIRA`}
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

              {/* Stitched composite of every previously-analyzed screenshot.
                  Lives in place of the old "Analyzed Captures" grid. */}
              <AnalyzedComposite
                userId={activeTab === 'team' ? (selectedTeamUserId || null) : null}
                date={selectedDate}
                refreshSignal={compositeRefreshSignal}
              />

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
                    onPick={openLightbox}
                  />
                </div>
              ) : null}

              {/* Truly empty */}
              {screenshots.length === 0 && !analysis ? (
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

      <Lightbox
        shots={lightboxShots}
        index={lightboxIndex}
        onIndexChange={setLightboxIndex}
        onClose={() => setLightboxIndex(null)}
      />
    </div>
  )
}
