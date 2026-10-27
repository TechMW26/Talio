// Opt-in acceptance against the configured model. Synthetic instructions only;
// no desktop inputs, account records, reminders or communications are executed.
import { generateDeepSeekContent } from '@/lib/ai/providers/deepseekProvider'
import { MIRA_CORE_SYSTEM_PROMPT } from '@/lib/miraSystemPrompt'
import { MIRA_ACTION_INSTRUCTIONS } from '@/lib/miraNavigation'
import { MIRA_ORCHESTRATION_POLICY, MIRA_ORCHESTRATION_RESPONSE_POLICY, miraOrchestrationContext, readyMiraTasks } from '@/lib/miraOrchestration'
import { MIRA_COMPUTER_INSTRUCTIONS } from '@/lib/miraComputerClient'
import { mergeMiraTaskPlan, miraTaskActionMatches } from '@/lib/miraTaskBank'
const live = process.env.MIRA_ORCHESTRATION_LIVE === '1' ? test : test.skip
const generate = async (message, bank) => {
  require('dotenv').config({ path: '.env.local', quiet: true })
  const started = performance.now()
  const output = await generateDeepSeekContent(JSON.stringify({ message, taskBank: bank, coordinator: miraOrchestrationContext(bank) }),
    `${MIRA_CORE_SYSTEM_PROMPT}\n${MIRA_ACTION_INSTRUCTIONS}\n${MIRA_COMPUTER_INSTRUCTIONS}\n${MIRA_ORCHESTRATION_POLICY}\n${MIRA_ORCHESTRATION_RESPONSE_POLICY}\nReturn only JSON {message,action,taskId,taskPlan}. When executing a multi-step action, taskId MUST equal the dependency-ready selected node id. Use stable plan IDs. Do not execute a blocked dependency. For an existing plan do not replace it. desktopComputerAvailable:true. Current time 2026-10-28T10:00:00Z; timezone Asia/Kolkata.`,
    { useCase: 'mira', thinking: false, maxTokens: 1400, timeoutMs: 45000 })
  const response = JSON.parse(output.replace(/^```(?:json)?\s*|\s*```$/g, ''))
  if (!response.action && response.taskPlan?.length) console.info('[Mira unexecuted synthetic plan]', JSON.stringify(response))
  console.info('[Mira orchestration acceptance]', { milliseconds: Math.round(performance.now() - started), action: response.action?.type || null })
  return response
}
live.each([
  ['Search the internet for NASA Artemis updates, then create a task called Review Artemis using those sources.', 'search_internet'],
  ['Create a task called Draft outline, then create a task called Review outline. Both are mine.', 'create_task'],
  ['Notes ऐप खोलो और फिर मुझे 15 मिनट बाद ड्राफ्ट पढ़ने की याद दिलाओ।', 'desktop_task'],
])('live multi-step decision selects a bound ready task: %s', async (message, type) => {
  const response = await generate(message, { tasks: [] })
  const bank = mergeMiraTaskPlan(null, response, message), selected = readyMiraTasks(bank)[0]
  expect(bank.tasks.length).toBeGreaterThanOrEqual(2)
  expect(selected).toBeDefined()
  expect(response.taskId).toBe(selected.id)
  expect(response.action?.type).toBe(type)
  expect(miraTaskActionMatches(selected, response.action, response.taskId)).toBe(true)
}, 50000)
live('live blocked prerequisite cannot become an executable dependent action', async () => {
  const bank = { tasks: [
    { id: 'research', request: 'Research the official result', dependsOn: [], status: 'blocked', action: { type: 'search_internet', fields: { query: 'NASA Artemis' } }, result: 'Provider unavailable; no source evidence' },
    { id: 'write', request: 'Create a task with the official result', dependsOn: ['research'], status: 'pending', action: { type: 'create_task', fields: { title: 'Official result' } } },
  ] }
  const response = await generate('Tell me the current status; do not retry anything.', bank)
  expect(response.action == null).toBe(true)
}, 50000)
