import { chooseLogoBackground, sampleLogoBackground, LOGO_BACKGROUND_FALLBACK } from '@/lib/client/logoContrast'
const pixel = (v, alpha = 255) => [v, v, v, alpha]
test('dark and light logos get opposite backgrounds', () => {
  expect(chooseLogoBackground(pixel(0))).toBe('#f8fafc')
  expect(chooseLogoBackground(pixel(255))).toBe('#18202b')
})
test('transparent padding does not skew the decision', () => {
  expect(chooseLogoBackground([...pixel(255, 0), ...pixel(0)])).toBe('#f8fafc')
  expect(chooseLogoBackground([...pixel(0, 0), ...pixel(255)])).toBe('#18202b')
})
test('mixed black and white artwork gets a balanced neutral background', () => {
  expect(chooseLogoBackground([...pixel(0), ...pixel(255)])).toBe('#767676')
})
test('empty and fully transparent artwork use safe fallback', () => {
  expect(chooseLogoBackground([])).toBe(LOGO_BACKGROUND_FALLBACK)
  expect(chooseLogoBackground(pixel(0, 0))).toBe(LOGO_BACKGROUND_FALLBACK)
})
test('unloaded images and unavailable canvas do not throw', () => {
  expect(sampleLogoBackground({ naturalWidth: 0 })).toBe(LOGO_BACKGROUND_FALLBACK)
  expect(sampleLogoBackground({ naturalWidth: 200, naturalHeight: 100 })).toBe(LOGO_BACKGROUND_FALLBACK)
})
test('canvas sampling stays bounded and catches cross-origin pixel errors', () => {
  const previous = global.document
  const context = { drawImage: jest.fn(), getImageData: jest.fn(() => ({ data: pixel(0) })) }
  const canvas = { getContext: () => context }
  global.document = { createElement: () => canvas }
  try {
    expect(sampleLogoBackground({ naturalWidth: 2000, naturalHeight: 1000 })).toBe('#f8fafc')
    expect([canvas.width, canvas.height]).toEqual([96, 48])
    context.getImageData.mockImplementation(() => { throw new Error('Tainted canvas') })
    expect(sampleLogoBackground({ naturalWidth: 2000, naturalHeight: 1000 })).toBe(LOGO_BACKGROUND_FALLBACK)
  } finally {
    if (previous === undefined) delete global.document
    else global.document = previous
  }
})
