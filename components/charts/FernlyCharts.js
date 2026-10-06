'use client'

// Fernly graph visual treatment, © 2026 Hasib (OVERSHOOT), adapted for
// Talio's dark palette. Keep Recharts' real data, events and chart semantics.
import { Children, cloneElement, isValidElement, useState } from 'react'
import * as Charts from 'recharts'
import { useReducedMotion } from 'framer-motion'
import styles from './FernlyCharts.module.css'
export * from 'recharts'

export function styleChartTree(node, reduced = false) {
  if (!isValidElement(node)) return node
  const props = {}
  if (node.type === Charts.CartesianGrid) Object.assign(props, { stroke: 'var(--color-border, #303030)', strokeOpacity: .65, strokeDasharray: '3 5', vertical: false })
  if ([Charts.XAxis, Charts.YAxis, Charts.PolarAngleAxis, Charts.PolarRadiusAxis].includes(node.type)) {
    Object.assign(props, { tickLine: false, axisLine: false })
    if (node.props.tick !== false && !isValidElement(node.props.tick) && typeof node.props.tick !== 'function') props.tick = { fontSize: 11, fill: 'var(--color-text-secondary, #a3a3a3)', ...(typeof node.props.tick === 'object' ? node.props.tick : {}) }
  }
  if ([Charts.Line, Charts.Area, Charts.Bar, Charts.Pie, Charts.Radar, Charts.RadialBar].includes(node.type)) {
    props.animationDuration = reduced ? 0 : 750
    if (reduced) props.isAnimationActive = false
  }
  if (node.type === Charts.Line || node.type === Charts.Area) Object.assign(props, { strokeWidth: 2.5, strokeLinejoin: 'round' })
  if (node.type === Charts.Area) props.fillOpacity = .16
  // Recharts clamps the radius to each rectangle's dimensions: works for
  // vertical, horizontal, grouped and stacked series without changing values.
  if (node.type === Charts.Bar) props.radius = 999
  if (node.type === Charts.Pie) Object.assign(props, { stroke: 'var(--color-bg-card, #171717)', strokeWidth: 3 })
  if (node.type === Charts.Tooltip) Object.assign(props, {
    contentStyle: { background: 'var(--color-bg-card, #171717)', border: '1px solid var(--color-border, #303030)', borderRadius: 14, boxShadow: '0 12px 32px #0006', padding: '12px 14px', color: 'var(--color-text-primary, #fafafa)' },
    labelStyle: { color: 'var(--color-text-secondary, #a3a3a3)', fontSize: 11, marginBottom: 6 },
    itemStyle: { fontSize: 12 },
  })
  if (node.props.children) props.children = Children.map(node.props.children, child => styleChartTree(child, reduced))
  return cloneElement(node, props)
}

export function ResponsiveContainer({ children, className = '', ...props }) {
  const reduced = useReducedMotion()
  return <Charts.ResponsiveContainer {...props} className={`${styles.chart} ${className}`}>{styleChartTree(children, reduced)}</Charts.ResponsiveContainer>
}

const count = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0

// Fernly's actual pill geometry and fill-rise treatment, with Talio blue tones.
// Zero is deliberately not given the template's minimum-height bar.
export function FernlyBars({ data = [], label = 'Activity', emptyMessage = 'No activity yet', valueLabel = 'tasks' }) {
  const [active, setActive] = useState(null)
  const rows = data.map(row => ({ ...row, value: count(row.value) }))
  const maximum = Math.max(0, ...rows.map(row => row.value))
  if (!maximum) return <div className={styles.empty}>{emptyMessage}</div>
  return <div className={styles.barsScroll}>
    <ul className={styles.bars} aria-label={label} style={{ '--columns': rows.length, minWidth: rows.length * 62 }}>
      {rows.map((row, index) => <li key={`${row.name}-${index}`}>
        <div className={styles.barSpace}>
          {row.value > 0 ? <button type="button" className={`${styles.pill} ${row.planned ? styles.planned : ''}`} style={{ height: `${row.value / maximum * 100}%`, '--tone': ['#2563eb', '#93b4fa', '#1e3a8a'][index % 3], '--delay': `${index * 55}ms` }}
            aria-label={`${row.name}: ${row.value} ${valueLabel}${row.planned ? ' (planned)' : ''}`}
            onPointerEnter={() => setActive(index)} onPointerLeave={() => setActive(null)} onFocus={() => setActive(index)} onBlur={() => setActive(null)} onClick={() => setActive(index)}>
            <span className={styles.pillFill} />
          </button> : <span role="img" aria-label={`${row.name}: 0 ${valueLabel}`} />}
          {(active === index || row.value === 0) && <span className={styles.barTip} style={{ bottom: `calc(${row.value / maximum * 100}% + 12px)` }}>{row.planned ? 'Plan ' : ''}{row.value}</span>}
        </div>
        <span className={styles.barLabel} title={row.name}>{row.name}</span>
      </li>)}
    </ul>
  </div>
}

export function CompletionRing({ stats = {} }) {
  const total = count(stats.total), completed = count(stats.completed)
  const percent = total ? Math.min(100, Math.round(completed / total * 100)) : 0
  return <div className={styles.completion}>
    <svg viewBox="0 0 160 160" role="img" aria-label={`${percent}% completed`}><circle cx="80" cy="80" r="64" fill="none" stroke="var(--color-border, #303030)" strokeWidth="12" /><circle cx="80" cy="80" r="64" fill="none" stroke="#3b82f6" strokeWidth="12" strokeLinecap="round" pathLength="100" strokeDasharray={`${percent} 100`} transform="rotate(-90 80 80)" /></svg>
    <div><strong>{percent}%</strong><span>Completed</span></div>
    <p>{completed} of {total} tasks</p>
  </div>
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
