// Synthetic live provider smoke test. No desktop content, credentials or user
// records are logged/sent. Run explicitly with a funded server-side key.
require('dotenv').config({ path: '.env.local', quiet: true })
const fs = require('fs')
const path = require('path')
const { transformSync } = require('@swc/core')
const original = require.extensions['.js']
require.extensions['.js'] = (module, filename) => {
  if (!filename.startsWith(path.resolve(__dirname, '../lib/ai/'))) return original(module, filename)
  module._compile(transformSync(fs.readFileSync(filename, 'utf8'), { filename, jsc: { parser: { syntax: 'ecmascript' }, target: 'es2022' }, module: { type: 'commonjs' } }).code, filename)
}
const { requestHybridDesktop } = require('../lib/ai/miraHybridDesktop')
async function main() {
  const input = { operation: 'plan', goal: 'Fill the Search field in Notes with नमस्ते. Do not submit.', app: 'Notes', targets: [{ ref: 'search-field', role: 'AXSearchField', label: 'Search' }, { ref: 'help-button', role: 'AXButton', label: 'Help' }] }
  const started = Date.now()
  const plan = await requestHybridDesktop(input, 'synthetic:smoke')
  console.log({ phase: 'deepseek-plan', elapsedMs: Date.now() - started, fallback: plan.fallback || false, steps: plan.count })
  if (!plan.plan) throw new Error('No structured plan produced')
  let filled = false
  for (let index = 0; index < plan.count; index++) {
    const selecting = Date.now()
    const result = await requestHybridDesktop({ ...input, operation: 'select', plan: plan.plan, index }, 'synthetic:smoke')
    console.log({ phase: 'jev-selection', elapsedMs: Date.now() - selecting, fallback: result.fallback || false, reason: result.reason, operation: result.action?.operation, targetMatched: result.action?.ref === 'search-field', preservedHindi: result.action?.text === 'नमस्ते' })
    if (result.action?.ref !== 'search-field') throw new Error('Synthetic hybrid acceptance failed')
    if (result.action.operation === 'fill') filled = result.action.text === 'नमस्ते'
  }
  if (!filled) throw new Error('Synthetic hybrid acceptance failed')
}
main().catch(error => { console.error(error.name === 'AbortError' || error.name === 'TimeoutError' ? 'Provider request timed out' : 'Synthetic hybrid acceptance failed'); process.exitCode = 1 })
