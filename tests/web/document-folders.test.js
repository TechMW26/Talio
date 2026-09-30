import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import DocumentFolders, { buildDocumentFolders } from '@/components/employees/DocumentFolders'
import DocumentsPage from '@/app/dashboard/documents/page'
import useAuthedSWR from '@/hooks/useAuthedSWR'

jest.mock('@/hooks/useAuthedSWR', () => ({ __esModule: true, default: jest.fn() }))
jest.mock('@/hooks/useApiMutation', () => ({ __esModule: true, default: () => ({ execute: jest.fn() }) }))
jest.mock('@/contexts/SocketContext', () => ({ useSocket: () => ({}), REALTIME_EVENTS: {} }))
jest.mock('@/components/employees/EmployeeOnboardingDocuments', () => () => <div>My onboarding checklist</div>)
jest.mock('@/lib/client/documentFile', () => ({ fetchDocumentFile: jest.fn(), downloadDocumentFile: jest.fn() }))
jest.mock('@/lib/client/uploadFile', () => ({ uploadAuthenticatedFile: jest.fn() }))
const employee = { _id: 'one', firstName: 'Asha', lastName: 'Singh', employeeCode: 'E1', profilePicture: '/asha.jpg' }
const other = { _id: 'two', firstName: 'Meera', employeeCode: 'E2' }
const documents = [{ _id: 'doc', employee, fileName: 'Appointment letter', category: 'employment', createdAt: '2026-09-01' }]

beforeEach(() => {
  localStorage.clear()
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  useAuthedSWR.mockImplementation(key => ({ data: { data: key?.startsWith('/api/employees') ? [employee, other] : documents }, mutate: jest.fn() }))
})

test('groups documents by employee and includes empty and company folders', () => {
  const folders = buildDocumentFolders([...documents, { _id: 'shared' }], [employee, other])
  expect(folders).toHaveLength(3)
  expect(folders.find(f => f.id === 'one')).toMatchObject({ photo: '/asha.jpg', documents })
  expect(folders.find(f => f.id === 'two').documents).toEqual([])
  expect(folders.find(f => f.id === 'company').documents).toHaveLength(1)
})

test('searches names and codes and opens the selected folder', () => {
  const onOpen = jest.fn()
  render(<DocumentFolders folders={buildDocumentFolders(documents, [employee, other])} onOpen={onOpen} />)
  fireEvent.change(screen.getByLabelText('Search document folders'), { target: { value: 'e2' } })
  expect(screen.queryByRole('button', { name: 'Open Asha Singh documents' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Open Meera documents' }))
  expect(onOpen).toHaveBeenCalledWith('two')
  fireEvent.change(screen.getByLabelText('Search document folders'), { target: { value: 'missing' } })
  expect(screen.getByText('No matching folders.')).toBeInTheDocument()
})

test('HR switches to organisation folders and opens documents in a dialog', async () => {
  localStorage.setItem('user', JSON.stringify({ ...employee, employeeId: 'one', role: 'hr' }))
  render(<DocumentsPage />)
  expect(screen.getByText('My onboarding checklist')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('tab', { name: 'Public' }))
  expect(screen.queryByText('My onboarding checklist')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Open Meera documents' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Open Asha Singh documents' }))
  expect(await screen.findByRole('dialog')).toBeInTheDocument()
  expect(screen.getByText('Appointment letter')).toBeInTheDocument()
  expect(screen.getByTitle('Download')).toBeInTheDocument()
})

test('employees have only their personal folder and no public switch', () => {
  localStorage.setItem('user', JSON.stringify({ ...other, employeeId: 'two', role: 'employee' }))
  render(<DocumentsPage />)
  expect(screen.queryByRole('tab', { name: 'Public' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Open Asha Singh documents' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Open Meera documents' })).toBeInTheDocument()
})
