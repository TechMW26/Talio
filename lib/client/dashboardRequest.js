// Dashboard reads only: never retry mutations. No cached authorization/data.
const cancellation = () => Object.assign(new Error('Dashboard request cancelled'), { name: 'AbortError', cancelled: true })
export const isRequestCancelled = error => error?.cancelled === true

export async function dashboardRequest(url, token, { timeoutMs = 15000, signal } = {}) {
  // A caller-cancelled read (route change/unmount) must never run or retry.
  if (signal?.aborted) throw cancellation()
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController()
    // Relay the caller's signal so navigating away stops in-flight work.
    const relay = () => controller.abort()
    signal?.addEventListener('abort', relay, { once: true })
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal })
      if (!response.ok) throw Object.assign(new Error('Dashboard data is unavailable. Please retry.'), { status: response.status })
      return await response.json()
    } catch (error) {
      // One retry for an interrupted connection (e.g. local dev recompilation).
      // Auth errors, server errors and timeouts require explicit user retry.
      // Caller cancellation (route change/unmount) must not retry or surface.
      if (signal?.aborted) throw cancellation()
      if (attempt === 0 && error instanceof TypeError && !controller.signal.aborted) continue
      if (controller.signal.aborted) throw new Error('Dashboard data took too long to load. Please retry.')
      throw error
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', relay) }
  }
}
