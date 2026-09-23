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
    latest = text.slice(0, 5000)
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
      const sentence = remaining.match(/^.{1,160}?[.!?।](?:\s|$)/su)
      let length = sentence?.[0].length || 0
      if (!length && remaining.length >= 100) length = remaining.lastIndexOf(' ', 140) + 1
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
