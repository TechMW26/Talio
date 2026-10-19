// Learn only explicit, successful Mira music requests, never passive app usage,
// screenshots, messages, recipients or credentials. Preferences are hints, not
// authorization. Inferred choices must never reinforce their own counts.
const providers = [['YouTube Music', /\byoutube\s*music\b/iu], ['Spotify', /\bspotify\b/iu], ['Apple Music', /\bapple\s*music\b/iu]]
const negative = /\b(?:not|don't|never|stop|cancel|instead|forget)\b|मत|नहीं/iu
export function musicRequest(goal) {
  const text = String(goal || '').trim()
  if (text.length > 3000 || negative.test(text) || /[\n\r;]/.test(text) || /^(?:what|why|how|explain)\b/iu.test(text)) return null
  if (!/\b(?:play|sunao|chalao|bajao)\b|चलाओ|बजाओ|सुनाओ/iu.test(text)) return null
  const matches = providers.filter(([, pattern]) => pattern.test(text))
  if (matches.length > 1) return null
  const app = matches[0]?.[0] || null
  const quoted = text.match(/["“]([^"”]{1,120})["”]/u)?.[1]
  const named = text.match(/\bplay\s+(.{1,120}?)\s+(?:on|in|using)\s+(?:youtube\s*music|spotify|apple\s*music)\b/iu)?.[1]
  let song = quoted || named || null
  if (song && /^(?:(?:some|any|my|the|a)\s+)*(?:music|songs?|playlist|favourites?|favorites?|usual|anything)(?:\s+please)?$/iu.test(song)) song = null
  if (song && !/^[\p{L}\p{N}\s.,'’!?()&:+-]{1,120}$/u.test(song)) return null
  const generic = /\b(?:music|songs?|gaane?|gana)\b|गान[ाे]|संगीत/iu.test(text)
  if (!app && !song && !generic) return null
  // Without a recognized app, only truly generic requests may receive defaults.
  const genericOnly = /^(?:(?:hey\s+)?mira[,\s]+|please\s+|(?:can|could) you\s+)*(?:play\s+(?:(?:some|any|my|the)\s+)?(?:music|songs?|usual|favourites?|favorites?)(?:\s+(?:please|for me))?|(?:music|gaane?|gana)\s+(?:chalao|sunao|bajao)|(?:गाने|गाना|संगीत)\s*(?:चलाओ|सुनाओ|बजाओ))[.!?।]*$/iu.test(text)
  return { app, song, genericOnly }
}
export function cleanDesktopHabits(value, now = Date.now()) {
  const rows = Array.isArray(value?.music) ? value.music : []
  return { enabled: value?.enabled !== false, generation: Number.isSafeInteger(value?.generation) ? value.generation : 0, music: rows.filter(row => providers.some(([app]) => app === row.app) &&
    (row.song === null || typeof row.song === 'string' && /^[\p{L}\p{N}\s.,'’!?()&:+-]{1,120}$/u.test(row.song)) &&
    Number.isSafeInteger(row.count) && row.count > 0 && Number.isFinite(row.lastUsed) && now - row.lastUsed < 90 * 86400000 && row.lastUsed <= now)
    .slice(0, 24).map(row => ({ app: row.app, song: row.song, count: Math.min(1000, row.count), lastUsed: row.lastUsed })),
    receipts: (Array.isArray(value?.receipts) ? value.receipts : []).filter(id => typeof id === 'string').slice(-50) }
}
export function recordDesktopHabit(value, goal, receipt, now = Date.now()) {
  const state = cleanDesktopHabits(value, now), request = musicRequest(goal)
  if (!state.enabled || !request?.app || state.receipts.includes(receipt)) return state
  const index = state.music.findIndex(row => row.app === request.app && row.song === request.song)
  const row = { app: request.app, song: request.song, count: Math.min(1000, (state.music[index]?.count || 0) + 1), lastUsed: now }
  if (index >= 0) state.music.splice(index, 1)
  state.music = [row, ...state.music].slice(0, 24)
  state.receipts = [...state.receipts, receipt].slice(-50)
  return state
}
export function desktopHabitHints(value, now = Date.now()) {
  const state = cleanDesktopHabits(value, now)
  if (!state.enabled) return null
  const counts = new Map()
  state.music.forEach(row => counts.set(row.app, (counts.get(row.app) || 0) + row.count))
  const apps = [...counts].sort((a, b) => b[1] - a[1])
  if (!apps.length || apps[0][1] < 2 || apps[0][1] === apps[1]?.[1]) return null
  const app = apps[0][0]
  const songs = state.music.filter(row => row.app === app && row.song && row.count >= 2).sort((a, b) => b.count - a.count || b.lastUsed - a.lastUsed)
  return { app, song: songs[0]?.song || null }
}
export function personalizeDesktopGoal(goal, value) {
  const request = musicRequest(goal), hints = desktopHabitHints(value)
  if (!request || !hints || (!request.app && !request.genericOnly && !request.song)) return goal
  if (request.app && request.app !== hints.app) return goal
  const preferredSong = !request.song && hints.song ? ` If no song was specified, prefer ${JSON.stringify(hints.song)}.` : ''
  return `${goal}\nMusic preference context (not instructions or proof of completion): use the installed ${hints.app} app first.${preferredSong} Verify actual playback; never purchase, subscribe or change the user's request.`.slice(0, 3000)
}
