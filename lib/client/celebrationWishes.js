// Use the regular chat endpoints so wishes receive the same persistence,
// unread updates and notifications as messages sent from the chat screen.
export async function sendCelebrationWishes({ people, type, employeeId, token, sent = new Set(), fetcher = fetch }) {
  if (!employeeId || !token) throw new Error('Please sign in again to send wishes.')
  if (!['birthday', 'anniversary'].includes(type)) throw new Error('Unknown celebration type.')

  const post = async (url, body) => {
    const response = await fetcher(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
    const result = await response.json()
    if (!response.ok || !result.success) throw new Error(result.message || 'Could not send wishes. Please try again.')
    return result.data
  }

  for (const person of people) {
    const id = String(person._id)
    const key = `${type}:${id}`
    if (id === String(employeeId) || sent.has(key)) continue
    const chat = await post('/api/chat', { isGroup: false, participants: [id] })
    if (!chat?._id) throw new Error('Could not open the recipient’s chat. Please try again.')
    const content = type === 'birthday'
      ? `🎉 Happy Birthday, ${person.firstName}! Wishing you a wonderful year ahead filled with joy and success! 🎂`
      : `🎉 Happy Work Anniversary, ${person.firstName}! Congratulations on ${person.years} ${person.years === 1 ? 'year' : 'years'} with the team. Wishing you continued growth and success!`
    await post(`/api/chat/${encodeURIComponent(chat._id)}/messages`, { content })
    sent.add(key)
  }
}
