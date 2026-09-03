'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Button,
  Chip,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Textarea,
} from '@heroui/react'
import { FaCheck, FaFileAlt, FaLock, FaRedo, FaUpload } from 'react-icons/fa'
import { uploadAuthenticatedFile } from '@/lib/client/uploadFile'
import {
  getOnboardingVerificationRequirement,
  normalizeOnboardingVerification,
} from '@/lib/hrms/onboardingVerification'
import toast from '@/utils/toast'

function formatDate(value) {
  if (!value) return 'Not recorded'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Not recorded'
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function initialDetails(requirement, verification) {
  const details = { ...(verification?.details || {}) }
  const today = new Date().toISOString().slice(0, 10)
  for (const field of requirement?.fields || []) {
    if (details[field.key] === undefined) details[field.key] = field.type === 'checkbox' ? false : field.type === 'date' ? today : ''
  }
  return details
}

export default function OnboardingVerificationModal({ isOpen, item, onClose, onVerify, onReopen, isProcessing }) {
  const requirement = useMemo(() => getOnboardingVerificationRequirement(item?.key), [item?.key])
  const [details, setDetails] = useState({})
  const [remarks, setRemarks] = useState('')
  const [files, setFiles] = useState({})
  const [documents, setDocuments] = useState([])
  const [reopenReason, setReopenReason] = useState('')
  const [uploadingKey, setUploadingKey] = useState('')

  useEffect(() => {
    if (!isOpen || !requirement) return
    setDetails(initialDetails(requirement, item?.verification))
    setRemarks(item?.verification?.remarks || '')
    setDocuments(item?.verification?.documents || [])
    setFiles({})
    setReopenReason('')
    setUploadingKey('')
  }, [isOpen, item, requirement])

  if (!requirement || !item) return null

  const setDetail = (key, value) => setDetails((current) => ({ ...current, [key]: value }))

  const submitVerification = async () => {
    try {
      const nextDocuments = [...documents]
      for (const upload of requirement.uploads) {
        const selectedFile = files[upload.key]
        if (!selectedFile) continue
        setUploadingKey(upload.key)
        const uploaded = await uploadAuthenticatedFile(selectedFile, { category: 'documents' })
        const document = {
          requirementKey: upload.key,
          label: upload.label,
          fileName: uploaded.data.fileName || selectedFile.name,
          fileUrl: uploaded.data.fileUrl,
          fileId: uploaded.data.fileId,
          fileType: uploaded.data.fileType || selectedFile.type || 'application/octet-stream',
          fileSize: uploaded.data.fileSize || selectedFile.size,
        }
        const existingIndex = nextDocuments.findIndex((entry) => entry.requirementKey === upload.key)
        if (existingIndex >= 0) nextDocuments[existingIndex] = document
        else nextDocuments.push(document)
      }
      setUploadingKey('')
      setDocuments(nextDocuments)

      const verification = { details, remarks, documents: nextDocuments }
      normalizeOnboardingVerification(item.key, verification)
      const completed = await onVerify?.(verification)
      if (completed) onClose?.()
    } catch (error) {
      setUploadingKey('')
      toast.error(error.message || 'Unable to verify this onboarding step')
    }
  }

  const reopenVerification = async () => {
    if (!reopenReason.trim()) {
      toast.error('Enter a reason for reopening this verification')
      return
    }
    const reopened = await onReopen?.(reopenReason.trim())
    if (reopened) onClose?.()
  }

  const completed = Boolean(item.completed)
  const linked = item.completionSource === 'system' || item.verification?.method === 'linked_record'

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(open) => { if (!open && !isProcessing && !uploadingKey) onClose?.() }}
      size="2xl"
      scrollBehavior="inside"
      isDismissable={!isProcessing && !uploadingKey}
      classNames={{ base: 'rounded-3xl', header: 'rounded-t-3xl', footer: 'rounded-b-3xl' }}
    >
      <ModalContent>
        <ModalHeader className="flex flex-col gap-1 border-b border-default-200">
          <span className="flex items-center gap-2"><FaLock className="text-primary" /> {requirement.title}</span>
          <span className="text-sm font-normal text-default-500">{requirement.description}</span>
        </ModalHeader>
        <ModalBody className="gap-5 py-5">
          {completed ? (
            <>
              <div className="rounded-2xl border border-success-200 bg-success-50/70 p-4 dark:border-success-500/20 dark:bg-success-500/10">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="flex items-center gap-2 font-semibold text-success-800 dark:text-success-200"><FaCheck /> Verification complete</p>
                  <Chip size="sm" color="success" variant="flat">{linked ? 'Linked record' : 'Verified by HR'}</Chip>
                </div>
                <p className="mt-2 text-xs text-success-700/80 dark:text-success-200/70">Verified {formatDate(item.verification?.verifiedAt || item.completedAt)}</p>
              </div>

              {Object.keys(item.verification?.details || {}).length > 0 && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {Object.entries(item.verification.details).filter(([key]) => key !== 'signalKey').map(([key, value]) => (
                    <div key={key} className="rounded-xl border border-default-200 bg-default-50 p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-default-500">{key.replace(/([A-Z])/g, ' $1')}</p>
                      <p className="mt-1 break-words text-sm text-default-800">{typeof value === 'boolean' ? (value ? 'Confirmed' : 'Not confirmed') : value || 'Not recorded'}</p>
                    </div>
                  ))}
                </div>
              )}

              {(item.verification?.documents || []).length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-default-500">Evidence files</p>
                  {item.verification.documents.map((document) => (
                    <a key={document.fileId} href={document.fileUrl} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-xl border border-default-200 p-3 text-sm transition hover:border-primary">
                      <FaFileAlt className="shrink-0 text-primary" />
                      <span className="min-w-0 flex-1 truncate">{document.label || document.fileName}</span>
                      <span className="text-xs text-default-400">Open</span>
                    </a>
                  ))}
                </div>
              )}

              {item.verification?.remarks && <div className="rounded-xl bg-default-50 p-3 text-sm text-default-600"><span className="font-semibold">Verification notes:</span> {item.verification.remarks}</div>}

              {!linked && (
                <Textarea
                  label="Reason for reopening"
                  placeholder="Explain why this verification must be reviewed again"
                  value={reopenReason}
                  onValueChange={setReopenReason}
                  minRows={2}
                  isRequired
                />
              )}
            </>
          ) : (
            <>
              {(requirement.fields || []).length > 0 && (
                <div className="grid gap-4 sm:grid-cols-2">
                  {requirement.fields.map((field) => field.type === 'checkbox' ? (
                    <label key={field.key} className="flex min-h-14 cursor-pointer items-start gap-3 rounded-xl border border-default-200 p-3 text-sm sm:col-span-2">
                      <input
                        type="checkbox"
                        checked={Boolean(details[field.key])}
                        onChange={(event) => setDetail(field.key, event.target.checked)}
                        className="mt-0.5 h-4 w-4 rounded border-default-300 accent-primary"
                      />
                      <span>{field.label}{field.required && <span className="text-danger"> *</span>}</span>
                    </label>
                  ) : field.type === 'textarea' ? (
                    <Textarea
                      key={field.key}
                      className="sm:col-span-2"
                      label={field.label}
                      value={details[field.key] || ''}
                      onValueChange={(value) => setDetail(field.key, value)}
                      isRequired={field.required}
                      minRows={2}
                    />
                  ) : (
                    <Input
                      key={field.key}
                      label={field.label}
                      type={field.type || 'text'}
                      value={details[field.key] || ''}
                      onValueChange={(value) => setDetail(field.key, value)}
                      isRequired={field.required}
                    />
                  ))}
                </div>
              )}

              {(requirement.uploads || []).length > 0 && (
                <div className="space-y-3">
                  <div>
                    <p className="text-sm font-semibold text-default-800">Required evidence</p>
                    <p className="text-xs text-default-500">PDF, image, or office document; maximum 25 MB per file.</p>
                  </div>
                  {requirement.uploads.map((upload) => {
                    const existing = documents.find((document) => document.requirementKey === upload.key)
                    const selected = files[upload.key]
                    return (
                      <label key={upload.key} className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-default-300 p-4 transition hover:border-primary">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-50 text-primary dark:bg-primary-500/10"><FaUpload /></span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium">{upload.label}{upload.required && <span className="text-danger"> *</span>}</span>
                          <span className="block truncate text-xs text-default-500">{selected?.name || existing?.fileName || 'Choose file'}</span>
                        </span>
                        {existing && !selected && <FaCheck className="text-success" />}
                        <input
                          type="file"
                          className="sr-only"
                          accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx"
                          onChange={(event) => setFiles((current) => ({ ...current, [upload.key]: event.target.files?.[0] || null }))}
                        />
                      </label>
                    )
                  })}
                </div>
              )}

              <Textarea label="Verification notes" placeholder="Optional audit notes" value={remarks} onValueChange={setRemarks} minRows={2} maxLength={2000} />
            </>
          )}
        </ModalBody>
        <ModalFooter className="border-t border-default-200">
          <Button variant="flat" onPress={onClose} isDisabled={isProcessing || Boolean(uploadingKey)}>Close</Button>
          {completed ? (
            !linked && <Button color="warning" variant="flat" startContent={!isProcessing && <FaRedo />} isLoading={isProcessing} isDisabled={!reopenReason.trim()} onPress={reopenVerification}>Reopen verification</Button>
          ) : (
            <Button color="primary" startContent={!isProcessing && !uploadingKey && <FaCheck />} isLoading={isProcessing || Boolean(uploadingKey)} onPress={submitVerification}>
              {uploadingKey ? 'Uploading evidence…' : 'Verify and complete'}
            </Button>
          )}
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
