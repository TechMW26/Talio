'use client'

// Fernly graph visual treatment, © 2026 Hasib (OVERSHOOT), adapted for
// Talio's dark palette. Keep Recharts' real data, events and chart semantics.
import { Children, cloneElement, isValidElement, useId, useState } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  Pie,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  RadialBar,
  ResponsiveContainer as RechartsResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { motion, useReducedMotion } from 'framer-motion'
import styles from './FernlyCharts.module.css'
import { FernlyMetricCard } from './FernlyVisuals'

// Shared numeric guard used by the completion analytics below.
const count = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0
// Explicit re-exports only. `export * from recharts` forced the entire Recharts
// bundle into every module that imported this file, even chart-free pages.
export {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend,
  Line, LineChart, Pie, PieChart, PolarAngleAxis, PolarRadiusAxis, Radar,
  RadialBar, Tooltip, XAxis, YAxis,
} from 'recharts'

// Namespace object kept for the node.type comparisons below, while importing
// named members so the bundler can tree-shake the rest of Recharts.
const Charts = {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  Pie,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  RadialBar,
  ResponsiveContainer: RechartsResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
}

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
// Visuals live in a Recharts-free module; re-exported here so this module keeps
// its existing public API for current importers.
export { FernlyMetricCard, FernlyBars, FernlyGauge, CompletionRing, TaskBars, TaskDistribution } from './FernlyVisuals'
