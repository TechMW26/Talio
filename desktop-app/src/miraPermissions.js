'use strict';

function trustedMiraSender(event, window, origin) {
  if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return false;
  try { const url = new URL(event.senderFrame.url); return url.origin === origin && /^\/dashboard(?:\/|$)/.test(url.pathname); } catch { return false; }
}

function createMiraPermissions({ systemPreferences, shell, platform }) {
  function status() {
    if (platform !== 'darwin') return { platform, microphone: 'runtime', camera: 'runtime', screenRecording: 'runtime', accessibility: 'runtime' };
    return { platform, microphone: systemPreferences.getMediaAccessStatus('microphone'), camera: systemPreferences.getMediaAccessStatus('camera'), screenRecording: systemPreferences.getMediaAccessStatus('screen'), accessibility: systemPreferences.isTrustedAccessibilityClient(false) ? 'granted' : 'denied' };
  }
  async function request(kind) {
    const panels = { microphone: 'Microphone', camera: 'Camera', screenRecording: 'ScreenCapture', accessibility: 'Accessibility' };
    if (!panels[kind]) return { success: false };
    if (platform === 'darwin') {
      if (['microphone', 'camera'].includes(kind) && systemPreferences.getMediaAccessStatus(kind) === 'not-determined') await systemPreferences.askForMediaAccess(kind);
      else if (kind === 'accessibility') systemPreferences.isTrustedAccessibilityClient(true);
      if (status()[kind] !== 'granted') await shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?Privacy_${panels[kind]}`);
    } else if (platform === 'win32' && ['microphone', 'camera'].includes(kind)) {
      await shell.openExternal(kind === 'camera' ? 'ms-settings:privacy-webcam' : 'ms-settings:privacy-microphone');
    }
    return { success: true, permissions: status() };
  }
  return { status, request };
}
module.exports = { trustedMiraSender, createMiraPermissions };
