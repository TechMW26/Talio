'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { FaArrowRight, FaChevronLeft, FaChevronRight, FaSearch, FaTimes } from 'react-icons/fa'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import styles from './TeamAttendanceWidget.module.css'

const STATUSES = {
  present: ['Present', 'green'], 'in-progress': ['Working', 'blue'],
  'half-day': ['Half Day', 'amber'], absent: ['Absent', 'pink'],
  'on-leave': ['On Leave', 'amber'], 'not-checked-in': ['Not Checked In', 'amber'],
  'not-started': ['Not Started', 'neutral'], late: ['Late', 'amber'],
  holiday: ['Holiday', 'neutral'], weekend: ['Weekend', 'neutral'],
}
const PAGE_SIZE = 4

function checkInLabel(member) {
  const date = member.checkIn && new Date(member.checkIn)
  if (date && !Number.isNaN(date.getTime())) return `Checked in at ${date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`
  return member.status === 'on-leave' ? 'On leave today' : 'No check-in today'
}

export default function TeamAttendanceWidget() {
  const router = useRouter()
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const { data, error, isLoading, mutate } = useAuthedSWR('/api/attendance/team-today', { refreshInterval: 0 })
  const members = Array.isArray(data?.data) ? data.data : []
  const total = members.length
  const query = search.trim().toLocaleLowerCase().replace(/\s+/g, ' ')
  const filteredMembers = query ? members.filter(member =>
    `${member.firstName || ''} ${member.lastName || ''}`.trim().toLocaleLowerCase().replace(/\s+/g, ' ').includes(query)
  ) : members
  const resultCount = filteredMembers.length
  const lastPage = Math.max(0, Math.ceil(resultCount / PAGE_SIZE) - 1)
  const currentPage = Math.min(page, lastPage)
  const offset = currentPage * PAGE_SIZE
  const metrics = [
    { label: 'Total', value: total, tone: 'blue' },
    { label: 'Present', value: members.filter(m => ['present', 'in-progress'].includes(m.status)).length, tone: 'green' },
    { label: 'Absent', value: members.filter(m => m.status === 'absent').length, tone: 'pink' },
  ]

  return <section className={styles.panel} aria-label="Team attendance" aria-busy={isLoading}>
    <div className={styles.header}>
      <div><h3>Team Attendance</h3><p>Today's overview</p></div>
      <button className={styles.button} onClick={() => router.push('/dashboard/attendance')}>View All <FaArrowRight aria-hidden="true" /></button>
    </div>
    {error && <div role="alert" className={styles.notice}>Unable to update team attendance. <button onClick={() => mutate()}>Retry</button></div>}
    <div className={styles.metrics}>
      {metrics.map(({ label, value, tone }, index) => {
        const percent = total ? Math.round(value / total * 100) : 0
        const available = !isLoading && (!error || data)
        return <div key={label} className={styles.metric} data-tone={tone}>
          <span>{label}</span><strong>{available ? value : '–'}</strong>
          {index > 0 && available && <><small>{percent}% of total</small><div className={styles.ring} role="img" aria-label={`${label}: ${percent}% of team`}>
            <svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="16" /><circle cx="20" cy="20" r="16" pathLength="100" strokeDasharray={`${percent} 100`} /></svg><b>{percent}%</b>
          </div></>}
          {index === 0 && <small>Team members</small>}
        </div>
      })}
    </div>
    <div className={styles.subheading}><div><h4>Recent Team Status</h4><p>Today's attendance records</p></div><span>Today</span></div>
    <div className={styles.search} data-search-container>
      <FaSearch aria-hidden="true" />
      <input type="search" aria-label="Search team members" placeholder="Search team members…" value={search}
        onChange={event => { setSearch(event.target.value); setPage(0) }}
        onKeyDown={event => { if (event.key === 'Escape') { setSearch(''); setPage(0) } }} />
      {search && <button type="button" aria-label="Clear team search" onClick={() => { setSearch(''); setPage(0) }}><FaTimes aria-hidden="true" /></button>}
    </div>
    {isLoading && !data ? <p role="status" className={styles.notice}>Loading team attendance…</p> : total === 0 && !error ? <p className={styles.notice}>No team members to display.</p> : resultCount === 0 && total > 0 ? <p role="status" className={styles.notice}>No team members match your search.</p> : <ul key={currentPage} className={styles.list} aria-label="Team attendance records">
      {filteredMembers.slice(offset, offset + PAGE_SIZE).map(member => {
        const [label, tone] = STATUSES[member.status] || ['Unknown', 'neutral']
        const name = `${member.firstName || ''} ${member.lastName || ''}`.trim() || 'Team member'
        return <li key={member._id} className={styles.row}>
          <span className={styles.avatar} aria-hidden="true">{name.charAt(0)}</span>
          <div className={styles.identity}><strong>{name}</strong><small>{checkInLabel(member)}</small></div>
          <span className={styles.status} data-tone={tone}><i aria-hidden="true" />{label}</span>
        </li>
      })}
    </ul>}
    {resultCount > 0 && <div className={styles.footer}><span aria-live="polite">Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, resultCount)} of {resultCount} {query ? 'matching members' : 'members'}</span><div>
      <button className={styles.button} aria-label="Previous team members" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}><FaChevronLeft /></button>
      <button className={styles.button} aria-label="Next team members" disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}><FaChevronRight /></button>
    </div></div>}
  </section>
}
