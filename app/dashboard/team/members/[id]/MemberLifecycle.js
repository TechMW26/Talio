'use client'


import { NativeButton, Heading3 } from '@/components/ui/fernly/native'
import { useState } from 'react'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import styles from './lifecycle.module.css'

export default function MemberLifecycle({ employeeId }) {
  const { data, error, isLoading, isValidating, mutate } = useAuthedSWR(employeeId ? `/api/employees/${employeeId}/history` : null, { revalidateOnFocus: false, refreshInterval: 0 })
  const [filter, setFilter] = useState('all'), [count, setCount] = useState(8)
  const history = data?.data
  const events = (history?.events || []).filter(event => filter === 'all' || event.category === filter)
  return <section className={styles.panel} aria-label="Employee lifecycle">
    <header><NativeButton onClick={() => mutate()} disabled={isValidating} aria-label="Refresh lifecycle history">↻</NativeButton></header>
    {isLoading ? <p role="status">Loading lifecycle history…</p> : error ? <p role="alert">{error.status === 403 ? 'You do not have permission to view this lifecycle history.' : 'History could not be loaded. Use refresh to retry.'}</p> : history && <>
      <div className={styles.summary}><span>{history.stage.replaceAll('_', ' ')}</span><strong>{history.progress ? `${history.progress.percentage}%` : '—'}</strong><p>{history.progress ? `Onboarding · ${history.progress.completed}/${history.progress.total} recorded tasks` : 'No onboarding checklist recorded'}</p></div>
      <nav aria-label="Lifecycle filters">{[['all','All'],['promotion','Promotions'],['appraisal','Appraisals'],['pip','PIPs'],['other','Other']].map(([key, title]) => <NativeButton key={key} aria-pressed={filter === key} onClick={() => { setFilter(key); setCount(8) }}>{title}</NativeButton>)}</nav>
      <ol className={styles.timeline}>{events.slice(0, count).map(event => <li key={event.id}><span className={styles.dot} /><div><Heading3>{event.title}</Heading3><time>{event.at ? new Date(event.at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' }) : 'Date not recorded'}</time><span className={styles.status}>{event.status}</span>{event.detail && <details><summary>View details</summary><p>{event.detail}</p></details>}</div></li>)}</ol>
      {!events.length && <p>No recorded {filter === 'all' ? 'lifecycle events' : filter === 'promotion' ? 'promotions' : filter === 'pip' ? 'PIPs' : filter + ' events'}.</p>}
      {events.length > count && <NativeButton className={styles.more} onClick={() => setCount(value => value + 8)}>Show more · {events.length - count} remaining</NativeButton>}
      <p className={styles.note}>{history.note}</p>
    </>}
  </section>
}
