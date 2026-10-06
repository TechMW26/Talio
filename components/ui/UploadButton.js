'use client'

import { forwardRef, useState } from 'react'
import styles from './UploadButton.module.css'

function Visual({ label, state }) {
  return <><span className={styles.label} aria-hidden="true"><span className={styles.track}>
    <span>{label}</span><span>Uploading…</span><span>Uploaded</span><span>Retry upload</span>
  </span></span><span className={styles.well} aria-hidden="true">
    <span className={styles.liquid} />
    <svg className={styles.arrow} viewBox="0 0 60 60"><path d="M23 28 30 21 37 28 M30 22v16" /></svg>
    <svg className={styles.tick} viewBox="0 0 60 60"><path d="m23 30 5 5 10-10" /></svg>
  </span></>
}
function presentation(state, progress) {
  const measured = typeof progress === 'number' && Number.isFinite(progress)
  return { 'data-state': state, 'data-indeterminate': state === 'uploading' && !measured,
    style: { '--upload-progress': state === 'done' ? 1 : measured ? Math.min(1, Math.max(0, progress / 100)) : 0 } }
}
const UploadButton = forwardRef(function UploadButton({ label = 'Upload file', state = 'idle', progress, disabled, isLoading, busy, className = '', children, style, ...props }, ref) {
  const current = busy || isLoading ? 'uploading' : state
  const visual = presentation(current, progress)
  return <button {...props} ref={ref} type="button" {...visual} style={{ ...style, ...visual.style }}
    className={`${className} ${styles.upload}`} disabled={disabled || current === 'uploading'} aria-busy={current === 'uploading'}
    aria-label={props['aria-label'] || (current === 'idle' ? label : current === 'done' ? 'Uploaded' : current === 'error' ? 'Retry upload' : 'Uploading')}>
    <Visual label={label} state={current} />
  </button>
})

// The real file input remains the interactive control: browser picker, label
// association, form validation, refs, accept and multiple all remain native.
export const UploadInput = forwardRef(function UploadInput({ className, onChange, label = 'Choose file', busy = false, state = 'idle', progress, disabled, style, ...props }, ref) {
  const [names, setNames] = useState('')
  const current = busy ? 'uploading' : state
  const visual = presentation(current, progress)
  return <span className={styles.field}>
    <span className={styles.upload} {...visual} data-disabled={disabled || busy || undefined}>
      <Visual label={label} state={current} />
      <input {...props} ref={ref} type="file" disabled={disabled || busy} className={styles.picker}
        aria-label={props['aria-label'] || label} aria-busy={busy}
        onChange={event => { setNames(Array.from(event.target.files || []).map(file => file.name).join(', ')); onChange?.(event) }} />
    </span>
    {names && <span className={styles.filename}>{names}</span>}
  </span>
})

export default UploadButton
