'use client'
async function requestOnce(body, { settings = false, signal, companyId } = {}) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (signal?.aborted) abort()
  signal?.addEventListener('abort', abort, { once: true })
  const timeout = setTimeout(abort, settings ? 60000 : 30000)
  try {
    const query = settings && companyId ? `?companyId=${encodeURIComponent(companyId)}` : ''
    const response = await fetch(`/api/induction${settings ? '/settings' : ''}${query}`, { method: body ? 'POST' : 'GET', signal: controller.signal, cache: 'no-store', headers: { Authorization: `Bearer ${localStorage.getItem('token')}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
    const result = await response.json().catch(() => null)
    if (!response.ok || !result?.success) throw Object.assign(new Error(result?.message || 'Induction service is unavailable. Please retry.'), { status: response.status })
    return result.data
  } catch (error) {
    if (controller.signal.aborted && !signal?.aborted) throw Object.assign(new Error('The induction request timed out. Please retry; saved progress is retained.'), { retryable: true })
    throw error
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', abort)
  }
}

export async function inductionRequest(body, options = {}) {
  try { return await requestOnce(body, options) }
  catch (error) {
    // Retry one read after a cold-start/network failure, never replay progress
    // writes or retry a denied session. Usually only one request is needed.
    if (body || options.settings || options.signal?.aborted || !(error.retryable || error instanceof TypeError || error.status >= 500)) throw error
    return requestOnce(body, options)
  }
}
