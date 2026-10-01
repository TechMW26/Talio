'use client'

import { useMemo, useState } from 'react'
import { Avatar, Input, Skeleton } from '@heroui/react'
import { FaSearch } from 'react-icons/fa'
import DocumentThumbnail from './DocumentThumbnail'
import styles from './DocumentFolders.module.css'
import { preloadDocumentFiles } from '@/lib/client/documentFile'

// Stable pseudo-random palette: colours do not jump on search, sorting or refresh.
export function folderHue(id) {
  const hash = Array.from(String(id)).reduce((value, char) => (Math.imul(value, 31) + char.charCodeAt(0)) | 0, 0)
  return [155, 205, 255, 325, 25, 45][Math.abs(hash) % 6]
}

export function buildDocumentFolders(documents, employees = []) {
  const folders = new Map()
  const addEmployee = employee => {
    const id = String(employee?._id || employee || '')
    if (!id) return
    const existing = folders.get(id)
    folders.set(id, {
      id,
      name: `${employee.firstName || ''} ${employee.lastName || ''}`.trim() || employee.employeeCode || 'Employee',
      photo: employee.profilePicture,
      code: employee.employeeCode,
      documents: existing?.documents || [],
    })
  }
  employees.forEach(addEmployee)
  documents.forEach(document => {
    if (document.employee) addEmployee(document.employee)
    const id = String(document.employee?._id || document.employee || 'company')
    if (!folders.has(id)) folders.set(id, { id, name: 'Company documents', documents: [] })
    folders.get(id).documents.push(document)
  })
  return [...folders.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export default function DocumentFolders({ folders, loading, onOpen }) {
  const [search, setSearch] = useState('')
  const visible = useMemo(() => folders.filter(folder => `${folder.name} ${folder.code || ''}`.toLowerCase().includes(search.trim().toLowerCase())), [folders, search])
  return <section aria-label="Document folders" className="space-y-4">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <h2 className="text-xl font-semibold">Document folders</h2>
      <Input aria-label="Search document folders" placeholder="Search by name or employee code…" value={search} onValueChange={setSearch} startContent={<FaSearch aria-hidden="true" />} isClearable onClear={() => setSearch('')} className="sm:max-w-xs" />
    </div>
    {loading ? <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">{[1, 2, 3, 4].map(id => <Skeleton key={id} className="h-40 rounded-2xl" />)}</div>
      : visible.length ? <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {visible.map(folder => <button key={folder.id} type="button" onMouseEnter={() => { void preloadDocumentFiles(folder.documents) }} onFocus={() => { void preloadDocumentFiles(folder.documents) }} onClick={event => onOpen(folder.id, event.currentTarget)} aria-label={`Open ${folder.name} documents`} className={styles.folder} style={{ '--folder-hue': folderHue(folder.id) }}>
          <span className={styles.back} aria-hidden="true" />
          {folder.documents.slice(0, 3).map((file, index, stack) => <span key={file._id} className={styles.paper} style={{ '--stack-scale': 1 - (stack.length - index - 1) * .05, '--hover-lift': `${-12 - (stack.length - index - 1) * 16}px` }} aria-hidden="true"><DocumentThumbnail file={file} compact /></span>)}
          {!folder.documents.length && <span className={styles.empty}>No documents yet</span>}
          <span className={styles.front}>
            <span className={styles.identity}><Avatar src={folder.photo} name={folder.name} showFallback className="h-9 w-9 shrink-0" /><span className="min-w-0"><span className={`block ${styles.name}`} title={folder.name}>{folder.name}</span>{folder.code && <span className="block text-xs mt-1">{folder.code}</span>}</span></span>
            <span className={styles.count}>{folder.documents.length} {folder.documents.length === 1 ? 'document' : 'documents'}</span>
          </span>
        </button>)}
      </div> : <div className="rounded-2xl border border-dashed border-default-200 p-10 text-center text-default-500">{search ? 'No matching folders.' : 'No document folders available.'}</div>}
  </section>
}
