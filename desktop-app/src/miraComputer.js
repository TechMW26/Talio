'use strict';
const { execFile } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const { randomUUID } = require('crypto');
const { trustedMiraSender } = require('./miraPermissions');
const { createMiraFile } = require('./miraFiles');
const run = promisify(execFile);

function validateComputerAction(value) {
  if (!value || typeof value !== 'object') return null;
  const { type } = value;
  if (type === 'create_file' && typeof value.name === 'string' && typeof value.content === 'string' && value.content.length <= 20000) return { type, name: value.name, content: value.content };
  if (type === 'reveal_file' && typeof value.name === 'string' && value.name.length <= 110) return { type, name: value.name };
  if (type === 'drag' && ['x', 'y', 'toX', 'toY'].every(key => Number.isFinite(value[key]) && value[key] >= 0 && value[key] <= 1)) return { type, x: value.x, y: value.y, toX: value.toX, toY: value.toY };
  if (type === 'click' && Number.isFinite(value.x) && Number.isFinite(value.y) && value.x >= 0 && value.x <= 1 && value.y >= 0 && value.y <= 1) return { type, x: value.x, y: value.y };
  if (type === 'type' && typeof value.text === 'string' && value.text.length <= 2000) return { type, text: value.text };
  if (type === 'key' && ['enter', 'tab', 'escape', 'backspace', 'up', 'down', 'left', 'right', 'select_all', 'copy', 'paste', 'find', 'open_location'].includes(value.key)) return { type, key: value.key };
  if (type === 'scroll' && Number.isInteger(value.amount) && Math.abs(value.amount) <= 10) return { type, amount: value.amount };
  if (type === 'open_app' && typeof value.name === 'string' && /^[\p{L}\p{N} ._-]{1,80}$/u.test(value.name)) return { type, name: value.name };
  if (type === 'lock') return { type };
  return null;
}

