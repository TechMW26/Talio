'use client'

import useAuthedSWR from '@/hooks/useAuthedSWR'
import { Heading3 } from '@/components/ui/fernly/native'
import styles from './AttendanceSummaryWidget.module.css'

const METRICS = [
  { key: 'presentDays', label: 'Present', caption: 'Days attended' },
  { key: 'absentDays', label: 'Absent', caption: 'Recorded absences' },
  { key: 'lateDays', label: 'Late', caption: 'Late check-ins' },
  { key: 'avgHours', label: 'Avg Hours', caption: 'Per working day' },
]

export default function AttendanceSummaryWidget({ employeeId }) {
  const { data, error, isLoading } = useAuthedSWR(
    employeeId ? `/api/attendance/summary?employeeId=${employeeId}` : null,
    { refreshInterval: 0 }
  )
  const summary = data?.data
  const recordedDays = Number(summary?.presentDays || 0) + Number(summary?.absentDays || 0)
  const presence = recordedDays > 0 ? Math.round(Number(summary.presentDays || 0) / recordedDays * 100) : null
  const month = new Date().toLocaleString('en-IN', { month: 'long', timeZone: 'Asia/Kolkata' })
  return (
    <section className={styles.panel} aria-label="Attendance summary" aria-busy={isLoading}>
      <header className={styles.header}>
        <div><p className={styles.eyebrow}>YOUR MONTH AT A GLANCE</p><Heading3>Attendance</Heading3></div>
        <span className={styles.month}>{month}</span>
      </header>
      {error ? <p role="alert" className={styles.empty}>Unable to load attendance summary.</p> : <>
        {!isLoading && !summary && <p className={styles.empty}>Attendance data is not available yet.</p>}
        <div className={styles.grid}>
          {METRICS.map(({ key, label, caption }) => {
            const raw = summary?.[key]
            const value = raw == null ? '–' : `${raw}${key === 'avgHours' ? 'h' : ''}`
            return <div key={key} className={styles.card} data-metric={key}>
              <div className={styles.content}>
                {isLoading ? <span className={styles.skeleton} aria-label={`Loading ${label}`} /> : <p className={styles.value}>{value}</p>}
                <p className={styles.label}>{label}</p>
                <p className={styles.caption}>{caption}</p>
              </div>
            </div>
          })}
        </div>
        {!isLoading && summary && <footer className={styles.insight}>
          <div><span>Recorded presence</span><strong>{presence == null ? '—' : `${presence}%`}</strong></div>
          {presence != null && <div className={styles.track} role="meter" aria-label="Recorded presence" aria-valuemin={0} aria-valuemax={100} aria-valuenow={presence}><i style={{ width: `${presence}%` }} /></div>}
          <p>{recordedDays ? 'Present days as a share of present and absent records. Late check-ins can overlap with present days.' : 'Your attendance insights will appear when records are available.'}</p>
        </footer>}
      </>}
    </section>
  )
}
