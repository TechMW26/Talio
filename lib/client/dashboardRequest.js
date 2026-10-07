// Dashboard reads only: never retry mutations. No cached authorization/data.
export async function dashboardRequest(url, token, { timeoutMs = 15000 } = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal })
      if (!response.ok) throw Object.assign(new Error('Dashboard data is unavailable. Please retry.'), { status: response.status })
      return await response.json()
    } catch (error) {
      // One retry for an interrupted connection (e.g. local dev recompilation).
      // Auth errors, server errors and timeouts require explicit user retry.
      if (attempt === 0 && error instanceof TypeError && !controller.signal.aborted) continue
      if (controller.signal.aborted) throw new Error('Dashboard data took too long to load. Please retry.')
      throw error
    } finally { clearTimeout(timer) }
  }
}
