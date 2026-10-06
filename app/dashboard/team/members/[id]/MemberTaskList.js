'use client'

import styles from './member.module.css'

export default function MemberTaskList({ tasks }) {
  return <div className={styles.taskTable}>
    <div className={styles.taskColumns} aria-hidden="true"><span>Task / project</span><span>Status</span><span>Priority</span><span>Due date</span></div>
    <ul>{tasks.map(task => {
      const due = task.dueDate ? new Date(task.dueDate) : null
      const validDue = due && !Number.isNaN(due.getTime())
      const overdue = validDue && due < new Date() && task.status !== 'completed'
      return <li className={styles.taskRow} key={task._id}>
        <div><strong>{task.title}</strong><p>{task.project?.name || 'Standalone task'}</p><small>Assigned by {[task.assignedBy?.firstName || task.createdBy?.firstName, task.assignedBy?.lastName || task.createdBy?.lastName].filter(Boolean).join(' ') || 'Unknown'}</small></div>
        <div><span className={styles.taskStatus} data-status={task.status}>{(task.status || 'Unknown').replaceAll('-', ' ')}</span>{['pending', 'rejected'].includes(task.assignmentStatus) && <small>{task.assignmentStatus === 'pending' ? 'Awaiting acceptance' : 'Assignment rejected'}</small>}</div>
        <span className={styles.priority} data-priority={task.priority}>{task.priority || 'Normal'}</span>
        <time className={overdue ? styles.overdue : ''} dateTime={validDue ? due.toISOString() : undefined}>{validDue ? due.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'No due date'}</time>
      </li>
    })}</ul>
  </div>
}
