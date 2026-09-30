'use client'

import { Button } from '@heroui/react'
import { FaEye, FaDownload, FaTrash } from 'react-icons/fa'
import DocumentThumbnail from './DocumentThumbnail'

export default function DocumentGrid({ documents, canManage, onPreview, onDownload, onDelete, columns = 4 }) {
  if (!documents.length) return <p className="py-12 text-center text-default-500">No documents found</p>
  return <div aria-label="Documents grid" className={`grid grid-cols-1 sm:grid-cols-2 ${columns === 5 ? 'md:grid-cols-3 lg:grid-cols-5' : 'lg:grid-cols-4'} items-start gap-4`}>
    {documents.map(doc => {
      const name = doc.fileName || doc.name
      const status = doc.isAadhaarDocument ? 'Verified' : ({ pending: 'Pending HR review', changes_requested: 'Changes requested', issued: 'Issued letter', approved: 'Verified' }[doc.status] || doc.status)
      const date = doc.createdAt ? new Date(doc.createdAt) : null
      return <article key={doc._id} className="min-w-0 overflow-hidden rounded-2xl border border-default-200 bg-content1 flex flex-col">
        <button type="button" onClick={() => onPreview(doc)} aria-label={`Preview ${name}`} className="block w-full overflow-hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"><DocumentThumbnail file={doc} /></button>
        <div className="p-4 flex flex-1 flex-col gap-2">
          <h3 className="font-semibold text-sm break-words">{name}</h3>
          <p className="text-xs text-default-500 capitalize">{doc.category || 'Document'}</p>
          {status && <span className={`self-start rounded-full px-2 py-1 text-xs ${['pending', 'changes_requested', 'rejected'].includes(doc.status) ? 'bg-warning-100 text-warning-800' : 'bg-success-100 text-success-800'}`}>{status}</span>}
          <p className="text-xs text-default-500">{date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : 'Date unavailable'}</p>
          <div className="mt-auto pt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="flat" startContent={<FaEye />} onPress={() => onPreview(doc)}>View</Button>
            <Button size="sm" isIconOnly variant="flat" title="Download" aria-label={`Download ${name}`} onPress={() => onDownload(doc)}><FaDownload /></Button>
            {!doc.isAadhaarDocument && (!doc.generatedLetter || canManage) && <Button size="sm" isIconOnly variant="light" color="danger" aria-label={`Delete ${name}`} onPress={() => onDelete(doc._id)}><FaTrash /></Button>}
          </div>
        </div>
      </article>
    })}
  </div>
}
