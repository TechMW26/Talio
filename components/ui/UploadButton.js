'use client'

import { forwardRef } from 'react'
import { NativeButton } from './fernly/native'

// Preserve existing upload wiring and each caller's original icon/content.
const UploadButton = forwardRef(function UploadButton({ label = 'Upload file', state = 'idle', progress, disabled, isLoading, busy, children, ...props }, ref) {
  const uploading = Boolean(busy || isLoading || state === 'uploading')
  const accessibleLabel = props['aria-label'] || (uploading ? 'Uploading' : state === 'done' ? 'Uploaded' : state === 'error' ? 'Retry upload' : label)
  return <NativeButton {...props} ref={ref} type="button" disabled={disabled || uploading}
    data-state={uploading ? 'uploading' : state} aria-busy={uploading} aria-label={accessibleLabel}>
    {children ?? (uploading ? 'Uploading…' : state === 'done' ? 'Uploaded' : state === 'error' ? 'Retry upload' : label)}
  </NativeButton>
})

// Native picker retains file restrictions, form labels, refs and events.
export const UploadInput = forwardRef(function UploadInput({ label = 'Choose file', busy = false, state = 'idle', progress, disabled, ...props }, ref) {
  const uploading = busy || state === 'uploading'
  return <input {...props} ref={ref} type="file" disabled={disabled || uploading}
    aria-label={props['aria-label'] || label} aria-busy={uploading} />
})

export default UploadButton
