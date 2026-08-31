import { NextResponse } from 'next/server'
import { handleUpload } from '@vercel/blob/client'
import { getAuthAndModels } from '@/lib/auth'
import { buildTenantBlobPrefix, getBlobAccessMode } from '@/lib/platform/blobStorage.server'
import {
  MAX_UPLOAD_SIZE_BYTES,
  normalizeUploadCategory,
  validateUploadMetadata,
} from '@/lib/platform/uploadPolicy'

export const runtime = 'nodejs'

export async function POST(request) {
  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, message: 'Invalid upload request' }, { status: 400 })
  }

  try {
    const response = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const auth = await getAuthAndModels(request)
        if (!auth.success) throw new Error('Unauthorized upload request')

        let metadata
        try {
          metadata = JSON.parse(clientPayload || '{}')
        } catch {
          throw new Error('Invalid upload metadata')
        }

        const category = normalizeUploadCategory(metadata.category)
        const validation = validateUploadMetadata({
          filename: metadata.filename,
          contentType: metadata.contentType,
          size: Number(metadata.size),
        })
        if (!category || !validation.valid) {
          throw new Error(validation.message || 'Invalid upload category')
        }

        const expectedPrefix = `${buildTenantBlobPrefix({
          tenantId: auth.tenant.databaseName,
          category,
          ownerId: String(auth.user._id || auth.user.userId),
        })}/`

        if (!pathname.startsWith(expectedPrefix) || pathname.includes('..')) {
          throw new Error('Upload path does not match the authenticated tenant')
        }

        return {
          allowedContentTypes: [validation.contentType],
          maximumSizeInBytes: Math.min(Number(metadata.size), MAX_UPLOAD_SIZE_BYTES),
          addRandomSuffix: false,
          allowOverwrite: false,
          cacheControlMaxAge: getBlobAccessMode() === 'private' ? 300 : 31_536_000,
          tokenPayload: JSON.stringify({
            tenantId: auth.tenant.databaseName,
            ownerId: String(auth.user._id || auth.user.userId),
            category,
          }),
        }
      },
      onUploadCompleted: async () => {
        // The calling feature persists the returned pathname with its own domain record.
      },
    })

    return NextResponse.json(response)
  } catch (error) {
    console.error('[BlobUploadToken] Failed:', error.message)
    return NextResponse.json({ success: false, message: error.message }, { status: 400 })
  }
}
