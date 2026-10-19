import { createHash } from 'node:crypto'
import { QueryCache } from '../queryCache'

// Short-lived, process-local cache: retains no images or raw request keys.
// Full validated context + current image + model + account must match exactly.
const cache = new QueryCache({ maxSize: 100 })
export function desktopResponseKey(scope, model, messages) {
  if (!scope?.tenant || !scope?.user) return null
  return createHash('sha256').update(JSON.stringify(['visual-v2', scope.tenant, scope.user, model, messages])).digest('hex')
}
export function cachedDesktopResponse(key) { return key ? cache.get(key) : null }
export function saveDesktopResponse(key, text) {
  // Cache only a single navigation/open/find or editable-input batch proposal.
  // Never cache completion/answers about live state, send, submit, delete or
  // arbitrary clicks. Every hit still passes the native guarded executor.
  if (!key || typeof text !== 'string' || text.length > 6000) return
  const code = text.match(/^\s*```(?:python)?\s*\n?(agent\.(?:navigate|open_app|batch|key)\([\s\S]*\))\s*```\s*$/)?.[1]
  if (!code || /agent\.(?:done|ask)|\b(?:send|delete|purchase|password|token|secret)\b/i.test(code)) return
  if (code.startsWith('agent.key') && !/^agent\.key\((?:key\s*=\s*)?["'](?:find|app_search|browser_address)["']\)$/.test(code)) return
  if (code.startsWith('agent.batch') && /["'](?:enter|paste|space|tab|backspace)["']/.test(code)) return
  cache.set(key, text, 60 * 1000)
}
