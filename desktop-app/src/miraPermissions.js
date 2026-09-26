'use strict';

function trustedMiraSender(event, window, origin) {
  if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return false;
  try { const url = new URL(event.senderFrame.url); return url.origin === origin && /^\/dashboard(?:\/|$)/.test(url.pathname); } catch { return false; }
}

function createMiraPermissions({ systemPreferences, shell, platform, store, dialog, desktopCapturer }) {
  let screenVerified = false;
  function status() {
    const media = kind => {
      if (!['darwin', 'win32'].includes(platform)) return 'runtime';
      try { return systemPreferences.getMediaAccessStatus(kind); } catch { return 'runtime'; }
    };
    return { platform, desktopControl: store?.get('miraDesktopConsentV1') === true ? 'granted' : 'denied', microphone: media('microphone'), camera: media('camera'), location: 'runtime', notifications: 'runtime', screenRecording: platform === 'darwin' ? media('screen') : screenVerified ? 'granted' : 'runtime', accessibility: platform === 'darwin' ? (systemPreferences.isTrustedAccessibilityClient(false) ? 'granted' : 'denied') : 'runtime' };
  }
  async function request(kind) {
    const settingsOnly = typeof kind === 'string' && kind.endsWith(':settings');
    if (settingsOnly) kind = kind.slice(0, -9);
    if (kind === 'screenRecording' && desktopCapturer && !settingsOnly) {
      // Request through Electron so macOS registers Talio, not a helper binary.
      // Enumerate only; do not retain, upload or return any screen image.
      try {
        const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false });
        screenVerified = sources.length > 0;
      } catch { screenVerified = false; }
      const permissions = status();
      return { success: true, permissions, ...(permissions.screenRecording !== 'granted' ? { message: 'Screen access was not granted. Use Open settings if macOS requires approval there, then restart Talio if requested.' } : {}) };
    }
    if (kind === 'desktopControl' && dialog && store) {
      const stopKey = platform === 'darwin' ? 'Command+Shift+Escape' : 'Control+Alt+Shift+Escape';
      const consent = await dialog.showMessageBox({ type: 'question', title: 'Enable MIRA desktop control', message: 'Allow MIRA to carry out your desktop commands?', detail: `For desktop tasks you request, MIRA can share screen captures with its vision provider and use your mouse and keyboard. This permission is remembered on this device. Keep sensitive information out of view. Press ${stopKey} to stop. You can revoke this permission in the Talio setup checklist.`, buttons: ['Not now', 'Enable desktop control'], defaultId: 0, cancelId: 0, noLink: true });
      if (consent.response === 1) store.set('miraDesktopConsentV1', true);
      return { success: true, permissions: status() };
    }
    if (kind === 'revokeDesktopControl' && store) { store.delete('miraDesktopConsentV1'); return { success: true, permissions: status() }; }
    const panels = { microphone: 'Microphone', camera: 'Camera', screenRecording: 'ScreenCapture', accessibility: 'Accessibility', location: 'LocationServices', notifications: 'Notifications' };
    if (!panels[kind]) return { success: false };
    if (platform === 'darwin') {
      if (!settingsOnly && ['microphone', 'camera'].includes(kind) && systemPreferences.getMediaAccessStatus(kind) === 'not-determined') {
        await systemPreferences.askForMediaAccess(kind);
        return { success: true, permissions: status() };
      }
      else if (kind === 'accessibility') systemPreferences.isTrustedAccessibilityClient(true);
      if (status()[kind] !== 'granted') await shell.openExternal(kind === 'notifications' ? 'x-apple.systempreferences:com.apple.preference.notifications' : `x-apple.systempreferences:com.apple.preference.security?Privacy_${panels[kind]}`);
    } else if (platform === 'win32') {
      const targets = { camera: 'ms-settings:privacy-webcam', microphone: 'ms-settings:privacy-microphone', location: 'ms-settings:privacy-location', notifications: 'ms-settings:notifications' };
      if (targets[kind]) await shell.openExternal(targets[kind]);
      else return { success: true, permissions: status(), message: 'Windows manages screen capture and desktop input at runtime. Secure desktops and elevated applications may not be controllable.' };
    } else {
      return { success: true, permissions: status(), message: 'Open your Linux desktop Settings → Privacy or Notifications. Screen sharing may use a system portal; desktop control depends on X11/Wayland support. Talio cannot grant these permissions for you.' };
    }
    return { success: true, permissions: status() };
  }
  return { status, request };
}
module.exports = { trustedMiraSender, createMiraPermissions };
