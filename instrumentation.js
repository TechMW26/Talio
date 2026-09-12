export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initializeServerlessRealtime } = await import('./lib/platform/realtimeIoAdapter.server')
    initializeServerlessRealtime()
  }
}
