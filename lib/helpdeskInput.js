export function sanitizeTicketUpdate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid ticket update')
  const data = {}
  for (const key of ['subject', 'description', 'category']) {
    if (Object.hasOwn(input, key)) {
      if (typeof input[key] !== 'string' || !input[key].trim()) throw new Error(`Invalid ${key}`)
      data[key] = input[key].trim()
    }
  }
  for (const [key, values] of Object.entries({ status: ['open', 'in-progress', 'resolved', 'closed', 'reopened'], priority: ['low', 'medium', 'high', 'critical', 'urgent'] })) {
    if (Object.hasOwn(input, key)) {
      if (!values.includes(input[key])) throw new Error(`Invalid ${key}`)
      data[key] = input[key]
    }
  }
  if (Object.hasOwn(input, 'assignedTo')) {
    if (input.assignedTo && !/^[a-f0-9]{24}$/i.test(String(input.assignedTo))) throw new Error('Invalid assignee')
    data.assignedTo = input.assignedTo || null
  }
  if (input.attachments !== undefined) {
    if (!Array.isArray(input.attachments)) throw new Error('Invalid attachments')
    data.attachments = input.attachments.map(item => {
      if (!item || typeof item.url !== 'string' || !/^(https:\/\/|\/(?!\/))/.test(item.url)) throw new Error('Invalid attachment URL')
      return { url: item.url, fileName: String(item.fileName || ''), fileId: String(item.fileId || '') }
    })
  }
  if (!Object.keys(data).length) throw new Error('No valid ticket fields provided')
  if (data.status) {
    if (data.status !== 'closed') data.resolvedAt = data.status === 'resolved' ? new Date() : null
    data.closedAt = data.status === 'closed' ? new Date() : null
  }
  return data
}
