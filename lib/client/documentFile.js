/** Never forward an app token to an external document host. */
export async function fetchDocumentFile(url, { signal } = {}) {
  const target = new URL(url, window.location.origin)
  if (!['https:', 'http:'].includes(target.protocol)) throw new Error('Unsupported document URL')
  const sameOrigin = target.origin === window.location.origin
  const token = sameOrigin ? localStorage.getItem('token') : null
  const response = await fetch(target.href, {
    signal,
    credentials: sameOrigin ? 'same-origin' : 'omit',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403
    ? 'You do not have access to this document. Please sign in again or contact HR.'
    : 'The document could not be loaded. Please retry or contact HR.')
  const blob = await response.blob()
  if (blob.type.includes('text/html')) throw new Error('The server returned a page instead of a document. Please contact HR.')
  return blob
}

export async function downloadDocumentFile(document) {
  const blob = await fetchDocumentFile(document.fileUrl || document.url)
  const url = URL.createObjectURL(blob)
  const link = window.document.createElement('a')
  link.href = url
  link.download = document.fileName || document.name || 'document'
  window.document.body.appendChild(link)
  link.click()
  link.remove()
  // Keep the object alive long enough for the browser download to start.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
