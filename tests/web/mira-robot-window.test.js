import { subscribeRobotFrame, robotPointer } from '@/lib/miraRobotWindowLoop'

function fakeDocument() {
  const doc = new EventTarget(), view = new EventTarget(), frames = new Map()
  let id = 0
  Object.assign(view, { closed: false, requestAnimationFrame: jest.fn(fn => { frames.set(++id, fn); return id }), cancelAnimationFrame: jest.fn(id => frames.delete(id)) })
  Object.assign(doc, { hidden: false, defaultView: view })
  return { doc, frames, tick(now) { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn(now)) } }
}
beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())
test('canvas adoption switches to the visible child clock and pointer while opener sleeps', () => {
  const main = fakeDocument(), child = fakeDocument(), draw = jest.fn()
  let owner = main.doc
  const unsubscribe = subscribeRobotFrame(draw, () => owner)
  main.tick(10)
  expect(draw).toHaveBeenCalledTimes(1)
  main.doc.hidden = true; main.doc.dispatchEvent(new Event('visibilitychange'))
  expect(main.frames.size).toBe(0)
  owner = child.doc
  jest.advanceTimersByTime(250)
  child.doc.dispatchEvent(new MouseEvent('pointermove', { clientX: 50, clientY: 80 }))
  expect(robotPointer(child.doc)).toEqual({ x: 50, y: 80 })
  expect(Number.isNaN(robotPointer(main.doc).x)).toBe(true)
  child.tick(20); child.tick(36)
  expect(draw).toHaveBeenCalledTimes(2)
  child.tick(54)
  expect(draw).toHaveBeenLastCalledWith(.034)
  unsubscribe()
  expect(child.frames.size).toBe(0)
  expect(jest.getTimerCount()).toBe(0)
})
test('multiple heads share one clock per document and stop when hidden', () => {
  const target = fakeDocument(), first = jest.fn(), second = jest.fn()
  const stop1 = subscribeRobotFrame(first, () => target.doc)
  const stop2 = subscribeRobotFrame(second, () => target.doc)
  expect(target.frames.size).toBe(1)
  target.tick(10)
  expect(first).toHaveBeenCalledTimes(1)
  expect(second).toHaveBeenCalledTimes(1)
  stop1()
  target.doc.hidden = true; target.doc.dispatchEvent(new Event('visibilitychange'))
  expect(target.frames.size).toBe(0)
  target.doc.hidden = false; target.doc.dispatchEvent(new Event('visibilitychange'))
  target.tick(30)
  expect(first).toHaveBeenCalledTimes(1)
  expect(second).toHaveBeenCalledTimes(2)
  stop2()
})

test('offscreen heads skip raster work and resume when visible or moved into PiP', () => {
  const main = fakeDocument(), child = fakeDocument(), draw = jest.fn()
  main.doc.defaultView.innerHeight = 600; main.doc.defaultView.innerWidth = 800
  child.doc.defaultView.innerHeight = 600; child.doc.defaultView.innerWidth = 800
  let owner = main.doc, top = 900
  const element = { getBoundingClientRect: jest.fn(() => ({ top, bottom: top + 40, left: 10, right: 50, width: 40, height: 40 })) }
  const stop = subscribeRobotFrame(draw, () => owner, () => element)
  main.tick(10); main.tick(44)
  expect(draw).not.toHaveBeenCalled()
  expect(element.getBoundingClientRect).toHaveBeenCalledTimes(1)
  owner = child.doc; top = 10
  jest.advanceTimersByTime(250); child.tick(100)
  expect(draw).toHaveBeenCalledTimes(1)
  stop()
})
