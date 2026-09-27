'use strict';

// Non-interactive, local-only overlay. It cannot focus or intercept other apps.
function createMiraPointer({ BrowserWindow }) {
  let window = null, timer = null, position = null, ready = false;
  // SVG tip is (128, 64) in a 512 viewBox, placed at (42, 45).
  const offsetX = 48, offsetY = 48;
  function hide() {
    clearInterval(timer); timer = null;
    if (window && !window.isDestroyed()) window.close();
    window = null; position = null; ready = false;
  }
  function show() {
    hide();
    // Electron macOS renders <=64px transparent windows as opaque white
    // (electron/electron#38630). Keep a larger invisible backing surface.
    window = new BrowserWindow({ width: 128, height: 128, transparent: true, backgroundColor: '#00000000', frame: false, thickFrame: false, roundedCorners: false, focusable: false, skipTaskbar: true, resizable: false, hasShadow: false, show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    const pointerWindow = window;
    pointerWindow.setBackgroundColor('#00000000');
    window.setIgnoreMouseEvents(true);
    window.setAlwaysOnTop(true, 'screen-saver');
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    window.setContentProtection(true);
    const html = '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><style>:root{color-scheme:only light}html,body{margin:0;padding:0;width:100%;height:100%;background:transparent!important;overflow:hidden;pointer-events:none}svg{position:absolute;left:42px;top:45px;display:block;width:24px;height:24px;background:transparent!important}</style></head><body><svg viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg"><path fill="#386de8" d="M128 110 Q125 45 185 67 Q209 77 239 102 L430 269 Q473 314 415 334 L336 338 L227 432 Q144 490 139 410 Z"/></svg></body></html>';
    window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    window.once('ready-to-show', () => {
      if (window !== pointerWindow || pointerWindow.isDestroyed()) return;
      // Reassert alpha after Chromium creates its backing surface, before showing it.
      pointerWindow.setBackgroundColor('#00000000');
      ready = true;
      if (position) draw();
    });
  }
  function draw() {
    if (!ready || !position || !window || window.isDestroyed()) return;
    window.setPosition(Math.round(position.x - offsetX), Math.round(position.y - offsetY), false);
    window.showInactive();
    // Re-assert the highest supported app window level after other topmost
    // windows move or appear. The OS-owned hardware cursor remains compositor-owned.
    window.setAlwaysOnTop(true, 'screen-saver');
    window.moveTop();
  }
  function moveTo(point) {
    if (!window || window.isDestroyed() || !Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return;
    clearInterval(timer); timer = null;
    // Native input is immediate: display its actual target immediately too.
    position = { x: point.x, y: point.y }; draw();
  }
  return { show, hide, moveTo };
}
module.exports = { createMiraPointer };
