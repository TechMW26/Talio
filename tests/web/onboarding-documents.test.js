import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import EmployeeOnboardingDocuments from '@/components/employees/EmployeeOnboardingDocuments'
import OnboardingVerificationModal from '@/components/employees/OnboardingVerificationModal'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import { uploadAuthenticatedFile } from '@/lib/client/uploadFile'

jest.mock('@/hooks/useAuthedSWR', () => ({ __esModule: true, default: jest.fn() }))
jest.mock('@/lib/client/uploadFile', () => ({ uploadAuthenticatedFile: jest.fn() }))
jest.mock('@/utils/toast', () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }))
const item = { key: 'documents', label: 'Joining documents', completed: false }
const file = { requirementKey: 'aadhaar', fileName: 'aadhaar.pdf', fileId: '507f1f77bcf86cd799439011', fileUrl: '/api/images/507f1f77bcf86cd799439011', fileSize: 100, fileType: 'application/pdf' }

beforeEach(() => {
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
})

test('profile phone is autofilled and refreshes without erasing emergency contact input', async () => {
  const profile = { key: 'profile', label: 'Employee profile', completed: false }
  const submit = jest.fn().mockResolvedValue(false)
  const view = render(<OnboardingVerificationModal isOpen item={profile} profilePhone="9000000001" mode="submit" onVerify={submit} />)
  const phone = await screen.findByLabelText(/Employee phone number/)
  expect(phone).toHaveValue('9000000001')
  expect(phone).toHaveAttribute('readonly')
  fireEvent.change(screen.getByLabelText(/Emergency contact name/), { target: { value: 'Test Contact' } })
  view.rerender(<OnboardingVerificationModal isOpen item={profile} profilePhone="9000000002" mode="submit" onVerify={submit} />)
  expect(phone).toHaveValue('9000000002')
  expect(screen.getByLabelText(/Emergency contact name/)).toHaveValue('Test Contact')
  fireEvent.click(screen.getByRole('button', { name: 'Submit to HR' }))
  await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({ details: expect.objectContaining({ phone: '9000000002', emergencyContactName: 'Test Contact' }) })))
})

test('phone can be entered when employee account has none', async () => {
  render(<OnboardingVerificationModal isOpen item={{ key: 'profile', label: 'Employee profile' }} mode="submit" />)
  expect(await screen.findByLabelText(/Employee phone number/)).not.toHaveAttribute('readonly')
})

test('documents page displays pending state and opens the shared onboarding upload form', async () => {
  useAuthedSWR.mockReturnValue({ data: { data: { enabled: true, checklist: [{ ...item, submission: { status: 'pending', verification: { documents: [file] } } }] } }, mutate: jest.fn() })
  render(<EmployeeOnboardingDocuments />)
  expect(screen.getByText('Pending HR review')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /Joining documents/ }))
  await screen.findByRole('button', { name: 'Submit to HR' })
  expect(screen.getByText('Aadhaar card')).toBeInTheDocument()
  expect(screen.getByText('Passport')).toBeInTheDocument()
  expect(screen.getByText('Other onboarding document')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Verify and complete' })).not.toBeInTheDocument()
})

test('profile KYC Aadhaar shows a submitted check and no duplicate file picker', async () => {
  const linkedEvidence = { aadhaar: [{ fileName: 'Aadhaar Card (Front)', fileUrl: '/api/images/front' }, { fileName: 'Aadhaar Card (Back)', fileUrl: '/api/images/back' }] }
  useAuthedSWR.mockReturnValue({ data: { data: { enabled: true, linkedEvidence, checklist: [item] } } })
  render(<EmployeeOnboardingDocuments />)
  fireEvent.click(screen.getByRole('button', { name: /Joining documents/ }))
  expect(await screen.findByText('Submitted through profile KYC')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'View Aadhaar Card (Front)' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'View Aadhaar Card (Back)' })).toBeInTheDocument()
  expect(screen.getByText('Aadhaar card').closest('label')).toBeNull()
  expect(screen.getByText('PAN card').closest('label').querySelector('input[type="file"]')).toBeInTheDocument()
})

test('partial evidence can be submitted from the employee form but not approved', async () => {
  const submit = jest.fn().mockResolvedValue(true), close = jest.fn()
  render(<OnboardingVerificationModal isOpen item={{ ...item, submission: { status: 'pending', verification: { documents: [file] } } }} mode="submit" onVerify={submit} onClose={close} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Submit to HR' }))
  await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({ documents: [file] })))
  expect(close).toHaveBeenCalled()
})

test('HR review offers feedback and requires remaining evidence for approval', async () => {
  const verify = jest.fn(), changes = jest.fn().mockResolvedValue(true)
  render(<OnboardingVerificationModal isOpen item={{ ...item, submission: { status: 'pending', verification: { documents: [file] } } }} onVerify={verify} onRequestChanges={changes} onClose={jest.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Verify and complete' }))
  expect(verify).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('Feedback if changes are required'), { target: { value: 'Please upload the remaining documents.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Request changes' }))
  await waitFor(() => expect(changes).toHaveBeenCalledWith('Please upload the remaining documents.'))
})

test('successful uploads are retained when a later file fails', async () => {
  uploadAuthenticatedFile.mockReset().mockResolvedValueOnce({ data: file }).mockRejectedValueOnce(new Error('Network interrupted')).mockResolvedValueOnce({ data: { ...file, fileName: 'pan.pdf' } })
  const submit = jest.fn().mockResolvedValue(false)
  render(<OnboardingVerificationModal isOpen item={item} mode="submit" onVerify={submit} onClose={jest.fn()} />)
  await screen.findByRole('button', { name: 'Submit to HR' })
  const inputs = document.querySelectorAll('input[type="file"]')
  fireEvent.change(inputs[0], { target: { files: [new File(['a'], 'aadhaar.pdf', { type: 'application/pdf' })] } })
  fireEvent.change(inputs[1], { target: { files: [new File(['p'], 'pan.pdf', { type: 'application/pdf' })] } })
  fireEvent.click(screen.getByRole('button', { name: 'Submit to HR' }))
  await waitFor(() => expect(uploadAuthenticatedFile).toHaveBeenCalledTimes(2))
  await screen.findByRole('button', { name: 'Submit to HR' })
  fireEvent.click(screen.getByRole('button', { name: 'Submit to HR' }))
  await waitFor(() => expect(submit).toHaveBeenCalled())
  expect(uploadAuthenticatedFile).toHaveBeenCalledTimes(3)
})
