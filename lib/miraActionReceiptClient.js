import { nextMiraTask } from './miraOrchestration'
import { recordMiraTaskOutcome } from './miraTaskBank'

const writes = new Set(['schedule_reminder', 'create_task', 'create_project', 'create_meeting', 'assign_task', 'send_message', 'invite_project', 'invite_meeting'])

// An interrupted response is not a failed write. Before reasoning about a retry,
// ask for its existing server receipt; this endpoint can never execute an action.
// The ordinary successful path performs no extra request.
export async function refreshMiraExecutionReceipt(bank, { token, signal, fetcher = fetch } = {}) {
  const task = nextMiraTask(bank)
  if (!task?.uncertain || !task.executionId || !writes.has(task.action?.type)) return bank
  signal?.throwIfAborted()
  try {
    const query = new URLSearchParams({ requestId: task.executionId, type: task.action.type })
    const response = await fetcher(`/api/ai/mira-actions?${query}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal })
    const body = await response.json()
    signal?.throwIfAborted()
    if (!response.ok || !body.success || !body.found || body.state !== 'completed' || typeof body.outcome?.success !== 'boolean' || body.outcome.uncertain) return bank
    return recordMiraTaskOutcome(bank, body.outcome, task.id)
  } catch (error) {
    if (signal?.aborted) throw error
    // A missing/unavailable receipt never permits automatic replay.
    return bank
  }
}
