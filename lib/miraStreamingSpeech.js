// Consume cumulative text snapshots, not token deltas. Playback stays ordered.
export function createMiraStreamingSpeech({ speak, live, clean = text => text }) {
  let consumed = '', latest = '', chain = Promise.resolve(), failure
  const enqueue = text => {
    const phrase = clean(text)
    if (!phrase.trim()) return
    chain = chain.then(async () => {
      if (live() && !failure) await speak(phrase)
    }).catch(error => { failure = error })
  }
  function update(text, final = false) {
    if (!live() || typeof text !== 'string') return
    latest = text
    // A final tool outcome can replace a provisional response. Read the outcome.
    if (!latest.startsWith(consumed)) {
      if (!final) return
      consumed = ''
    }
    let remaining = latest.slice(consumed.length)
    while (remaining) {
      // Do not narrate incomplete code fences or cut words/numbers mid-token.
      const fence = remaining.indexOf('```')
      if (!final && fence >= 0) remaining = remaining.slice(0, fence)
      // Never split a sentence to hit a character budget. Preserve punctuation
      // for TTS prosody, including closing quotes, and skip common abbreviations.
      let length = 0
      for (const boundary of remaining.matchAll(/[.!?।]+["'”’)]*(?:\s+|$)/gu)) {
        const prefix = remaining.slice(0, boundary.index + 1)
        if (boundary[0].startsWith('.') && /(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc)|\b[A-Z]|\b(?:e\.g|i\.e))\.$/u.test(prefix)) continue
        if (!final && boundary.index + boundary[0].length === remaining.length && /\d\.$/u.test(prefix)) continue
        length = boundary.index + boundary[0].length
        break
      }
      if (!length && final) length = remaining.length
      if (!length) break
      const chunk = remaining.slice(0, length)
      consumed += chunk
      enqueue(chunk)
      remaining = latest.slice(consumed.length)
    }
  }
  return {
    update,
    async finish(text) {
      update(text, true)
      await chain
      if (failure) throw failure
    },
  }
}
