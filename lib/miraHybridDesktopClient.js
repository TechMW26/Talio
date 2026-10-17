// Task-local cache only: no private plans, control labels or text in localStorage.
export function createHybridDesktopPlan(goal, token, signal) {
  let plan, count = 0, index = 0, disabled = false
  async function request(body) {
    const controller = new AbortController()
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(abort, body.operation === 'plan' ? 10000 : 3000)
    try {
      signal?.throwIfAborted()
      const response = await fetch('/api/ai/mira-desktop-plan', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, signal: controller.signal, body: JSON.stringify(body) })
      return response.ok ? await response.json() : { fallback: true }
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
  }
  return {
    get enabled() { return !disabled },
    disable() { disabled = true; plan = null },
    advance() { index++; if (index >= count) this.disable() },
    async next(observation) {
      if (disabled) return null
      const targets = observation.targets?.filter(t => t.ref).map(({ ref, role, label }) => ({ ref, role, label })) || []
      if (!targets.length) { this.disable(); return null }
      const state = { goal, app: observation.app, targets }
      try {
        if (!plan) {
          const result = await request({ ...state, operation: 'plan' })
          if (!result.success || result.fallback || !result.plan || !Number.isInteger(result.count) || result.count < 1 || result.count > 8) { this.disable(); return null }
          plan = result.plan; count = result.count
        }
        const result = await request({ ...state, operation: 'select', plan, index })
        signal?.throwIfAborted()
        if (!result.success || result.fallback || result.action?.type !== 'semantic') { this.disable(); return null }
        return result
      } catch (error) {
        if (signal?.aborted) throw error
        this.disable(); return null
      }
    },
  }
}
