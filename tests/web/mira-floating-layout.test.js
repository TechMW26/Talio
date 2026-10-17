import { clampMiraFloating, miraFloatingSize, miraFloatingResult, readMiraFloatingPosition, saveMiraFloatingPosition } from '@/lib/miraFloatingLayout'

test('browser PiP remembers a drag, keeps its bottom anchor, and rejects corrupted storage', () => {
  localStorage.clear()
  expect(readMiraFloatingPosition({ width: 224, height: 224 })).toBeNull()
  saveMiraFloatingPosition({ left: 30, top: 100, width: 224, height: 224 })
  expect(readMiraFloatingPosition({ width: 224, height: 224 })).toEqual({ x: 30, y: 100 })
  expect(readMiraFloatingPosition({ width: 360, height: 444 })).toEqual({ x: -38, y: -120 })
  localStorage.setItem('talio:mira-floating-position:v1', '{bad')
  expect(readMiraFloatingPosition({ width: 224, height: 224 })).toBeNull()
  localStorage.clear()
})

test('transparent face padding may cross left and bottom edges without hiding the face', () => {
  expect(clampMiraFloating({ x: -999, y: 9999 }, { width: 224, height: 224 }, { width: 390, height: 650 }, false)).toEqual({ x: -40, y: 466 })
})
test('details stay fully readable horizontally and above the face, even on small screens', () => {
  const size = miraFloatingSize(true, { width: 320, height: 350 })
  expect(size).toEqual({ width: 320, height: 390 })
  expect(clampMiraFloating({ x: -999, y: 9999 }, size, { width: 320, height: 350 }, true)).toEqual({ x: 0, y: 0 })
})
test('normal voice and in-progress messages never become live captions', () => {
  const reply = { id: 'a', role: 'assistant', content: 'Hello!' }
  expect(miraFloatingResult(reply, true)).toBeNull()
  expect(miraFloatingResult({ ...reply, data: { nativeVoice: true } }, false)).toBeNull()
  expect(miraFloatingResult({ ...reply, streaming: true }, false)).toBeNull()
  expect(miraFloatingResult({ ...reply, role: 'user' }, false)).toBeNull()
  expect(miraFloatingResult(reply, false)).toBe(reply)
  const result = { ...reply, data: { voiceTool: true, cards: [{ type: 'stat' }] } }
  expect(miraFloatingResult(result, true)).toBe(result)
})
