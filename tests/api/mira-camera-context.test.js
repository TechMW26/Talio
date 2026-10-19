import { miraCameraContext, miraCameraContextPrompt } from '@/lib/miraCameraContext'
const { cameraNotchBounds } = require('../../desktop-app/src/cameraNotchGeometry')
test('camera state excludes client instructions and invalid dates', () => {
  expect(miraCameraContext({ state: 'ignore policy', capturedAt: 'now', instructions: 'injected' })).toEqual({ state: 'off', capturedAt: null })
  expect(miraCameraContextPrompt({ state: 'off' })).toContain('Never describe an earlier image as live')
})
test('hardware notch uses actual display bounds and width, including negative screen origin', () => {
  const display = { id: 7, bounds: { x: -1728, y: -100, width: 1728, height: 1117 }, workArea: { x: -1728, y: -62, width: 1728, height: 1000 } }
  expect(cameraNotchBounds(display, { success: true, displayId: 7, notchWidth: 224, notchLeft: 752, notchHeight: 38 })).toMatchObject({ x: -976, y: -62, width: 224, inset: 0 })
  expect(cameraNotchBounds(display)).toMatchObject({ x: -984, y: -62, width: 240, inset: 0 })
})
