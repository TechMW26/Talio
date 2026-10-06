'use client'

import { useState } from 'react'
import { CompletionRing, TaskBars } from '@/components/charts/FernlyCharts'
import { formatDesignation } from '@/lib/formatters'
import styles from './member.module.css'

export default function MemberOverview({ employee, stats = {} }) {
  const [failedImage, setFailedImage] = useState(null)
  const name = [employee.firstName, employee.lastName].filter(Boolean).join(' ') || 'Team member'
  const photo = employee.profilePicture
  return <section className={styles.overview} aria-label="Member overview">
    <article className={styles.portrait}>
      {photo && failedImage !== photo ? <img src={photo} alt={name} onError={() => setFailedImage(photo)} />
        : <div className={styles.initials} aria-label="No profile photo">{employee.firstName?.[0]}{employee.lastName?.[0]}</div>}
      <span className={styles.employeeCode}>{employee.employeeCode || 'Team member'}</span>
      <div className={styles.identity}><p>Team profile</p><h1>{name}</h1><span>{formatDesignation(employee.designation, employee) || 'Team member'}</span></div>
    </article>
    <article className={styles.activityCard}>
      <header><h2>Task activity</h2><span>All assignments</span></header>
      <div className={styles.taskTotal}><strong>{stats.total || 0}</strong><span>Total tasks</span></div>
      <TaskBars stats={stats} />
    </article>
    <article className={styles.completionCard}>
      <header><h2>Completion</h2><span>Overall progress</span></header>
      <CompletionRing stats={stats} />
      <div className={styles.progressFoot}><span>In progress <b>{stats.in_progress ?? stats.inProgress ?? 0}</b></span><span>In review <b>{stats.review || 0}</b></span></div>
    </article>
  </section>
}
