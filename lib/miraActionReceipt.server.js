import { createHash, randomUUID } from 'node:crypto'

const collection = 'miraactionreceipts'
export const MIRA_RECEIPT_ACTION_TYPES = new Set(['create_task', 'create_project', 'create_meeting', 'assign_task', 'send_message', 'invite_project', 'invite_meeting', 'schedule_reminder'])
const digest = value => createHash('sha256').update(value).digest('hex')
const receiptId = (tenant, owner, requestId) => digest(JSON.stringify([tenant, String(owner), requestId])).slice(0, 24)
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
const interrupted = () => ({ status: 503, body: { success: false, uncertain: true, message: 'The action may have completed, but its result could not be confirmed. Check the destination before retrying.' } })

export function validateMiraActionRequestId(value) {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !value.trim() || value.length > 200 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw Object.assign(new Error('Invalid action request identity.'), { status: 400 })
  }
  return value.trim()
}

// Read-back is evidence recovery, not an execution/retry mechanism. The caller
// rechecks current Mira access and write permission before calling this helper.
export async function readMiraActionReceipt({ database, tenant, owner, requestId, type, signal }) {
  const rawRequestId = requestId
  requestId = validateMiraActionRequestId(requestId)
  if (requestId === undefined || !MIRA_RECEIPT_ACTION_TYPES.has(type)) throw Object.assign(new Error('Invalid action receipt lookup.'), { status: 400 })
  if (!owner || !tenant || typeof database?.get !== 'function' || database.databaseName && database.databaseName !== tenant) throw Object.assign(new Error('Please sign in again.'), { status: 401 })
  signal?.throwIfAborted()
  if (type === 'schedule_reminder') {
    // Matches createMiraReminder's identity exactly; old clients may have sent
    // surrounding spaces, which that writer retained in its request identity.
    const id = digest(`${tenant}:${String(owner)}:${rawRequestId}`).slice(0, 24)
    const row = await database.get('schedulednotifications', id)
    signal?.throwIfAborted()
    if (!row || row.metadata?.owner !== String(owner) || row.metadata?.source !== 'mira') return { success: true, found: false }
    const date = new Date(row.scheduledFor)
    if (!Number.isFinite(date.getTime())) return { success: true, found: true, state: 'uncertain', httpStatus: 409, outcome: { success: false, uncertain: true, message: 'A reminder record exists, but its creation details could not be verified. It was not recreated.' } }
    const scheduledFor = date.toISOString(), timezone = String(row.timezone || 'UTC').slice(0, 80)
    return { success: true, found: true, state: 'completed', httpStatus: 200, outcome: {
      success: true, message: `Reminder creation confirmed for ${scheduledFor} (${timezone}). ${row.status === 'cancelled' ? 'It is currently cancelled. ' : ''}This confirms scheduling only, not delivery.`,
      reminder: { id, scheduledFor, timezone },
    } }
  }
  const row = await database.get(collection, receiptId(tenant, owner, requestId))
  signal?.throwIfAborted()
  if (!row || row.owner !== String(owner) || row.tenant !== tenant || row.actionType !== type) return { success: true, found: false }
  if (row.status === 'completed' && Number.isInteger(row.httpStatus) && row.httpStatus >= 200 && row.httpStatus <= 599 &&
      row.response && typeof row.response === 'object' && !Array.isArray(row.response) && typeof row.response.success === 'boolean' && row.response.uncertain !== true && JSON.stringify(row.response).length <= 20000) {
    return { success: true, found: true, state: 'completed', httpStatus: row.httpStatus, outcome: JSON.parse(JSON.stringify(row.response)) }
  }
  return { success: true, found: true, state: row.status === 'pending' ? 'pending' : 'uncertain', httpStatus: 409,
    outcome: { success: false, uncertain: true, message: 'This action is still in progress or may have completed. Check the destination; it will not be repeated automatically.' } }
}

// Permission checks belong to the caller and MUST precede even a cached read.
// The claim commits separately before any delegate runs: a crashed worker leaves
// a pending receipt that is never automatically reclaimed or replayed.
export async function executeMiraActionOnce({ database, tenant, owner, requestId, action, signal }, execute) {
  requestId = validateMiraActionRequestId(requestId)
  let claim
  if (requestId !== undefined) {
    if (!owner || !tenant || typeof database?.transaction !== 'function') throw Object.assign(new Error('Please sign in again before performing this action.'), { status: 401 })
    const id = receiptId(tenant, owner, requestId)
    const payloadHash = digest(JSON.stringify(canonical(action)))
    const claimToken = randomUUID()
    let receipt
    try { receipt = await database.transaction(async tx => {
      const existing = await tx.get(collection, id)
      if (existing) {
        if (existing.owner !== String(owner) || existing.tenant !== tenant || existing.payloadHash !== payloadHash) return { conflict: true }
        if (existing.status === 'completed' && existing.response && Number.isInteger(existing.httpStatus)) {
          return { cached: { body: existing.response, status: existing.httpStatus } }
        }
        return { blocked: true }
      }
      const now = new Date()
      await tx.create(collection, { _id: id, owner: String(owner), tenant, payloadHash, claimToken,
        actionType: action.type, status: 'pending', createdAt: now, updatedAt: now })
      return { claimed: true }
    }) } catch {
      // A transaction's result can be lost after its claim commits. Do not call
      // the delegate when claim ownership cannot be proven.
      return interrupted()
    }
    if (receipt.conflict) return { status: 409, body: { success: false, message: 'This action request identity was already used for a different payload. Start a new request for a different action.' } }
    if (receipt.cached) return receipt.cached
    if (receipt.blocked) return { status: 409, body: { success: false, uncertain: true, message: 'This action is already in progress or may have completed. Check the destination before retrying; it will not be repeated automatically.' } }
    claim = { id, claimToken, payloadHash }
  }
  const finish = async result => {
    if (!claim) return
    await database.transaction(async tx => {
      const row = await tx.get(collection, claim.id)
      if (!row || row.claimToken !== claim.claimToken || row.payloadHash !== claim.payloadHash || row.status !== 'pending') throw new Error('Action receipt ownership changed.')
      await tx.replace(collection, { ...row, status: result.body.uncertain ? 'uncertain' : 'completed',
        httpStatus: result.status, response: result.body, updatedAt: new Date() })
    })
  }
  let result
  try {
    signal?.throwIfAborted()
    result = await execute()
    // Store only the deliberately bounded API receipt, not a delegated record or
    // a private request payload. JSON cloning also makes a cache replay isolated.
    if (!result || !Number.isInteger(result.status) || result.status < 200 || result.status > 599 || !result.body || typeof result.body !== 'object' || JSON.stringify(result.body).length > 20000) throw new Error('Invalid action result.')
    result = { status: result.status, body: JSON.parse(JSON.stringify(result.body)) }
  } catch {
    result = interrupted()
  }
  try { await finish(result) }
  catch {
    // The durable pending claim still prevents a duplicate even if saving the
    // final response fails after the delegate committed its side effect.
    return interrupted()
  }
  return result
}
