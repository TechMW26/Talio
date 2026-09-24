function cell(value) {
  const text = String(value ?? '')
  // Prevent spreadsheet formulas from ticket subjects or comments.
  const safe = /^[\s]*[=+@-]/.test(text) ? `'${text}` : text
  return `"${safe.replaceAll('"', '""')}"`
}

export function buildHelpdeskReport(tickets) {
  const name = person => [person?.firstName, person?.lastName].filter(Boolean).join(' ')
  const rows = [['Ticket', 'Subject', 'Category', 'Status', 'Priority', 'Raised by', 'Assigned to', 'Created', 'Comments', 'Resolution']]
  for (const ticket of tickets) {
    rows.push([
      ticket.ticketNumber, ticket.subject, ticket.category, ticket.status, ticket.priority,
      name(ticket.createdBy), name(ticket.assignedTo), ticket.createdAt,
      (Array.isArray(ticket.comments) ? ticket.comments : []).map(comment =>
        `${comment.commentedAt || ''} ${comment.isInternal ? '[Internal] ' : ''}${comment.comment || ''}`
      ).join('\n'), ticket.resolution,
    ])
  }
  return '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n')
}
