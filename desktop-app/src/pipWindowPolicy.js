'use strict';

function pipWindowOptions(details, openerUrl, appOrigin) {
  let trusted = false;
  try { trusted = new URL(openerUrl).origin === appOrigin; } catch {}
  if (!trusted || details.url !== 'about:blank' || details.frameName !== 'talio-live-pip') return null;
  return {
    action: 'allow',
    outlivesOpener: false,
    overrideBrowserWindowOptions: {
      title: 'Talio · Live', frame: false, alwaysOnTop: true,
      skipTaskbar: true, fullscreenable: false, minimizable: false,
      maximizable: false, resizable: false, minWidth: 180, minHeight: 80,
      transparent: true, hasShadow: false, show: false,
      useContentSize: true, backgroundColor: '#00000000',
      webPreferences: { nodeIntegration: false, contextIsolation: true, webSecurity: true, backgroundThrottling: false },
    },
  };
}

// workArea excludes the macOS Dock/menu bar and Windows taskbar, including
// side taskbars and displays with negative coordinates. Electron uses DIP units.
function pipBounds(workArea, size, margin = 16, saved, insets = {}) {
  const pad = key => Number.isFinite(insets[key]) ? Math.max(0, Math.min(40, insets[key])) : 0;
  const width = Math.min(size.width, Math.max(1, workArea.width - margin * 2));
  const height = Math.min(size.height, Math.max(1, workArea.height - margin * 2));
  return {
    x: Math.max(workArea.x - pad('left'), Math.min(workArea.x + workArea.width - width + pad('right'), Number.isFinite(saved?.x) ? saved.x : workArea.x + workArea.width - width - margin)),
    y: Math.max(workArea.y - pad('top'), Math.min(workArea.y + workArea.height - height + pad('bottom'), Number.isFinite(saved?.y) ? saved.y : workArea.y + workArea.height - height - margin)),
    width, height,
  };
}

function savedPipPoint(saved, size) {
  if (!Number.isFinite(saved?.x) || !Number.isFinite(saved?.y)) return undefined;
  const width = Number.isFinite(saved.width) && saved.width > 0 ? saved.width : size.width;
  const height = Number.isFinite(saved.height) && saved.height > 0 ? saved.height : size.height;
  return { x: saved.x + (width - size.width) / 2, y: saved.y + height - size.height };
}

function cameraWindowOptions(details, openerUrl, appOrigin) {
  if (details.frameName !== 'talio-camera-notch') return null;
  const options = pipWindowOptions({ ...details, frameName: 'talio-live-pip' }, openerUrl, appOrigin);
  if (options) Object.assign(options.overrideBrowserWindowOptions, { title: 'Mira camera', width: 360, height: 340 });
  return options;
}

module.exports = { pipWindowOptions, pipBounds, savedPipPoint, cameraWindowOptions };
