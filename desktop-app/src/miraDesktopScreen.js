'use strict';

// Separate from attendance capture: one frame, initiated by a MIRA question,
// never uploaded until the user approves sharing with the vision provider.
function createMiraDesktopScreenCapture({ desktopCapturer, screen, dialog, systemPreferences, platform, hasDesktopConsent = () => false }) {
  let capturing = false;
  return async function capture(event, window, appOrigin) {
    const contents = window?.webContents;
    if (!window || window.isDestroyed() || event.sender !== contents || event.senderFrame !== contents.mainFrame) return { success: false, message: 'Screen context is available only inside Talio.' };
    let source;
    try { source = new URL(event.senderFrame.url); } catch { return { success: false }; }
    if (source.origin !== appOrigin || !/^\/dashboard(?:\/|$)/.test(source.pathname)) return { success: false };
    if (capturing) return { success: false, message: 'A screen sharing request is already open.' };
    capturing = true;
    try {
      if (platform === 'darwin' && systemPreferences.getMediaAccessStatus('screen') !== 'granted') return { success: false, message: 'Allow Screen Recording for Talio in macOS System Settings, then restart Talio.' };
      const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1600, height: 1000 }, fetchWindowIcons: false });
      const selected = sources.find(item => String(item.display_id) === String(display.id)) || (sources.length === 1 ? sources[0] : null);
      if (!selected || selected.thumbnail.isEmpty()) return { success: false, message: 'The current display could not be captured. Please attach a screenshot.' };
      const bytes = selected.thumbnail.toJPEG(80);
      if (bytes.length > 2 * 1024 * 1024) return { success: false, message: 'Screen image is too large. Please attach a smaller screenshot.' };
      const capturedAt = Date.now();
      const consent = hasDesktopConsent() ? { response: 1 } : await dialog.showMessageBox({ type: 'question', title: 'MIRA screen context', message: 'Share a screenshot of your current display with MIRA?', detail: 'A single frame from the display containing your mouse pointer will be sent to the Pollinations vision service to answer your question. It may include another app or sensitive content. Enable desktop control in MIRA permissions to allow screen context without repeated prompts. Cancel to keep it private.', buttons: ['Cancel', 'Share screenshot'], defaultId: 0, cancelId: 0, noLink: true });
      if (consent.response !== 1) return { success: false, message: 'Screen sharing cancelled. You can describe what you see instead.' };
      if (contents.isDestroyed() || contents.getURL() !== source.href) return { success: false, message: 'Talio changed pages before screen sharing completed. Please try again.' };
      return { success: true, image: bytes.toString('base64'), mimeType: 'image/jpeg', capturedAt };
    } catch { return { success: false, message: 'Screen capture failed. Check screen-recording permission or attach a screenshot.' }; }
    finally { capturing = false; }
  };
}
module.exports = { createMiraDesktopScreenCapture };
