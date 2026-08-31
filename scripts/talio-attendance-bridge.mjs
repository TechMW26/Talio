#!/usr/bin/env node

/**
 * Generic outbound bridge for LAN-only attendance middleware.
 *
 * The local source URL must return a JSON event, an event array, or an object
 * containing `events`, `records`, `punches`, `attendance`, or `data`.
 * Talio's server-side idempotency makes retries safe.
 */
const ingestUrl = process.env.TALIO_ATTENDANCE_INGEST_URL
const setupToken = process.env.TALIO_ATTENDANCE_SETUP_TOKEN
const sourceUrl = process.env.TALIO_ATTENDANCE_SOURCE_URL
const intervalMs = Math.max(5_000, Number(process.env.TALIO_ATTENDANCE_POLL_MS || 30_000))

if (!ingestUrl || !setupToken || !sourceUrl) {
  console.error('Set TALIO_ATTENDANCE_INGEST_URL, TALIO_ATTENDANCE_SETUP_TOKEN, and TALIO_ATTENDANCE_SOURCE_URL.')
  process.exit(1)
}

let running = false

async function relay() {
  if (running) return
  running = true
  try {
    const sourceResponse = await fetch(sourceUrl, { signal: AbortSignal.timeout(15_000) })
    if (!sourceResponse.ok) throw new Error(`Local source returned HTTP ${sourceResponse.status}`)
    const payload = await sourceResponse.json()

    const talioResponse = await fetch(ingestUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${setupToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
    })
    const result = await talioResponse.json().catch(() => ({}))
    if (!talioResponse.ok) throw new Error(result.message || `Talio returned HTTP ${talioResponse.status}`)
    console.log(`[${new Date().toISOString()}] processed=${result.data?.processed || 0} duplicates=${result.data?.duplicates || 0} unmapped=${result.data?.unmapped || 0}`)
  } catch (error) {
    console.error(`[${new Date().toISOString()}] bridge error: ${error.message}`)
  } finally {
    running = false
  }
}

await relay()
setInterval(relay, intervalMs)

