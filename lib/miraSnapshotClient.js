export async function resolveMiraSnapshot(snapshot, { token, signal }) {
  if (signal?.aborted) return null
  // Older desktop clients and browsers can still use the DOM navigation snapshot.
  const capture = await window.electronAPI?.captureMiraAppSnapshot?.().catch(() => null)
  if (signal?.aborted || location.pathname !== snapshot.page) return null
  const image = capture?.page === snapshot.page ? capture.image : undefined
  const response = await fetch('/api/ai/mira-navigation-snapshot', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ...snapshot, image }), signal,
  })
  if (!response.ok) return null
  const result = await response.json()
  return result.success ? result.controlId : null
}
