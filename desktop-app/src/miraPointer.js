'use strict';

// Non-interactive, local-only overlay. It cannot focus or intercept other apps.
function createMiraPointer({ BrowserWindow, screen }) {
  let window = null, timer = null;
  function hide() {
    clearInterval(timer); timer = null;
    if (window && !window.isDestroyed()) window.close();
    window = null;
  }
  function show() {
    hide();
    window = new BrowserWindow({ width: 32, height: 32, transparent: true, frame: false, focusable: false, skipTaskbar: true, resizable: false, hasShadow: false, show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    window.setIgnoreMouseEvents(true);
    window.setAlwaysOnTop(true, 'screen-saver');
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    window.setContentProtection(true);
    const html = '<html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><style>html,body{margin:0;background:transparent;overflow:hidden}svg{width:24px;height:24px;filter:drop-shadow(0 1px 1px white)}</style><svg viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg"><path fill="#386de8" d="M128 110 Q125 45 185 67 Q209 77 239 102 L430 269 Q473 314 415 334 L336 338 L227 432 Q144 490 139 410 Z"/></svg></html>';
    window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    const move = () => { if (!window || window.isDestroyed()) return; const point = screen.getCursorScreenPoint(); window.setPosition(Math.round(point.x - 6), Math.round(point.y - 3), false); };
    window.once('ready-to-show', () => { if (window && !window.isDestroyed()) { move(); window.showInactive(); } });
    timer = setInterval(move, 16);
  }
  return { show, hide };
}
module.exports = { createMiraPointer };
