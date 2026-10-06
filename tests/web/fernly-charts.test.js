import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import * as Charts from 'recharts'
import { styleChartTree, TaskDistribution, FernlyBars, FernlyGauge, FernlyMetricCard, FernlyCompletionAnalytics } from '@/components/charts/FernlyCharts'
import MemberOverview from '@/app/dashboard/team/members/[id]/MemberOverview'
jest.mock('framer-motion', () => ({ ...jest.requireActual('framer-motion'), useReducedMotion: () => true }))
const originalResizeObserver = global.ResizeObserver
test('distribution labels show shares of total and names only in hover or focus details', () => {
  render(<FernlyBars percentageLabels valueLabel="employees" data={[{ name: 'Sales', value: 3 }, { name: 'Research and Development', value: 1 }, { name: 'Empty', value: 0 }]} />)
  expect(screen.getByText('75%')).toBeInTheDocument()
  expect(screen.getByText('25%')).toBeInTheDocument()
  expect(screen.getByText('0%')).toBeInTheDocument()
  expect(screen.queryByText('Research and Development')).not.toBeInTheDocument()
  const bar = screen.getByRole('button', { name: 'Research and Development: 1 employees' })
  fireEvent.focus(bar)
  expect(screen.getByRole('tooltip')).toHaveTextContent('Research and Development · 1 employees · 25%')
  fireEvent.blur(bar)
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
})
beforeAll(() => { global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } })
afterAll(() => { global.ResizeObserver = originalResizeObserver })
test('theme preserves chart data, data keys, handlers and series colors', () => {
  const rows = [{ name: 'One', value: 10 }], click = jest.fn()
  const tree = styleChartTree(<Charts.BarChart data={rows} onClick={click}><Charts.Bar dataKey="value" fill="#ef4444" /><Charts.XAxis dataKey="name" /><Charts.Tooltip formatter={click} /></Charts.BarChart>, true)
  expect(tree.type).toBe(Charts.BarChart)
  expect(tree.props.data).toBe(rows)
  expect(tree.props.onClick).toBe(click)
  expect(tree.props.children[0].props).toMatchObject({ dataKey: 'value', fill: '#ef4444', isAnimationActive: false, radius: 999 })
  expect(tree.props.children[2].props.formatter).toBe(click)
  expect(tree.props.children[2].props.cursor).toBe(false)
})
test('custom axis ticks and horizontal bar geometry survive styling', () => {
  const tick = () => null
  const tree = styleChartTree(<Charts.BarChart layout="vertical"><Charts.Bar radius={[0, 4, 4, 0]} /><Charts.YAxis tick={tick} /></Charts.BarChart>)
  expect(tree.props.layout).toBe('vertical')
  expect(tree.props.children[0].props.radius).toEqual(999)
  expect(tree.props.children[1].props.tick).toBe(tick)
})

