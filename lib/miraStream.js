// Read UTF-8 SSE records across arbitrary network boundaries.
export async function readMiraEvents(body, onEvent) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop()
      if (done && buffer) lines.push(buffer)
      for (const line of lines) {
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (data === '[DONE]') return
        if (data) {
          const event = JSON.parse(data)
          await onEvent(event)
          // Completion is authoritative; do not wait for a proxy to close the socket.
          if (event.type === 'complete') return
        }
      }
      if (done) break
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}

// Expose only the first, top-level message string, never unfinished cards/actions.
export function partialMiraMessage(raw) {
  const match = raw.match(/^\s*(?:```json\s*)?\{\s*"message"\s*:\s*"/)
  if (!match) return ''
  let value = ''
  for (let i = match[0].length; i < raw.length; i++) {
    const c = raw[i]
    if (c === '"') break
    if (c !== '\\') { value += c; continue }
    const escape = raw[++i]
    if (!escape) break
    if (escape === 'u') {
      const hex = raw.slice(i + 1, i + 5)
      if (!/^[0-9a-f]{4}$/i.test(hex)) break
      value += String.fromCharCode(parseInt(hex, 16)); i += 4
    } else {
      const decoded = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '"': '"', '\\': '\\', '/': '/' }[escape]
      if (decoded === undefined) break
      value += decoded
    }
  }
  return value
}
