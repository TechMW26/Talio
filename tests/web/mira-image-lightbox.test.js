import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import MiraImageLightbox from '@/components/ui/MiraImageLightbox'
import MiraScreenshotGallery from '@/components/ui/MiraScreenshotGallery'

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = jest.fn(function () { this.setAttribute('open', '') })
  HTMLDialogElement.prototype.close = jest.fn(function () { this.removeAttribute('open') })
  URL.createObjectURL = jest.fn(() => 'blob:capture')
  URL.revokeObjectURL = jest.fn()
  global.fetch = jest.fn(async () => ({ ok: true, blob: async () => new Blob(['image']) }))
})
test('lightbox has keyboard navigation and a close button', async () => {
  const onChange = jest.fn(), onClose = jest.fn()
  render(<MiraImageLightbox items={[{ imageUrl: 'blob:a', label: 'First' }, { imageUrl: 'blob:b', label: 'Second' }]} index={0} onChange={onChange} onClose={onClose} />)
  await waitFor(() => expect(screen.getByAltText('First')).toBeTruthy())
  fireEvent.keyDown(screen.getByLabelText('Image viewer'), { key: 'ArrowRight' })
  expect(onChange).toHaveBeenCalledWith(1)
  fireEvent.click(screen.getByLabelText('Close image viewer'))
  expect(onClose).toHaveBeenCalled()
})
test('gallery opens authenticated capture in lightbox and releases blobs', async () => {
  const { unmount } = render(<MiraScreenshotGallery gallery={{ items: [{ id: 'a', capturedAt: '2026-09-25T12:00:00Z', imageUrl: '/api/activity/screenshot?id=a' }] }} />)
  await waitFor(() => expect(screen.getByRole('img')).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: /Open capture/ }))
  expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled()
  unmount()
  expect(URL.revokeObjectURL).toHaveBeenCalled()
})
test('refuses external URLs rather than leaking authentication', () => {
  render(<MiraImageLightbox items={[{ imageUrl: 'https://untrusted.example/image' }]} index={0} onChange={() => {}} onClose={() => {}} />)
  expect(fetch).not.toHaveBeenCalled()
  expect(screen.getByRole('alert')).toHaveTextContent('Invalid image source')
})
