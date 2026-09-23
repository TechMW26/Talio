import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import MiraWakeReminder from '@/components/MiraWakeReminder'
import { publishMiraWakeState } from '@/lib/miraWakeState'

const enable = jest.fn()
const update = (status, owner = 'tenant:user') => act(() => publishMiraWakeState({ status, owner, enable }))
beforeEach(() => {
  jest.useFakeTimers()
  localStorage.clear()
  enable.mockClear()
  update('off')
})
afterEach(() => jest.useRealTimers())

test('dismissal lasts one hour across remounts and repeats until enabled', () => {
  let view = render(<MiraWakeReminder />)
  fireEvent.click(screen.getByRole('button', { name: /Dismiss/ }))
  view.unmount()
  view = render(<MiraWakeReminder />)
  act(() => jest.advanceTimersByTime(3599999))
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  act(() => jest.advanceTimersByTime(1))
  expect(screen.getByRole('complementary')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Enable' }))
  expect(enable).toHaveBeenCalledTimes(1)
  update('listening')
  act(() => jest.advanceTimersByTime(7200000))
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
})

test.each(['loading', 'listening', 'suspended', 'unknown'])('does not nag during %s', status => {
  update(status)
  render(<MiraWakeReminder />)
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
})

test('dismissal is isolated per account and syncs across tabs', () => {
  render(<MiraWakeReminder />)
  fireEvent.click(screen.getByRole('button', { name: /Dismiss/ }))
  update('off', 'tenant:other')
  expect(screen.getByRole('complementary')).toBeInTheDocument()
  act(() => {
    localStorage.setItem('mira-wake-remind-after:tenant:other', String(Date.now() + 3600000))
    window.dispatchEvent(new Event('storage'))
  })
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
})
