'use client'

// Fernly graph visual treatment, © 2026 Hasib (OVERSHOOT), adapted for
// Talio's dark palette. Keep Recharts' real data, events and chart semantics.
import { Children, cloneElement, isValidElement, useId, useState } from 'react'
import * as Charts from 'recharts'
import { motion, useReducedMotion } from 'framer-motion'
import styles from './FernlyCharts.module.css'
export * from 'recharts'

export function styleChartTree(node, reduced = false, gradientPrefix = '') {
  if (!isValidElement(node)) return node
  const props = {}
  if (node.type === Charts.CartesianGrid) Object.assign(props, { stroke: 'var(--color-border, #303030)', strokeOpacity: .45, strokeDasharray: '0', vertical: false })
  if ([Charts.XAxis, Charts.YAxis, Charts.PolarAngleAxis, Charts.PolarRadiusAxis].includes(node.type)) {
    Object.assign(props, { tickLine: false, axisLine: false })
    if (node.props.tick !== false && !isValidElement(node.props.tick) && typeof node.props.tick !== 'function') props.tick = { fontSize: 11, fill: 'var(--color-text-secondary, #a3a3a3)', ...(typeof node.props.tick === 'object' ? node.props.tick : {}) }
  }
  if ([Charts.Line, Charts.Area, Charts.Bar, Charts.Pie, Charts.Radar, Charts.RadialBar].includes(node.type)) {
    props.animationDuration = reduced ? 0 : 750
    if (reduced) props.isAnimationActive = false
  }
  if (node.type === Charts.Line || node.type === Charts.Area) Object.assign(props, { strokeWidth: 2.5, strokeLinejoin: 'round' })
  if (node.type === Charts.Area) {
    props.fillOpacity = .16
    if (gradientPrefix && typeof node.props.stroke === 'string' && !node.props.stroke.startsWith('url(')) {
      props.fill = `url(#${gradientPrefix}-${String(node.props.dataKey).replace(/[^a-zA-Z0-9_-]/g, '_')})`
      props.fillOpacity = 1
    }
  }
  // Recharts clamps the radius to each rectangle's dimensions: works for
  // vertical, horizontal, grouped and stacked series without changing values.
  if (node.type === Charts.Bar) props.radius = 999
  if (node.type === Charts.Pie) Object.assign(props, { stroke: 'var(--color-bg-card, #171717)', strokeWidth: 3 })
  if (node.type === Charts.Tooltip) Object.assign(props, {
    cursor: false,
    contentStyle: { background: 'var(--color-bg-card, #171717)', border: '1px solid var(--color-border, #303030)', borderRadius: 14, boxShadow: '0 12px 32px #0006', padding: '12px 14px', color: 'var(--color-text-primary, #fafafa)' },
    labelStyle: { color: 'var(--color-text-secondary, #a3a3a3)', fontSize: 11, marginBottom: 6 },
    itemStyle: { fontSize: 12 },
  })
  if (node.props.children) props.children = Children.map(node.props.children, child => styleChartTree(child, reduced, gradientPrefix))
  if (gradientPrefix && [Charts.AreaChart, Charts.ComposedChart].includes(node.type)) {
    const areas = Children.toArray(node.props.children).filter(child => isValidElement(child) && child.type === Charts.Area && typeof child.props.stroke === 'string' && !child.props.stroke.startsWith('url('))
    props.children = [<defs key="fernly-gradients">{areas.map((area, index) => <linearGradient key={index} id={`${gradientPrefix}-${String(area.props.dataKey).replace(/[^a-zA-Z0-9_-]/g, '_')}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={area.props.stroke} stopOpacity={.22} /><stop offset="100%" stopColor={area.props.stroke} stopOpacity={0} /></linearGradient>)}</defs>, ...Children.toArray(props.children)]
  }
  return cloneElement(node, props)
}

export function ResponsiveContainer({ children, className = '', ...props }) {
  const reduced = useReducedMotion()
  const gradientPrefix = `fernly-area-${useId().replace(/:/g, '')}`
  return <Charts.ResponsiveContainer {...props} className={`${styles.chart} ${className}`}>{styleChartTree(children, reduced, gradientPrefix)}</Charts.ResponsiveContainer>
}

const count = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0

// Fernly analytics KPI geometry (views.css / js/analytics.js), with real
// observations only. Missing samples break the line rather than inventing zeroes.
export function FernlyMetricCard({ label, value, values = [], comparison, note }) {
  const points = values.filter(value => typeof value === 'number' && Number.isFinite(value))
  const canPlot = points.length >= 2 && points.length === values.length
  const min = Math.min(...points), max = Math.max(...points)
  const span = max - min || 1
  const line = canPlot ? points.map((point, index) => `${index ? 'L' : 'M'}${index / (points.length - 1) * 120} ${32 - (point - min) / span * 26}`).join(' ') : ''
  return <article className={styles.metricCard}>
    <h4>{label}</h4><strong>{value}</strong>
    {Number.isFinite(comparison) && <p className={styles.metricDelta}>{comparison > 0 ? '↑' : comparison < 0 ? '↓' : '→'} {Math.abs(comparison).toFixed(1)}% <span>vs previous period</span></p>}
    {note && <p className={styles.metricNote}>{note}</p>}
    {canPlot ? <svg className={styles.spark} viewBox="0 0 120 36" preserveAspectRatio="none" role="img" aria-label={`${label} trend: ${points.join(', ')}`}>
      <path className={styles.sparkArea} d={`${line} L120 36 L0 36 Z`} />
      <path className={styles.sparkLine} d={line} />
    </svg> : <p className={styles.metricNote}>Not enough trend data</p>}
  </article>
}

export function FernlyCompletionAnalytics({ data = [] }) {
  const [days, setDays] = useState(30)
  // The endpoint supplies chronologically ordered daily buckets, including zero days.
  const rows = data.slice(-days)
  const previous = data.length >= days * 2 ? data.slice(-days * 2, -days) : null
  const total = rows.reduce((sum, row) => sum + count(row.completed), 0)
  const previousTotal = previous?.reduce((sum, row) => sum + count(row.completed), 0)
  const comparison = previousTotal > 0 ? (total - previousTotal) / previousTotal * 100 : undefined
  const series = rows.map((row, index) => ({ ...row, completed: count(row.completed), previous: previous ? count(previous[index]?.completed) : undefined }))
  const formatDate = value => new Date(`${String(value).slice(0, 10)}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return <section className={styles.analytics} aria-label="Task completion analytics">
    <header className={styles.analyticsHeader}><div><h3>Completion Analytics</h3><p>Daily delivery across the selected period</p></div>
      <div className={styles.periodSwitch} role="group" aria-label="Analytics period">{[7, 14, 30].map(period => <button key={period} type="button" aria-pressed={days === period} onClick={() => setDays(period)}>{period}D</button>)}</div>
    </header>
    {!rows.length ? <div className={styles.empty}>No completion history available yet.</div> : <>
      <div className={styles.metricGrid}>
        <FernlyMetricCard label="Tasks completed" value={total.toLocaleString()} values={series.map(row => row.completed)} comparison={comparison} note={`${rows.length} days of history`} />
        <FernlyMetricCard label="Average completed per day" value={(total / rows.length).toFixed(1)} values={series.map((_, index) => {
          const window = series.slice(Math.max(0, index - 6), index + 1)
          return window.reduce((sum, row) => sum + row.completed, 0) / window.length
        })} note="Sparkline: trailing average, up to 7 days" />
      </div>
      <div className={styles.trendCard}><header className={styles.analyticsHeader}><div><h4>Throughput</h4><p>Tasks completed each day</p></div><div className={styles.trendLegend}><span>This period</span>{previous && <span>Previous</span>}</div></header>
        <div className={styles.trendPlot}><ResponsiveContainer width="100%" height="100%"><Charts.ComposedChart data={series} margin={{ top: 12, right: 12, bottom: 0, left: -20 }}>
          <Charts.CartesianGrid /><Charts.XAxis dataKey="date" tickFormatter={formatDate} minTickGap={35} /><Charts.YAxis allowDecimals={false} />
          <Charts.Tooltip labelFormatter={formatDate} />
          <Charts.Area type="linear" dataKey="completed" name="This period" stroke="#3b82f6" dot={false} />
          {previous && <Charts.Line type="linear" dataKey="previous" name="Previous period" stroke="var(--color-text-secondary, #a3a3a3)" strokeDasharray="5 5" dot={false} />}
        </Charts.ComposedChart></ResponsiveContainer></div>
        {!previous && <p className={styles.metricNote}>Previous-period comparison requires {days * 2} days of history.</p>}
      </div>
    </>}
  </section>
}

// Fernly's actual pill geometry and fill-rise treatment, with Talio blue tones.
// Zero is deliberately not given the template's minimum-height bar.
export function FernlyBars({ data = [], label = 'Activity', emptyMessage = 'No activity yet', valueLabel = 'tasks', percentageLabels = false }) {
  const [active, setActive] = useState(null)
  const rows = data.map(row => ({ ...row, value: count(row.value) }))
  const maximum = Math.max(0, ...rows.map(row => row.value))
  const total = rows.reduce((sum, row) => sum + row.value, 0)
  const percentage = value => `${Number((total ? value / total * 100 : 0).toFixed(1))}%`
  if (!maximum) return <div className={styles.empty}>{emptyMessage}</div>
  return <div className={styles.barsScroll}>
    {percentageLabels && <div className={styles.distributionTip} aria-live="polite">{rows[active] && <span role="tooltip">{rows[active].name} · {rows[active].value} {valueLabel} · {percentage(rows[active].value)}</span>}</div>}
    <ul className={styles.bars} aria-label={label} style={{ '--columns': rows.length, minWidth: rows.length * 62 }}>
      {rows.map((row, index) => <li key={`${row.name}-${index}`}>
        <div className={styles.barSpace}>
          {row.value > 0 || percentageLabels ? <button type="button" className={`${styles.pill} ${row.planned ? styles.planned : ''}`} style={{ height: row.value === 0 ? '4px' : `${row.value / maximum * 100}%`, '--tone': row.value === 0 ? 'transparent' : ['#2563eb', '#93b4fa', '#1e3a8a'][index % 3], '--delay': `${index * 55}ms` }}
            aria-label={`${row.name}: ${row.value} ${valueLabel}${row.planned ? ' (planned)' : ''}`}
            onPointerEnter={() => setActive(index)} onPointerLeave={() => setActive(null)} onFocus={() => setActive(index)} onBlur={() => setActive(null)} onClick={() => setActive(index)}>
            <span className={styles.pillFill} />
          </button> : <span role="img" aria-label={`${row.name}: 0 ${valueLabel}`} />}
          {!percentageLabels && (active === index || row.value === 0) && <span className={styles.barTip} style={{ bottom: `calc(${row.value / maximum * 100}% + 12px)` }}>{row.planned ? 'Plan ' : ''}{row.value}</span>}
        </div>
        <span className={styles.barLabel} title={row.name}>{percentageLabels ? percentage(row.value) : row.name}</span>
      </li>)}
    </ul>
  </div>
}

// Adapted from Fernly's gauge in index.html and js/dashboard.js. Layer order,
// path geometry and hatch match the template; IDs are unique across dashboards.
export function FernlyGauge({ value = 0, maxValue = 100, inProgress = 0, label = 'Completed', showLegend = true, color = '#2563eb', valueText, caption }) {
  const hatchId = `fernly-hatch-${useId().replace(/:/g, '')}`
  const reduced = useReducedMotion()
  const total = count(maxValue)
  const done = total ? Math.min(100, count(value) / total * 100) : 0
  const running = total ? Math.min(100 - done, count(inProgress) / total * 100) : 0
  const pending = total ? Math.max(0, 100 - done - running) : 0
  const percent = Math.round(done)
  const tone = color === 'auto' ? (percent >= 80 ? '#10b981' : percent >= 60 ? '#f59e0b' : '#ef4444') : color
  const segments = [
    { name: 'Pending', value: pending, offset: done + running, stroke: `url(#${hatchId})` },
    { name: 'In Progress', value: running, offset: done, stroke: '#1e3a8a' },
    { name: 'Completed', value: done, offset: 0, stroke: tone },
  ]
  return <div className={styles.gaugeWrap} style={{ '--gauge-tone': tone }}>
    <div className={styles.gauge}>
      <svg className={styles.gaugeSvg} viewBox="0 0 260 142" role="img" aria-label={`${percent}% ${label.toLowerCase()}`}>
        <title>{total ? `${label}: ${percent}%. In progress: ${Math.round(running)}%. Remaining: ${Math.round(pending)}%.` : 'No data yet'}</title>
        <defs><pattern id={hatchId} patternUnits="userSpaceOnUse" width="8" height="8">
          <rect width="8" height="8" fill="var(--color-bg-card, #171717)" />
          <path d="M-2 2l4-4M0 8l8-8M6 10l4-4" stroke="var(--color-text-secondary, #a3a3a3)" strokeWidth="2" />
        </pattern></defs>
        <path className={styles.gaugeTrack} d="M32 120a98 98 0 0 1 196 0" />
        {segments.filter(segment => segment.value > 0).map(segment => <motion.path key={segment.name} className={styles.gaugeSegment}
          d="M32 120a98 98 0 0 1 196 0" pathLength="100" stroke={segment.stroke}
          initial={reduced ? false : { strokeDasharray: '0 100', strokeDashoffset: 0 }}
          animate={{ strokeDasharray: `${segment.value} 100`, strokeDashoffset: -segment.offset }}
          transition={{ duration: reduced ? 0 : .9, ease: [.65, 0, .35, 1] }} />)}
      </svg>
      <div className={styles.gaugeRead}><strong>{valueText ?? `${percent}%`}</strong><span>{label}</span></div>
    </div>
    {showLegend && <ul className={styles.gaugeLegend}>
      <li><i style={{ background: tone }} />Completed</li>
      <li><i style={{ background: '#1e3a8a' }} />In Progress</li>
      <li><i className={styles.gaugePending} />Pending</li>
    </ul>}
    {caption && <p className={styles.gaugeCaption}>{caption}</p>}
  </div>
}

export function CompletionRing({ stats = {} }) {
  const total = count(stats.total), completed = Math.min(total, count(stats.completed))
  return <FernlyGauge value={completed} maxValue={total} inProgress={stats.in_progress ?? stats.inProgress}
    caption={`${completed} of ${total} tasks`} />
}

export function TaskBars({ stats = {} }) {
  return <FernlyBars label="Task status distribution" data={[
    { name: 'To do', value: stats.todo },
    { name: 'In progress', value: stats.in_progress ?? stats.inProgress },
    { name: 'Review', value: stats.review },
    { name: 'Completed', value: stats.completed },
    { name: 'Blocked', value: stats.blocked },
  ]} emptyMessage="No task activity yet. Assigned tasks will appear here." />
}

export function TaskDistribution({ stats = {} }) {
  return <div className={styles.distribution}>
    <TaskBars stats={stats} />
    <CompletionRing stats={stats} />
  </div>
}
