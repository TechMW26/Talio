'use client'


import { Heading2, NativeButton, Heading3 } from '@/components/ui/fernly/native'
import { useEffect, useRef, useState } from 'react'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import AnalyzedComposite from '@/components/productivity/AnalyzedComposite'
import { Modal as Modal } from '@/components/ui/fernly'
import { ModalBody, ModalContent } from '@/components/ui/fernly'
import styles from './member.module.css'

export function ProtectedScreenshot({ shot }) {
  const container = useRef(null)
  const [visible, setVisible] = useState(false)
  const [source, setSource] = useState(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    if (!('IntersectionObserver' in window)) { setVisible(true); return }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect() }
    }, { rootMargin: '100px' })
    if (container.current) observer.observe(container.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!visible) return
    const controller = new AbortController()
    let objectUrl, cancelled = false
    const timeout = setTimeout(() => controller.abort(), 15000)
    setSource(null); setError(false)
    // Keep protected images behind the existing authenticated, tenant-scoped API.
    fetch(`/api/activity/screenshot?id=${encodeURIComponent(shot.id)}`, { signal: controller.signal, headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` } })
      .then(response => { if (!response.ok) throw new Error('Image unavailable'); return response.blob() })
      .then(blob => { if (!cancelled) { objectUrl = URL.createObjectURL(blob); setSource(objectUrl) } })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => clearTimeout(timeout))
    return () => { cancelled = true; clearTimeout(timeout); controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [visible, shot.id])
  return <div ref={container} className={styles.protectedImage}>{source && !error ? <img src={source} alt={`Screenshot captured ${shot.formattedTime || shot.capturedAt}`} onError={() => setError(true)} /> : <span>{error ? 'Screenshot unavailable' : 'Loading screenshot…'}</span>}</div>
}

export default function MemberProductivity({ employee, date }) {
  const [cursors, setCursors] = useState([null])
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState(null)
  const [refreshSignal, setRefreshSignal] = useState(0)
  const userId = employee.userId
  const query = new URLSearchParams({ userId: userId || '', date, limit: '12' })
  if (cursors[page]) query.set('cursor', cursors[page])
  const { data, error, isLoading, isValidating, mutate } = useAuthedSWR(userId ? `/api/activity/screenshots?${query}` : null, { keepPreviousData: false })
  const { data: scoreResponse, error: scoreError, isLoading: scoreLoading, mutate: refreshScores } = useAuthedSWR(userId ? `/api/productivity/scores?employeeId=${encodeURIComponent(employee._id)}&startDate=${date}&endDate=${date}` : null, { keepPreviousData: false })
  const score = scoreResponse?.data?.find(row => row.employeeId === employee._id)
  const screenshots = data?.screenshots || []
  function nextPage() { setCursors(previous => [...previous.slice(0, page + 1), data.pagination.nextCursor]); setPage(value => value + 1) }
  function refresh() { mutate(); refreshScores(); setRefreshSignal(value => value + 1) }
  return <section className={styles.section} aria-label="Employee productivity">
    <header className={styles.sectionHeader}><div><Heading2>Productivity & screenshots</Heading2><p>{employee.firstName} {employee.lastName} · {date}</p></div><NativeButton className={styles.secondaryButton} disabled={!userId || isValidating} onClick={refresh}>Refresh</NativeButton></header>
    {!userId ? <p className={styles.emptyState}>No linked account for this employee. Productivity captures are unavailable.</p> : <>
      <div className={styles.productivityMetrics}><div><span>Productivity score</span><strong>{scoreLoading ? '…' : score?.averageProductivityScore != null ? `${score.averageProductivityScore}/100` : '—'}</strong></div><div><span>Focus score</span><strong>{scoreLoading ? '…' : score?.averageFocusScore != null ? `${score.averageFocusScore}/100` : '—'}</strong></div><div><span>Available screenshots</span><strong>{isLoading ? '…' : data?.pagination?.total ?? '—'}</strong></div></div>
      {scoreError && <p role="alert">{scoreError.status === 403 ? 'You do not have permission to view productivity scores.' : 'Scores could not be loaded. Use Refresh to retry.'}</p>}
      {!scoreLoading && !scoreError && !score?.analyzedSessions && <p className={styles.calendarNote}>No productivity analysis is available for this day.</p>}
      {error ? <div role="alert" className={styles.emptyState}>{error.status === 403 ? 'You do not have permission to view this employee’s screenshots.' : 'Screenshots could not be loaded.'}<NativeButton className={styles.secondaryButton} onClick={() => mutate()}>Retry</NativeButton></div> : isLoading ? <p role="status" className={styles.emptyState}>Loading screenshots…</p> : <>
        <div className={styles.screenshotGrid}>{screenshots.map(shot => <NativeButton type="button" key={shot.id} className={styles.screenshotTile} onClick={() => setSelected(shot)} aria-label={`Open screenshot ${shot.formattedTime}`}><ProtectedScreenshot shot={shot} /><span>{shot.formattedTime}<small>{shot.analyzed ? 'Analyzed' : 'Pending analysis'}</small></span></NativeButton>)}</div>
        {!screenshots.length && <p className={styles.emptyState}>No individual screenshots available for this day. Capture may be disabled, or older images may have been removed or combined below.</p>}
        {(page > 0 || data?.pagination?.nextCursor) && <nav className={styles.pagination} aria-label="Screenshot pages"><NativeButton disabled={page === 0} onClick={() => setPage(value => value - 1)}>Previous</NativeButton><span>Page {page + 1}</span><NativeButton disabled={!data?.pagination?.nextCursor} onClick={nextPage}>Next</NativeButton></nav>}
        {data && <AnalyzedComposite key={`${userId}-${date}`} userId={userId} date={date} refreshSignal={refreshSignal} />}
      </>}
    </>}
    <Modal isOpen={!!selected} onClose={() => setSelected(null)} size="5xl" aria-label="Employee screenshot"><ModalContent><ModalBody>{selected && <><Heading3>Screenshot · {selected.formattedTime}</Heading3><ProtectedScreenshot key={selected.id} shot={selected} /></>}</ModalBody></ModalContent></Modal>
  </section>
}
