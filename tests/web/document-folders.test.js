import React from 'react'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import DocumentFolders, { buildDocumentFolders, folderHue } from '@/components/employees/DocumentFolders'
import DocumentsPage from '@/app/dashboard/documents/page'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import { HeroUIProvider } from '@heroui/react'
import { preloadDocumentFiles } from '@/lib/client/documentFile'

jest.mock('@/hooks/useAuthedSWR', () => ({ __esModule: true, default: jest.fn() }))
jest.mock('@/hooks/useApiMutation', () => ({ __esModule: true, default: () => ({ execute: jest.fn() }) }))
jest.mock('@/contexts/SocketContext', () => ({ useSocket: () => ({}), REALTIME_EVENTS: {} }))
jest.mock('@/components/employees/EmployeeOnboardingDocuments', () => () => <div>My onboarding checklist</div>)
jest.mock('@/lib/client/documentFile', () => ({ fetchDocumentFile: jest.fn(), downloadDocumentFile: jest.fn(), preloadDocumentFiles: jest.fn() }))
jest.mock('@/lib/client/uploadFile', () => ({ uploadAuthenticatedFile: jest.fn() }))
const employee = { _id: 'one', firstName: 'Asha', lastName: 'Singh', employeeCode: 'E1', profilePicture: '/asha.jpg' }
const other = { _id: 'two', firstName: 'Meera', employeeCode: 'E2' }
const documents = [{ _id: 'doc', employee, fileName: 'Appointment letter', category: 'employment', createdAt: '2026-09-01' }]

const manyFolders = Array.from({ length: 25 }, (_, index) => ({ id: String(index), name: `Employee ${index}`, code: `CODE${index}`, documents: [] }))

test('public folders load in batches and hide Load more at the end', () => {
  render(<DocumentFolders folders={manyFolders} onOpen={jest.fn()} />)
  expect(screen.getAllByRole('button', { name: /^Open Employee/ })).toHaveLength(12)
  expect(screen.getByRole('status')).toHaveTextContent('Showing 12 of 25 folders')
  fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
  expect(screen.getAllByRole('button', { name: /^Open Employee/ })).toHaveLength(24)
  fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
  expect(screen.getAllByRole('button', { name: /^Open Employee/ })).toHaveLength(25)
  expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
})

