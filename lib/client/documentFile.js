/** Never forward an app token to an external document host. */
async function requestDocumentFile(url, { signal } = {}) {
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

const fileCache = new Map()
const pendingFiles = new Map()
const CACHE_TTL = 60_000
const MAX_BYTES = 32 * 1024 * 1024
let cacheIdentity

export function clearDocumentFileCache() {
  fileCache.clear()
  pendingFiles.clear()
}

function syncIdentity() {
  const identity = `${localStorage.getItem('token') || ''}:${localStorage.getItem('user') || ''}`
  if (identity !== cacheIdentity) {
    clearDocumentFileCache()
    cacheIdentity = identity
  }
  return identity
}

// Consumers can cancel their wait without cancelling another card's shared download.
function withSignal(promise, signal) {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'))
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); reject(new DOMException('Aborted', 'AbortError')) }
    const cleanup = () => signal.removeEventListener('abort', abort)
    signal.addEventListener('abort', abort, { once: true })
    promise.then(value => { cleanup(); resolve(value) }, error => { cleanup(); reject(error) })
  })
}

export function fetchDocumentFile(url, { signal } = {}) {
  if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'))
  const identity = syncIdentity()
  const key = new URL(url, window.location.origin).href
  for (const [id, entry] of fileCache) if (entry.expires <= Date.now()) fileCache.delete(id)
  const cached = fileCache.get(key)
  if (cached) return withSignal(Promise.resolve(cached.blob), signal)
  let pending = pendingFiles.get(key)
  if (!pending) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30_000)
    pending = requestDocumentFile(key, { signal: controller.signal }).then(blob => {
      if (syncIdentity() === identity && blob.size <= MAX_BYTES) {
        fileCache.set(key, { blob, expires: Date.now() + CACHE_TTL })
        let bytes = [...fileCache.values()].reduce((sum, entry) => sum + entry.blob.size, 0)
        while (fileCache.size > 40 || bytes > MAX_BYTES) {
          const oldest = fileCache.keys().next().value
          bytes -= fileCache.get(oldest).blob.size
          fileCache.delete(oldest)
        }
      }
      return blob
    }).finally(() => {
      clearTimeout(timeout)
      if (pendingFiles.get(key) === pending) pendingFiles.delete(key)
    })
    pendingFiles.set(key, pending)
  }
  return withSignal(pending, signal)
}

// Limit speculative downloads so hovering a large folder does not flood the network.
export async function preloadDocumentFiles(documents) {
  const identity = syncIdentity()
  const queue = [...new Set(documents.map(file => file.fileUrl || file.url).filter(Boolean))].slice(0, 40)
  await Promise.all(Array.from({ length: Math.min(3, queue.length) }, async () => {
    while (queue.length && syncIdentity() === identity) {
      try { await fetchDocumentFile(queue.shift()) } catch { /* Normal open can retry. */ }
    }
  }))
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
