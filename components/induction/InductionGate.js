'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Button, Checkbox } from '@heroui/react'
import { inductionRequest } from '@/lib/client/induction'
import { fetchDocumentFile } from '@/lib/client/documentFile'
import PresentationReader from './PresentationReader'

export default function InductionGate({ children }) {
  const pathname = usePathname()
  const [status, setStatus] = useState(null), [error, setError] = useState('')
  const [buffer, setBuffer] = useState(null), [page, setPage] = useState(1)
  const [rendered, setRendered] = useState(0), [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState(false), [attempt, setAttempt] = useState(0)
  const working = useRef(false), live = useRef(true), marking = useRef(new Set())
  const refresh = useCallback(async () => {
    if (working.current) return
    try { const data = await inductionRequest(); if (live.current) setStatus(data) }
    catch (error) { if (live.current) setError(error.message) }
  }, [])
  useEffect(() => {
    live.current = true; refresh()
    const timer = setInterval(refresh, 60000)
    window.addEventListener('focus', refresh)
    window.addEventListener('induction-published', refresh)
    return () => { live.current = false; clearInterval(timer); window.removeEventListener('focus', refresh); window.removeEventListener('induction-published', refresh) }
  }, [refresh])
  const settingsException = status?.canManage && pathname.startsWith('/dashboard/settings')
  const required = status?.required && !settingsException
  const version = status?.program?.version
  useEffect(() => {
    setBuffer(null); setRendered(0); setAgreed(false); marking.current.clear()
    if (!required) return
    let cancelled = false
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30000)
    setPage(Math.max(1, Math.min(status.viewedThrough + 1, status.program.pageCount)))
    fetchDocumentFile(`/api/induction/file?version=${encodeURIComponent(version)}`, { signal: controller.signal }).then(blob => blob.arrayBuffer()).then(value => { if (!cancelled) { setBuffer(value); setError('') } }).catch(error => { if (!cancelled) setError(controller.signal.aborted ? 'The presentation download timed out. Please retry or contact HR.' : error.message) }).finally(() => clearTimeout(timeout))
    return () => { cancelled = true; clearTimeout(timeout); controller.abort() }
  }, [required, version, attempt]) // Progress updates must not reload the presentation.
  const markPage = async number => {
    if (marking.current.has(number)) { setRendered(number); return }
    marking.current.add(number)
    setRendered(0); setBusy(true); working.current = true
    try {
      const data = await inductionRequest({ action: 'page', version, page: number })
      if (live.current) { setStatus(data); setRendered(number); setError('') }
    } catch (error) { marking.current.delete(number); setError(error.message) }
    finally { setBusy(false); working.current = false }
  }
  const acknowledge = async () => {
    setBusy(true); working.current = true
    try {
      const data = await inductionRequest({ action: 'acknowledge', version, acknowledged: agreed })
      setStatus(data); setError('')
    } catch (error) { setError(error.message) }
    finally { setBusy(false); working.current = false }
  }
  if (status && !required) return children
  return <div className="fixed inset-0 z-[2147483000] flex items-center justify-center bg-black/90 p-2 sm:p-6">
    <section role="dialog" aria-modal="true" aria-labelledby="induction-title" className="flex max-h-[96dvh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-default-200 bg-content1 shadow-2xl">
      <header className="border-b border-default-200 px-4 py-3 sm:px-6"><h1 id="induction-title" className="text-xl font-semibold">{status?.program?.title || 'Induction & orientation'}</h1><p className="text-sm text-default-500">Read every page and acknowledge to complete your induction. Your progress is saved automatically.</p></header>
      <div className="min-h-32 flex-1 overflow-y-auto bg-default-100 p-2 sm:p-4">
        {error && <div role="alert" className="mb-3 rounded-lg border border-danger-200 bg-content1 p-4 text-danger">{error}<Button className="ml-3" size="sm" onPress={async () => { await refresh(); setAttempt(value => value + 1) }}>Retry</Button></div>}
        {!status || !buffer ? <p role="status" className="p-6 text-center">{error ? 'Induction is waiting for the presentation to load.' : 'Loading induction presentation…'}</p> : <PresentationReader key={`${version}:${attempt}`} buffer={buffer} format={status.program.format} page={page} expectedCount={status.program.pageCount} onRendered={markPage} onError={error => { setRendered(0); setError(error.message || 'This page could not be displayed. Ask HR to re-upload a PDF.') }} />}
      </div>
      <footer className="space-y-3 border-t border-default-200 p-4">
        {status?.program && <div className="flex items-center justify-between gap-2"><Button variant="flat" isDisabled={page === 1 || busy || !buffer} onPress={() => { setRendered(0); setPage(value => value - 1) }}>Previous</Button><p className="text-sm">Page {page} of {status.program.pageCount}</p><Button color="primary" isDisabled={page >= status.program.pageCount || rendered !== page || busy || Boolean(error)} onPress={() => { setRendered(0); setPage(value => value + 1) }}>Next</Button></div>}
        {status?.program && page === status.program.pageCount && <div className="flex flex-wrap items-center justify-between gap-3"><Checkbox isSelected={agreed} onValueChange={setAgreed} isDisabled={rendered !== page || Boolean(error) || busy}>I have read and understood the induction presentation.</Checkbox><Button color="success" isLoading={busy} isDisabled={!agreed || rendered !== page || status.viewedThrough < page || Boolean(error) || busy} onPress={acknowledge}>Acknowledge & complete</Button></div>}
        {status?.canManage && <a href="/dashboard/settings?tab=induction" className="inline-block text-sm text-primary underline">Manage induction content</a>}
        <a href="/login" className="ml-4 inline-block text-sm text-default-500 underline">Return to sign in</a>
      </footer>
    </section>
  </div>
}
