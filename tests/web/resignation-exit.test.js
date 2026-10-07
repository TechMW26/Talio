import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ResignationExitPanel from '@/components/employees/ResignationExitPanel'
import ResignationPanel from '@/components/employees/ResignationPanel'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import useApiMutation from '@/hooks/useApiMutation'
jest.mock('@/hooks/useAuthedSWR', () => ({ __esModule: true, default: jest.fn() }))
jest.mock('@/hooks/useApiMutation', () => ({ __esModule: true, default: jest.fn() }))
jest.mock('@/components/employees/OffboardingAssetChecklistModal', () => ({ __esModule: true, default: () => null }))
let data, execute, mutate
beforeAll(() => { global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } })
beforeEach(() => {
  data = { status: 'accepted', version: 7, employeeId: 'employee', started: true, canManage: true, assets: { total: 0, cleared: 0, complete: true }, settlement: { date: '2026-09-29', savedAt: '2026-09-29', currency: 'INR', netAmount: 100, items: [{ label: 'Salary', amount: 100, type: 'earning' }] } }
  execute = jest.fn().mockResolvedValue({ success: true, message: 'Saved' }); mutate = jest.fn()
  useAuthedSWR.mockImplementation(() => ({ data: { data }, mutate }))
  useApiMutation.mockImplementation(() => ({ execute, isLoading: false }))
})
test('finalisation passes explicit confirmations and version', async () => {
  render(<ResignationExitPanel record={{ _id: 'request' }} />)
  expect(useAuthedSWR).toHaveBeenCalledWith('/api/resignations/request/exit', { refreshInterval: 60000, revalidateOnFocus: true })
  fireEvent.change(screen.getByLabelText(/Payment \/ recovery reference/), { target: { value: 'BANK-123' } })
  screen.getAllByRole('checkbox').forEach(checkbox => fireEvent.click(checkbox))
  fireEvent.click(screen.getByText('Finalise exit & send documents'))
  await waitFor(() => expect(execute).toHaveBeenCalledWith('/api/resignations/request/exit', expect.objectContaining({ action: 'finalise', version: 7, paymentReference: 'BANK-123', handoverConfirmed: true, accessConfirmed: true, settlementConfirmed: true })))
})
test('pending asset clearance disables finalisation', () => {
  data.assets.complete = false
  render(<ResignationExitPanel record={{ _id: 'request' }} />)
  expect(screen.getByText('Finalise exit & send documents')).toBeDisabled()
})
test.each(['not_sent', 'failed'])('completed exit can retry %s email without settlement form', async status => {
  data.status = 'completed'; data.document = { _id: 'doc', fileName: 'exit.pdf', emailDelivery: { status, recipient: 'qa@example.test' } }
  render(<ResignationExitPanel record={{ _id: 'request' }} />)
  expect(screen.queryByText('Finalise exit & send documents')).not.toBeInTheDocument()
  fireEvent.click(screen.getByText('Send documents by email'))
  await waitFor(() => expect(execute).toHaveBeenCalledWith('/api/resignations/request/exit', { action: 'send_documents', version: 7 }))
})
test('unknown email result does not expose an unsafe automatic retry', () => {
  data.status = 'completed'; data.document = { _id: 'doc', emailDelivery: { status: 'unknown' } }
  render(<ResignationExitPanel record={{ _id: 'request' }} />)
  expect(screen.queryByText('Send documents by email')).not.toBeInTheDocument()
  expect(screen.getByText(/Check the mail provider/)).toBeInTheDocument()
})
test('employee sees settlement but no HR controls', () => {
  data.canManage = false
  render(<ResignationExitPanel record={{ _id: 'request' }} />)
  expect(screen.getByText('Settlement: INR 100.00')).toBeInTheDocument()
  expect(screen.queryByText('Finalise exit & send documents')).not.toBeInTheDocument()
})
test('dedicated overview has approval, offboarding and completed dashboard tabs', () => {
  useAuthedSWR.mockReturnValue({ data: { data: [], canSubmit: true }, mutate })
  render(<ResignationPanel initialView="overview" />)
  expect(screen.getByText('Needs your action')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('tab', { name: 'My requests' }))
  expect(screen.getByText('Submit resignation')).toBeInTheDocument()
  expect(screen.getByText('F&F / Offboarding (0)')).toBeInTheDocument()
})
