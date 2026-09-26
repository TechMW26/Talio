// Renderer smoke test: never clicks, types, captures other apps or moves the OS cursor.
const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict')
const { createMiraPointer } = require('../src/miraPointer')

app.whenReady().then(async () => {
  let win
  const pointer = createMiraPointer({ BrowserWindow: function (options) {
    win = new BrowserWindow(options)
    return win
  } })
  try {
    pointer.show()
    await new Promise(resolve => win.once('ready-to-show', resolve))
    pointer.moveTo({ x: 160, y: 160 })
    await new Promise(resolve => setTimeout(resolve, 250))
    const capture = await win.webContents.capturePage()
    const bitmap = capture.toBitmap()
    // NativeImage bitmap is BGRA. The backing canvas corner must have zero alpha.
    assert.equal(bitmap[3], 0, 'Pointer background must be transparent')
    let visible = 0, white = 0
    for (let i = 0; i < bitmap.length; i += 4) {
      if (bitmap[i + 3]) visible++
      if (bitmap[i + 3] && bitmap[i] > 240 && bitmap[i + 1] > 240 && bitmap[i + 2] > 240) white++
    }
    assert(visible > 0, 'Arrow should be visible')
    assert.equal(white, 0, 'No white rectangle or glow')
    assert(visible < bitmap.length / 16, 'Most of the overlay must remain transparent')
    console.log('PASS: actual Electron cursor surface has transparent corners, a visible arrow, and no white pixels.')
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  } finally {
    pointer.hide()
    app.exit(process.exitCode || 0)
  }
})
