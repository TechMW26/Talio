// Reuse the authenticated direct-chat endpoint; it returns an existing chat
// when the participants already have a conversation.
export async function getTeamChat(employeeId) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)
  try {
    const token = localStorage.getItem('token')
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ isGroup: false, participants: [employeeId] }),
      signal: controller.signal,
    })
    const result = await response.json()
    if (!response.ok || !result.success || !result.data?._id) throw new Error(result.message || 'Unable to open chat. Please try again.')
    return result.data
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Opening chat timed out. Please try again.')
    throw error
  } finally {
    clearTimeout(timeout)
  }
}
