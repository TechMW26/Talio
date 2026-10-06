import { retryPageError } from '@/lib/client/retryPageError'

test.each([
  { name: 'ChunkLoadError', message: 'Loading chunk widget failed' },
  { message: 'Loading chunk widget failed.' },
  { message: 'Failed to fetch dynamically imported module: /widget.js' },
])('user retry reloads a failed chunk instead of reusing its rejected import', error => {
  const reset = jest.fn(), reload = jest.fn()
  retryPageError(error, reset, reload)
  expect(reload).toHaveBeenCalledTimes(1)
  expect(reset).not.toHaveBeenCalled()
})

test('normal render errors use the existing non-destructive boundary reset', () => {
  const reset = jest.fn(), reload = jest.fn()
  retryPageError(new Error('Render failed'), reset, reload)
  expect(reset).toHaveBeenCalledTimes(1)
  expect(reload).not.toHaveBeenCalled()
})
