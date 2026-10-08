'use client'

import { Heading2, NativeButton, Heading3 } from '@/components/ui/fernly/native'
import { Card } from '@/components/ui/fernly'
import { HiOutlineXMark, HiOutlineChartBar, HiOutlineTrophy, HiOutlineArrowTrendingUp, HiOutlineClock, HiOutlineCheckCircle, HiOutlineExclamationCircle, HiOutlineCalendarDays, HiOutlineFlag } from 'react-icons/hi2'
import s from './AnalyticsPanel.module.css'
import { FernlyBars } from '@/components/charts/FernlyVisuals'

const num = v => Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0
const pct = v => Math.min(100, num(v))
function Metric({ icon: Icon, value, label, color }) {
  return <div className={s.metric} style={{ '--accent': color }}><span className={s.icon}><Icon aria-hidden="true" /></span><div><strong>{value}</strong><span className={s.label}>{label}</span></div></div>
}
export default function AnalyticsPanel({ analytics, onClose }) {
  if (!analytics) return null
  const { summary = {}, trends = {}, breakdown = {}, analytics: stats = {} } = analytics
  const days = (trends.completionTrend || []).slice(-7)
  const colors = { urgent: '#f05265', high: '#fb7185', medium: '#f7ad39', low: '#59de79' }
  return <Card as="section" shadow="none" className={s.panel} aria-label="To-do Analytics">
    <header className={s.header}><span className={s.headingIcon}><HiOutlineChartBar aria-hidden="true" /></span><div><Heading2>To-do Analytics</Heading2><p>Your delivery, at a glance.</p></div><NativeButton type="button" onClick={onClose} aria-label="Close to-do analytics" className={s.close}><HiOutlineXMark /></NativeButton></header>
    <div className={s.metrics}>
      <Metric icon={HiOutlineTrophy} value={`${pct(summary.productivityScore).toFixed(0)}%`} label="Productivity Score" color="#5794ff" />
      <Metric icon={HiOutlineCheckCircle} value={`${pct(summary.completionRate).toFixed(0)}%`} label="Completion Rate" color="#59de79" />
      <Metric icon={HiOutlineClock} value={`${pct(stats.onTimeRate).toFixed(0)}%`} label="On-time Completions" color="#5794ff" />
      <Metric icon={HiOutlineArrowTrendingUp} value={`${num(stats.avgCompletionTimeHours).toFixed(1)}h`} label="Avg Completion Time" color="#f7ad39" />
    </div>
    <div className={s.charts}>
      <section className={s.chart} aria-label="Weekly completions"><div className={s.chartHeading}><Heading3>Weekly completions</Heading3><span>Last 7 days</span></div>
        {days.some(d => num(d.count) > 0) ? <div className={s.plot} role="group" aria-label={days.map(d => `${d.date}: ${num(d.count)} completed`).join('; ')}>
          <FernlyBars fillHeight label="Weekly completions" valueLabel="completed" data={days.map(d => ({ name: new Date(`${String(d.date).slice(0,10)}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' }), value: num(d.count) }))} />
        </div> : <div className={s.empty}><span className={s.emptyIcon}><HiOutlineChartBar aria-hidden="true" /></span><div><strong>No completion data yet</strong><p>Complete a to-do to start your weekly trend.</p></div></div>}
      </section>
      <section className={s.chart} aria-label="Completion by priority"><Heading3>By Priority</Heading3><div className={s.priorities}>{Object.keys(colors).map(priority => {
        const data = breakdown.byPriority?.[priority] || {}
        const total = num(data.total), completed = num(data.completed), value = total ? pct(completed / total * 100) : 0
        return <div key={priority}><div className={s.row}><span className={s.capitalize}>{priority}</span><span>{completed}/{total}</span></div><div className={s.progress} role="progressbar" aria-label={`${priority} completion`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}><div style={{ width: `${value}%`, background: colors[priority] }} /></div></div>
      })}</div></section>
    </div>
    <div className={`${s.metrics} ${s.footer}`}>
      <Metric icon={HiOutlineClock} value={num(stats.onTimeCompletions)} label="On Time" color="#59de79" />
      <Metric icon={HiOutlineExclamationCircle} value={num(stats.lateCompletions)} label="Completed Late" color="#ff575f" />
      <Metric icon={HiOutlineFlag} value={num(summary.highPriority)} label="High Priority Pending" color="#f7ad39" />
      <Metric icon={HiOutlineCalendarDays} value={num(stats.totalDueDateExtensions)} label="Due Date Extensions" color="#adb4ce" />
    </div>
    {breakdown.byCategory?.length > 0 && <details className={s.categories}><summary>By Category</summary>{breakdown.byCategory.map((c,i) => <div className={s.row} key={c.categoryId || i}><span>{c.categoryName || 'Uncategorized'}</span><span>{num(c.completed)}/{num(c.total)}</span></div>)}</details>}
  </Card>
}
