import { prepareCompanyLogo, validateCompanyLogo } from '@/lib/client/companyLogo'

afterEach(() => jest.restoreAllMocks())

test.each(['image/svg+xml', 'image/webp', 'image/png', 'image/jpeg', 'image/jpg', 'image/gif'])('accepts %s logos', type => {
  expect(() => validateCompanyLogo(new File(['image'], 'logo', { type }))).not.toThrow()
})

test('accepts known extensions with missing MIME but rejects non-image types', () => {
  expect(() => validateCompanyLogo(new File(['svg'], 'logo.SVG'))).not.toThrow()
  expect(() => validateCompanyLogo(new File(['html'], 'logo.svg', { type: 'text/html' }))).toThrow('Choose an SVG')
})

test('rasterizes SVG, bounds dimensions, and releases preview resources', async () => {
  URL.createObjectURL = jest.fn(() => 'blob:test')
  URL.revokeObjectURL = jest.fn()
  const drawImage = jest.fn()
  let canvas
  jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function () { canvas = this; return { drawImage } })
  jest.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(new Blob(['webp'], { type: 'image/webp' })))
  jest.spyOn(window, 'Image').mockImplementation(() => ({ naturalWidth: 4096, naturalHeight: 2048, set src(value) { if (value) this.onload() } }))
  const output = await prepareCompanyLogo(new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' }))
  expect(output.type).toBe('image/webp')
  expect([canvas.width, canvas.height]).toEqual([1024, 512])
  expect(drawImage).toHaveBeenCalled()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test')
})

test('rejects undecodable images and releases their object URL', async () => {
  URL.createObjectURL = jest.fn(() => 'blob:broken')
  URL.revokeObjectURL = jest.fn()
  jest.spyOn(window, 'Image').mockImplementation(() => ({ set src(value) { if (value) this.onerror() } }))
  await expect(prepareCompanyLogo(new File(['broken'], 'logo.png', { type: 'image/png' }))).rejects.toThrow('could not be read')
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:broken')
})