function createMiraComputer({ desktopCapturer, screen, store, pointer, systemPreferences, shell, globalShortcut, platform, resourcesPath, packaged, runControl, agentS, isLocked = () => false }) {
  let session = null;
  let expiryTimer = null;
  let restoring = false;
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
  async function cancel() {
    const previous = session;
    clearTimeout(expiryTimer); session = null; agentS?.stop(); pointer?.hide(); globalShortcut.unregister(stopShortcut);
    if (!previous) return;
    restoring = true;
    for (const state of previous?.windows?.values() || []) {
      try { await control({ type: 'restore_window', state }); } catch { /* Never steal focus or replay input on cleanup failure. */ }
    }
    restoring = false;
  }
  return async function handle(event, window, origin, input) {
    if (!trustedMiraSender(event, window, origin)) return { success: false, message: 'Desktop controls require the Talio application.' };
    if (input?.operation === 'cancel') {
      if (!input.sessionId || input.sessionId === session?.id) await cancel();
      return { success: true };
    }
    let operationSession = session;
    try {
      if (isLocked()) { cancel(); return { success: false, message: 'Unlock your laptop before using desktop controls.' }; }
      if (input?.operation === 'begin') {
        if (session || restoring) return { success: false, message: 'Another desktop task is running or restoring its windows. Please try again shortly.' };
        if (platform === 'darwin' && platform === process.platform && Number(require('os').release().split('.')[0]) < 23) return { success: false, message: 'Computer controls require macOS 14 or newer. Other Talio features remain available.' };
        if (typeof input.goal !== 'string' || !input.goal.trim() || input.goal.length > 3000) return { success: false };
        if (platform === 'darwin' && (!systemPreferences.isTrustedAccessibilityClient(false) || systemPreferences.getMediaAccessStatus('screen') !== 'granted')) return { success: false, message: 'Enable Accessibility and Screen Recording in the Talio permission checklist first.' };
        const probe = await control({ type: 'status' });
        if (!probe.success) return probe;
        if (probe.accessibility === false) return { success: false, message: 'Allow Talio desktop controls in Accessibility settings, then restart Talio.' };
        if (store?.get('miraDesktopConsentV1') !== true) return { success: false, message: 'Enable desktop control once in the Talio permission checklist, then retry your command.' };
        session = { id: randomUUID(), expires: Date.now() + 300000, steps: 0, observation: null, windows: new Map(), files: new Map() };
        operationSession = session;
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
      if (!active || input?.sessionId !== active.id) return { success: false, message: 'Desktop task stopped or expired.' };
      if (Date.now() > active.expires) { cancel(); return { success: false, message: 'Desktop task stopped or expired.' }; }
      if (input.operation === 'observe') {
        const before = await control({ type: 'status' });
        if (!before.success) throw new Error('Foreground application unavailable.');
        const identity = before.windowId || before.pid;
        if (before.windowId && !active.windows.has(identity) && !/terminal|password|system settings|keychain/i.test(before.app || '')) {
          const prepared = await control({ type: 'prepare_window' });
          if (session !== active) {
            if (prepared.state) await control({ type: 'restore_window', state: prepared.state });
            throw new Error('Desktop task stopped.');
          }
          if (prepared.state) active.windows.set(identity, prepared.state);
        }
        const foreground = await control({ type: 'status' });
        const center = foreground.physicalCenter && screen.screenToDipPoint ? screen.screenToDipPoint(foreground.physicalCenter) : foreground.center;
        const display = screen.getDisplayNearestPoint(center || screen.getCursorScreenPoint());
        const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1440, height: 900 }, fetchWindowIcons: false });
        const source = sources.find(item => String(item.display_id) === String(display.id));
        if (!source || source.thumbnail.isEmpty()) throw new Error('Screen capture is unavailable. Check Screen Recording permission.');
        const after = await control({ type: 'status' });
        if (after.pid !== foreground.pid || after.windowId !== foreground.windowId) return { success: false, retryable: true, message: 'Window changed during capture; observing again.' };
        if (!foreground.success) throw new Error(foreground.message || 'Foreground application unavailable.');
        if (session !== active) throw new Error('Desktop task stopped.');
        active.observation = { id: randomUUID(), time: Date.now(), bounds: display.bounds, pid: foreground.pid, windowId: foreground.windowId, frame: foreground.frame, cursor: screen.getCursorScreenPoint(), image: source.thumbnail.toJPEG(75).toString('base64'), app: foreground.app };
        return { success: true, observationId: active.observation.id, image: active.observation.image, app: foreground.app, evidence: active.lastOutcome || '' };
      }
      if (input.operation === 'plan' || input.operation === 'model_response') {
        if (!agentS || !active.observation || active.observation.id !== input.observationId) throw new Error('Observe the desktop before planning.');
        if (input.operation === 'plan' && active.planning) throw new Error('A plan is already in progress.');
        if (input.operation === 'model_response' && (!active.awaitingModel || typeof input.text !== 'string' || input.text.length > 16000)) throw new Error('Unexpected model response.');
        active.planning = true; active.awaitingModel = false;
        const result = input.operation === 'plan'
          ? await agentS.predict({ image: active.observation.image, app: `${active.observation.app}. Last input evidence: ${active.lastOutcome || 'None'}` })
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
      if (!action || !observation || observation.id !== input.observationId || active.steps >= 24) throw new Error('The screen changed or this task reached its step limit. Please try again.');
      if (Date.now() - observation.time > 45000) return { success: false, retryable: true, message: 'Observation expired; capture a fresh screen before acting.' };
      const foreground = await control({ type: 'status' });
      const cursor = screen.getCursorScreenPoint();
      if (!foreground.success || isLocked() || session !== active || foreground.pid !== observation.pid || foreground.windowId !== observation.windowId || JSON.stringify(foreground.frame) !== JSON.stringify(observation.frame) || (Number.isFinite(foreground.keyIdleSeconds) && foreground.keyIdleSeconds < (Date.now() - observation.time) / 1000 - .1) || Math.hypot(cursor.x - observation.cursor.x, cursor.y - observation.cursor.y) > 8) throw new Error('The active window, keyboard or mouse changed. Desktop task paused so you retain control.');
      if (/terminal|iterm|powershell|command prompt|^(cmd|pwsh|regedit|mmc)(\.exe)?$|system settings|keychain|password|keepass|lastpass|bitwarden/i.test(foreground.app || '') && action.type !== 'open_app') throw new Error('This application requires manual control. Desktop task stopped.');
      active.observation = null;
      active.steps++;
      if (action.type === 'create_file') {
        const destination = await createMiraFile(action.name, action.content);
        active.files.set(action.name, destination);
        active.lastOutcome = `Created file ${destination}. Use the application's attachment picker to select this path; verify the filename and recipient before sending.`;
        return { success: true, message: active.lastOutcome };
      }
      if (action.type === 'reveal_file') {
        const destination = active.files.get(action.name);
        if (!destination) throw new Error('Only files created in this session can be revealed by this tool. Use the file manager for other user-requested files.');
        shell.showItemInFolder(destination);
        return { success: true, message: 'File revealed in the system file manager. Verify its selection.' };
      }
      if (action.type === 'click' || action.type === 'drag') {
        action.x = observation.bounds.x + Math.round(action.x * (observation.bounds.width - 1));
        action.y = observation.bounds.y + Math.round(action.y * (observation.bounds.height - 1));
        // Indicator coordinates are independent of the user's OS cursor and use
        // DIP units; convert only the actual input to Windows physical pixels.
        pointer?.moveTo?.({ x: action.x, y: action.y });
        if (platform === 'win32' && screen.dipToScreenPoint) Object.assign(action, screen.dipToScreenPoint({ x: action.x, y: action.y }));
        if (action.type === 'drag') {
          let end = { x: observation.bounds.x + Math.round(action.toX * (observation.bounds.width - 1)), y: observation.bounds.y + Math.round(action.toY * (observation.bounds.height - 1)) };
          if (platform === 'win32' && screen.dipToScreenPoint) end = screen.dipToScreenPoint(end);
          action.toX = end.x; action.toY = end.y;
        }
      }
      const outcome = await control(action);
      active.lastOutcome = outcome.message || 'Input delivered; verify the next screen.';
      if (action.type === 'open_app' && outcome.notInstalled) {
        const fallback = { whatsapp: 'https://web.whatsapp.com/', gmail: 'https://mail.google.com/', slack: 'https://app.slack.com/' }[action.name.toLowerCase()];
        if (fallback) { await shell.openExternal(fallback); return { success: true, message: 'Opened web app because the desktop app is not installed.' }; }
      }
      if (action.type === 'lock') cancel();
      return outcome;
    } catch (error) { if (session === operationSession) cancel(); return { success: false, message: error.code === 'ENOENT' ? 'Update Talio to install its desktop-control helper.' : error.cmd ? 'The desktop-control helper could not complete the input. Check Accessibility permission.' : String(error.message || 'Desktop task stopped.').slice(0, 250) }; }
  };
}
module.exports = { createMiraComputer, validateComputerAction };
