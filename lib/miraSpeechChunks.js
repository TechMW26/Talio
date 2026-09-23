// Small first phrase reduces time to first audio; later chunks preserve prosody.
export function splitMiraSpeech(text) {
  const chunks = []
  let rest = String(text || '').trim()
  while (rest) {
    const limit = chunks.length ? 280 : 120
    if (rest.length <= limit) { chunks.push(rest); break }
    const head = rest.slice(0, limit)
    const sentence = [...head.matchAll(/[.!?。！？।](?:\s|$)/gu)].pop()
    const boundary = sentence && sentence.index > 30 ? sentence.index + 1 : head.lastIndexOf(' ')
    const cut = boundary > 20 ? boundary : limit
    chunks.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  return chunks
}
