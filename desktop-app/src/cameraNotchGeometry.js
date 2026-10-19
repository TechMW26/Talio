'use strict';
const { execFile } = require('child_process');
const path = require('path');
function cameraNotchBounds(display, geometry) {
  const hardware = geometry?.success && geometry.displayId === display.id && geometry.notchWidth > 0;
  const area = hardware ? display.bounds : display.workArea;
  const width = Math.round(Math.min(area.width, hardware ? geometry.notchWidth : 240));
  // Join the hardware notch's lower edge. macOS constrains normal windows
  // below its menu bar, so drawing a second safe-area spacer creates a gap.
  const notchBottom = hardware ? Math.max(0, Math.min(80, geometry.notchHeight)) : 0;
  return { x: Math.round(area.x + (hardware ? geometry.notchLeft : (area.width - width) / 2)), y: area.y + notchBottom,
    width, height: Math.ceil(width * 0.66 + 36), inset: 0 };
}
function createCameraNotchGeometry({ platform, packaged, resourcesPath, run = execFile }) {
  let cached, pending, expires = 0;
  return async display => {
    if (platform !== 'darwin') return cameraNotchBounds(display);
    if (cached?.displayId !== display.id || Date.now() > expires) {
      if (!pending) {
        const helper = packaged ? path.join(resourcesPath, 'mira-control') : path.join(__dirname, '..', 'build', `mira-control-${process.arch}`);
        pending = new Promise(resolve => run(helper, [JSON.stringify({ type: 'notch_geometry', displayId: display.id })], { timeout: 1500, maxBuffer: 4096 }, (error, stdout) => {
          try { resolve(error ? null : JSON.parse(stdout)); } catch { resolve(null); }
        }));
      }
      cached = await pending; pending = null; expires = Date.now() + 30000;
    }
    return cameraNotchBounds(display, cached);
  };
}
module.exports = { cameraNotchBounds, createCameraNotchGeometry };
