const { createMiraPointer } = require('../../desktop-app/src/miraPointer')

describe('native MIRA pointer transparency', () => {
  let windows, pointer
  beforeEach(() => {
    jest.useFakeTimers()
    windows = []
    const BrowserWindow = jest.fn(function (options) {
      const instance = {
        options, callbacks: {},
        isDestroyed: jest.fn(() => false), close: jest.fn(),
        setBackgroundColor: jest.fn(), setIgnoreMouseEvents: jest.fn(),
        setAlwaysOnTop: jest.fn(), setVisibleOnAllWorkspaces: jest.fn(),
        setContentProtection: jest.fn(), setPosition: jest.fn(),
        showInactive: jest.fn(), loadURL: jest.fn(),
        once: jest.fn((event, cb) => { instance.callbacks[event] = cb }),
      }
      windows.push(instance)
      return instance
    })
    pointer = createMiraPointer({ BrowserWindow, screen: { getCursorScreenPoint: () => ({ x: 100, y: 200 }) } })
  })
  afterEach(() => { pointer.hide(); jest.useRealTimers() })

  test('shows only the arrow without a window fill, frame, shadow or white glow', () => {
    pointer.show()
    const win = windows[0]
    expect(win.options).toMatchObject({ transparent: true, backgroundColor: '#00000000', frame: false, thickFrame: false, roundedCorners: false, hasShadow: false, show: false, focusable: false })
    const html = decodeURIComponent(win.loadURL.mock.calls[0][0].split(',')[1])
    expect(html).toContain('background:transparent!important')
    expect(html).not.toContain('drop-shadow')
    expect(win.setIgnoreMouseEvents).toHaveBeenCalledWith(true)
    expect(win.showInactive).not.toHaveBeenCalled()
    win.callbacks['ready-to-show']()
    expect(win.setBackgroundColor).toHaveBeenNthCalledWith(2, '#00000000')
    expect(win.showInactive).toHaveBeenCalledTimes(1)
    expect(win.setPosition).toHaveBeenCalledWith(94, 197, false)
  })

  test('a stale ready callback cannot display a replacement window before it is ready', () => {
    pointer.show()
    const old = windows[0]
    pointer.show()
    old.callbacks['ready-to-show']()
    expect(windows[1].showInactive).not.toHaveBeenCalled()
    windows[1].callbacks['ready-to-show']()
    expect(windows[1].showInactive).toHaveBeenCalledTimes(1)
    pointer.hide()
    expect(jest.getTimerCount()).toBe(0)
  })
})
