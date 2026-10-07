'use client'

import styles from './attendance-colors.module.css'

export const ATTENDANCE_LEGEND = [
  ['present', 'Present'], ['absent', 'Absent'], ['late', 'Late'],
  ['half-day', 'Half Day'], ['leave', 'On Leave'], ['holiday', 'Holiday'],
  ['in-progress', 'In Progress'], ['work-from-home', 'WFH'],
  ['weekend', 'Weekend'], ['no-record', 'No Record'],
]

export default function AttendanceLegend() {
  return <ul className={styles.legend} aria-label="Attendance colour legend">
    {ATTENDANCE_LEGEND.map(([status, label]) => <li key={status}>
      <span className={styles.swatch} data-attendance-status={status} aria-hidden="true" />{label}
    </li>)}
  </ul>
}
