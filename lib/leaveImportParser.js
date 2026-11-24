// Reads HR leave sheets (one row per employee, one column per leave type) without AI.
// Works with multi-sheet workbooks and 2-row headers (e.g. "Current Balance" / "CL Balance").
// Returns null when no sheet looks like that, so the caller can fall back to AI.

const norm = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')

const CODE_HEADERS = new Set(['employeecode', 'empcode', 'code', 'eid', 'empid', 'employeeid', 'employeeno', 'empno'])
const NAME_HEADERS = new Set(['employeename', 'name', 'empname', 'employee'])

// Higher rank wins when a sheet has several columns for one leave type.
const SUFFIX_RANK = [['balance', 3], ['', 2], ['days', 2], ['allotted', 1], ['alloted', 1]]

export function splitCsvLine(line) {
  const cells = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cell += '"'; i++ }
      else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { cells.push(cell); cell = '' }
    else cell += ch
  }
  cells.push(cell)
  return cells.map(value => value.trim())
}

export const csvTextToRows = text => String(text || '').split(/\r?\n/).filter(line => line.trim()).map(splitCsvLine)

const fullName = employee => [employee.firstName, employee.lastName].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
const cellText = value => (value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? '').trim())

function matchLeaveColumn(header, leaveTypes) {
  const key = norm(header)
  if (!key) return null
  for (const type of leaveTypes) {
    for (const base of [norm(type.code), norm(type.name)]) {
      if (!base) continue
      for (const [suffix, rank] of SUFFIX_RANK) {
        if (key === base + suffix) return { type, rank }
      }
    }
  }
  return null
}

function parseSheet(rows, leaveTypes) {
  for (let h = 0; h < Math.min(6, rows.length); h++) {
    const keys = (rows[h] || []).map(norm)
    const codeCol = keys.findIndex(key => CODE_HEADERS.has(key))
    const nameCol = keys.findIndex(key => NAME_HEADERS.has(key))
    if (codeCol < 0 && nameCol < 0) continue

    // A second header row (blank under the code column) holds the leave type names.
    const next = rows[h + 1] || []
    const idCol = codeCol >= 0 ? codeCol : nameCol
    const hasSubHeader = cellText(next[idCol]) === '' && next.some(cell => cellText(cell) !== '')
    const headerRows = hasSubHeader ? [rows[h], next] : [rows[h]]

    const best = new Map() // leaveTypeId -> { index, type, rank }
    headerRows.forEach(row => (row || []).forEach((header, index) => {
      if (index === codeCol || index === nameCol) return
      const match = matchLeaveColumn(header, leaveTypes)
      if (!match) return
      const id = String(match.type._id)
      const current = best.get(id)
      if (!current || match.rank > current.rank) best.set(id, { index, ...match })
    }))
    if (best.size === 0) continue

    const columns = [...best.values()]
    const entries = []
    for (let r = h + headerRows.length; r < rows.length; r++) {
      const row = rows[r] || []
      const code = codeCol >= 0 ? cellText(row[codeCol]) : ''
      const name = nameCol >= 0 ? cellText(row[nameCol]) : ''
      if (!code && !name) continue
      for (const { index, type } of columns) {
        const raw = row[index]
        const text = cellText(raw)
        if (text === '') continue
        const days = typeof raw === 'number' ? raw : Number(text)
        if (!Number.isFinite(days)) continue // text such as "As Per Company Policy"
        entries.push({ code, name, type, days: Math.round(days * 100) / 100, row: r + 1 })
      }
    }
    return { entries, usesBalance: columns.some(col => col.rank === 3) }
  }
  return null
}

export function parseStructuredLeaveImport(input, employees, leaveTypes) {
  // Accepts plain row arrays (one sheet) or [{ name, rows }] (workbook).
  const sheets = Array.isArray(input) && input.length && !Array.isArray(input[0]) && input[0]?.rows
    ? input
    : [{ name: '', rows: (input || []).map(row => (Array.isArray(row) ? row : splitCsvLine(String(row)))) }]

  const parsed = sheets
    .map(sheet => ({ sheet: sheet.name || '', result: parseSheet(sheet.rows || [], leaveTypes) }))
    .filter(item => item.result && item.result.entries.length > 0)
  if (parsed.length === 0) return null

  // If any sheet has "Balance" columns, use only those sheets (others are allotment/detail sheets).
  const useSheets = parsed.some(item => item.result.usesBalance) ? parsed.filter(item => item.result.usesBalance) : parsed

  const byCode = new Map()
  const byName = new Map()
  for (const employee of employees) {
    const code = norm(employee.employeeCode)
    if (code && !byCode.has(code)) byCode.set(code, employee)
    const name = norm(fullName(employee))
    if (name) byName.set(name, byName.has(name) ? null : employee) // null = ambiguous name
  }

  // The same code on two different people in the file cannot be imported safely.
  const namesByCode = new Map()
  for (const { result } of useSheets) {
    for (const entry of result.entries) {
      const key = norm(entry.code)
      if (!key) continue
      if (!namesByCode.has(key)) namesByCode.set(key, new Set())
      namesByCode.get(key).add(norm(entry.name))
    }
  }

  const results = []
  for (const { sheet, result } of useSheets) {
    for (const entry of result.entries) {
      const duplicate = entry.code && namesByCode.get(norm(entry.code)).size > 1
      const employee = duplicate ? null : (entry.code && byCode.get(norm(entry.code))) || (entry.name && byName.get(norm(entry.name))) || null
      const validDays = entry.days >= 0
      results.push({
        employeeId: employee ? String(employee._id) : null,
        employeeName: employee ? fullName(employee) : entry.name,
        employeeCode: employee ? employee.employeeCode || '' : entry.code,
        leaveTypeId: String(entry.type._id),
        leaveTypeName: entry.type.name,
        totalDays: entry.days,
        matched: Boolean(employee) && validDays,
        unmatchedEmployee: employee ? (validDays ? undefined : fullName(employee)) : `${entry.code || entry.name}${entry.name && entry.code ? ` (${entry.name})` : ''}${duplicate ? ' - same code used for 2 people in file' : ''}`,
        unmatchedLeaveType: validDays ? undefined : `Negative days: ${entry.days}`,
        sheet,
        row: entry.row,
      })
    }
  }
  return results
}
