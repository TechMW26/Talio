'use client'

export async function requestEmploymentLetter(employeeId, { kind = 'appointment', fields, sendEmail = false } = {}) {
  const response = await fetch(`/api/employees/${employeeId}/letters${fields ? '' : `?kind=${kind}`}`, {
    method: fields ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${localStorage.getItem('token')}`, ...(fields ? { 'Content-Type': 'application/json' } : {}) },
    ...(fields ? { body: JSON.stringify({ kind, fields, sendEmail }) } : {}),
  })
  const result = await response.json().catch(() => null)
  if (!response.ok || !result?.success) throw new Error(result?.message || 'The letter service is unavailable. Please retry.')
  return result
}
