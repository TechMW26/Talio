import { render, screen, fireEvent } from '@testing-library/react'
import AnalyticsPanel from '@/app/dashboard/todo/components/AnalyticsPanel'
beforeAll(() => { global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } })

test('zero completion days show the designed empty state and close works', () => {
  const onClose = jest.fn()
  render(<AnalyticsPanel analytics={{ trends: { completionTrend: [{ date: '2026-09-24', count: 0 }] } }} onClose={onClose} />)
  expect(screen.getByText('No completion data yet')).toBeInTheDocument()
  expect(screen.getByText('0.0h')).toBeInTheDocument()
  expect(screen.getAllByRole('progressbar')).toHaveLength(4)
  fireEvent.click(screen.getByLabelText('Close to-do analytics'))
  expect(onClose).toHaveBeenCalledTimes(1)
})
test('renders real chart values, bounded priority bars and category details', () => {
  render(<AnalyticsPanel analytics={{ summary: { productivityScore: 72 }, trends: { completionTrend: [{ date: '2026-09-24', count: 3 }] }, breakdown: { byPriority: { urgent: { completed: 2, total: 4 } }, byCategory: [{ categoryName: 'Work', total: 4, completed: 2 }] } }} />)
  expect(screen.getByText('72%')).toBeInTheDocument()
  expect(screen.getByRole('group', { name: '2026-09-24: 3 completed' })).toBeInTheDocument()
  expect(screen.getByRole('progressbar', { name: 'urgent completion' })).toHaveAttribute('aria-valuenow', '50')
  expect(screen.getByText('By Category')).toBeInTheDocument()
})

test('compact layout retains every secondary metric without extra metric cards', () => {
  render(<AnalyticsPanel analytics={{ summary: { highPriority: 3 }, analytics: { onTimeCompletions: 8, lateCompletions: 2, totalDueDateExtensions: 1 } }} />)
  for (const label of ['Productivity Score', 'Completion Rate', 'On-time Completions', 'Avg Completion Time', 'On Time', 'Completed Late', 'High Priority Pending', 'Due Date Extensions']) {
    expect(screen.getByText(label)).toBeInTheDocument()
  }
  expect(screen.getByText('On Time').previousSibling).toHaveTextContent('8')
  expect(screen.getByText('High Priority Pending').previousSibling).toHaveTextContent('3')
  expect(screen.getByRole('region', { name: 'To-do Analytics' })).toBeInTheDocument()
})

test('analytics is compact, theme-aware and reuses the shared Fernly card and chart', () => {
  const fs = require('fs')
  const source = fs.readFileSync('app/dashboard/todo/components/AnalyticsPanel.js', 'utf8')
  const css = fs.readFileSync('app/dashboard/todo/components/AnalyticsPanel.module.css', 'utf8')
  expect(source).toContain('<Card as="section" shadow="none"')
  expect(source).toContain('<FernlyBars fillHeight')
  expect(css).toContain('height: 156px')
  expect(css).toContain('.plot > div { min-height: 0; padding-top: 24px; }')
  expect(css).toContain('var(--color-bg-card, #171717)')
  expect(css).toContain('@media (max-width: 640px)')
  expect(css).not.toContain('gradient(')
  expect(css).not.toContain(':hover')
  expect(css).not.toContain('244px')
})

test('missing analytics does not render a misleading panel', () => {
  const { container } = render(<AnalyticsPanel analytics={null} />)
  expect(container).toBeEmptyDOMElement()
})
