'use client'

import { uploadAuthenticatedFile } from './uploadFile'

export function validateCompanyLogo(file) {
  if (!file) return
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) throw new Error('Choose a PNG, JPEG, WebP or GIF logo.')
  if (!file.size || file.size > 10 * 1024 * 1024) throw new Error('Choose a non-empty logo smaller than 10 MB.')
}

export async function saveCompanySettings({ companyId, values, logoFile, token, onPhase, onLogoUploaded }) {
  validateCompanyLogo(logoFile)
  const controller = new AbortController()
  let timer
  const deadline = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new Error('Request timed out'))
    }, 60000)
  })
  const bounded = operation => Promise.race([operation, deadline])
  let phase = 'upload'
  try {
    let logo = values.logo || ''
    if (logoFile) {
      onPhase?.('Uploading logo…')
      const uploaded = await bounded(uploadAuthenticatedFile(logoFile, { category: 'company', token, signal: controller.signal }))
      logo = uploaded.fileUrl || uploaded.data?.fileUrl
      if (!uploaded.success || !logo) throw new Error(uploaded.message || 'Logo upload failed. Company settings were not saved.')
      onLogoUploaded?.(logo)
    }
    phase = 'save'
    onPhase?.('Saving…')
    const response = await bounded(fetch(companyId ? `/api/companies/${encodeURIComponent(companyId)}` : '/api/companies', {
      method: companyId ? 'PUT' : 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...values, logo }),
      signal: controller.signal,
    }))
    const data = await bounded(response.json().catch(() => ({})))
    if (!response.ok || !data.success) throw new Error(data.message || `Company save failed (${response.status}). Please try again.`)
    return data
  } catch (error) {
    if (controller.signal.aborted) throw new Error(phase === 'upload'
      ? 'Logo upload timed out. Please check your connection and try again.'
      : 'Save confirmation timed out. Reload the company to check whether changes were saved before retrying.')
    throw error
  } finally {
    clearTimeout(timer)
  }
}
