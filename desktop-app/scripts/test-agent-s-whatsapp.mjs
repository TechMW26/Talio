// Explicit, supervised live acceptance test. Searches only, never sends messages.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import bridge from '../src/miraAgentS.js'
import { requestAgentSModel } from '../../lib/ai/agentSProxy.js'
if (process.argv[2] !== '--search-only' || process.platform !== 'darwin') throw new Error('Explicit macOS search-only test required')
const width = Number(process.argv[3]); const height = Number(process.argv[4])
if (!(width > 100 && height > 100)) throw new Error('Provide current primary-display logical width and height')
const helper = path.resolve('desktop-app/build/mira-control-arm64')
const control = action => JSON.parse(execFileSync(helper, [JSON.stringify(action)], { encoding: 'utf8', timeout: 10000 }))
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'talio-agent-s-qa-'))
const imagePath = path.join(temp, 'screen.png')
const worker = bridge.createAgentS({ packaged: false })
const normalize = value => String(value).replace(/[\u200b\u200e\u200f\ufeff]/g, '').toLowerCase()
try {
  await worker.begin('Open or focus WhatsApp. Search for Mansi in the WhatsApp contacts/chats search. Stop when the search results or no-results state is visible. Do not select any conversation. Do not send any messages. Do not search Talio employees.')
  // Opening is part of the test but the initial screenshot is synthetic, so
  // unrelated foreground conversations are never captured by this test harness.
  let image = (await sharp({ create: { width: 640, height: 480, channels: 3, background: 'black' } }).jpeg().toBuffer()).toString('base64')
  let app = 'No desktop observation yet. First open WhatsApp.'
  for (let step = 0; step < 8; step++) {
    const started = Date.now()
    let result = await worker.predict({ image, app })
    for (let retry = 0; result.kind === 'model_request' && retry < 4; retry++) result = await worker.respond(await requestAgentSModel(result.messages))
    console.log(JSON.stringify({ step, elapsedMs: Date.now() - started, result }))
    if (result.done) break
    if (result.question || !result.action) throw new Error('Planner stopped without verified completion')
    const action = result.action
    const allowed = action.type === 'open_app' && normalize(action.name) === 'whatsapp'
      || action.type === 'key' && ['find', 'select_all', 'escape'].includes(action.key)
      || action.type === 'type' && normalize(action.text) === 'mansi'
      || action.type === 'click' && action.x >= .05 && action.x <= .245 && action.y >= .078 && action.y <= .104
    // Only the visually verified WhatsApp search field is clickable in this
    // fixture's current full-screen layout. No contact rows or send controls.
    if (!allowed) throw new Error('Action outside search-only test scope')
    if (action.type !== 'open_app' && normalize(control({ type: 'status' }).app) !== 'whatsapp') throw new Error('Foreground changed; stopping test')
    const outcome = control(action.type === 'click' ? { type: 'click', x: Math.round(action.x * width), y: Math.round(action.y * height) } : action)
    if (!outcome.success) throw new Error('Native input failed')
    await new Promise(resolve => setTimeout(resolve, 600))
    if (normalize(control({ type: 'status' }).app) !== 'whatsapp') throw new Error('Foreground changed before capture')
    execFileSync('screencapture', ['-x', '-D', '1', imagePath], { timeout: 10000 })
    image = (await sharp(imagePath).resize({ width: 1440, height: 900, fit: 'inside' }).jpeg({ quality: 75 }).toBuffer()).toString('base64')
    app = 'WhatsApp'
    if (step === 7) throw new Error('Search test exceeded step limit')
  }
} finally {
  worker.stop()
  if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath)
  fs.rmdirSync(temp)
}
