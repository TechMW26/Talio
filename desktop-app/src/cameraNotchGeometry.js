'use strict';
const { execFile } = require('child_process');
const path = require('path');
function cameraNotchBounds(display, geometry, aspectRatio = 16 / 9) {
  const hardware = geometry?.success && geometry.displayId === display.id && geometry.notchWidth > 0;
  const area = hardware ? display.bounds : display.workArea;
  const width = Math.round(Math.min(area.width, hardware ? geometry.notchWidth : 240));
  // The camera-only frameless window opts out of macOS's menu-bar constraint.
  // A black safe-area bridge starts at the physical display edge; video begins
  // below the notch, so neither the hardware cutout nor menu bar crops the feed.
  const notchBottom = hardware ? Math.max(0, Math.min(80, geometry.notchHeight)) : 0;
  const ratio = Number.isFinite(aspectRatio) && aspectRatio >= .25 && aspectRatio <= 4 ? aspectRatio : 16 / 9;
  return { x: Math.round(area.x + (hardware ? geometry.notchLeft : (area.width - width) / 2)), y: area.y,
    width, height: Math.min(area.height, Math.ceil((width - 12) / ratio + 6 + notchBottom)), inset: notchBottom };
}
function createCameraNotchGeometry({ platform, packaged, resourcesPath, run = execFile }) {
  let cached, pending, expires = 0;
  return async (display, aspectRatio) => {
    if (platform !== 'darwin') return cameraNotchBounds(display, null, aspectRatio);
    if (cached?.displayId !== display.id || Date.now() > expires) {
      if (!pending) {
        const helper = packaged ? path.join(resourcesPath, 'mira-control') : path.join(__dirname, '..', 'build', `mira-control-${process.arch}`);
        pending = new Promise(resolve => run(helper, [JSON.stringify({ type: 'notch_geometry', displayId: display.id })], { timeout: 1500, maxBuffer: 4096 }, (error, stdout) => {
          try { resolve(error ? null : JSON.parse(stdout)); } catch { resolve(null); }
        }));
      }
      cached = await pending; pending = null; expires = Date.now() + 30000;
    }
    return cameraNotchBounds(display, cached, aspectRatio);
  };
}
module.exports = { cameraNotchBounds, createCameraNotchGeometry };
