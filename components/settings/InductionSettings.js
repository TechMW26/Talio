'use client'
import { useEffect, useRef, useState } from 'react'
import { Button, Checkbox, Input } from '@heroui/react'
import { inductionRequest } from '@/lib/client/induction'
import { uploadAuthenticatedFile } from '@/lib/client/uploadFile'
import PresentationReader from '@/components/induction/PresentationReader'

export default function InductionSettings() {
  const [catalog, setCatalog] = useState(null), [error, setError] = useState(''), [companyId, setCompanyId] = useState(''), [busy, setBusy] = useState(false)
  const load = () => inductionRequest(undefined, { settings: true }).then(data => { setCatalog(data); setError('') }).catch(error => setError(error.message))
  useEffect(() => { load() }, [])
  if (!catalog) return <section className="rounded-2xl border border-default-200 bg-content1 p-5">{error ? <p role="alert">{error} <Button onPress={load}>Retry</Button></p> : <p role="status">Loading company orientation modules…</p>}</section>
  const cards = [{ id: '', name: 'Organisation default', code: 'Fallback module', program: catalog.defaultProgram }, ...catalog.companies]
  const selected = cards.find(card => card.id === companyId) || cards[0]
  return <div className="space-y-5">
    <div><h2 className="text-xl font-semibold">Company orientation modules</h2><p className="mt-1 text-sm text-default-500">Choose a company to manage its own presentation. Employees receive the module for their saved company assignment. Companies without a module use the organisation default.</p></div>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Company orientation modules">
      {cards.map(card => <button type="button" key={card.id || 'organisation'} aria-pressed={card.id === companyId} disabled={busy} onClick={() => setCompanyId(card.id)} className={`rounded-xl border p-4 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-60 ${card.id === companyId ? 'border-primary bg-primary/10' : 'border-default-200 bg-content1 hover:bg-default-100'}`}>
        <span className="block font-semibold">{card.name}</span><span className="block text-xs text-default-500">{card.code}</span>
        <span className="mt-3 block text-sm">{card.program ? (card.program.active ? 'Published' : 'Withdrawn — no required module') : (card.id && catalog.defaultProgram?.active ? 'Using organisation default' : 'No module uploaded')}</span>
        {card.program && <span className="mt-1 block truncate text-xs text-default-500">{card.program.fileName} · {card.program.pageCount} pages</span>}
      </button>)}
    </div>
    {!catalog.companies.length && <p className="text-sm text-default-500">No companies added yet. Add companies in Company Settings to upload their individual orientation modules.</p>}
    <InductionEditor key={companyId || 'organisation'} companyId={companyId} companyName={selected.name} onUpdated={setCatalog} onBusy={setBusy} />
  </div>
}

