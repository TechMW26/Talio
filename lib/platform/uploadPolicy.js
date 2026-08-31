export const MAX_UPLOAD_SIZE_BYTES = 25 * 1024 * 1024

export const UPLOAD_CATEGORIES = Object.freeze(new Set([
  'chat',
  'documents',
  'projects',
  'tasks',
  'profiles',
  'company',
  'attachments',
]))

const BLOCKED_CONTENT_TYPES = new Set([
  'application/javascript',
  'application/x-httpd-php',
  'application/x-msdownload',
  'application/x-sh',
  'image/svg+xml',
  'text/html',
  'text/javascript',
])

export function normalizeUploadCategory(value) {
  const category = String(value || 'chat').trim().toLowerCase()
  return UPLOAD_CATEGORIES.has(category) ? category : null
}

export function validateUploadMetadata({ filename, contentType, size }) {
  if (!filename || String(filename).trim().length === 0) {
    return { valid: false, code: 'MISSING_FILENAME', message: 'File name is required' }
  }

  if (!Number.isFinite(size) || size <= 0) {
    return { valid: false, code: 'EMPTY_FILE', message: 'The selected file is empty' }
  }

  if (size > MAX_UPLOAD_SIZE_BYTES) {
    return {
      valid: false,
      code: 'FILE_TOO_LARGE',
      message: 'File size exceeds the 25 MB limit',
    }
  }

  const normalizedType = String(contentType || 'application/octet-stream').toLowerCase()
  if (BLOCKED_CONTENT_TYPES.has(normalizedType)) {
    return {
      valid: false,
      code: 'UNSAFE_FILE_TYPE',
      message: 'This file type is not allowed',
    }
  }

  return { valid: true, contentType: normalizedType }
}
