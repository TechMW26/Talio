import { chooseLogoBackground, sampleLogoBackground, LOGO_BACKGROUND_FALLBACK } from '@/lib/client/logoContrast'
import fs from 'node:fs'
import path from 'node:path'
import postcss from 'postcss'
const pixel = (v, alpha = 255) => [v, v, v, alpha]
test('dark theme cannot override the adaptive logo surface or fallback text', () => {
  const css = postcss.parse(fs.readFileSync(path.join(process.cwd(), 'styles/dark-mode.css'), 'utf8'))
  css.walkRules(rule => {
    if (rule.selector.includes('.back-logo-container')) {
      rule.walkDecls(/^background(?:-.*)?$/, declaration => {
        expect(declaration.important).not.toBe(true)
      })
    }
    if (rule.selector.includes('.company-name-fallback')) {
      rule.walkDecls('color', declaration => expect(declaration.value).toBe('#1e293b'))
    }
  })
  const base = postcss.parse(fs.readFileSync(path.join(process.cwd(), 'src/component/Lanyard.css'), 'utf8'))
  const fallbackColors = []
  base.walkRules('.company-name-fallback', rule => rule.walkDecls('color', declaration => fallbackColors.push(declaration.value)))
  expect(fallbackColors).toContain('#1e293b')
})
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
