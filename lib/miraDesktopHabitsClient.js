import { musicRequest } from './miraDesktopHabits'

async function request(body, token, signal) {
  const controller = new AbortController(), abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(abort, 1500)
  try {
    signal?.throwIfAborted()
    const result = await fetch('/api/mira/desktop-habits', { method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) })
    return result.ok ? await result.json() : null
  } catch { return null }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
}
export async function withDesktopHabits(goal, options, execute) {
  if (!musicRequest(goal)) return execute(goal, options)
  const prepared = await request({ operation: 'prepare', goal }, options.token, options.signal)
  options.signal?.throwIfAborted()
  const outcome = await execute(prepared?.success && typeof prepared.goal === 'string' ? prepared.goal : goal, options)
  // Executor success is returned only after its native/visual verification.
  if (outcome.success && prepared?.ticket && !options.signal?.aborted) await request({ operation: 'complete', ticket: prepared.ticket }, options.token, options.signal)
  return outcome
}
