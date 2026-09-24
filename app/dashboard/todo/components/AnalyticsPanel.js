'use client'
import { HiOutlineXMark, HiOutlineChartBar, HiOutlineTrophy, HiOutlineArrowTrendingUp, HiOutlineClock, HiOutlineCheckCircle, HiOutlineExclamationCircle, HiOutlineCalendarDays, HiOutlineFlag } from 'react-icons/hi2'
import s from './AnalyticsPanel.module.css'

const num = v => Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0
const pct = v => Math.min(100, num(v))
function Metric({ icon: Icon, value, label, color, featured }) {
  return <div className={`${s.metric} ${featured ? s.featured : ''}`} style={{ '--accent': color }}><span className={s.icon}><Icon aria-hidden="true" /></span><div><strong>{value}</strong><span className={s.label}>{label}</span></div></div>
}
export default function AnalyticsPanel({ analytics, onClose }) {
  if (!analytics) return null
  const { summary = {}, trends = {}, breakdown = {}, analytics: stats = {} } = analytics
  const days = (trends.completionTrend || []).slice(-7)
  const maximum = Math.max(1, ...days.map(d => num(d.count)))
  const colors = { urgent: '#f05265', high: '#fb7185', medium: '#f7ad39', low: '#59de79' }
  return <section className={s.panel} aria-label="To-do Analytics">
    <header className={s.header}><HiOutlineChartBar className={s.headingIcon} aria-hidden="true" /><div><h2>To-do Analytics</h2><p>Track your productivity and completion trends.</p></div><button onClick={onClose} aria-label="Close to-do analytics" className={s.close}><HiOutlineXMark /></button></header>
    <div className={s.metrics}>
      <Metric featured icon={HiOutlineTrophy} value={`${pct(summary.productivityScore).toFixed(0)}%`} label="Productivity Score" color="#fff" />
      <Metric icon={HiOutlineCheckCircle} value={`${pct(summary.completionRate).toFixed(0)}%`} label="Completion Rate" color="#59de79" />
      <Metric icon={HiOutlineClock} value={`${pct(stats.onTimeRate).toFixed(0)}%`} label="On-time Completions" color="#5794ff" />
      <Metric icon={HiOutlineArrowTrendingUp} value={`${num(stats.avgCompletionTimeHours).toFixed(1)}h`} label="Avg Completion Time" color="#f7ad39" />
    </div>
    <div className={s.charts}>
      <section className={s.chart} aria-label="Weekly completions"><h3>To-dos Completed (Last 7 Days)</h3>
        {days.some(d => num(d.count) > 0) ? <div className={s.bars} role="img" aria-label={days.map(d => `${d.date}: ${num(d.count)} completed`).join('; ')}>
          {days.map(d => <div key={d.date} className={s.column}><div className={s.track}><div className={s.bar} style={{ height: `${num(d.count) / maximum * 100}%` }} title={`${num(d.count)} to-dos`}><span>{num(d.count) || ''}</span></div></div><span>{new Date(`${String(d.date).slice(0,10)}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' })}</span></div>)}
        </div> : <div className={s.empty}><span className={s.emptyIcon}><HiOutlineChartBar aria-hidden="true" /></span><strong>No completion data yet</strong><p>Complete some to-dos to see your progress<br />in the last 7 days.</p></div>}
      </section>
      <section className={s.chart} aria-label="Completion by priority"><h3>By Priority</h3><div className={s.priorities}>{Object.keys(colors).map(priority => {
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
  </section>
}
