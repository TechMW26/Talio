'use strict';

// Planning guidance for existing validated inputs, never future coordinates or
// executable downloaded skills. Foreground effects always have one owner.
const DESKTOP_SKILLS = Object.freeze([
  { id: 'app-activation', method: 'Resolve installed/running app -> focus natively -> inspect foreground identity -> continue the task. On lookup miss, inspect OS app search; use browser fallback only after verifying absence.' },
  { id: 'find-and-edit', method: 'Identify the current editable/global search field -> focus exact AX target -> replace query in a bounded batch -> inspect results before choosing. Document Find is not global/contact search.' },
  { id: 'browser-navigation', method: 'Reuse the current tab with navigate; observe destination before input. Reuse the browser session. New tabs require the current request.' },
  { id: 'communication', method: 'Verify app/channel and unique recipient header -> compose exact user content -> inspect -> send separately only when requested -> verify sent state. Inspect uncertain sends; never blindly replay.' },
  { id: 'media', method: 'Open installed player -> search requested title/artist or authorized saved preference -> inspect exact result -> activate playback -> verify actual playing title/state. Opening the player is not playback.' },
  { id: 'forms-and-documents', method: 'Read required fields -> fill known fields with predictable batches -> inspect validation -> submit/save only as requested -> verify saved artifact/state.' },
  { id: 'cross-app', method: 'Track requested outcomes as checkpoints; preserve verified outputs across app switches. Never run two workers against the same mouse/keyboard/window.' },
  { id: 'recovery', method: 'Classify loading, stale observation, wrong app, ambiguity, denied permission or uncertain effect. Inspect; choose a different grounded target/shortcut/query. Keep completed checkpoints; retry only incomplete work.' },
]);

const DESKTOP_ORCHESTRATION_POLICY = `Use skill-guided orchestration internally: plan the requested outcomes as short checkpoints with observable completion tests. Choose matching skills from the supplied catalog; skills are guidance, not proof of a tool or permission. Execute one grounded step or validated predictable 2-4 input batch, then advance from fresh feedback. Preserve completed checkpoints and artifacts across replans. Independent research may run concurrently; mouse, keyboard, app focus and capture have one owner. A failed approach changes method instead of restarting the task or replaying uncertain effects. Read the failure ledger; never select an identical no-progress action again. Prefer native/AX targets and documented shortcuts over approximate clicks. Finish only when all requested outcomes have evidence. Keep internal planning out of speech; return one brief verified result or the exact observed blocker.`;

function summarizeDesktopRun(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const count = number => Number.isFinite(number) ? Math.max(0, Math.min(100, Math.floor(number))) : 0;
  return {
    executedInputs: count(value.executedInputs), observations: count(value.observations), recoveries: count(value.recoveries),
    recentFailures: (Array.isArray(value.recentFailures) ? value.recentFailures : []).slice(-4).map(item => ({
      action: String(item?.action || '').slice(0, 400), reason: String(item?.reason || '').slice(0, 400), uncertain: item?.uncertain === true,
    })),
  };
}

// Planner object property order is not an input identity. Keep replay protection
// stable when a fresh model emits the same literal action with reordered keys.
function desktopActionFingerprint(action) {
  const canonical = value => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  return JSON.stringify(canonical(action));
}

function createDesktopRun() {
  const state = { executedInputs: 0, observations: 0, recoveries: 0, recentFailures: [] };
  const noProgress = new Map();
  return {
    observed() { state.observations++; },
    executed(action, completedActions) { state.executedInputs += completedActions || action?.actions?.length || (action?.type === 'navigate' ? 3 : 1); },
    failed(action, outcome) {
      state.recoveries++;
      state.recentFailures.push({ action: JSON.stringify(action || {}).slice(0, 400), reason: String(outcome?.message || 'No verified progress').slice(0, 400), uncertain: outcome?.uncertain === true || outcome?.completedActions > 0 });
      state.recentFailures = state.recentFailures.slice(-4);
    },
    repeated(action, image) {
      // Progress heuristic only; native observation IDs remain authoritative.
      let hash = 2166136261;
      const text = String(image || '');
      // Sampling only every 64th byte mistook different short screenshots (and
      // changes between samples) for the same screen, suppressing valid input.
      for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
      const key = `${text.length}:${hash >>> 0}:${desktopActionFingerprint(action)}`;
      const count = (noProgress.get(key) || 0) + 1;
      noProgress.set(key, count);
      if (noProgress.size > 30) noProgress.delete(noProgress.keys().next().value);
      return count > 1;
    },
    context: () => summarizeDesktopRun(state),
  };
}

module.exports = { DESKTOP_SKILLS, DESKTOP_ORCHESTRATION_POLICY, summarizeDesktopRun, createDesktopRun, desktopActionFingerprint };
