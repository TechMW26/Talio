'use client'

import { NativeButton } from '@/components/ui/fernly/native'
import { motion } from 'framer-motion'
import { useId } from 'react'
import styles from './member.module.css'
export const EMPLOYEE_TABS = [['overview', 'Overview'], ['profile', 'Profile & team'], ['tasks', 'Tasks'], ['attendance', 'Attendance'], ['screenshots', 'Productivity & screenshots'], ['assets', 'Assets'], ['lifecycle', 'Lifecycle'], ['reviews', 'Reviews']]
export default function EmployeeTabs({ active, onChange }) {
  const id = useId()
  return <nav role="tablist" aria-label="Employee dashboards" className={styles.tabs}>{EMPLOYEE_TABS.map(([key, name], index) => <NativeButton key={key} id={`employee-tab-${key}`} role="tab" aria-selected={active === key} aria-controls={`employee-panel-${key}`} tabIndex={active === key ? 0 : -1} onClick={() => onChange(key)} onKeyDown={event => {
    const next = event.key === 'ArrowRight' ? (index + 1) % EMPLOYEE_TABS.length : event.key === 'ArrowLeft' ? (index + EMPLOYEE_TABS.length - 1) % EMPLOYEE_TABS.length : event.key === 'Home' ? 0 : event.key === 'End' ? EMPLOYEE_TABS.length - 1 : null
    if (next != null) { event.preventDefault(); onChange(EMPLOYEE_TABS[next][0]); document.getElementById(`employee-tab-${EMPLOYEE_TABS[next][0]}`)?.focus() }
  }}>{active === key && <motion.span className={styles.pill} layoutId={`employee-pill-${id}`} transition={{ type: 'spring', stiffness: 400, damping: 35 }} />}<span>{name}</span></NativeButton>)}</nav>
}
