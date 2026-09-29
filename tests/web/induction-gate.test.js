import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import InductionGate from '@/components/induction/InductionGate'
import { inductionRequest } from '@/lib/client/induction'
import { fetchDocumentFile } from '@/lib/client/documentFile'
import { usePathname } from 'next/navigation'

jest.mock('next/navigation', () => ({ usePathname: jest.fn() }))
jest.mock('@/lib/client/induction', () => ({ inductionRequest: jest.fn() }))
jest.mock('@/lib/client/documentFile', () => ({ fetchDocumentFile: jest.fn() }))
jest.mock('@/components/induction/PresentationReader', () => ({ __esModule: true, default: ({ page, onRendered, onError }) => <div>
  <button onClick={() => onRendered(page)}>Render page {page}</button>
  <button onClick={() => onError(new Error('Unreadable page'))}>Fail page</button>
</div> }))

const pending = { required: true, canManage: false, viewedThrough: 0, program: { version: 'v1', title: 'Welcome to Talio', pageCount: 2, format: 'pdf' } }
beforeEach(() => {
  jest.clearAllMocks()
  usePathname.mockReturnValue('/dashboard')
  fetchDocumentFile.mockResolvedValue({ arrayBuffer: async () => new ArrayBuffer(8) })
  inductionRequest.mockImplementation(async body => body?.action === 'acknowledge' ? { ...pending, required: false, viewedThrough: 2 } : body?.action === 'page' ? { ...pending, viewedThrough: body.page } : pending)
})

test('blocks the dashboard until every page renders and an explicit acknowledgement is saved', async () => {
  render(<InductionGate><p>Private dashboard</p></InductionGate>)
  expect(screen.queryByText('Private dashboard')).not.toBeInTheDocument()
  await screen.findByRole('button', { name: 'Render page 1' })
  expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Render page 1' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  expect(screen.getByRole('button', { name: 'Acknowledge & complete' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Render page 2' }))
  await waitFor(() => expect(screen.getByRole('checkbox')).toBeEnabled())
  expect(screen.getByRole('button', { name: 'Acknowledge & complete' })).toBeDisabled()
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: 'Acknowledge & complete' }))
  await screen.findByText('Private dashboard')
  expect(inductionRequest).toHaveBeenCalledWith({ action: 'acknowledge', version: 'v1', acknowledged: true })
})

test('resumes the next unread page after a new session', async () => {
  inductionRequest.mockResolvedValue({ ...pending, viewedThrough: 1 })
  render(<InductionGate><p>Private dashboard</p></InductionGate>)
  await screen.findByRole('button', { name: 'Render page 2' })
  expect(screen.getByText('Page 2 of 2')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Previous' })).toBeEnabled()
})

test('a failed page cannot be acknowledged and exposes retry', async () => {
  render(<InductionGate><p>Private dashboard</p></InductionGate>)
  fireEvent.click(await screen.findByRole('button', { name: 'Fail page' }))
  expect(screen.getByRole('alert')).toHaveTextContent('Unreadable page')
  expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await waitFor(() => expect(fetchDocumentFile).toHaveBeenCalledTimes(2))
})

test('HR retains settings access to replace or withdraw broken content', async () => {
  inductionRequest.mockResolvedValue({ ...pending, canManage: true })
  usePathname.mockReturnValue('/dashboard/settings')
  render(<InductionGate><p>HR settings</p></InductionGate>)
  await screen.findByText('HR settings')
  expect(fetchDocumentFile).not.toHaveBeenCalled()
})

test('employees cannot bypass the gate by navigating to settings', async () => {
  usePathname.mockReturnValue('/dashboard/settings')
  render(<InductionGate><p>Employee settings</p></InductionGate>)
  await screen.findByRole('button', { name: 'Render page 1' })
  expect(screen.queryByText('Employee settings')).not.toBeInTheDocument()
})

test('no published presentation allows normal use', async () => {
  inductionRequest.mockResolvedValue({ required: false, program: null })
  render(<InductionGate><p>Private dashboard</p></InductionGate>)
  await screen.findByText('Private dashboard')
})
