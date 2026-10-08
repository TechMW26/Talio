'use client'

// Fernly visuals with no Recharts dependency. A page that only renders a metric
// card, bar chart or gauge therefore never downloads the Recharts bundle.

import { useId, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import styles from './FernlyCharts.module.css'

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

export function FernlyBars({ data = [], label = 'Activity', emptyMessage = 'No activity yet', valueLabel = 'tasks', percentageLabels = false, fillHeight = false }) {
  const [active, setActive] = useState(null)
  const rows = data.map(row => ({ ...row, value: count(row.value) }))
  const maximum = Math.max(0, ...rows.map(row => row.value))
  const total = rows.reduce((sum, row) => sum + row.value, 0)
  const percentage = value => `${Number((total ? value / total * 100 : 0).toFixed(1))}%`
  if (!maximum) return <div className={styles.empty}>{emptyMessage}</div>
  return <div className={`${styles.barsScroll} ${fillHeight ? styles.barsFullHeight : ''}`}>
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
