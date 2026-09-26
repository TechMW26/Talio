'use strict';

// Non-interactive, local-only overlay. It cannot focus or intercept other apps.
function createMiraPointer({ BrowserWindow }) {
  let window = null, timer = null, position = null, ready = false;
  const offset = 48;
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
    window.setPosition(Math.round(position.x - offset), Math.round(position.y - offset), false);
    window.showInactive();
  }
  function moveTo(point) {
    if (!window || window.isDestroyed() || !Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return;
    clearInterval(timer); timer = null;
    if (!position) { position = { x: point.x, y: point.y }; draw(); return; }
    const start = { ...position }, target = { x: point.x, y: point.y }, began = Date.now();
    timer = setInterval(() => {
      const t = Math.min(1, (Date.now() - began) / 180);
      const eased = t * t * (3 - 2 * t);
      position = { x: start.x + (target.x - start.x) * eased, y: start.y + (target.y - start.y) * eased };
      draw();
      if (t === 1) { clearInterval(timer); timer = null; }
    }, 16);
  }
  return { show, hide, moveTo };
}
module.exports = { createMiraPointer };