test('Fernly pills keep real proportions, sanitize invalid values and support focus', () => {
  render(<FernlyBars data={[{ name: 'Open', value: 10 }, { name: 'Done', value: 5 }, { name: 'Invalid', value: Infinity }]} />)
  expect(screen.getByRole('button', { name: 'Open: 10 tasks' })).toHaveStyle({ height: '100%' })
  const half = screen.getByRole('button', { name: 'Done: 5 tasks' })
  expect(half).toHaveStyle({ height: '50%' })
  expect(screen.getByRole('img', { name: 'Invalid: 0 tasks' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Invalid: 0 tasks' })).not.toBeInTheDocument()
  fireEvent.focus(half)
  expect(screen.getByText('5')).toBeInTheDocument()
})

test('member portrait uses real image and falls back when image fails', () => {
  render(<MemberOverview employee={{ firstName: 'Test', lastName: 'User', profilePicture: '/photo.jpg', employeeCode: 'T1' }} />)
  const photo = screen.getByRole('img', { name: 'Test User' })
  expect(photo).toHaveAttribute('src', '/photo.jpg')
  fireEvent.error(photo)
  expect(screen.getByLabelText('No profile photo')).toHaveTextContent('TU')
  expect(screen.getByRole('heading', { name: 'Test User', level: 1 })).toBeInTheDocument()
})
test('empty task data is honest and does not show fabricated bars', () => {
  render(<TaskDistribution stats={{ total: 0, completed: 0 }} />)
  expect(screen.getByText(/No task activity yet/)).toBeInTheDocument()
  expect(screen.getByRole('img', { name: '0% completed' })).toBeInTheDocument()
  expect(screen.getByText('0 of 0 tasks')).toBeInTheDocument()
})

test('Fernly gauge uses template geometry, proportional segments and unique hatches', () => {
  const { container } = render(<><FernlyGauge value={42} inProgress={40} /><FernlyGauge value={100} /></>)
  expect(screen.getByRole('img', { name: '42% completed' })).toBeInTheDocument()
  const gauges = container.querySelectorAll('svg')
  expect(gauges[0]).toHaveAttribute('viewBox', '0 0 260 142')
  const segments = gauges[0].querySelectorAll('path[pathLength="100"]')
  expect(segments[0]).toHaveAttribute('stroke-dasharray', '18 100')
  expect(segments[0]).toHaveAttribute('stroke-dashoffset', '-82')
  expect(segments[1]).toHaveAttribute('stroke-dasharray', '40 100')
  expect(segments[2]).toHaveAttribute('stroke-dasharray', '42 100')
  const patterns = [...container.querySelectorAll('pattern')].map(p => p.id)
  expect(new Set(patterns).size).toBe(2)
  expect(segments[0]).toHaveAttribute('stroke', `url(#${patterns[0]})`)
})

test('gauge sanitizes invalid inputs and updates without retaining stale percentages', () => {
  const { container, rerender } = render(<FernlyGauge value={Infinity} inProgress={-10} />)
  expect(screen.getByRole('img', { name: '0% completed' })).toBeInTheDocument()
  rerender(<FernlyGauge value={200} inProgress={80} />)
  expect(screen.getByRole('img', { name: '100% completed' })).toBeInTheDocument()
  rerender(<FernlyGauge value={0} maxValue={0} />)
  expect(screen.getByText('No data yet')).toBeInTheDocument()
  expect(container.querySelectorAll('path[pathLength="100"]')).toHaveLength(0)
})

test('metric sparkline uses observed values and does not fabricate missing samples', () => {
  const { rerender } = render(<FernlyMetricCard label="Delivery" value="6" values={[1, 2, 3]} />)
  expect(screen.getByRole('img', { name: 'Delivery trend: 1, 2, 3' })).toBeInTheDocument()
  expect(screen.queryByText(/vs previous/)).not.toBeInTheDocument()
  rerender(<FernlyMetricCard label="Delivery" value="6" values={[1, null, 3]} />)
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
  expect(screen.getByText('Not enough trend data')).toBeInTheDocument()
})

test('analytics periods change real totals and only compare complete periods', () => {
  const data = Array.from({ length: 30 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, '0')}`, completed: i < 23 ? 1 : 2 }))
  render(<FernlyCompletionAnalytics data={data} />)
  expect(screen.getByText('37')).toBeInTheDocument()
  expect(screen.getByText(/requires 60 days/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '7D' }))
  expect(screen.getByRole('button', { name: '7D' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByText('14')).toBeInTheDocument()
  expect(screen.getByText(/100.0%/)).toBeInTheDocument()
  expect(screen.queryByText(/requires 60 days/)).not.toBeInTheDocument()
})

test('shared area theme provides gradients while preserving series data and events', () => {
  const click = jest.fn(), rows = [{ date: 'Mon', value: 4 }]
  const tree = styleChartTree(<Charts.AreaChart data={rows} onClick={click}><Charts.Area dataKey="value" stroke="#3b82f6" /><Charts.Tooltip formatter={click} /></Charts.AreaChart>, true, 'chart-one')
  expect(tree.props.data).toBe(rows)
  expect(tree.props.onClick).toBe(click)
  expect(tree.props.children[0].type).toBe('defs')
  expect(tree.props.children[1].props.fill).toBe('url(#chart-one-value)')
  expect(tree.props.children[2].props.formatter).toBe(click)
})
