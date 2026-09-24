import { render, screen, fireEvent } from '@testing-library/react'
import AnalyticsPanel from '@/app/dashboard/todo/components/AnalyticsPanel'

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
  expect(screen.getByRole('img')).toHaveAttribute('aria-label', '2026-09-24: 3 completed')
  expect(screen.getByRole('progressbar', { name: 'urgent completion' })).toHaveAttribute('aria-valuenow', '50')
  expect(screen.getByText('By Category')).toBeInTheDocument()
})
