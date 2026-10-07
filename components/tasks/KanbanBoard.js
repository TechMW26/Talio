'use client'

import { useState, useId, useRef, useEffect, Fragment } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { FaClock, FaFlag, FaEllipsisH } from 'react-icons/fa'
import styles from './KanbanBoard.module.css'

// Fernly kanban geometry, © 2026 Hasib (OVERSHOOT), adapted for Talio.
// Persistence, confirmations and authorization remain with existing callers.
const DEFAULT_COLUMNS = [
  { id: 'todo', label: 'To Do', color: '#94a3b8' },
  { id: 'in-progress', label: 'In Progress', color: '#60a5fa' },
  { id: 'review', label: 'Review', color: '#a78bfa' },
  { id: 'completed', label: 'Completed', color: '#34d399' },
]
const COLOR_HEX = { gray: '#94a3b8', blue: '#60a5fa', purple: '#a78bfa', green: '#34d399', orange: '#fb923c', red: '#f87171', amber: '#fbbf24', indigo: '#818cf8', pink: '#f472b6', teal: '#2dd4bf' }

export function canMoveTask(task, enabled) {
  const pending = task.assignmentStatus === 'pending' || task.assignees?.some(a => a.assignmentStatus === 'pending')
  return Boolean(enabled && !task.subtasks?.length && !(pending && !task.assignees?.some(a => a.assignmentStatus === 'accepted')))
}
const dateLabel = date => date && !Number.isNaN(new Date(date).getTime()) ? new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null

