'use client'

import { uploadAuthenticatedFile } from './uploadFile'
import { prepareCompanyLogo, validateCompanyLogo } from './companyLogo'
export { validateCompanyLogo } from './companyLogo'

export async function saveCompanySettings({ companyId, values, logoFile, token, onPhase, onLogoUploaded }) {
  validateCompanyLogo(logoFile)
  const controller = new AbortController()
  let timer
  let deadline
  const startDeadline = () => { clearTimeout(timer); deadline = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new Error('Request timed out'))
    }, 30000)
  }) }
  startDeadline()
  const bounded = operation => Promise.race([operation, deadline])
  let phase = 'upload'
  try {
    let logo = values.logo || ''
    if (logoFile) {
      onPhase?.('Preparing logo…')
      const preparedLogo = await bounded(prepareCompanyLogo(logoFile, controller.signal))
      onPhase?.('Uploading logo…')
      const uploaded = await bounded(uploadAuthenticatedFile(preparedLogo, { category: 'company', token, signal: controller.signal, transport: 'server' }))
      logo = uploaded.fileUrl || uploaded.data?.fileUrl
      if (!uploaded.success || !logo) throw new Error(uploaded.message || 'Logo upload failed. Company settings were not saved.')
      onLogoUploaded?.(logo)
    }
    phase = 'save'
    startDeadline()
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
