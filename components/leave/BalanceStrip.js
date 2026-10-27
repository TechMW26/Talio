'use client'

const formatDay = value => {
  if (!value) return ''
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`)
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' })
}

export default function BalanceStrip({
  balance,
  days = 0,
  typeLabel = 'leave',
  error = '',
  preview = null,
  lockedTill = '',
  requiresBalance = true,
}) {
  if (!balance && !error && !preview) return null

  const available = Number(balance?.available || 0)
  const pending = Number(balance?.pending || 0)
  const segments = Array.isArray(preview?.segments) ? preview.segments : []
  const splitSegments = segments.filter(segment => segment.segment === 'lwp')
  const paidDays = preview ? Number(preview.paidDays || 0) : Number(days || 0)
  const lwpDays = preview ? Number(preview.lwpDays || 0) : 0
  const locked = Boolean(lockedTill)
  const exceeds = requiresBalance && paidDays > available
  const danger = Boolean(error) || exceeds || locked || Boolean(preview?.violation)
  const afterApproval = requiresBalance ? Math.max(0, available - paidDays) : null
  const violationMessage = preview?.violation?.message || ''
  const message = error || violationMessage || (locked ? `Locked till ${lockedTill}` : '') ||
    (exceeds ? `Only ${available} ${typeLabel} available for ${paidDays} paid day${paidDays === 1 ? '' : 's'}` : '')

  return (
    <div
      role="status"
      aria-live="polite"
      className={`rounded-lg border p-3 text-sm ${danger
        ? 'border-danger-200 bg-danger-50 text-danger-700'
        : 'border-success-200 bg-success-50 text-success-700'}`}
    >
      {message && <p className="mb-2 font-medium">{message}</p>}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {requiresBalance ? (
          <span>Available: <strong>{available}</strong></span>
        ) : (
          <span>No balance needed</span>
        )}
        {requiresBalance && pending > 0 && <span>Pending: <strong>{pending}</strong></span>}
        <span>
          This request: <strong>{paidDays} day{paidDays === 1 ? '' : 's'}</strong>
          {lwpDays > 0 && <span className="ml-1">+ <strong>{lwpDays}</strong> LWP</span>}
        </span>
        {requiresBalance && <span>After approval: <strong>{afterApproval} left</strong></span>}
      </div>

      {splitSegments.length > 0 && (
        <div className="mt-2 space-y-0.5">
          {segments.map((segment, index) => (
            <p key={`${segment.segment}-${segment.startDate}-${index}`} className="text-xs">
              {segment.segment === 'lwp' ? 'LWP (notice period)' : typeLabel}: {formatDay(segment.startDate)} – {formatDay(segment.endDate)}
              {' · '}{segment.days} day{Number(segment.days) === 1 ? '' : 's'}
              {segment.segment === 'leave' ? ' → debited' : ' → not debited'}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