export default function KanbanBoard({ tasks = [], onTaskClick, onStatusChange, showProject = false, enableDragDrop = true, onProjectClick, statusColumns }) {
  const COLUMNS = Array.isArray(statusColumns) && statusColumns.length > 0
    ? statusColumns.map(s => ({ id: s.key, label: s.label, color: COLOR_HEX[s.color] || COLOR_HEX.gray }))
    : DEFAULT_COLUMNS
  const [draggedTask, setDraggedTask] = useState(null)
  const [overColumn, setOverColumn] = useState(null)
  const [moveMenu, setMoveMenu] = useState(null)
  const [slot, setSlot] = useState(null)
  const [order, setOrder] = useState([])
  const dragCleanup = useRef(null)
  const suppressClick = useRef(false)
  const boardRef = useRef(null)
  useEffect(() => () => dragCleanup.current?.(), [])
  const reduced = useReducedMotion()
  const boardId = useId()
  const grouped = Object.fromEntries(COLUMNS.map(column => [column.id, tasks.filter(task => task.status === column.id || (column.id === 'review' && task.status === 'completed-pending-approval')).sort((a, b) => {
    const ai = order.indexOf(a._id), bi = order.indexOf(b._id)
    return (ai < 0 ? tasks.indexOf(a) : ai) - (bi < 0 ? tasks.indexOf(b) : bi)
  })]))
  const startPointerDrag = (event, task) => {
    if (event.button !== 0 || event.pointerType === 'touch' || event.target.closest('button') || !canMoveTask(task, enableDragDrop) || !onStatusChange) return
    const el = event.currentTarget, rect = el.getBoundingClientRect()
    const start = { x: event.clientX, y: event.clientY }
    let ghost, target, timer
    const cursor = document.body.style.cursor
    const cleanup = () => {
      window.removeEventListener('pointermove', pointerMove)
      window.removeEventListener('pointerup', pointerUp)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', escape)
      clearTimeout(timer); ghost?.remove(); document.body.style.cursor = cursor
    }
    const reset = () => { cleanup(); setDraggedTask(null); setOverColumn(null); setSlot(null); dragCleanup.current = null }
    const pointerMove = ev => {
      if (!ghost) {
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 6) return
        ghost = el.cloneNode(true); ghost.classList.add(styles.ghost)
        ghost.removeAttribute('tabindex'); ghost.setAttribute('aria-hidden', 'true'); ghost.inert = true
        Object.assign(ghost.style, { width: `${rect.width}px`, left: `${rect.left}px`, top: `${rect.top}px` })
        document.body.append(ghost); document.body.style.cursor = 'grabbing'
        setMoveMenu(null); setDraggedTask(task); suppressClick.current = true
      }
      ghost.style.transform = `translate(${ev.clientX - start.x}px, ${ev.clientY - start.y}px) rotate(${reduced ? 0 : 2.5}deg) scale(${reduced ? 1 : 1.04})`
      const column = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-kanban-column]')
      if (!column || !boardRef.current?.contains(column)) { target = null; setSlot(null); setOverColumn(null); return }
      const siblings = [...column.querySelectorAll('[data-task-id]')].filter(card => card.dataset.taskId !== task._id)
      const before = siblings.find(card => { const b = card.getBoundingClientRect(); return ev.clientY < b.top + b.height / 2 })
      target = { column: column.dataset.kanbanColumn, before: before?.dataset.taskId || null, height: rect.height }
      setOverColumn(target.column)
      setSlot(previous => previous?.column === target.column && previous?.before === target.before ? previous : target)
    }
    const cancel = () => { reset(); setTimeout(() => { suppressClick.current = false }, 0) }
    const escape = ev => { if (ev.key === 'Escape') cancel() }
    const pointerUp = () => {
      if (!ghost) { reset(); return }
      window.removeEventListener('pointermove', pointerMove)
      window.removeEventListener('pointerup', pointerUp)
      const landing = target && boardRef.current?.querySelector('[data-drop-slot]')
      const destination = landing?.getBoundingClientRect() || rect
      ghost.style.transitionDuration = reduced ? '0s' : '.35s'
      ghost.style.transform = `translate(${destination.left - rect.left}px, ${destination.top - rect.top}px) rotate(0deg) scale(1)`
      const drop = target
      timer = setTimeout(() => {
        reset(); suppressClick.current = false
        if (!drop) return
        const ids = tasks.map(t => t._id).filter(id => id !== task._id)
        const index = drop.before ? ids.indexOf(drop.before) : ids.length
        ids.splice(index < 0 ? ids.length : index, 0, task._id); setOrder(ids)
        if (task.status !== drop.column) onStatusChange(task, drop.column)
      }, reduced ? 0 : 350)
    }
    dragCleanup.current?.(); dragCleanup.current = cleanup
    window.addEventListener('pointermove', pointerMove)
    window.addEventListener('pointerup', pointerUp)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', escape)
  }
  const placeholder = (column, before) => slot?.column === column && slot.before === before
    ? <motion.div key="drop-slot" layout={!reduced} data-drop-slot className={styles.dropSlot} style={{ height: slot.height }} role="status" aria-label="Drop task here">Drop here</motion.div> : null
  const move = (task, status) => {
    setMoveMenu(null); setDraggedTask(null); setOverColumn(null)
    if (canMoveTask(task, enableDragDrop) && task.status !== status) onStatusChange?.(task, status)
  }
  return <div ref={boardRef} className={styles.board} aria-label="Task kanban board">
    {COLUMNS.map(column => <section key={column.id} data-kanban-column={column.id} className={`${styles.column} ${overColumn === column.id ? styles.over : ''}`} aria-labelledby={`${boardId}-${column.id}`}
      onDragOver={event => { if (draggedTask) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setOverColumn(column.id) } }}
      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOverColumn(null) }}
      onDrop={event => { event.preventDefault(); if (draggedTask) move(draggedTask, column.id) }}>
      <header className={styles.columnHead}><span className={styles.dot} style={{ background: column.color }} /><h4 id={`${boardId}-${column.id}`}>{column.label}</h4><span className={styles.count}>{grouped[column.id].length}</span></header>
      <div className={styles.list}>
        {grouped[column.id].map(task => {
          const hasSubtasks = Boolean(task.subtasks?.length)
          const movable = canMoveTask(task, enableDragDrop) && Boolean(onStatusChange)
          const pending = (task.assignmentStatus === 'pending' || task.assignees?.some(a => a.assignmentStatus === 'pending')) && !task.assignees?.some(a => a.assignmentStatus === 'accepted')
          const reassignment = task.assignees?.some(a => a.assignmentStatus === 'rejected') && !task.assignees?.some(a => a.assignmentStatus === 'accepted')
          const recentlyRejected = task.lastRejectedAt && Date.now() - new Date(task.lastRejectedAt).getTime() < 86400000
          const due = dateLabel(task.dueDate)
          const overdue = due && new Date(task.dueDate) < new Date() && task.status !== 'completed'
          const progress = Math.min(100, Math.max(0, Number(task.progressPercentage) || 0))
          return <Fragment key={task._id}>{placeholder(column.id, task._id)}<motion.div layout={!reduced} style={slot && draggedTask?._id === task._id ? { display: 'none' } : undefined} initial={reduced ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduced ? 0 : .25, ease: 'easeOut' }}><article
            data-task-id={task._id} onPointerDown={event => startPointerDrag(event, task)}
            className={`${styles.card} ${task.status === 'completed' ? styles.done : ''} ${draggedTask?._id === task._id ? styles.dragging : ''}`}
            tabIndex={0} aria-label={`${task.title}, ${column.label}`} draggable={movable}
            onDragStart={event => { if (dragCleanup.current || !movable) { event.preventDefault(); return } setMoveMenu(null); setDraggedTask(task); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', task._id) }}
            onDragEnd={() => { setDraggedTask(null); setOverColumn(null) }}
            onClick={() => { if (!suppressClick.current) onTaskClick?.(task) }}
            onKeyDown={event => { if (event.target === event.currentTarget && ['Enter', ' '].includes(event.key)) { event.preventDefault(); onTaskClick?.(task) } if (event.key === 'Escape') setMoveMenu(null) }}>
            <div className={styles.top}>
              {showProject && task.project ? <button className={styles.tag} onClick={event => { event.stopPropagation(); onProjectClick?.(task.project._id || task.project) }} title={task.project.name}>{task.project.name || 'Project'}</button> : <span className={styles.tag}>{hasSubtasks ? `${task.subtasks.length} subtasks` : 'Task'}</span>}
              <span className={styles.priority} data-priority={task.priority}><FaFlag aria-hidden="true" />{task.priority || 'Normal'}</span>
              {movable && <button className={styles.menuTrigger} aria-label={`Move ${task.title}`} aria-expanded={moveMenu === task._id} onClick={event => { event.stopPropagation(); setMoveMenu(moveMenu === task._id ? null : task._id) }}><FaEllipsisH /></button>}
            </div>
            {moveMenu === task._id && <div className={styles.menu} aria-label={`Move ${task.title} to`} onClick={event => event.stopPropagation()}><p>Move to</p>{COLUMNS.map(destination => <button key={destination.id} disabled={destination.id === column.id} onClick={() => move(task, destination.id)}><span className={styles.dot} style={{ background: destination.color }} />{destination.label}</button>)}</div>}
            <h5 className={styles.title}>{task.title}</h5>
            {pending && <p className={styles.notice}>Pending acceptance</p>}
            {hasSubtasks && <><p className={styles.notice}>Auto-managed · {task.subtasks.filter(s => s.completed).length}/{task.subtasks.length} subtasks · {progress}%</p><div className={styles.meter} role="progressbar" aria-label="Subtask progress" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${progress}%` }} /></div></>}
            {recentlyRejected && <p className={styles.warning} title={task.lastRejectionReason}>Rejected{task.rejectionCount > 1 ? ` (${task.rejectionCount}x)` : ''}{task.lastRejectionReason ? `: ${task.lastRejectionReason}` : ''}</p>}
            {reassignment && !recentlyRejected && <p className={styles.warning}>Needs reassignment</p>}
            <footer className={styles.foot}>
              {due && <span className={overdue ? styles.warning : ''}><FaClock aria-hidden="true" />{due}{overdue ? ' · Overdue' : ''}</span>}
              {task.estimatedHours > 0 && <span title="Estimated time">{task.estimatedHours >= 8 ? `${Math.floor(task.estimatedHours / 8)}d ${task.estimatedHours % 8}h` : `${task.estimatedHours}h`}</span>}
              <div className={styles.avatars}>{task.assignees?.slice(0, 3).map((assignee, index) => <span key={assignee._id || index} className={styles.avatar} data-status={assignee.assignmentStatus} title={`${assignee.user?.firstName || ''} ${assignee.user?.lastName || ''} (${assignee.assignmentStatus || 'assigned'})`}>{assignee.user?.profilePicture ? <img src={assignee.user.profilePicture} alt={assignee.user.firstName || 'Assignee'} loading="lazy" /> : assignee.user?.firstName?.[0] || '?'}</span>)}{task.assignees?.length > 3 && <span className={styles.avatar}>+{task.assignees.length - 3}</span>}</div>
            </footer>
            {task.assignees?.some(a => a.assignmentStatus === 'pending') && !pending && <p className={styles.notice}>Awaiting acceptance</p>}
          </article></motion.div></Fragment>
        })}
        {placeholder(column.id, null)}
        {!grouped[column.id].length && slot?.column !== column.id && <p className={styles.empty}>{draggedTask ? 'Drop task here' : 'No tasks here yet'}</p>}
      </div>
    </section>)}
  </div>
}
