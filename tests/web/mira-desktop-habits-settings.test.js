import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import MiraDesktopHabits from '@/components/settings/MiraDesktopHabits'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import { publishMiraOrbState } from '@/lib/miraOrbState'
jest.mock('@/hooks/useAuthedSWR', () => ({ __esModule: true, default: jest.fn() }))
jest.mock('@/utils/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))
afterEach(() => { delete window.electronAPI; jest.restoreAllMocks() })
test('loading/error states and retry are visible without editable stale data', () => {
  const mutate = jest.fn()
  useAuthedSWR.mockReturnValue({ isLoading: true, mutate })
  const { rerender } = render(<MiraDesktopHabits />)
  expect(screen.getByRole('status')).toHaveTextContent('Loading')
  useAuthedSWR.mockReturnValue({ error: new Error('Offline'), mutate })
  rerender(<MiraDesktopHabits />)
  expect(screen.getByRole('alert')).toHaveTextContent('could not load')
  fireEvent.click(screen.getByText('Retry'))
  expect(mutate).toHaveBeenCalled()
})
test('user can disable learning and clear saved preferences', async () => {
  const mutate = jest.fn()
  useAuthedSWR.mockReturnValue({ data: { data: { enabled: true, music: [{ app: 'YouTube Music', song: 'Kesariya', count: 2 }] } }, mutate })
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ success: true }) }))
  render(<MiraDesktopHabits />)
  expect(screen.getByText(/Kesariya/)).toBeVisible()
  fireEvent.click(screen.getByRole('checkbox'))
  await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1))
  expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ operation: 'enabled', enabled: false })
  fireEvent.click(screen.getByText('Forget learned preferences'))
  await waitFor(() => expect(mutate).toHaveBeenCalledTimes(2))
  expect(JSON.parse(global.fetch.mock.calls[1][1].body)).toEqual({ operation: 'clear' })
})
test('voice and chat activities preserve timer accuracy only while active', () => {
  window.electronAPI = { setMiraRendererActivity: jest.fn(async () => true) }
  publishMiraOrbState('chat', 'solving')
  publishMiraOrbState('voice', 'listening')
  publishMiraOrbState('chat', 'breathing')
  expect(window.electronAPI.setMiraRendererActivity.mock.calls.map(([input]) => input)).toEqual([
    { source: 'request', active: true }, { source: 'voice', active: true }, { source: 'request', active: false },
  ])
})
