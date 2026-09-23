import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import fs from 'fs'
import path from 'path'
import CallAlertButton from '@/components/CallAlertButton'

jest.mock('@heroui/react', () => ({ Select: () => null, SelectItem: () => null }))
jest.mock('@/hooks/useRoles', () => ({ getRoleDisplayLabel: role => role }))
jest.mock('@/utils/toast', () => ({ __esModule: true, default: { error: jest.fn(), success: jest.fn() } }))

beforeEach(() => localStorage.clear())

test('floating trigger escapes transformed route containers and is cleaned up on unmount', () => {
  const view = render(<div style={{ transform: 'translateY(0)' }}><CallAlertButton user={{ role: 'admin' }} floating /></div>)
  const trigger = screen.getByRole('button', { name: 'Call / Alert' })
  expect(trigger.parentElement).toBe(document.body)
  expect(trigger).toHaveClass('fixed', 'z-40')
  expect(view.container).not.toContainElement(trigger)
  view.unmount()
  expect(screen.queryByRole('button', { name: 'Call / Alert' })).not.toBeInTheDocument()
})

test('inline usage remains inside its original container', () => {
  const view = render(<CallAlertButton user={{ role: 'admin' }} />)
  const trigger = screen.getByRole('button', { name: 'Call / Alert' })
  expect(view.container).toContainElement(trigger)
  expect(trigger).not.toHaveClass('fixed')
  expect(trigger).toHaveClass('rounded-full', 'bg-primary/10', 'text-primary')
  expect(trigger.style.background).toBe('')
})

test('header owns the trigger and dashboard no longer mounts a floating duplicate', () => {
  const header = fs.readFileSync(path.join(process.cwd(), 'components/Header.js'), 'utf8')
  const dashboard = fs.readFileSync(path.join(process.cwd(), 'components/dashboards/UnifiedDashboard.js'), 'utf8')
  expect(header).toContain('<CallAlertButton user={currentUser} />')
  expect(dashboard).not.toContain('<CallAlertButton')
})

test('header-style trigger opens the themed dialog without sending an alert', async () => {
  global.fetch = jest.fn().mockResolvedValue({ json: async () => ({ success: true, data: { departments: [], recipients: [], templates: [] } }) })
  render(<CallAlertButton user={{ role: 'admin' }} />)
  fireEvent.click(screen.getByRole('button', { name: 'Call / Alert' }))
  const dialog = await screen.findByRole('dialog', { name: 'Select Recipients' })
  expect(dialog).toHaveClass('bg-content1', 'text-foreground', 'rounded-[30px]')
  expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  expect(fetch.mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Close call alert' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test('denied permissions do not create a floating trigger', async () => {
  const previousFetch = global.fetch
  global.fetch = jest.fn().mockResolvedValue({ json: async () => ({ success: false }) })
  try {
    render(<CallAlertButton user={{ role: 'employee' }} floating />)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'Call / Alert' })).not.toBeInTheDocument()
  } finally {
    global.fetch = previousFetch
  }
})
