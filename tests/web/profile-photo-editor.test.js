import { render, screen, fireEvent } from '@testing-library/react'
import ProfilePhotoEditor from '@/components/profile/ProfilePhotoEditor'
import { DEFAULT_PHOTO_VIEWPORT, normalizePhotoViewport, photoViewportStyle } from '@/lib/profilePhotoViewport'

jest.mock('@/components/ui/fernly', () => ({
  Modal: ({ isOpen, children }) => isOpen ? <div>{children}</div> : null,
  ModalContent: ({ children }) => <div>{children}</div>, ModalHeader: ({ children }) => <header>{children}</header>, ModalBody: ({ children }) => <div>{children}</div>, ModalFooter: ({ children }) => <footer>{children}</footer>,
  Heading2: ({ children }) => <h2>{children}</h2>, NativeInput: props => <input {...props} />,
  Button: ({ children, onPress, isDisabled }) => <button onClick={onPress} disabled={isDisabled}>{children}</button>,
}))
test('editor changes display metadata but keeps both previews on the original image', () => {
  const change = jest.fn(), save = jest.fn(), source = 'data:image/png;base64,original'
  render(<ProfilePhotoEditor isOpen image={source} viewport={{ ...DEFAULT_PHOTO_VIEWPORT }} onChange={change} onSave={save} />)
  const avatar = screen.getByAltText('Avatar framing preview')
  expect(screen.getByAltText('Full original image — unchanged').getAttribute('src')).toBe(source)
  expect(avatar.getAttribute('src')).toBe(source)
  expect(screen.getByRole('button', { name: 'Save photo' }).disabled).toBe(true)
  fireEvent.load(avatar)
  fireEvent.change(screen.getByRole('slider', { name: 'Zoom' }), { target: { value: '2' } })
  expect(change).toHaveBeenCalledWith({ ...DEFAULT_PHOTO_VIEWPORT, scale: 2 })
  fireEvent.click(screen.getByRole('button', { name: 'Reset framing' }))
  expect(change).toHaveBeenLastCalledWith(DEFAULT_PHOTO_VIEWPORT)
  fireEvent.click(screen.getByRole('button', { name: 'Save photo' }))
  expect(save).toHaveBeenCalledTimes(1)
})
test('invalid viewport values are rejected; legacy photos use neutral display settings', () => {
  expect(() => normalizePhotoViewport({ scale: Infinity })).toThrow()
  expect(() => normalizePhotoViewport({ x: 101 })).toThrow()
  expect(() => normalizePhotoViewport({ rotation: '90' })).toThrow()
  expect(normalizePhotoViewport({ scale: 2 })).toEqual({ ...DEFAULT_PHOTO_VIEWPORT, scale: 2 })
  expect(photoViewportStyle({ scale: 2, x: 10 }).transform).toBe('translate(10%, 0%) scale(2) rotate(0deg)')
  expect(photoViewportStyle(null).transform).toContain('scale(1)')
})
