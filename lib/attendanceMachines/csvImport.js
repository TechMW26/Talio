function parseCsvRows(text) {
  const rows = []
  let row = []
  let value = ''
  let quoted = false

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        value += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (character === ',' && !quoted) {
      row.push(value)
      value = ''
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index += 1
      row.push(value)
      if (row.some((cell) => cell.trim())) rows.push(row)
      row = []
      value = ''
    } else {
      value += character
    }
  }
  row.push(value)
  if (row.some((cell) => cell.trim())) rows.push(row)
  return rows
}

function normalizeHeader(value) {
  return String(value || '').trim().replace(/^\uFEFF/, '').toLowerCase().replace(/[\s-]+/g, '_')
}

/** Parse vendor exports using common attendance field aliases. */
export function parseAttendanceCsv(text) {
  const rows = parseCsvRows(String(text || ''))
  if (rows.length < 2) return []

  const headers = rows[0].map(normalizeHeader)
  return rows.slice(1).map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index]?.trim() || ''])))
}

