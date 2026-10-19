'use strict';

// Idle dashboards may throttle; live audio, voice and desktop tasks must not.
// No GPU overrides: Chromium retains its supported-driver/crash fallback.
function manageRendererPerformance(contents, { schedule = setTimeout, unschedule = clearTimeout } = {}) {
  const active = new Map();
  const update = () => { if (!contents.isDestroyed()) contents.setBackgroundThrottling(active.size === 0); };
  const set = (reason, enabled, leaseMs = 0) => {
    unschedule(active.get(reason));
    active.delete(reason);
    if (enabled) {
      const timer = leaseMs ? schedule(() => set(reason, false), leaseMs) : null;
      timer?.unref?.();
      active.set(reason, timer);
    }
    update();
  };
  const clear = () => { active.forEach(timer => unschedule(timer)); active.clear(); update(); };
  contents.on('media-started-playing', () => set('media', true));
  contents.on('media-paused', () => set('media', false));
  contents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => { if (mainFrame && !inPlace) clear(); });
  contents.on('render-process-gone', clear);
  contents.once('destroyed', clear);
  update();
  return { set, clear };
}
module.exports = { manageRendererPerformance };
