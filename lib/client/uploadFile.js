'use client'

import { upload } from '@vercel/blob/client'
import { MAX_UPLOAD_SIZE_BYTES } from '@/lib/platform/uploadPolicy'

async function readJson(response) {
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload.success === false) {
    const error = new Error(payload.message || 'File upload failed')
    error.code = payload.code
    error.status = response.status
    throw error
  }
  return payload
}

async function legacyServerUpload(file, { category, token }) {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('folder', category)

  const response = await fetch('/api/upload', {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: formData,
  })
  return readJson(response)
}

export async function uploadAuthenticatedFile(file, {
  category = 'chat',
  token = typeof window !== 'undefined' ? localStorage.getItem('token') : '',
  onUploadProgress,
} = {}) {
  if (!file) throw new Error('No file selected')
  if (file.size <= 0) throw new Error('The selected file is empty')
  if (file.size > MAX_UPLOAD_SIZE_BYTES) throw new Error('File size exceeds the 25 MB limit')

  let prepared
  try {
    const response = await fetch('/api/upload/prepare', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        filename: file.name,
        contentType: file.type || 'application/octet-stream',
        size: file.size,
        category,
      }),
    })
    prepared = await readJson(response)
  } catch (error) {
    if (error.code === 'BLOB_NOT_CONFIGURED') {
      return legacyServerUpload(file, { category, token })
    }
    throw error
  }

  const metadata = {
    filename: file.name,
    contentType: prepared.data.contentType,
    size: file.size,
    category: prepared.data.category,
  }
  const blob = await upload(prepared.data.pathname, file, {
    access: prepared.data.access,
    handleUploadUrl: '/api/upload/token',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    clientPayload: JSON.stringify(metadata),
    contentType: prepared.data.contentType,
    multipart: file.size > 5 * 1024 * 1024,
    onUploadProgress,
  })

  const data = {
    fileUrl: prepared.data.fileUrl,
    fileId: blob.pathname,
    fileName: file.name,
    fileType: prepared.data.contentType,
    fileSize: file.size,
    originalSize: file.size,
    optimized: false,
    storage: 'vercel-blob',
  }

  return { success: true, url: data.fileUrl, fileUrl: data.fileUrl, data }
}
