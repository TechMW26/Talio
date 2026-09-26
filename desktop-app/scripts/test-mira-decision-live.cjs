// Supervised macOS acceptance: real main-process executor + packaged Python Agent S.
// Only app activation and contact-search inputs are permitted. Never sends messages.
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { createMiraComputer } = require('../src/miraComputer');
const { createAgentS } = require('../src/miraAgentS');
if (process.argv[2] !== '--search-only' || process.platform !== 'darwin') throw Error('Explicit macOS --search-only required');
const width = Number(process.argv[3]), height = Number(process.argv[4]);
if (!(width > 100 && height > 100)) throw Error('Supply actual primary-display logical width and height');
const requestAgentSModel = require('jiti')(__filename)('../../lib/ai/agentSProxy.js').requestAgentSModel;
async function model(messages) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await requestAgentSModel(messages); }
    catch (error) {
      if (attempt === 2) throw error;
      console.log(JSON.stringify({ modelRetry: attempt + 1, message: error.message }));
      await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
}
const helper = path.resolve(__dirname, '../build', `mira-control-${process.arch}`);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'talio-decision-qa-'));
const imagePath = path.join(temp, 'screen.jpg');
const raw = action => JSON.parse(execFileSync(helper, [JSON.stringify(action)], { encoding: 'utf8', timeout: 10000 }));
const normalize = value => String(value || '').replace(/[\u200e\u200f]/g, '').trim().toLowerCase();
let captures = 0, inputs = 0, searchFocused = false;
const control = async action => {
  const searchTargets = action.type === 'click' ? (raw({ type: 'ui_elements' }).elements || []).filter(element => normalize(element.label) === 'search') : [];
  const inSearch = searchTargets.some(({ frame }) => action.x >= frame.x && action.x <= frame.x + frame.width && action.y >= frame.y && action.y <= frame.y + frame.height);
  const allowed = ['status', 'ui_elements', 'prepare_window', 'restore_window'].includes(action.type)
    || action.type === 'open_app' && normalize(action.name) === 'whatsapp'
    || action.type === 'key' && ['find', 'select_all', 'escape'].includes(action.key)
    || action.type === 'type' && normalize(action.text) === 'mansi' && searchFocused
    || action.type === 'click' && inSearch;
  if (!allowed) throw Error('Outside search-only scope; no input delivered');
  if (!['status', 'open_app', 'restore_window'].includes(action.type) && normalize(raw({ type: 'status' }).app) !== 'whatsapp') throw Error('Foreground changed; stopping supervised test');
  const result = raw(action);
  if (result.success && ['click', 'key', 'type'].includes(action.type)) {
    inputs++;
    if (action.type === 'click' || action.key === 'find') searchFocused = true;
  }
  return result;
};
const frame = { url: 'https://app.talio.in/dashboard' }, contents = { mainFrame: frame };
const event = { sender: contents, senderFrame: frame }, window = { webContents: contents, isDestroyed: () => false };
const handler = createMiraComputer({ platform: 'darwin', packaged: false, runControl: control,
  agentS: createAgentS({ packaged: false }), store: { get: () => true },
  // Native helper independently checks actual Accessibility. This harness does
  // not grant/change OS permissions and refuses capture outside WhatsApp.
  systemPreferences: { isTrustedAccessibilityClient: () => raw({ type: 'status' }).accessibility, getMediaAccessStatus: () => 'granted' },
  globalShortcut: { register: () => true, unregister: () => {} }, shell: {},
  screen: { getCursorScreenPoint: () => ({ x: 0, y: 0 }), getDisplayNearestPoint: () => ({ id: 1, bounds: { x: 0, y: 0, width, height } }) },
  desktopCapturer: { getSources: async () => {
    if (normalize(raw({ type: 'status' }).app) !== 'whatsapp') throw Error('Refusing to capture another app');
    execFileSync('screencapture', ['-x', '-D', '1', imagePath], { timeout: 10000 });
    const jpeg = await sharp(imagePath).resize({ width: 1440, height: 900, fit: 'inside' }).jpeg({ quality: 75 }).toBuffer();
    captures++;
    return [{ display_id: '1', thumbnail: { isEmpty: () => false, toJPEG: () => jpeg } }];
  } },
});
const call = input => handler(event, window, 'https://app.talio.in', input);
(async () => {
  let sessionId;
  try {
    const start = await call({ operation: 'begin', goal: 'Open WhatsApp and search for Mansi in the contacts/chats search. Stop when search results or no results are visible. Do not select any conversation or send any message.' });
    if (!start.success) throw Error(start.message);
    sessionId = start.sessionId;
    console.log(JSON.stringify({ route: start.decision.route, phase: 'native-open', result: await call({ operation: 'fast', sessionId }) }));
    for (let step = 0; step < 8; step++) {
      await new Promise(resolve => setTimeout(resolve, 400));
      const observation = await call({ operation: 'observe', sessionId });
      if (!observation.success) throw Error(observation.message);
      const args = { sessionId, observationId: observation.observationId };
      const started = Date.now();
      let result = await call({ ...args, operation: 'plan' });
      for (let i = 0; result.kind === 'model_request' && i < 4; i++) result = await call({ ...args, operation: 'model_response', text: await model(result.messages) });
      console.log(JSON.stringify({ step, elapsedMs: Date.now() - started, action: result.action, done: result.done, retryable: result.retryable, message: result.message }));
      if (result.done) { console.log(JSON.stringify({ result: 'PASS', captures, inputs, note: 'Confirm search results independently in the app; no messages sent.' })); return; }
      if (result.retryable) continue;
      if (!result.success || !result.action) throw Error(result.message || result.question || 'No action');
      const outcome = await call({ ...args, operation: 'act', action: result.action });
      if (!outcome.success && !outcome.retryable) throw Error(outcome.message);
      if (outcome.retryable) console.log(JSON.stringify({ recovery: outcome.message }));
    }
    throw Error('Search step limit exceeded');
  } finally {
    await call({ operation: 'cancel', sessionId });
    if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
    fs.rmdirSync(temp);
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
