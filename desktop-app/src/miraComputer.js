'use strict';
const { execFile } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const { randomUUID } = require('crypto');
const { trustedMiraSender } = require('./miraPermissions');
const run = promisify(execFile);

function validateComputerAction(value) {
  if (!value || typeof value !== 'object') return null;
  const { type } = value;
  if (type === 'click' && Number.isFinite(value.x) && Number.isFinite(value.y) && value.x >= 0 && value.x <= 1 && value.y >= 0 && value.y <= 1) return { type, x: value.x, y: value.y };
  if (type === 'type' && typeof value.text === 'string' && value.text.length <= 2000) return { type, text: value.text };
  if (type === 'key' && ['enter', 'tab', 'escape', 'backspace', 'up', 'down', 'left', 'right', 'select_all', 'copy', 'paste', 'find'].includes(value.key)) return { type, key: value.key };
  if (type === 'scroll' && Number.isInteger(value.amount) && Math.abs(value.amount) <= 10) return { type, amount: value.amount };
  if (type === 'open_app' && typeof value.name === 'string' && /^[\p{L}\p{N} ._-]{1,80}$/u.test(value.name)) return { type, name: value.name };
  if (type === 'lock') return { type };
  return null;
}

function createMiraComputer({ desktopCapturer, screen, store, pointer, systemPreferences, shell, globalShortcut, platform, resourcesPath, packaged, runControl, agentS, isLocked = () => false }) {
  let session = null;
  let expiryTimer = null;
  // Ctrl+Shift+Esc belongs to Task Manager on Windows and cannot reliably be
  // registered. Keep the familiar Mac shortcut and use a non-reserved chord elsewhere.
  const stopShortcut = platform === 'darwin' ? 'CommandOrControl+Shift+Escape' : 'Control+Alt+Shift+Escape';
  const helper = packaged ? path.join(resourcesPath, 'mira-control') : path.join(__dirname, '..', 'build', `mira-control-${process.arch}`);
  async function control(action) {
    if (runControl) return runControl(action);
    if (platform !== 'darwin') {
      const runtime = path.join(packaged ? resourcesPath : path.join(__dirname, '..', 'build', `agent-s-${platform}-${process.arch}`), ...(packaged ? ['agent-s'] : []), platform === 'win32' ? 'mira-agent-s.exe' : 'mira-agent-s');
      return new Promise((resolve, reject) => {
        const child = execFile(runtime, ['--control'], { timeout: 12000, maxBuffer: 100000, windowsHide: true }, (error, stdout) => {
          if (error) return reject(error);
          try { resolve(JSON.parse(stdout)); } catch (parseError) { reject(parseError); }
        });
        child.stdin.end(JSON.stringify(action) + '\n');
      });
    }
    const result = await run(helper, [JSON.stringify(action)], { timeout: 10000, maxBuffer: 100000 });
    return JSON.parse(result.stdout);
  }
  function cancel() { clearTimeout(expiryTimer); session = null; agentS?.stop(); pointer?.hide(); globalShortcut.unregister(stopShortcut); }
  return async function handle(event, window, origin, input) {
    if (!trustedMiraSender(event, window, origin)) return { success: false, message: 'Desktop controls require the Talio application.' };
    if (input?.operation === 'cancel') { cancel(); return { success: true }; }
    try {
      if (isLocked()) { cancel(); return { success: false, message: 'Unlock your laptop before using desktop controls.' }; }
      if (input?.operation === 'begin') {
        if (session) return { success: false, message: 'Another desktop task is already running.' };
        if (platform === 'darwin' && platform === process.platform && Number(require('os').release().split('.')[0]) < 23) return { success: false, message: 'Computer controls require macOS 14 or newer. Other Talio features remain available.' };
        if (typeof input.goal !== 'string' || !input.goal.trim() || input.goal.length > 3000) return { success: false };
        if (platform === 'darwin' && (!systemPreferences.isTrustedAccessibilityClient(false) || systemPreferences.getMediaAccessStatus('screen') !== 'granted')) return { success: false, message: 'Enable Accessibility and Screen Recording in the Talio permission checklist first.' };
        const probe = await control({ type: 'status' });
        if (!probe.success) return probe;
        if (probe.accessibility === false) return { success: false, message: 'Allow Talio desktop controls in Accessibility settings, then restart Talio.' };
        if (store?.get('miraDesktopConsentV1') !== true) return { success: false, message: 'Enable desktop control once in the Talio permission checklist, then retry your command.' };
        session = { id: randomUUID(), expires: Date.now() + 300000, steps: 0, observation: null };
        if (!globalShortcut.register(stopShortcut, cancel)) { cancel(); return { success: false, message: 'The emergency stop shortcut is unavailable. Close the app using it and try again.' }; }
        pointer?.show();
        expiryTimer = setTimeout(cancel, 300000);
        expiryTimer.unref?.();
        const started = session;
        if (agentS) await agentS.begin(input.goal);
        if (session !== started || isLocked()) throw new Error('Desktop task stopped.');
        return { success: true, sessionId: session.id, planner: agentS ? 'agent-s-local' : 'legacy' };
      }
      const active = session;
      if (store?.get('miraDesktopConsentV1') !== true) { cancel(); return { success: false, message: 'Desktop control permission was revoked.' }; }
      if (!active || input?.sessionId !== active.id || Date.now() > active.expires) { cancel(); return { success: false, message: 'Desktop task stopped or expired.' }; }
      if (input.operation === 'observe') {
        const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
        const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1440, height: 900 }, fetchWindowIcons: false });
        const source = sources.find(item => String(item.display_id) === String(display.id));
        if (!source || source.thumbnail.isEmpty()) throw new Error('Screen capture is unavailable. Check Screen Recording permission.');
        const foreground = await control({ type: 'status' });
        if (!foreground.success) throw new Error(foreground.message || 'Foreground application unavailable.');
        if (session !== active) throw new Error('Desktop task stopped.');
        active.observation = { id: randomUUID(), time: Date.now(), bounds: display.bounds, pid: foreground.pid, image: source.thumbnail.toJPEG(75).toString('base64'), app: foreground.app };
        return { success: true, observationId: active.observation.id, image: source.thumbnail.toJPEG(75).toString('base64'), app: foreground.app };
      }
      if (input.operation === 'plan' || input.operation === 'model_response') {
        if (!agentS || !active.observation || active.observation.id !== input.observationId) throw new Error('Observe the desktop before planning.');
        if (input.operation === 'plan' && active.planning) throw new Error('A plan is already in progress.');
        if (input.operation === 'model_response' && (!active.awaitingModel || typeof input.text !== 'string' || input.text.length > 16000)) throw new Error('Unexpected model response.');
        active.planning = true; active.awaitingModel = false;
        const result = input.operation === 'plan'
          ? await agentS.predict({ image: active.observation.image, app: active.observation.app })
          : await agentS.respond(input.text);
        if (session !== active || isLocked()) throw new Error('Desktop task stopped.');
        active.awaitingModel = result.kind === 'model_request';
        active.planning = active.awaitingModel;
        // Planning can take longer than the input freshness window. Never refresh
        // the observation timestamp: stale actions must be rejected, not replayed.
        return { success: true, ...result };
      }
      const action = validateComputerAction(input.action);
      const observation = active.observation;
      if (!action || !observation || observation.id !== input.observationId || Date.now() - observation.time > 45000 || active.steps >= 24) throw new Error('The screen changed or this task reached its step limit. Please try again.');
      const foreground = await control({ type: 'status' });
      if (!foreground.success || isLocked() || session !== active || foreground.pid !== observation.pid) throw new Error('The active application changed. Desktop task paused to avoid acting in the wrong window.');
      if (/terminal|iterm|powershell|command prompt|^(cmd|pwsh|regedit|mmc)(\.exe)?$|system settings|keychain|password|keepass|lastpass|bitwarden/i.test(foreground.app || '') && action.type !== 'open_app') throw new Error('This application requires manual control. Desktop task stopped.');
      active.observation = null;
      active.steps++;
      if (action.type === 'click') {
        action.x = observation.bounds.x + Math.round(action.x * (observation.bounds.width - 1));
        action.y = observation.bounds.y + Math.round(action.y * (observation.bounds.height - 1));
        if (platform === 'win32' && screen.dipToScreenPoint) Object.assign(action, screen.dipToScreenPoint({ x: action.x, y: action.y }));
      }
      const outcome = await control(action);
      if (action.type === 'open_app' && outcome.notInstalled) {
        const fallback = { whatsapp: 'https://web.whatsapp.com/', gmail: 'https://mail.google.com/', slack: 'https://app.slack.com/' }[action.name.toLowerCase()];
        if (fallback) { await shell.openExternal(fallback); return { success: true, message: 'Opened web app because the desktop app is not installed.' }; }
      }
      if (action.type === 'lock') cancel();
      return outcome;
    } catch (error) { cancel(); return { success: false, message: error.code === 'ENOENT' ? 'Update Talio to install its desktop-control helper.' : error.cmd ? 'The desktop-control helper could not complete the input. Check Accessibility permission.' : String(error.message || 'Desktop task stopped.').slice(0, 250) }; }
  };
}
module.exports = { createMiraComputer, validateComputerAction };