function InductionEditor({ companyId, companyName, onUpdated, onBusy }) {
  const [status, setStatus] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [file, setFile] = useState(null), [buffer, setBuffer] = useState(null), [title, setTitle] = useState('Company induction & orientation')
  const [page, setPage] = useState(1), [count, setCount] = useState(0), [seen, setSeen] = useState([]), [confirmed, setConfirmed] = useState(false)
  const selection = useRef(0), uploaded = useRef(null)
  const load = () => inductionRequest(undefined, { settings: true, companyId }).then(data => { setStatus(data); setError('') }).catch(error => setError(error.message))
  useEffect(() => { load() }, [])
  useEffect(() => { onBusy(busy); return () => onBusy(false) }, [busy, onBusy])
  const choose = async selected => {
    const request = ++selection.current
    setFile(null); setBuffer(null); setError(''); setPage(1); setCount(0); setSeen([]); setConfirmed(false); uploaded.current = null
    if (!selected) return
    if (!/\.(pdf|pptx)$/i.test(selected.name)) { setError('Choose PDF or PowerPoint .pptx. Save old .ppt files as .pptx or PDF first.'); return }
    if (!selected.size || selected.size > 25 * 1024 * 1024) { setError('Choose a file under 25 MB.'); return }
    const bytes = await selected.arrayBuffer()
    if (request === selection.current) { setFile(selected); setBuffer(bytes) }
  }
  const publish = async () => {
    setBusy(true); setError('')
    try {
      if (!uploaded.current) uploaded.current = (await uploadAuthenticatedFile(file, { category: 'documents' })).data
      const data = await inductionRequest({ action: 'publish', companyId: companyId || null, title, source: uploaded.current, previewConfirmed: confirmed && seen.length === count, previousVersion: status?.program?.version || null }, { settings: true })
      onUpdated(data)
      setStatus(data); setFile(null); setBuffer(null); uploaded.current = null
      window.dispatchEvent(new Event('induction-published'))
    } catch (error) { setError(error.message) }
    finally { setBusy(false) }
  }
  const withdraw = async () => {
    if (!window.confirm('Withdraw this presentation? Employees will no longer be blocked by it. Past acknowledgements will be retained.')) return
    setBusy(true)
    try { const data = await inductionRequest({ action: 'withdraw', companyId: companyId || null, previousVersion: status.program.version }, { settings: true }); setStatus(data); onUpdated(data); window.dispatchEvent(new Event('induction-published')) }
    catch (error) { setError(error.message) }
    finally { setBusy(false) }
  }
  return <section className="space-y-5 rounded-2xl border border-default-200 bg-content1 p-5 sm:p-7">
    <div><h3 className="text-lg font-semibold">{companyName} · Induction & orientation</h3><p className="mt-1 text-sm text-default-500">{companyId ? 'Only employees assigned to this company receive this module.' : 'Used for employees without a company-specific module.'} A new version requires acknowledgement again. HR and administrators retain access to Settings.</p></div>
    {error && <p role="alert" className="text-sm text-danger">{error} {!status && <Button size="sm" onPress={load}>Retry</Button>}</p>}
    {!status && !error && <p role="status">Loading settings…</p>}
    {status?.program ? <div className="rounded-xl bg-default-100 p-4"><p className="font-medium">{status.program.title}</p><p className="text-sm text-default-500">{status.program.fileName} · {status.program.pageCount} pages · {status.program.active ? 'Published — acknowledgement required' : 'Withdrawn'}</p>{status.program.active && <Button className="mt-3" color="warning" variant="flat" size="sm" onPress={withdraw} isDisabled={busy}>Withdraw presentation</Button>}</div> : status && <p className="rounded-xl bg-default-100 p-4 text-sm">{companyId && status.defaultProgram?.active ? 'No company module yet. Employees currently receive the organisation default.' : 'No presentation published for this scope.'}</p>}
    <Input label="Presentation title" value={title} onValueChange={setTitle} maxLength={160} isRequired isDisabled={busy} />
    <label className="block rounded-xl border border-dashed border-default-300 p-4 text-sm">Upload induction PDF or PowerPoint (.pptx), up to 25 MB / 100 pages<input className="mt-3 block w-full" aria-label="Induction presentation" type="file" accept=".pdf,.pptx" disabled={busy || !status} onChange={event => choose(event.target.files?.[0]).catch(error => setError(error.message))} /></label>
    <p className="text-xs text-default-500">PowerPoint is shown as static slides; review the preview before publishing. For exact fonts, animations captured as stills, or older .ppt files, export to PDF first.</p>
    {buffer && <div className="space-y-3"><div className="max-h-[60vh] overflow-auto rounded-xl border border-default-200 p-2"><PresentationReader buffer={buffer} format={file.name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'pptx'} page={page} onReady={setCount} onRendered={number => setSeen(previous => previous.includes(number) ? previous : [...previous, number])} onError={error => { setCount(0); setError(error.message) }} /></div><div className="flex items-center justify-between"><Button isDisabled={page <= 1 || busy} onPress={() => setPage(value => value - 1)}>Previous</Button><span>Page {page} of {count || '…'}</span><Button isDisabled={page >= count || busy} onPress={() => setPage(value => value + 1)}>Next</Button></div><Checkbox isSelected={confirmed} onValueChange={setConfirmed} isDisabled={seen.length !== count || !count || busy}>I reviewed all pages. Require acknowledgement from employees in this scope.</Checkbox><Button color="primary" isLoading={busy} isDisabled={!confirmed || !title.trim() || !count || seen.length !== count || busy} onPress={publish}>Publish induction</Button></div>}
  </section>
}
