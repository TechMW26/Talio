// Capture only Talio's authenticated main renderer, never the user's desktop.
async function captureMiraAppSnapshot(event, window, appOrigin) {
  if (!window || window.isDestroyed()) return null;
  const contents = window.webContents;
  if (event.sender !== contents || event.senderFrame !== contents.mainFrame) return null;
  let source;
  try { source = new URL(event.senderFrame.url); } catch { return null; }
  if (source.origin !== appOrigin || !/^\/dashboard(?:\/|$)/.test(source.pathname)) return null;
  const originalUrl = contents.getURL();
  const image = await contents.capturePage();
  if (contents.isDestroyed() || contents.getURL() !== originalUrl || image.isEmpty()) return null;
  const size = image.getSize();
  const resized = size.width > 1600 ? image.resize({ width: 1600 }) : image;
  const bytes = resized.toJPEG(75);
  if (bytes.length > 2 * 1024 * 1024) return null;
  return { image: bytes.toString('base64'), mimeType: 'image/jpeg', page: source.pathname };
}
module.exports = { captureMiraAppSnapshot };
