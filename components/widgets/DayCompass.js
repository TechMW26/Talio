'use client'

import Link from 'next/link'
import { FaBell } from 'react-icons/fa'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import { NativeButton } from '@/components/ui/fernly/native'
import { buildUpcomingReminders } from '@/lib/dayCompass'
import styles from './DayCompass.module.css'

export default function DayCompass({ enabled = false, meetingsEnabled = false }) {
  const { data, error, isLoading, mutate } = useAuthedSWR(enabled ? '/api/projects/my-tasks' : null, { refreshInterval: 0 })
  const meetings = useAuthedSWR(meetingsEnabled ? '/api/meetings?view=upcoming&limit=5' : null, { refreshInterval: 0 })
  const ready = enabled && !isLoading && !error && Array.isArray(data?.data)
  const meetingsReady = meetingsEnabled && !meetings.isLoading && !meetings.error && Array.isArray(meetings.data?.data)
  const reminders = buildUpcomingReminders(ready ? data.data : [], meetingsReady ? meetings.data.data : [])
  const reminderFailure = (enabled && (error || (!isLoading && !ready))) || (meetingsEnabled && (meetings.error || (!meetings.isLoading && !meetingsReady)))
  const reminderTime = value => new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value))
  if (!enabled && !meetingsEnabled) return null

  return <section className={styles.compass} aria-labelledby="profile-upcoming-title">
      <div className={styles.heading}><h3 id="profile-upcoming-title"><FaBell aria-hidden="true" /> Upcoming</h3><span>IST</span></div>
      <div className={styles.reminders} role="region" aria-label="Upcoming reminders" tabIndex={0}>
        {reminders.map(reminder => <Link key={reminder.id} href={reminder.href} className={styles.reminder}>
          <span className={styles.reminderCopy}><span className={styles.reminderMeta}>{reminder.kind} · <time dateTime={reminder.at}>{reminderTime(reminder.at)}</time></span><strong title={reminder.title}>{reminder.title}</strong></span>
          <span className={styles.priority} data-priority={reminder.priority}>{reminder.priority}</span>
        </Link>)}
        {(isLoading || meetings.isLoading) && <p className={styles.footnote} role="status">Loading reminders…</p>}
        {reminderFailure && <p className={styles.footnote}>Some reminders are unavailable. <NativeButton type="button" onClick={() => { if (enabled) mutate(); if (meetingsEnabled) meetings.mutate() }}>Retry reminders</NativeButton></p>}
        {!reminders.length && !isLoading && !meetings.isLoading && !reminderFailure && <p className={styles.footnote}>No upcoming deadlines{meetingsEnabled ? ' or meetings' : ''}. You’re clear for now.</p>}
      </div>
  </section>
}
