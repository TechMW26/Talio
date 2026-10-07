import { render, screen, fireEvent } from '@testing-library/react'
import { buildUpcomingReminders, priorityLevel } from '@/lib/dayCompass'
import DayCompass from '@/components/widgets/DayCompass'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import fs from 'node:fs'

jest.mock('@/hooks/useAuthedSWR', () => ({ __esModule: true, default: jest.fn() }))
const tasks = [
  { _id: 'high', title: 'Release review', status: 'todo', priority: 'high', dueDate: '2099-01-01T12:00:00Z' },
  { _id: 'medium', title: 'Documentation', status: 'todo', priority: 'medium', dueDate: '2099-01-02T12:00:00Z' },
  { _id: 'low', title: 'Follow up', status: 'todo', priority: 'low', dueDate: '2099-01-03T12:00:00Z' },
]
beforeEach(() => {
  jest.clearAllMocks()
  useAuthedSWR.mockReturnValue({ data: { data: tasks }, mutate: jest.fn(), isLoading: false })
})

test('profile contains only upcoming reminders and no focus controls', () => {
  render(<DayCompass enabled />)
  expect(screen.getByRole('heading', { name: 'Upcoming' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'My focus' })).not.toBeInTheDocument()
  expect(screen.queryByText(/Start 25-min focus/)).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /^Now|^Next/ })).not.toBeInTheDocument()
  expect(screen.getAllByRole('link')).toHaveLength(3)
  expect(screen.getByRole('link', { name: /Release review/ })).toHaveAttribute('href', '/dashboard/projects/my-tasks?task=high')
  expect(screen.getByText('high')).toHaveAttribute('data-priority', 'high')
  expect(screen.getByText('medium')).toHaveAttribute('data-priority', 'medium')
  expect(screen.getByText('low')).toHaveAttribute('data-priority', 'low')
})

test('feed is keyboard scrollable while its heading stays outside the scroll region', () => {
  render(<DayCompass enabled />)
  const region = screen.getByRole('region', { name: 'Upcoming reminders' })
  expect(region).toHaveAttribute('tabindex', '0')
  expect(region).not.toContainElement(screen.getByRole('heading', { name: 'Upcoming' }))
  const css = fs.readFileSync('components/widgets/DayCompass.module.css', 'utf8')
  const reminders = css.match(/\.reminders\s*\{([^}]+)\}/)[1]
  expect(reminders).toContain('overflow-y: auto;')
  expect(reminders).toContain('min-height: 0;')
  expect(css).not.toContain('.signals')
  expect(css).not.toContain('.actions')
})

test('disabled features make no requests and render no empty card', () => {
  const view = render(<DayCompass />)
  expect(useAuthedSWR.mock.calls.every(([key]) => key === null)).toBe(true)
  expect(view.container).toBeEmptyDOMElement()
})

test('loading and failure preserve honest states and retry reminders', () => {
  const retry = jest.fn()
  useAuthedSWR.mockReturnValue({ isLoading: true, mutate: retry })
  const view = render(<DayCompass enabled />)
  expect(screen.getByRole('status')).toHaveTextContent('Loading reminders')
  useAuthedSWR.mockReturnValue({ error: new Error('offline'), mutate: retry })
  view.rerender(<DayCompass enabled />)
  fireEvent.click(screen.getByRole('button', { name: 'Retry reminders' }))
  expect(retry).toHaveBeenCalled()
  expect(screen.queryByText(/clear for now/)).toBeNull()
})

test('empty upcoming feed has no fictional tasks', () => {
  useAuthedSWR.mockReturnValue({ data: { data: [] } })
  render(<DayCompass enabled />)
  expect(screen.getByText(/No upcoming deadlines/)).toBeInTheDocument()
  expect(screen.queryByRole('link')).toBeNull()
})

test('merges all available reminders nearest first, excluding past and closed rows', () => {
  const meetings = [{ _id: 'm1', title: 'Planning', status: 'scheduled', scheduledStart: '2099-01-01T10:00:00Z' }, { _id: 'no', status: 'scheduled', myInviteStatus: 'declined', scheduledStart: '2099-01-01T09:00:00Z' }]
  const result = buildUpcomingReminders([...tasks, { _id: 'done', status: 'completed', dueDate: '2099-01-01' }, { _id: 'past', status: 'todo', dueDate: '2020-01-01' }], meetings, new Date('2099-01-01T08:00:00Z'))
  expect(result.map(row => row.id)).toEqual(['meeting-m1', 'task-high', 'task-medium', 'task-low'])
  expect(['critical', 'urgent', 'high', 'medium', 'low', undefined].map(priorityLevel)).toEqual(['high', 'high', 'high', 'medium', 'low', 'medium'])
})

test('meeting request is bounded and failures do not hide available task reminders', () => {
  const retry = jest.fn()
  useAuthedSWR.mockImplementation(key => key?.startsWith('/api/meetings') ? { error: new Error('offline'), mutate: retry } : { data: { data: tasks }, mutate: jest.fn() })
  render(<DayCompass enabled meetingsEnabled />)
  expect(useAuthedSWR).toHaveBeenCalledWith('/api/meetings?view=upcoming&limit=5', { refreshInterval: 0 })
  expect(screen.getByRole('link', { name: /Release review/ })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Retry reminders' }))
  expect(retry).toHaveBeenCalled()
})
