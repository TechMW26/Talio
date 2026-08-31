import { randomUUID } from 'crypto'
import { del, get, put } from '@vercel/blob'

const DEFAULT_CONTENT_TYPE = 'application/octet-stream'
const MAX_PATH_SEGMENT_LENGTH = 120

function sanitizePathSegment(value, fallback) {
  const normalized = String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, MAX_PATH_SEGMENT_LENGTH)

  if (normalized) return normalized
  if (fallback) return fallback
  throw new TypeError('A non-empty storage path segment is required')
}

function sanitizeFilename(filename) {
  const source = String(filename || 'file')
  const basename = source.split(/[\\/]/).pop() || 'file'
  return sanitizePathSegment(basename, 'file')
}

export function isBlobStorageConfigured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN)
}

export function getBlobAccessMode(env = process.env) {
  return env.BLOB_ACCESS === 'public' ? 'public' : 'private'
}

export function buildTenantRootPrefix(tenantId) {
  return `tenants/${sanitizePathSegment(tenantId)}`
}

export function buildTenantBlobPrefix({ tenantId, category = 'uploads', ownerId = 'shared' }) {
  return [
    buildTenantRootPrefix(tenantId),
    sanitizePathSegment(category, 'uploads'),
    sanitizePathSegment(ownerId, 'shared'),
  ].join('/')
}

/**
 * Build a collision-resistant, tenant-isolated object path.
 * Callers may pass an id in tests or import jobs to make the path deterministic.
 */
export function buildTenantBlobPath({
  tenantId,
  category = 'uploads',
  ownerId = 'shared',
  filename,
  id = randomUUID(),
}) {
  const prefix = buildTenantBlobPrefix({ tenantId, category, ownerId })
  return `${prefix}/${sanitizePathSegment(id)}-${sanitizeFilename(filename)}`
}

export function buildAuthenticatedBlobUrl(pathname) {
  const encodedPath = String(pathname || '')
    .split('/')
    .map(encodeURIComponent)
    .join('/')
  return `/api/files/${encodedPath}`
}

export async function uploadTenantBlob({
  tenantId,
  category,
  ownerId,
  filename,
  body,
  contentType = DEFAULT_CONTENT_TYPE,
  access = 'private',
  cacheControlMaxAge,
  id,
  token = process.env.BLOB_READ_WRITE_TOKEN,
}) {
  if (!token) {
    const error = new Error('Vercel Blob is not configured')
    error.code = 'BLOB_NOT_CONFIGURED'
    throw error
  }

  if (access !== 'private' && access !== 'public') {
    throw new TypeError('Blob access must be either private or public')
  }

  const pathname = buildTenantBlobPath({ tenantId, category, ownerId, filename, id })
  const result = await put(pathname, body, {
    access,
    contentType,
    addRandomSuffix: false,
    token,
    ...(Number.isFinite(cacheControlMaxAge) ? { cacheControlMaxAge } : {}),
  })

  return {
    provider: 'vercel-blob',
    pathname,
    url: result.url,
    downloadUrl: result.downloadUrl || null,
    contentType,
    access,
  }
}

export async function deleteTenantBlob(urlOrUrls, options = {}) {
  const token = options.token || process.env.BLOB_READ_WRITE_TOKEN
  if (!token) {
    const error = new Error('Vercel Blob is not configured')
    error.code = 'BLOB_NOT_CONFIGURED'
    throw error
  }

  await del(urlOrUrls, { token })
  return true
}

export async function getTenantBlob(pathname, options = {}) {
  const token = options.token || process.env.BLOB_READ_WRITE_TOKEN
  if (!token) {
    const error = new Error('Vercel Blob is not configured')
    error.code = 'BLOB_NOT_CONFIGURED'
    throw error
  }

  return get(pathname, {
    access: options.access || getBlobAccessMode(),
    token,
    ...(options.ifNoneMatch ? { ifNoneMatch: options.ifNoneMatch } : {}),
  })
}
