import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import EmploymentLetterEditor from '@/components/employees/EmploymentLetterEditor'
import { LETTER_FIELDS } from '@/lib/hrms/employmentLetter'
import { requestEmploymentLetter } from '@/lib/client/employmentLetter'
import { downloadDocumentFile, fetchDocumentFile } from '@/lib/client/documentFile'

jest.mock('@/lib/client/employmentLetter', () => ({ requestEmploymentLetter: jest.fn() }))
jest.mock('@/lib/client/documentFile', () => ({ downloadDocumentFile: jest.fn(), fetchDocumentFile: jest.fn() }))
jest.mock('@/utils/toast', () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }))

const fields = { ...Object.fromEntries(LETTER_FIELDS.map(([key]) => [key, 'Agreed details'])), issueDate: '2026-09-29', joiningDate: '2026-10-01', employeeName: 'Aman Tiwari', companyName: 'Test Company', employeeCode: 'E001', currency: 'INR', salaryAmount: 900000, salaryBasis: 'annual CTC', paymentFrequency: 'monthly' }
beforeEach(() => {
  requestEmploymentLetter.mockReset().mockResolvedValue({ success: true, data: { defaults: fields, logo: '/api/images/logo', email: 'aman@example.test' } })
  fetchDocumentFile.mockResolvedValue(new Blob(['test'], { type: 'image/png' }))
  downloadDocumentFile.mockReset().mockResolvedValue()
  URL.createObjectURL = jest.fn(() => 'blob:test-logo')
  URL.revokeObjectURL = jest.fn()
})

test('loads populated details, saves PDF before download, and sends the exact selected type', async () => {
  render(<EmploymentLetterEditor employeeId="employee-1" />)
  fireEvent.click(screen.getByRole('button', { name: 'Prepare offer / appointment letter' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Download PDF' })).toBeEnabled())
  expect(screen.getByLabelText(/Employee full name/)).toHaveValue('Aman Tiwari')
  expect(screen.queryByRole('button', { name: 'Save draft' })).not.toBeInTheDocument()
  const issued = { _id: 'document-1', fileUrl: '/api/documents/document-1/file', fileName: 'appointment.pdf' }
  requestEmploymentLetter.mockResolvedValueOnce({ success: true, data: issued, message: 'Saved' })
  fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }))
  await waitFor(() => expect(downloadDocumentFile).toHaveBeenCalledWith(issued))
  expect(requestEmploymentLetter).toHaveBeenLastCalledWith('employee-1', { kind: 'appointment', fields, sendEmail: false })
  requestEmploymentLetter.mockResolvedValueOnce({ success: true, data: { ...issued, emailDelivery: { status: 'sent', recipient: 'aman@example.test' } }, message: 'Sent' })
  fireEvent.click(screen.getByRole('button', { name: 'Save & send email' }))
  await screen.findByText(/Email sent to aman@example.test/)
  expect(requestEmploymentLetter).toHaveBeenLastCalledWith('employee-1', { kind: 'appointment', fields, sendEmail: true })
})

test('missing actual terms block issuing instead of inserting placeholders', async () => {
  requestEmploymentLetter.mockResolvedValue({ success: true, data: { defaults: { ...fields, manager: '' }, logo: '/api/images/logo', email: 'aman@example.test' } })
  render(<EmploymentLetterEditor employeeId="employee-1" />)
  fireEvent.click(screen.getByRole('button', { name: 'Prepare offer / appointment letter' }))
  await screen.findByText('Complete reporting manager before issuing the letter')
  expect(screen.getByRole('button', { name: 'Download PDF' })).toBeDisabled()
  fireEvent.change(screen.getByLabelText(/Reporting manager/), { target: { value: 'Riya Sharma' } })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Download PDF' })).toBeEnabled())
})

test('email failure keeps saved document visible and reports the delivery warning', async () => {
  render(<EmploymentLetterEditor employeeId="employee-1" />)
  fireEvent.click(screen.getByRole('button', { name: 'Prepare offer / appointment letter' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save & send email' })).toBeEnabled())
  requestEmploymentLetter.mockResolvedValueOnce({ success: true, data: { _id: 'document-1', emailDelivery: { status: 'failed' } }, warning: 'PDF saved; email failed' })
  fireEvent.click(screen.getByRole('button', { name: 'Save & send email' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('PDF saved; email failed')
  expect(screen.getByText('Letter saved in employee documents.')).toBeInTheDocument()
  expect(screen.queryByText(/Email sent to/)).not.toBeInTheDocument()
})

test('load failure exposes retry', async () => {
  requestEmploymentLetter.mockRejectedValueOnce(new Error('Service unavailable'))
  render(<EmploymentLetterEditor employeeId="employee-1" />)
  fireEvent.click(screen.getByRole('button', { name: 'Prepare offer / appointment letter' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Service unavailable')
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Download PDF' })).toBeEnabled())
})
