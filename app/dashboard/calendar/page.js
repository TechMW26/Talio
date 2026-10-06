'use client'

import { useState, useMemo, useEffect } from 'react'
import Link from 'next/link'
import { useSocket, REALTIME_EVENTS } from '@/contexts/SocketContext'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import { buildCalendarEvents, calendarDateKey } from '@/lib/client/calendarEvents'
import styles from './calendar.module.css'

export default function CalendarPage() {
  const today = calendarDateKey(new Date())
  const [selected, setSelected] = useState(today)
  const [month, setMonth] = useState(today.slice(0, 7))
  const [view, setView] = useState('month')
  const holidays = useAuthedSWR('/api/holidays?limit=100')
  const birthdays = useAuthedSWR('/api/employees/birthdays')
  const announcements = useAuthedSWR('/api/announcements?limit=100')
  const tasks = useAuthedSWR('/api/projects/my-tasks?filter=all')
  const { subscribe } = useSocket()
  const refresh = () => { holidays.mutate(); birthdays.mutate(); announcements.mutate(); tasks.mutate() }
  useEffect(() => {
    const off = [REALTIME_EVENTS.HOLIDAY_UPDATE, REALTIME_EVENTS.ANNOUNCEMENT_CREATED, REALTIME_EVENTS.ANNOUNCEMENT_UPDATED, REALTIME_EVENTS.TASK_CREATED, REALTIME_EVENTS.TASK_UPDATED, REALTIME_EVENTS.TASK_DELETED].filter(Boolean).map(event => subscribe?.(event, refresh))
    return () => off.forEach(unsubscribe => unsubscribe?.())
  }, [subscribe, holidays.mutate, birthdays.mutate, announcements.mutate, tasks.mutate])
  const year = Number(month.slice(0, 4)), monthIndex = Number(month.slice(5)) - 1
  const events = useMemo(() => {
    const source = {
    holidays: holidays.data?.data || [], birthdays: birthdays.data?.data || [],
    announcements: announcements.data?.data || [], tasks: tasks.data?.data || [],
    }
    return [...new Map([...buildCalendarEvents(source, year), ...buildCalendarEvents(source, Number(today.slice(0, 4)))].map(event => [event.id, event])).values()].sort((a,b) => a.date.localeCompare(b.date))
  }, [holidays.data, birthdays.data, announcements.data, tasks.data, year, today])
  const selectedEvents = events.filter(event => event.date === selected)
  const comingUp = events.filter(event => event.type !== 'task' && event.date >= today).slice(0, 12)
  const days = new Date(year, monthIndex + 1, 0).getDate()
  const offset = new Date(year, monthIndex, 1).getDay()
  const format = (date, options) => new Date(date + 'T12:00:00').toLocaleDateString('en-US', options)
  const changeMonth = delta => {
    const next = new Date(year, monthIndex + delta, 1)
    const key = next.getFullYear() + '-' + String(next.getMonth() + 1).padStart(2, '0')
    setMonth(key); setSelected(key + '-01')
  }
  const sources = [holidays, birthdays, announcements, tasks]
  const loading = sources.some(source => source.isLoading)
  const failed = sources.some(source => source.error)
  return <div className={styles.page}>
    <header className={styles.heading}><div><h1>General Calendar</h1><p>Your deadlines, company events and celebrations in one place.</p></div>
      <div className={styles.toggle}>{['month', 'list'].map(mode => <button key={mode} onClick={() => setView(mode)} aria-pressed={view === mode}>{mode === 'month' ? 'Month' : 'List'}</button>)}</div>
    </header>
    {loading && <p role="status" className={styles.empty}>Loading calendar events…</p>}
    {failed && <div role="alert" className={styles.empty}>Some calendar data could not be loaded. <button onClick={refresh}>Retry</button></div>}
    <div className={styles.layout}>
      <section className={styles.card + ' ' + styles.month}>
        <div className={styles.toolbar}><h2>{format(month + '-01', { month: 'long', year: 'numeric' })}</h2><div className={styles.nav}>
          <button aria-label="Previous month" onClick={() => changeMonth(-1)}>‹</button>
          <button onClick={() => { setMonth(today.slice(0, 7)); setSelected(today) }}>Today</button>
          <button aria-label="Next month" onClick={() => changeMonth(1)}>›</button>
        </div></div>
        {view === 'month' ? <>
          <div className={styles.week}>{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(day => <span key={day}>{day}</span>)}</div>
          <div className={styles.grid}>{Array.from({ length: Math.ceil((offset + days) / 7) * 7 }, (_, index) => {
            const day = index - offset + 1
            if (day < 1 || day > days) return <div key={index} aria-hidden="true" />
            const key = month + '-' + String(day).padStart(2, '0')
            const items = events.filter(event => event.date === key)
            return <button key={key} className={styles.day + ' ' + (key === today ? styles.today : '')} aria-pressed={selected === key} aria-label={format(key, { dateStyle: 'full' }) + ', ' + items.length + ' events'} onClick={() => setSelected(key)}>
              <span className={styles.number}>{day}</span>{items.slice(0,2).map(event => <span className={styles.eventTag} key={event.id}>{event.title}</span>)}
              {items.length > 2 && <small>+{items.length - 2} more</small>}
            </button>
          })}</div>
        </> : <ul className={styles.agenda}>{events.filter(event => event.date.startsWith(month)).map(event => <li key={event.id}><button onClick={() => setSelected(event.date)}>{event.title}<small>{format(event.date, { month: 'short', day: 'numeric' })} · {event.type === 'task' ? 'Task deadline' : event.type}</small></button></li>)}
          {!events.some(event => event.date.startsWith(month)) && <li>No events this month.</li>}
        </ul>}
      </section>
      <aside className={styles.card + ' ' + styles.events}><p className={styles.eyebrow}>Events</p><h2>{format(selected, { weekday: 'short', month: 'short', day: 'numeric' })}</h2>
        <ul className={styles.agenda}>{selectedEvents.map(event => <li key={event.id}>{event.href ? <Link href={event.href}>{event.title}</Link> : event.title}<small>{event.type === 'task' ? 'Task deadline' : event.type}</small></li>)}</ul>
        {!selectedEvents.length && <p className={styles.empty}>{loading ? 'Loading events…' : 'No events for this day.'}</p>}
      </aside>
      <aside className={styles.card + ' ' + styles.next}><h2>Coming Up</h2><p className={styles.muted}>Celebrations, holidays and company events</p>
        {comingUp.map(event => <button className={styles.upcoming} key={event.id} onClick={() => { setMonth(event.date.slice(0,7)); setSelected(event.date) }}>
          <span className={styles.dateBadge}><b>{Number(event.date.slice(8))}</b><small>{format(event.date, {month:'short'})}</small></span><span>{event.title}<small>{event.type}</small></span>
        </button>)}
        {!comingUp.length && <p className={styles.empty}>{loading ? 'Loading upcoming events…' : 'No upcoming events.'}</p>}
      </aside>
    </div>
  </div>
}
