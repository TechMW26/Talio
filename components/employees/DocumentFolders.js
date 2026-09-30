'use client'

import { useMemo, useState } from 'react'
import { Avatar, Input, Skeleton } from '@heroui/react'
import { FaFolder, FaSearch } from 'react-icons/fa'

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
        {visible.map(folder => <button key={folder.id} type="button" onClick={() => onOpen(folder.id)} aria-label={`Open ${folder.name} documents`} className="group rounded-2xl border border-default-200 bg-content1 p-5 text-left transition-colors hover:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
          <div className="mb-4 flex items-center justify-between"><FaFolder aria-hidden="true" className="text-4xl text-primary" /><Avatar src={folder.photo} name={folder.name} showFallback className="h-10 w-10" /></div>
          <p className="font-semibold truncate" title={folder.name}>{folder.name}</p>
          {folder.code && <p className="text-xs text-default-500 mt-1">{folder.code}</p>}
          <p className="text-sm text-default-500 mt-3">{folder.documents.length} {folder.documents.length === 1 ? 'document' : 'documents'}</p>
        </button>)}
      </div> : <div className="rounded-2xl border border-dashed border-default-200 p-10 text-center text-default-500">{search ? 'No matching folders.' : 'No document folders available.'}</div>}
  </section>
}
