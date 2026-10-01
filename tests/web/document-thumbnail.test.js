import { act, render, screen, waitFor } from '@testing-library/react'
import DocumentThumbnail from '@/components/employees/DocumentThumbnail'
import { fetchDocumentFile } from '@/lib/client/documentFile'
jest.mock('@/lib/client/documentFile', () => ({ fetchDocumentFile: jest.fn() }))

test('loads authenticated image previews only when visible and releases the object URL', async () => {
  let enter
  const original = global.IntersectionObserver
  global.IntersectionObserver = class { constructor(callback) { enter = callback } observe() {} disconnect() {} }
  const create = URL.createObjectURL, revoke = URL.revokeObjectURL
  URL.createObjectURL = jest.fn(() => 'blob:preview')
  URL.revokeObjectURL = jest.fn()
  fetchDocumentFile.mockResolvedValue(new Blob(['image'], { type: 'image/png' }))
  const view = render(<DocumentThumbnail file={{ fileName: 'Identity', fileUrl: '/api/files/private' }} />)
  expect(fetchDocumentFile).not.toHaveBeenCalled()
  act(() => enter([{ isIntersecting: true }]))
  await waitFor(() => expect(view.container.querySelector('img')).toHaveAttribute('src', 'blob:preview'))
  expect(view.container.querySelector('img')).toHaveClass('h-auto', 'w-full')
  view.rerender(<DocumentThumbnail file={{ fileName: 'Identity', fileUrl: '/api/files/private' }} compact />)
  expect(view.container.querySelector('img')).toHaveClass('h-auto', 'w-full', 'max-h-[180px]')
  expect(fetchDocumentFile).toHaveBeenCalledWith('/api/files/private', expect.objectContaining({ signal: expect.any(AbortSignal) }))
  view.unmount()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview')
  URL.createObjectURL = create; URL.revokeObjectURL = revoke
  global.IntersectionObserver = original
})

test('a missing file remains a labelled document card', () => {
  render(<DocumentThumbnail file={{ fileName: 'Offer letter', type: 'docx' }} />)
  expect(screen.getByText('Offer letter')).toBeInTheDocument()
})

test('folder placeholders and regular grid previews fill their available width', () => {
  const file = { fileName: 'Unavailable document' }
  const view = render(<DocumentThumbnail file={file} compact />)
  expect(view.container.firstChild).toHaveClass('w-full', 'max-w-full')
  expect(view.container.firstChild).toHaveStyle({ backgroundColor: '#7d8083', color: '#111827' })
  expect(view.container.firstChild).not.toHaveClass('bg-white')
  expect(view.container.firstChild.style.minHeight).toBe('calc(var(--folder-height, 300px) * 0.8)')
  view.rerender(<DocumentThumbnail file={file} />)
  expect(view.container.firstChild).toHaveClass('w-full')
  expect(view.container.firstChild).not.toHaveClass('w-52')
  expect(view.container.firstChild.style.minHeight).toBe('')
})