test('search covers unloaded folders and resets the batch when cleared', () => {
  render(<DocumentFolders folders={manyFolders} onOpen={jest.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
  fireEvent.change(screen.getByLabelText('Search document folders'), { target: { value: 'CODE24' } })
  expect(screen.getByRole('button', { name: 'Open Employee 24 documents' })).toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('Showing 1 of 1 folders')
  fireEvent.change(screen.getByLabelText('Search document folders'), { target: { value: '' } })
  expect(screen.getAllByRole('button', { name: /^Open Employee/ })).toHaveLength(12)
})

test('loading and empty folders do not show pagination controls', () => {
  const view = render(<DocumentFolders folders={manyFolders} loading onOpen={jest.fn()} />)
  expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  view.rerender(<DocumentFolders folders={[]} onOpen={jest.fn()} />)
  expect(screen.getByText('No document folders available.')).toBeInTheDocument()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

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

test('preloads folder documents on hover and keyboard focus without opening', () => {
  const onOpen = jest.fn()
  render(<DocumentFolders folders={buildDocumentFolders(documents, [employee])} onOpen={onOpen} />)
  const folder = screen.getByRole('button', { name: 'Open Asha Singh documents' })
  fireEvent.mouseEnter(folder)
  expect(preloadDocumentFiles).toHaveBeenCalledWith(documents)
  fireEvent.focus(folder)
  expect(preloadDocumentFiles).toHaveBeenCalledWith(documents)
  expect(onOpen).not.toHaveBeenCalled()
})

test('searches names and codes and opens the selected folder', () => {
  const onOpen = jest.fn()
  render(<DocumentFolders folders={buildDocumentFolders(documents, [employee, other])} onOpen={onOpen} />)
  fireEvent.change(screen.getByLabelText('Search document folders'), { target: { value: 'e2' } })
  expect(screen.queryByRole('button', { name: 'Open Asha Singh documents' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Open Meera documents' }))
  expect(onOpen).toHaveBeenCalledWith('two', screen.getByRole('button', { name: 'Open Meera documents' }))
  fireEvent.change(screen.getByLabelText('Search document folders'), { target: { value: 'missing' } })
  expect(screen.getByText('No matching folders.')).toBeInTheDocument()
})

test('HR switches to organisation folders and opens documents in a dialog', async () => {
  localStorage.setItem('user', JSON.stringify({ ...employee, employeeId: 'one', role: 'hr' }))
  render(<HeroUIProvider disableAnimation><DocumentsPage /></HeroUIProvider>)
  expect(useAuthedSWR).toHaveBeenCalledWith('/api/documents?employeeId=one', { keepPreviousData: false })
  expect(screen.getByText('My onboarding checklist')).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Appointment letter' })).toBeInTheDocument()
  expect(screen.queryByLabelText('Document folders')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('tab', { name: 'Public' }))
  expect(screen.queryByText('My onboarding checklist')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Open Meera documents' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Open Asha Singh documents' }))
  expect(await screen.findByRole('dialog')).toBeInTheDocument()
  expect(within(screen.getByRole('dialog')).getByRole('heading', { name: 'Appointment letter' })).toBeInTheDocument()
  expect(screen.getByTitle('Download')).toBeInTheDocument()
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

test('employees see their documents directly without folders or a public switch', () => {
  useAuthedSWR.mockReturnValue({ data: { data: [...documents, { _id: 'mine', employee: other, fileName: 'My certificate' }] }, mutate: jest.fn() })
  localStorage.setItem('user', JSON.stringify({ ...other, employeeId: 'two', role: 'employee' }))
  render(<DocumentsPage />)
  expect(screen.queryByRole('tab', { name: 'Public' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Open Asha Singh documents' })).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Document folders')).not.toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'My certificate' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Appointment letter' })).not.toBeInTheDocument()
})

test('folder pastel colours are varied and stable after filtering', () => {
  expect(new Set(['a', 'b', 'c', 'd', 'e', 'f'].map(folderHue)).size).toBe(6)
  render(<DocumentFolders folders={buildDocumentFolders(documents, [employee, other])} onOpen={jest.fn()} />)
  const before = screen.getByRole('button', { name: 'Open Meera documents' }).style.getPropertyValue('--folder-hue')
  fireEvent.change(screen.getByLabelText('Search document folders'), { target: { value: 'Meera' } })
  expect(screen.getByRole('button', { name: 'Open Meera documents' }).style.getPropertyValue('--folder-hue')).toBe(before)
})

test.each([1, 2, 3])('stack of %i previews grows toward the front and spreads farther at the rear', count => {
  const files = Array.from({ length: count }, (_, index) => ({ _id: String(index), fileName: `File ${index}` }))
  render(<DocumentFolders folders={[{ id: 'stack', name: 'Stack', documents: files }]} onOpen={jest.fn()} />)
  const sheets = [...screen.getByRole('button', { name: 'Open Stack documents' }).querySelectorAll('[style]')]
    .filter(element => element.style.getPropertyValue('--stack-scale'))
  expect(sheets).toHaveLength(count)
  expect(sheets[count - 1].style.getPropertyValue('--stack-scale')).toBe('1')
  sheets.forEach((sheet, index) => {
    expect(Number(sheet.style.getPropertyValue('--stack-scale'))).toBeCloseTo(1 - (count - index - 1) * .05)
    expect(sheet.style.getPropertyValue('--hover-lift')).toBe(`${-12 - (count - index - 1) * 16}px`)
  })
})

test('personal grid displays loading and empty states without folders', () => {
  localStorage.setItem('user', JSON.stringify({ ...employee, employeeId: 'one', role: 'hr' }))
  useAuthedSWR.mockReturnValue({ isLoading: true })
  const view = render(<DocumentsPage />)
  expect(screen.getByLabelText('Loading documents')).toBeInTheDocument()
  useAuthedSWR.mockReturnValue({ data: { data: [] }, isLoading: false })
  view.rerender(<DocumentsPage />)
  expect(screen.getByText('No documents found')).toBeInTheDocument()
  expect(screen.queryByLabelText('Document folders')).not.toBeInTheDocument()
})
