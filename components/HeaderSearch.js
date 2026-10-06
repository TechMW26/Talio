'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { FaSearch, FaTimes } from 'react-icons/fa'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import { useChatWidget } from '@/contexts/ChatWidgetContext'
import AIActivityBeam from '@/components/ui/AIActivityBeam'
import { NativeButton } from '@/components/ui/fernly/native'
import styles from './HeaderSearch.module.css'

export default function HeaderSearch() {
  const router = useRouter()
  const { openWidget } = useChatWidget()
  const reducedMotion = useReducedMotion()
  const id = useId()
  const shellRef = useRef(null)
  const controlRef = useRef(null)
  const inputRef = useRef(null)
  const [radius, setRadius] = useState(16)
  const [expanded, setExpanded] = useState(false)
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [selected, setSelected] = useState(-1)
  const term = query.trim()

  useEffect(() => {
    const syncRadius = () => {
      const value = parseFloat(window.getComputedStyle(controlRef.current).borderTopLeftRadius)
      if (Number.isFinite(value)) setRadius(value)
    }
    syncRadius()
    window.addEventListener('resize', syncRadius)
    return () => window.removeEventListener('resize', syncRadius)
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(term), 300)
    return () => clearTimeout(timer)
  }, [term])
  const { data, error, isLoading, mutate } = useAuthedSWR(expanded && term.length >= 2 && term === debouncedQuery ? `/api/search?q=${encodeURIComponent(term)}` : null, { keepPreviousData: false, refreshInterval: 0 })
  const busy = expanded && term.length >= 2 && (term !== debouncedQuery || isLoading)
  const groups = expanded && term.length >= 2 && term === debouncedQuery && !busy && !error && data?.data ? Object.entries(data.data).filter(([, rows]) => Array.isArray(rows) && rows.length) : []
  const results = groups.flatMap(([category, rows]) => rows.map(row => ({ ...row, category })))

  const close = () => {
    setExpanded(false)
    setQuery('')
    setDebouncedQuery('')
    setSelected(-1)
  }
  const choose = link => {
    close()
    if (link === '/dashboard/chat' && window.innerWidth >= 1024) openWidget('button')
    else router.push(link)
  }

  useEffect(() => {
    const keydown = event => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setExpanded(true)
        inputRef.current?.focus()
      }
      if (event.key === 'Escape' && shellRef.current?.contains(document.activeElement)) {
        event.preventDefault()
        close()
        shellRef.current?.focus()
      }
    }
    const outside = event => { if (!shellRef.current?.contains(event.target)) close() }
    window.addEventListener('keydown', keydown)
    document.addEventListener('pointerdown', outside)
    return () => { window.removeEventListener('keydown', keydown); document.removeEventListener('pointerdown', outside) }
  }, [])
  useEffect(() => { setSelected(-1) }, [query, data])
  useEffect(() => { if (selected >= 0) document.getElementById(`${id}-option-${selected}`)?.scrollIntoView?.({ block: 'nearest' }) }, [selected, id])

  return <div ref={shellRef} tabIndex={-1} className={styles.shell} data-header-search data-expanded={expanded}>
    <div ref={controlRef} className={styles.control} data-search-container>
      <AIActivityBeam active={busy} borderRadius={radius} strength={0.55} />
      <FaSearch className={styles.icon} aria-hidden="true" />
      <span className={styles.brand}>AI Search</span>
      <input ref={inputRef} type="search" role="combobox" aria-label="Search Talio" aria-expanded={expanded} aria-controls={expanded ? `${id}-results` : undefined} aria-autocomplete="list" aria-activedescendant={selected >= 0 && results[selected] ? `${id}-option-${selected}` : undefined}
        placeholder={expanded ? 'Search Talio…' : 'AI Search'} value={query} autoComplete="off"
        onFocus={() => setExpanded(true)} onChange={event => { setExpanded(true); setQuery(event.target.value) }}
        onKeyDown={event => {
          if (['ArrowDown', 'ArrowUp'].includes(event.key) && results.length) {
            event.preventDefault()
            setSelected(current => event.key === 'ArrowDown' ? (current + 1) % results.length : (current <= 0 ? results.length - 1 : current - 1))
          }
          if (event.key === 'Enter' && selected >= 0 && results[selected]) { event.preventDefault(); choose(results[selected].link) }
        }} />
      {expanded ? <NativeButton type="button" aria-label="Close search" className={styles.close} onClick={() => { close(); shellRef.current?.focus() }}><FaTimes aria-hidden="true" /></NativeButton> : <kbd className={styles.shortcut}>⌘K</kbd>}
    </div>
    <AnimatePresence>
      {expanded && <motion.div className={styles.results} id={`${id}-results`} key="header-search-results"
        initial={{ opacity: 0, y: reducedMotion ? 0 : -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reducedMotion ? 0 : -4 }} transition={{ duration: reducedMotion ? 0 : 0.18 }}>
        {term.length < 2 ? <p className={styles.message}>Find pages, tasks, people and more. Type at least 2 characters.</p> : busy ? <p className={styles.message} role="status">Searching…</p> : error ? <p className={styles.message} role="alert">Search unavailable. <NativeButton type="button" onClick={() => mutate()}>Retry search</NativeButton></p> : !results.length ? <p className={styles.message}>No results for “{term}”.</p> : null}
        <div role="listbox" aria-label="Search results" className={styles.list}>
          {results.map((item, index) => <NativeButton type="button" role="option" aria-selected={selected === index} id={`${id}-option-${index}`} key={`${item.category}-${item._id || item.link}-${index}`} className={styles.result} onClick={() => choose(item.link)}>
            <span className={styles.resultCopy}><strong>{item.title}</strong>{(item.subtitle || item.description) && <span>{item.subtitle || item.description}</span>}</span>
            <span className={styles.category}>{item.category === 'pages' ? 'Page' : item.category}</span>
          </NativeButton>)}
        </div>
      </motion.div>}
    </AnimatePresence>
  </div>
}
