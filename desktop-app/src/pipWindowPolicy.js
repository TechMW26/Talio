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
      maximizable: false, resizable: true, minWidth: 180, minHeight: 80,
      useContentSize: true, backgroundColor: '#151518',
      webPreferences: { nodeIntegration: false, contextIsolation: true, webSecurity: true, backgroundThrottling: false },
    },
  };
}

module.exports = { pipWindowOptions };
