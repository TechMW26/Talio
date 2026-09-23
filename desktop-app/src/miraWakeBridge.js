// Wake requests may reveal the existing app, never navigate or execute code.
function revealMiraWindow(event, window, appOrigin) {
  if (!window || window.isDestroyed()) return { success: false };
  const contents = window.webContents;
  if (event.sender !== contents || event.senderFrame !== contents.mainFrame) return { success: false };
  try {
    const source = new URL(event.senderFrame.url);
    if (source.origin !== appOrigin || !/^\/dashboard(?:\/|$)/.test(source.pathname)) return { success: false };
  } catch { return { success: false }; }
  if (window.isMinimized()) window.restore();
  if (!window.isVisible()) window.show();
  if (!window.isFocused()) window.focus();
  return { success: true };
}

module.exports = { revealMiraWindow };
