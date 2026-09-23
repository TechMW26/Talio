import { moveWhiteboardObject } from '@/lib/whiteboardGeometry'

describe('whiteboard movement after database hydration', () => {
  test.each(['rect', 'text', 'sticky', 'image', 'ellipse', 'diamond'])('%s with default empty points still moves', type => {
    const original = { type, x: 10, y: 20, points: [] }
    expect(moveWhiteboardObject(original, 5, -4)).toEqual({ ...original, x: 15, y: 16 })
    expect(original.x).toBe(10)
  })
  test('paths move all points and their curve control point', () => {
    const original = { type: 'curvedArrow', points: [{ x: 1, y: 2 }, { x: 3, y: 4 }], controlPoint: { x: 5, y: 6 } }
    expect(moveWhiteboardObject(original, 10, 20)).toEqual({ type: 'curvedArrow', points: [{ x: 11, y: 22 }, { x: 13, y: 24 }], controlPoint: { x: 15, y: 26 } })
  })
})
