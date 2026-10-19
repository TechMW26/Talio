'use strict';

// Deliberately narrow: only an explicit app activation can bypass visual planning.
// Buttons, recipients, file selection and compound-task completion need Agent S.
function decideDesktopRoute(goal) {
  const text = String(goal || '').trim();
  // Explicit browser requests must not be redirected to an installed client.
  if (/\b(?:website|web version|in (?:the )?(?:browser|safari|chrome|edge|firefox))\b/i.test(text)) return { route: 'COGNITIVE', needsScreen: true, reason: 'Respect the explicitly requested browser destination.' };
  // Media requests name the destination later in the sentence. Launch only
  // that installed app here; selecting a song and verifying playback still
  // belongs to the visual executor (activation is never task completion).
  const media = !/\b(?:don't|do not|never|cancel|instead)\b|मत|नहीं/iu.test(text) && text.match(/^(?:(?:please|mira)[,\s]+)*(?:play|resume|pause)\b.+?\b(?:on|in|using)\s+(?:the\s+)?(youtube\s*music|spotify)(?:\s+(?:app|application))?(?=$|[.!?,;])/iu);
  if (media) return { route: 'FAST', needsScreen: true, continueCognitive: true, reason: 'Activate the requested media application before visual playback control.', action: { type: 'open_app', name: /^youtube/i.test(media[1]) ? 'YouTube Music' : 'Spotify' } };
  const match = text.match(/^(?:(?:please|mira|hey mira)[,\s]+)*(?:open|launch|focus|restore|bring up|switch to)\s+(?:the\s+)?(talio|youtube\s*music|whats\s*app|telegram|signal|slack|outlook|gmail|discord|spotify|notes|calculator|finder|textedit|chrome|safari|notepad)(?:\s+(?:app|application))?(?=$|[\s.!?,])/iu);
  if (!match) return { route: 'COGNITIVE', needsScreen: true, reason: 'The requested target requires current desktop context.' };
  const name = /^whats\s*app$/i.test(match[1]) ? 'WhatsApp' : /^youtube\s*music$/i.test(match[1]) ? 'YouTube Music' : match[1];
  const remainder = text.slice(match[0].length).trim();
  // A known-name prefix is not an exact app: "YouTube Music Player" may be
  // a different installed application. Let the planner resolve the full name.
  if (remainder && !/^(?:[.!?,;]|and\b|then\b|to\b|but\b)/i.test(remainder)) return { route: 'COGNITIVE', needsScreen: true, reason: 'Resolve the full application name before launching.' };
  const continueCognitive = !/^[.!?]*$/.test(remainder);
  return { route: 'FAST', needsScreen: continueCognitive, continueCognitive, reason: 'Activate the named application natively before any visual planning.', action: { type: 'open_app', name } };
}

function sameWindowFrame(a, b) {
  if (a == null || b == null) return a == null && b == null;
  return ['x', 'y', 'width', 'height'].every(key => Number.isFinite(a[key]) && Number.isFinite(b[key]) && Math.abs(a[key] - b[key]) <= 1);
}

module.exports = { decideDesktopRoute, sameWindowFrame };
