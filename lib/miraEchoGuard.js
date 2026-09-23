// Prefer cancellation of local speaker output, not just remote-call audio.
export async function strengthenMiraEchoCancellation(stream) {
  for (const track of stream.getAudioTracks?.() || []) {
    if (track.getCapabilities?.().echoCancellation?.includes('all')) {
      try { await track.applyConstraints({ echoCancellation: { exact: 'all' }, noiseSuppression: true }) }
      catch { /* Keep the already requested boolean AEC on older drivers. */ }
    }
  }
}

const normalize = text => String(text || '').normalize('NFKC').toLowerCase()
  .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()

function distance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 0; i < a.length; i++) {
    const next = [i + 1]
    for (let j = 0; j < b.length; j++) next.push(Math.min(next[j] + 1, row[j + 1] + 1, row[j] + (a[i] === b[j] ? 0 : 1)))
    row = next
  }
  return row[b.length]
}

export function isMiraPlaybackEcho(text, reply) {
  const heard = normalize(text).slice(0, 1000), spoken = normalize(reply).slice(0, 6000)
  if (!heard || !spoken) return false
  if (` ${spoken} `.includes(` ${heard} `)) return true
  // Small recognition errors must not cause MIRA to interrupt itself.
  // Short words need exact matching so commands like "stop" stay responsive.
  if (heard.length < 12) return false
  const words = spoken.split(' '), size = heard.split(' ').length
  for (let start = 0; start < words.length; start++) {
    for (const length of [size - 1, size, size + 1]) {
      if (length < 1) continue
      const candidate = words.slice(start, start + length).join(' ')
      const tolerance = Math.floor(heard.length * 0.18)
      if (Math.abs(candidate.length - heard.length) <= tolerance && distance(heard, candidate) <= tolerance) return true
    }
  }
  return false
}
