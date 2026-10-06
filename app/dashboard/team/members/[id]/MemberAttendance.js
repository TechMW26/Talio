'use client'

import { useMemo, useState } from 'react'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import { getDateKeyInTimezone, getTodayDateString, getTimezone } from '@/lib/timezone'
import { DataErrorState } from '@/components/ui/ErrorBoundary'
import MemberProductivity from './MemberProductivity'
import styles from './member.module.css'

export function attendanceDayKey(value, timezone) {
  if (!value || Number.isNaN(new Date(value).getTime())) return null
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? value : getDateKeyInTimezone(value, timezone)
}

export default function MemberAttendance({ employee }) {
  const [month, setMonth] = useState(() => getTodayDateString().slice(0, 7))
  const [selectedDate, setSelectedDate] = useState(getTodayDateString)
  const [year, monthNumber] = month.split('-').map(Number)
  const { data, error, isLoading, isValidating, mutate } = useAuthedSWR(`/api/attendance?employeeId=${encodeURIComponent(employee._id)}&month=${monthNumber}&year=${year}`, { keepPreviousData: false })
  const records = data?.data || []
  const timezone = getTimezone(records[0]?.employee?.company)
  const today = getTodayDateString(timezone)
  const byDay = useMemo(() => {
    const days = new Map()
    for (const record of records) { const key = attendanceDayKey(record.date, timezone); if (key && !days.has(key)) days.set(key, record) }
    return days
  }, [records, timezone])
  const selected = byDay.get(selectedDate)
  const days = new Date(year, monthNumber, 0).getDate()
  const offset = (new Date(year, monthNumber - 1, 1).getDay() + 6) % 7
  const title = new Date(year, monthNumber - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  function moveMonth(direction) {
    const date = new Date(year, monthNumber - 1 + direction, 1)
    const next = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    setMonth(next); setSelectedDate(next === today.slice(0, 7) ? today : `${next}-01`)
  }
  const clock = value => value && !Number.isNaN(new Date(value).getTime()) ? new Date(value).toLocaleTimeString('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit' }) : '—'
  return <>
    <section className={styles.section} aria-label="Employee attendance">
      <header className={styles.sectionHeader}><div><h2>Attendance calendar</h2><p>Select a day to view attendance and productivity · {timezone}</p></div><div className={styles.toolbar}><button aria-label="Previous attendance month" onClick={() => moveMonth(-1)}>‹</button><strong>{title}</strong><button aria-label="Next attendance month" disabled={month >= today.slice(0, 7)} onClick={() => moveMonth(1)}>›</button><button disabled={isValidating} onClick={() => mutate()} aria-label="Refresh attendance">↻</button></div></header>
      {error ? <DataErrorState message="Unable to load employee attendance" onRetry={() => mutate()} /> : isLoading ? <p role="status" className={styles.emptyState}>Loading attendance…</p> : <div className={styles.calendarLayout}>
        <div><div className={styles.calendar}>
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => <span className={styles.weekday} key={day}>{day}</span>)}
          {Array.from({ length: offset }, (_, i) => <span key={`space-${i}`} />)}
          {Array.from({ length: days }, (_, i) => {
            const key = `${month}-${String(i + 1).padStart(2, '0')}`, record = byDay.get(key)
            const status = record?.status || (record?.checkIn ? 'present' : 'no-record')
            return <button key={key} className={styles.calendarDay} data-status={status} aria-pressed={selectedDate === key} aria-label={`${key}: ${status.replaceAll('-', ' ')}`} disabled={key > today} onClick={() => setSelectedDate(key)}><b>{i + 1}</b><span>{record ? status.replaceAll('-', ' ') : key > today ? '' : '—'}</span></button>
          })}
        </div><p className={styles.calendarNote}>A dash means no attendance record, not an absence.</p></div>
        <aside className={styles.dayDetails}><h3>{new Date(`${selectedDate}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</h3>{!selected ? <p>No attendance record for this day.</p> : <><span className={styles.taskStatus}>{(selected.status || 'Recorded').replaceAll('-', ' ')}</span><dl><div><dt>Check in</dt><dd>{clock(selected.checkIn)}</dd></div><div><dt>Check out</dt><dd>{clock(selected.checkOut)}</dd></div><div><dt>Work hours</dt><dd>{Number.isFinite(Number(selected.workHours)) ? `${Number(selected.workHours).toFixed(1)}h` : '—'}</dd></div><div><dt>Break</dt><dd>{selected.breakMinutes != null ? `${selected.breakMinutes} min` : '—'}</dd></div></dl>{selected.remarks && <p>{selected.remarks}</p>}</>}</aside>
      </div>}
    </section>
    <MemberProductivity key={`${employee._id}-${selectedDate}`} employee={employee} date={selectedDate} />
  </>
}
