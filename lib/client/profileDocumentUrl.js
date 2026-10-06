export function profileDocumentUrl(document, origin) {
  if (/^[a-f0-9]{24}$/i.test(document?.fileId || '')) return `/api/images/${document.fileId}`
  const url = document?.url
  if (typeof url !== 'string' || !url.trim()) return null
  if (url.startsWith('/api/')) return url
  if (url.startsWith('/') && !url.startsWith('//')) return `/api${url}`
  try {
    const parsed = new URL(url)
    if (!['https:', 'http:'].includes(parsed.protocol)) return null
    if (parsed.origin === origin) return profileDocumentUrl({ url: parsed.pathname + parsed.search }, origin)
    return parsed.href
  } catch { return null }
}
