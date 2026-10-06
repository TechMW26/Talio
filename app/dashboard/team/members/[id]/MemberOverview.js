'use client'


import { Heading1, Heading2, NativeButton } from '@/components/ui/fernly/native'
import { useState } from 'react'
import { CompletionRing, TaskBars } from '@/components/charts/FernlyCharts'
import { formatDesignation } from '@/lib/formatters'
import styles from './member.module.css'

export default function MemberOverview({ employee, stats = {}, tasks = [], showHeading = true, onTasks }) {
  const [failedImage, setFailedImage] = useState(null)
  const name = [employee.firstName, employee.lastName].filter(Boolean).join(' ') || 'Team member'
  const photo = employee.profilePicture
  return <>
    {showHeading && <header className={styles.profileHeading}><div><p>Employee dashboard · {employee.department?.name || 'Team member'}</p><Heading1>{name}</Heading1></div><nav aria-label="Employee sections"><a href="#member-tasks">Tasks</a><a href="#member-attendance">Attendance</a><a href="#member-productivity">Productivity</a></nav></header>}
    <section className={styles.overview} aria-label="Member overview">
    <article className={styles.portrait}>
      {photo && failedImage !== photo ? <img src={photo} alt={name} onError={() => setFailedImage(photo)} />
        : <div className={styles.initials} aria-label="No profile photo">{employee.firstName?.[0]}{employee.lastName?.[0]}</div>}
      <span className={styles.employeeCode}>{employee.employeeCode || 'Team member'}</span>
      <div className={styles.identity}><p>Team profile</p><Heading2>{name}</Heading2><span>{formatDesignation(employee.designation, employee) || 'Team member'}</span></div>
    </article>
    <article className={styles.activityCard}>
      <header><Heading2>Task activity</Heading2><span>All assignments</span></header>
      <div className={styles.taskTotal}><strong>{stats.total || 0}</strong><span>Total tasks</span></div>
      <TaskBars stats={stats} />
    </article>
    <article className={styles.completionCard}>
      <header><Heading2>Completion</Heading2><span>Overall progress</span></header>
      <CompletionRing stats={stats} />
      <div className={styles.progressFoot}><span>In progress <b>{stats.in_progress ?? stats.inProgress ?? 0}</b></span><span>In review <b>{stats.review || 0}</b></span></div>
    </article>
    <article className={styles.assignmentCard}><header><Heading2>Assignments</Heading2><span>Recent tasks</span></header><ol>{tasks.slice(0,5).map(task => <li key={task._id}><span className={styles.assignmentMark} aria-hidden="true">{task.status === 'completed' ? '✓' : '·'}</span><div><strong>{task.title || task.name || 'Untitled task'}</strong><small>{String(task.status || 'Assigned').replaceAll('-', ' ')}</small></div></li>)}</ol>{!tasks.length && <p className={styles.emptyState}>No recent tasks.</p>}{onTasks ? <NativeButton onClick={onTasks}>View all assignments →</NativeButton> : <a href="#member-tasks">View all assignments →</a>}</article>
  </section></>
}
