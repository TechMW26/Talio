const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const validTime = value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
const fail = message => { throw Object.assign(new Error(message), { status: 400 }) }
export function validateRecurrence(record) {
  if (!['daily', 'weekly', 'monthly', 'custom'].includes(record.frequency)) fail('Invalid notification frequency')
  try { new Intl.DateTimeFormat('en-US', { timeZone: record.timezone || 'Asia/Kolkata' }).format() } catch { fail('Invalid notification timezone') }
  for (const key of ['dailyTime', 'weeklyTime', 'monthlyTime']) if (record[key] && !validTime(record[key])) fail(`Invalid ${key}`)
  for (const key of ['weeklyDays', 'customDays']) if (record[key] && (!Array.isArray(record[key]) || record[key].some(day => !days.includes(day)))) fail(`Invalid ${key}`)
  if (record.frequency === 'weekly' && !record.weeklyDays?.length) fail('Select at least one weekday')
  if (record.frequency === 'monthly' && (!Number.isInteger(Number(record.monthlyDay)) || Number(record.monthlyDay) < 1 || Number(record.monthlyDay) > 31)) fail('Monthly day must be between 1 and 31')
  if (record.frequency === 'custom' && (!record.customDays?.length || !Array.isArray(record.customTimes) || !record.customTimes.length || record.customTimes.some(time => !validTime(time)))) fail('Select valid custom days and times')
  for (const key of ['startDate', 'endDate']) if (record[key] && !Number.isFinite(+new Date(record[key]))) fail(`Invalid ${key}`)
  if (record.endDate && new Date(record.endDate) < new Date(record.startDate)) fail('End date must follow the start date')
}
// Wall-clock recurrence is evaluated in the saved timezone, never the server's TZ.
export function nextNotificationSchedule(record, now = new Date()) {
  validateRecurrence(record)
  const zone = record.timezone || 'Asia/Kolkata', start = new Date(record.startDate || now), end = record.endDate ? new Date(record.endDate) : null
  if (end && end <= now) return null
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
  const parts = value => Object.fromEntries(formatter.formatToParts(value).filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]))
  const first = parts(new Date(Math.max(+start, +now))), calendar = new Date(Date.UTC(first.year, first.month - 1, first.day))
  const toInstant = (day, time) => {
    const [hour, minute] = time.split(':').map(Number), wanted = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour, minute)
    let guess = wanted
    for (let n = 0; n < 4; n++) { const part = parts(new Date(guess)), local = Date.UTC(part.year, part.month - 1, part.day, part.hour, part.minute, part.second); const delta = wanted - local; if (!delta) return new Date(guess); guess += delta }
    return null // This local time does not exist during a DST transition.
  }
  for (let offset = 0; offset < 400; offset++) {
    const day = new Date(+calendar + offset * 86400000), dayName = days[day.getUTCDay()]
    if (record.frequency === 'weekly' && !record.weeklyDays.includes(dayName)) continue
    if (record.frequency === 'custom' && !record.customDays.includes(dayName)) continue
    if (record.frequency === 'monthly' && day.getUTCDate() !== Math.min(Number(record.monthlyDay), new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 0)).getUTCDate())) continue
    const times = record.frequency === 'custom' ? [...new Set(record.customTimes)].sort() : [record[`${record.frequency}Time`] || '09:00']
    for (const time of times) { const candidate = toInstant(day, time); if (candidate && candidate > now && candidate >= start) { if (end && candidate > end) return null; return candidate } }
  }
  return null
}
