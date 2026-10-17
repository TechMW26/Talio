// Opt-in provider contract test. Synthetic controls only; no desktop access,
// screenshots, account records, messages, or externally visible actions.
import { requestHybridDesktop } from '@/lib/ai/miraHybridDesktop'
const live = process.env.MIRA_LIVE_DESKTOP_TESTS === '1' ? test : test.skip

live('real providers preserve Hindi text and never act on uncertain or duplicate targets', async () => {
  const fs = require('node:fs')
  const dotenv = require('dotenv')
  const config = dotenv.parse(fs.readFileSync('.env.local'))
  const keys = ['TYPESAFE_API_KEY', 'DEEPSEEK_API_KEY', 'JWT_SECRET', 'MIRA_JEV_ENABLED', 'TYPESAFE_DESKTOP_MODEL', 'DEEPSEEK_DESKTOP_MODEL']
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]))
  try {
    for (const key of keys) if (config[key]) process.env[key] = config[key]
    const input = { operation: 'plan', goal: 'Search Notes for नमस्ते. Only fill the search field; do not edit any note.', app: 'Notes', targets: [{ ref: 'initial', role: 'AXSearchField', label: 'Search' }] }
    let started = Date.now()
    const plan = await requestHybridDesktop(input, 'synthetic:acceptance')
    const planningMs = Date.now() - started
    expect(plan).toMatchObject({ success: true, count: 1 })
    const results = []
    for (const label of ['Search', 'Search notes', 'Find a note']) {
      started = Date.now()
      const selection = await requestHybridDesktop({ ...input, operation: 'select', plan: plan.plan, index: 0, targets: [
        { ref: 'current', role: 'AXSearchField', label },
        { ref: 'cancel', role: 'AXButton', label: 'Cancel' },
      ] }, 'synthetic:acceptance')
      results.push({ label, ms: Date.now() - started, decision: selection.decision || selection.reason })
      if (selection.fallback) expect(selection.reason).toBe('uncertain_target')
      else expect(selection).toMatchObject({ success: true, action: { type: 'semantic', operation: 'fill', ref: 'current', text: 'नमस्ते' } })
    }
    const duplicate = await requestHybridDesktop({ ...input, operation: 'select', plan: plan.plan, index: 0, targets: [
      { ref: 'first', role: 'AXSearchField', label: 'Search' }, { ref: 'second', role: 'AXSearchField', label: 'Search' },
    ] }, 'synthetic:acceptance')
    expect(duplicate).toMatchObject({ fallback: true, reason: 'uncertain_target' })
    expect(results.some(x => x.decision === 'exact_target')).toBe(true)
    // Report fallback frequency, not just a pass count: a safe fallback is not a
    // claim that Jev resolved the control or that a real desktop task completed.
    console.info(JSON.stringify({ test: 'synthetic-provider-contract', planningMs, results }))
  } finally {
    for (const key of keys) saved[key] === undefined ? delete process.env[key] : process.env[key] = saved[key]
  }
}, 30000)
