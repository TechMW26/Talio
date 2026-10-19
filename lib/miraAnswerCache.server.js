import { createHash } from 'node:crypto'
import { QueryCache } from './queryCache'
const answers = new QueryCache({ maxSize: 150 })

export function miraAnswerCacheKey({ tenant, user, message, prompt, system, model, eligible }) {
  // No tools, screen/camera, personal/live facts or mutable workplace queries.
  if (!eligible || !tenant || !user || !/^(?:please\s+)?(?:explain|define|what is|what are|translate|rewrite)\b/iu.test(message) ||
    /\b(?:today|now|current|latest|weather|news|price|time|my|our|employee|attendance|task|project|meeting|leave|salary|balance|screen|camera|this|that|here|above)\b/iu.test(message)) return null
  // This reference clock does not affect an eligible timeless answer; all other
  // context, policies, language, account, model and personal instructions remain.
  const stableSystem = system.replace(/\nReminder scheduling reference:[^\n]*/g, '').replace(/"asOf":"\d{4}-\d{2}-\d{2}T[^"\\]+"/g, '"asOf":"timeless"')
  return createHash('sha256').update(JSON.stringify(['mira-answer-v1', tenant, user, model, prompt, stableSystem])).digest('hex')
}
export function readMiraAnswer(key) { return key ? answers.get(key) : null }
export function saveMiraAnswer(key, text) {
  if (!key || typeof text !== 'string' || text.length > 16000) return
  try {
    const value = JSON.parse(text.trim().replace(/^```(?:json)?\s*\n?([\s\S]*)\n?\s*$/, '$1').replace(/```$/, '').trim())
    if (!value || typeof value.message !== 'string' || value.action || value.actionResult || value.tool_calls ||
      value.cards?.length || value.taskBank?.tasks?.length || Object.keys(value).some(k => !['message', 'speech', 'suggestedQuestions', 'emotion', 'tone', 'action', 'cards', 'taskBank'].includes(k))) return
    answers.set(key, text, 5 * 60000)
  } catch { /* Partial/error responses are not answers. */ }
}
