import { createRef } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import UploadButton, { UploadInput } from '@/components/ui/UploadButton'

test('picker preserves file restrictions, multiple, refs and handler', () => {
  const ref = createRef(), change = jest.fn()
  render(<UploadInput ref={ref} accept="image/*" multiple onChange={change} label="Upload images" />)
  const files = [new File(['one'], 'one.png', { type: 'image/png' })]
  fireEvent.change(ref.current, { target: { files } })
  expect(change).toHaveBeenCalledTimes(1)
  expect(ref.current.accept).toBe('image/*')
  expect(ref.current.multiple).toBe(true)
  expect(screen.getByText('one.png')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Uploaded' })).toBeNull()
})
test('only confirmed done state announces success, not 100 percent progress', () => {
  const { rerender } = render(<UploadButton state="uploading" progress={100} />)
  expect(screen.getByRole('button').dataset.state).toBe('uploading')
  expect(screen.getByRole('button').disabled).toBe(true)
  rerender(<UploadButton state="done" />)
  expect(screen.getByRole('button', { name: 'Uploaded' }).dataset.state).toBe('done')
})
test('disabled prevents clicks; idle is a non-submitting button; error allows retry', () => {
  const click = jest.fn()
  const { rerender } = render(<UploadButton disabled onClick={click} />)
  fireEvent.click(screen.getByRole('button'))
  expect(click).not.toHaveBeenCalled()
  rerender(<UploadButton state="error" onClick={click} />)
  fireEvent.click(screen.getByRole('button', { name: 'Retry upload' }))
  expect(click).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button').type).toBe('button')
})
