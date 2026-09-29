'use client'
export async function inductionRequest(body, { settings = false, signal, companyId } = {}) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (signal?.aborted) abort()
  signal?.addEventListener('abort', abort, { once: true })
  const timeout = setTimeout(abort, settings ? 60000 : 20000)
  try {
    const query = settings && companyId ? `?companyId=${encodeURIComponent(companyId)}` : ''
    const response = await fetch(`/api/induction${settings ? '/settings' : ''}${query}`, { method: body ? 'POST' : 'GET', signal: controller.signal, cache: 'no-store', headers: { Authorization: `Bearer ${localStorage.getItem('token')}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
    const result = await response.json().catch(() => null)
    if (!response.ok || !result?.success) throw Object.assign(new Error(result?.message || 'Induction service is unavailable. Please retry.'), { status: response.status })
    return result.data
  } catch (error) {
    if (controller.signal.aborted && !signal?.aborted) throw new Error('The induction request timed out. Please retry; saved progress is retained.')
    throw error
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', abort)
  }
}
