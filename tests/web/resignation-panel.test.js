import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ResignationPanel from '@/components/employees/ResignationPanel'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import useApiMutation from '@/hooks/useApiMutation'
jest.mock('@/hooks/useAuthedSWR', () => ({ __esModule: true, default: jest.fn() }))
jest.mock('@/hooks/useApiMutation', () => ({ __esModule: true, default: jest.fn() }))
let execute, mutate, data
const record = () => ({ _id: 'r1', own: true, active: true, reason: 'Moving to another city', status: 'employee_review', version: 3, createdAt: '2026-09-29T00:00:00Z', timeline: [], actions: ['accept', 'negotiate', 'withdraw'], proposal: { noticeDays: 30, noticeStartDate: '2026-09-29T00:00:00Z', lastWorkingDate: '2026-10-29T00:00:00Z', reason: 'Complete handover' } })
beforeEach(() => {
  execute = jest.fn().mockResolvedValue({ success: true, message: 'Saved' }); mutate = jest.fn()
  data = { data: [], canSubmit: true }
  useAuthedSWR.mockImplementation(() => ({ data, mutate }))
  useApiMutation.mockImplementation(() => ({ execute, isLoading: false }))
})
test('submission requires explicit acknowledgement and posts the entered reason', async () => {
  render(<ResignationPanel />)
  fireEvent.click(screen.getByText('Submit resignation'))
  expect(screen.getByText('Submit to HR')).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Reason for resignation'), { target: { value: 'Personal relocation' } })
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByText('Submit to HR'))
  await waitFor(() => expect(execute).toHaveBeenCalledWith('/api/resignations', { action: 'submit', reason: 'Personal relocation' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Saved')
})
test('dashboard keeps summary cards visible on every view and separates the primary action from navigation', () => {
  render(<ResignationPanel dashboard initialView="reviews" />)
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Resignations & Exits')
  expect(screen.getByRole('button', { name: 'View completed exits' })).toBeInTheDocument()
  const navigation = screen.getByRole('navigation', { name: 'Resignation views' })
  const submit = screen.getByRole('button', { name: 'Submit resignation' })
  expect(navigation).not.toContainElement(submit)
  expect(submit).toHaveClass('bg-primary')
  fireEvent.click(submit)
  expect(screen.getByLabelText('Reason for resignation')).toBeInTheDocument()
  expect(execute).not.toHaveBeenCalled()
})
test('employee can negotiate with a reason and current version', async () => {
  data.data = [record()]
  render(<ResignationPanel />)
  expect(screen.queryByText('Submit resignation')).not.toBeInTheDocument()
  fireEvent.click(screen.getByText('Negotiate notice period'))
  fireEvent.change(screen.getByLabelText('Requested change and reason'), { target: { value: 'Please reduce to 15 days because of relocation' } })
  fireEvent.click(screen.getByText('Confirm'))
  await waitFor(() => expect(execute).toHaveBeenCalledWith('/api/resignations', expect.objectContaining({ action: 'negotiate', version: 3, reason: 'Please reduce to 15 days because of relocation' })))
})
test('acceptance is not sent until confirmation and cancel is harmless', () => {
  data.data = [record()]
  render(<ResignationPanel />)
  fireEvent.click(screen.getByText('Accept notice period'))
  expect(screen.getByText(/You are accepting 30 days/)).toBeInTheDocument()
  expect(execute).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText('Cancel'))
  expect(execute).not.toHaveBeenCalled()
})
test('notification deep link opens reviewer inbox and role-specific actions', async () => {
  data.data = [{ ...record(), own: false, status: 'hierarchy_review', actions: ['propose'], employee: { firstName: 'Test', lastName: 'Employee' } }]
  render(<ResignationPanel requestId="r1" />)
  expect(await screen.findByText('Propose notice period')).toBeInTheDocument()
  expect(screen.queryByText('Accept notice period')).not.toBeInTheDocument()
  fireEvent.click(screen.getByText('Propose notice period'))
  expect(screen.getByLabelText('Notice period (calendar days)')).toHaveValue(30)
  expect(screen.getByLabelText('Notice start date')).toBeRequired()
})
test('load failures offer retry without enabling a submission', () => {
  useAuthedSWR.mockReturnValue({ error: new Error('Unavailable'), mutate })
  render(<ResignationPanel />)
  expect(screen.getByRole('alert')).toHaveTextContent('Unable to load')
  fireEvent.click(screen.getByText('Retry'))
  expect(mutate).toHaveBeenCalled()
  expect(screen.queryByText('Submit resignation')).not.toBeInTheDocument()
})
test('failed mutations retain the negotiation form and show an error', async () => {
  data.data = [record()]; execute.mockResolvedValue(null)
  useApiMutation.mockReturnValue({ execute, error: 'Request changed. Refresh.', isLoading: false })
  render(<ResignationPanel />)
  fireEvent.click(screen.getByText('Negotiate notice period'))
  fireEvent.change(screen.getByLabelText('Requested change and reason'), { target: { value: 'Shorter period please' } })
  fireEvent.click(screen.getByText('Confirm'))
  await waitFor(() => expect(execute).toHaveBeenCalled())
  expect(screen.getByLabelText('Requested change and reason')).toHaveValue('Shorter period please')
  expect(screen.getByRole('alert')).toHaveTextContent('Request changed')
})
