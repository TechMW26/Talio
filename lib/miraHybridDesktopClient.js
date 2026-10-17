// Task-local cache only: no private plans, control labels or text in localStorage.
export function createHybridDesktopPlan(goal, token, signal, onDiagnostic = () => {}) {
  const diagnostic = value => { try { onDiagnostic(value) } catch { /* Telemetry must never control execution. */ } }
  let plan, count = 0, index = 0, disabled = false, misses = 0, rejected = 0
  async function request(body) {
    const started = Date.now()
    const controller = new AbortController()
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(abort, body.operation === 'plan' ? 10000 : 3000)
    try {
      signal?.throwIfAborted()
      const response = await fetch('/api/ai/mira-desktop-plan', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, signal: controller.signal, body: JSON.stringify(body) })
      const result = response.ok ? await response.json() : { fallback: true, reason: 'http_' + response.status }
      diagnostic({ stage: body.operation, ms: Date.now() - started, reason: result.reason || result.selection?.reason, decision: result.decision || result.selection?.decision })
      return result
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
  }
  function selection(result) {
    if (result.success && !result.fallback && result.action?.type === 'semantic') { misses = 0; return result }
    // A just-opened menu/search result may not have settled. Re-observe once,
    // never replay the preceding input. Provider/auth failures fall back at once.
    if (['no_controls', 'uncertain_target'].includes(result.reason) && misses++ < 1) {
      return { success: false, retryable: true, retryAfterMs: 200, message: 'Waiting for the requested control to become available.' }
    }
    disabled = true; plan = null
    return null
  }
  return {
    get enabled() { return !disabled },
    disable() { disabled = true; plan = null },
    rejected() { if (++rejected > 1) this.disable() },
    advance() { index++; rejected = 0; misses = 0; if (index >= count) this.disable() },
    async next(observation) {
      if (disabled) return null
      const targets = observation.targets?.filter(t => t.ref).map(({ ref, role, label }) => ({ ref, role, label })) || []
      if (!targets.length) {
        if (plan) return selection({ reason: 'no_controls' })
        this.disable(); diagnostic({ stage: 'observe', reason: 'no_controls' }); return null
      }
      const state = { goal, app: observation.app, targets }
      try {
        if (!plan) {
          const result = await request({ ...state, operation: 'plan', selectInitial: true })
          signal?.throwIfAborted()
          if (!result.success || result.fallback || !result.plan || !Number.isInteger(result.count) || result.count < 1 || result.count > 8) { this.disable(); return null }
          plan = result.plan; count = result.count
          if (result.selection) return selection(result.selection)
        }
        const result = await request({ ...state, operation: 'select', plan, index })
        signal?.throwIfAborted()
        return selection(result)
      } catch (error) {
        if (signal?.aborted) throw error
        diagnostic({ stage: 'hybrid', reason: 'transport_unavailable' }); this.disable(); return null
      }
    },
  }
}
