import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import InductionSettings from '@/components/settings/InductionSettings'
import { inductionRequest } from '@/lib/client/induction'
import { uploadAuthenticatedFile } from '@/lib/client/uploadFile'
jest.mock('@/lib/client/induction', () => ({ inductionRequest: jest.fn() }))
jest.mock('@/lib/client/uploadFile', () => ({ uploadAuthenticatedFile: jest.fn() }))
jest.mock('@/components/induction/PresentationReader', () => ({ __esModule: true, default: ({ onReady, onRendered }) => <button onClick={() => { onReady(1); onRendered(1) }}>Preview page</button> }))
const existing = { title: 'A intro', version: 'a-v1', fileName: 'a.pdf', active: true, pageCount: 1 }
const catalog = { defaultProgram: null, companies: [{ id: 'a', name: 'Company A', code: 'A', program: existing }, { id: 'b', name: 'Company B', code: 'B', program: null }] }
beforeEach(() => {
  jest.clearAllMocks()
  inductionRequest.mockImplementation(async (body, options) => ({ ...catalog, program: options?.companyId === 'a' ? existing : null }))
  uploadAuthenticatedFile.mockResolvedValue({ data: { fileId: 'uploaded', fileName: 'b.pdf' } })
  window.confirm = jest.fn(() => true)
})
test('company cards select isolated settings and reset unsubmitted files when switching', async () => {
  render(<InductionSettings />)
  fireEvent.click(await screen.findByRole('button', { name: /Company A/ }))
  await screen.findByText('A intro')
  expect(inductionRequest).toHaveBeenCalledWith(undefined, { settings: true, companyId: 'a' })
  const file = new File(['test'], 'b.pdf', { type: 'application/pdf' }); file.arrayBuffer = async () => new ArrayBuffer(4)
  fireEvent.change(screen.getByLabelText('Induction presentation'), { target: { files: [file] } })
  await screen.findByRole('button', { name: 'Preview page' })
  fireEvent.click(screen.getByRole('button', { name: /Company B/ }))
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Preview page' })).not.toBeInTheDocument())
  expect(screen.queryByText('A intro')).not.toBeInTheDocument()
})
test('publishes to the selected company only after preview and acknowledgement', async () => {
  render(<InductionSettings />)
  fireEvent.click(await screen.findByRole('button', { name: /Company B/ }))
  await waitFor(() => expect(screen.getByLabelText('Induction presentation')).toBeEnabled())
  const file = new File(['test'], 'b.pdf', { type: 'application/pdf' }); file.arrayBuffer = async () => new ArrayBuffer(4)
  fireEvent.change(screen.getByLabelText('Induction presentation'), { target: { files: [file] } })
  fireEvent.click(await screen.findByRole('button', { name: 'Preview page' }))
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: 'Publish induction' }))
  await waitFor(() => expect(inductionRequest).toHaveBeenCalledWith(expect.objectContaining({ action: 'publish', companyId: 'b', previousVersion: null, previewConfirmed: true }), { settings: true }))
})
test('withdrawal targets the selected company version', async () => {
  render(<InductionSettings />)
  fireEvent.click(await screen.findByRole('button', { name: /Company A/ }))
  fireEvent.click(await screen.findByRole('button', { name: 'Withdraw presentation' }))
  await waitFor(() => expect(inductionRequest).toHaveBeenCalledWith({ action: 'withdraw', companyId: 'a', previousVersion: 'a-v1' }, { settings: true }))
})
