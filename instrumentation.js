export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.VERCEL === '1') {
      const { initializeServerlessRealtime } = await import('./lib/platform/realtimeIoAdapter.server')
      initializeServerlessRealtime()
    }
  }
}
