'use client'

import useAuthedSWR from '@/hooks/useAuthedSWR'
import { FaCalendarCheck, FaCalendarTimes, FaClock, FaExclamationTriangle } from 'react-icons/fa'
import styles from './AttendanceSummaryWidget.module.css'

const METRICS = [
  { key: 'presentDays', label: 'Present', icon: FaCalendarCheck, color: '39, 234, 179', caption: 'Showing up makes a difference' },
  { key: 'absentDays', label: 'Absent', icon: FaCalendarTimes, color: '255, 113, 131', caption: 'People matter always' },
  { key: 'lateDays', label: 'Late', icon: FaExclamationTriangle, color: '255, 204, 70', caption: 'A little earlier goes a long way' },
  { key: 'avgHours', label: 'Avg Hours', icon: FaClock, color: '104, 174, 255', caption: 'Time fuels great things' },
]

export default function AttendanceSummaryWidget({ employeeId }) {
  const { data, error, isLoading } = useAuthedSWR(
    employeeId ? `/api/attendance/summary?employeeId=${employeeId}` : null,
    { refreshInterval: 0 }
  )
  const summary = data?.data
  const month = new Date().toLocaleString('en-IN', { month: 'long', timeZone: 'Asia/Kolkata' })
  return (
    <section className={styles.panel} aria-label="Attendance summary" aria-busy={isLoading}>
      <header className={styles.header}>
        <h3>Attendance <span>· {month}</span></h3>
        <div className={styles.message}><FaCalendarCheck aria-hidden="true" /><p>A healthier workplace<br />builds brighter tomorrows.</p></div>
      </header>
      {error ? <p role="alert" className={styles.empty}>Unable to load attendance summary.</p> : <>
        {!isLoading && !summary && <p className={styles.empty}>Attendance data is not available yet.</p>}
        <div className={styles.grid}>
          {METRICS.map(({ key, label, icon: Icon, color, caption }) => {
            const raw = summary?.[key]
            const value = raw == null ? '–' : `${raw}${key === 'avgHours' ? 'h' : ''}`
            return <div key={key} className={styles.card} style={{ '--metric': color }}>
              <div className={styles.dots} aria-hidden="true" />
              {key === 'avgHours' ? <div className={styles.bars} aria-hidden="true">{[30, 48, 70, 95].map(height => <i key={height} style={{ height: `${height}%` }} />)}</div> : <Icon className={styles.watermark} aria-hidden="true" />}
              <div className={styles.content}>
                {isLoading ? <span className={styles.skeleton} aria-label={`Loading ${label}`} /> : <p className={styles.value}>{value}</p>}
                <p className={styles.label}>{label}</p>
                <p className={styles.caption}>{caption}</p>
              </div>
            </div>
          })}
        </div>
      </>}
    </section>
  )
}
