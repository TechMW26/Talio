import React from 'react'
import { render, screen } from '@testing-library/react'
import AttendanceSummaryWidget from '@/components/widgets/AttendanceSummaryWidget'
import useAuthedSWR from '@/hooks/useAuthedSWR'
jest.mock('@/hooks/useAuthedSWR')
jest.mock('@/components/widgets/AttendanceSummaryWidget.module.css', () => ({}))

test('renders actual attendance values, including zero, without polling', () => {
  useAuthedSWR.mockReturnValue({ data: { data: { presentDays: 10, absentDays: 0, lateDays: 9, avgHours: 5.7 } } })
  render(<AttendanceSummaryWidget employeeId="employee-a" />)
  for (const value of ['10', '0', '9', '5.7h']) expect(screen.getByText(value)).toBeInTheDocument()
  expect(useAuthedSWR).toHaveBeenCalledWith('/api/attendance/summary?employeeId=employee-a', { refreshInterval: 0 })
})
test('loading and unavailable data do not masquerade as zero attendance', () => {
  useAuthedSWR.mockReturnValue({ isLoading: true })
  const view = render(<AttendanceSummaryWidget employeeId="employee-a" />)
  expect(screen.getByLabelText('Attendance summary')).toHaveAttribute('aria-busy', 'true')
  expect(screen.getByLabelText('Loading Present')).toBeInTheDocument()
  useAuthedSWR.mockReturnValue({})
  view.rerender(<AttendanceSummaryWidget />)
  expect(screen.getByText('Attendance data is not available yet.')).toBeInTheDocument()
  expect(screen.queryByText('0')).not.toBeInTheDocument()
})
test('error keeps a readable message instead of showing misleading figures', () => {
  useAuthedSWR.mockReturnValue({ error: new Error('Offline') })
  render(<AttendanceSummaryWidget employeeId="employee-a" />)
  expect(screen.getByRole('alert')).toHaveTextContent('Unable to load')
})

test('metrics have no wave overlays or icons preceding their values', () => {
  useAuthedSWR.mockReturnValue({ data: { data: { presentDays: 10, absentDays: 7, lateDays: 9, avgHours: 5.7 } } })
  const view = render(<AttendanceSummaryWidget employeeId="employee-a" />)
  expect(view.container.querySelector('svg[preserveAspectRatio="none"]')).toBeNull()
  for (const value of ['10', '7', '9', '5.7h']) {
    const content = screen.getByText(value).parentElement
    expect(content.firstElementChild).toBe(screen.getByText(value))
    expect(content.previousElementSibling?.querySelector('svg') || null).toBeNull()
  }
  view.rerender(<AttendanceSummaryWidget employeeId="employee-a" />)
  expect(view.container.querySelector('svg[preserveAspectRatio="none"]')).toBeNull()
})

test('recorded presence uses real present and absent records without double-counting late days', () => {
  useAuthedSWR.mockReturnValue({ data: { data: { presentDays: 3, absentDays: 1, lateDays: 2, avgHours: 7 } } })
  render(<AttendanceSummaryWidget employeeId="employee-a" />)
  expect(screen.getByRole('meter', { name: 'Recorded presence' })).toHaveAttribute('aria-valuenow', '75')
})

test('attendance metrics have no rigid tile heights and retain a scroll safety net', () => {
  const fs = require('fs')
  const css = fs.readFileSync('components/widgets/AttendanceSummaryWidget.module.css', 'utf8')
  expect(css).not.toMatch(/min-height:\s*(142|170)px/)
  expect(css).toContain('overflow: auto')
  expect(css).toContain('flex: 1 0 auto')
  expect(css).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))')
  expect(css).not.toContain('repeat(4, minmax(0, 1fr))')
})
