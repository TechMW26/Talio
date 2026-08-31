import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getAuthAndModels } from '@/lib/auth'
import {
  buildAuthenticatedBlobUrl,
  buildTenantBlobPath,
  getBlobAccessMode,
  isBlobStorageConfigured,
} from '@/lib/platform/blobStorage.server'
import { normalizeUploadCategory, validateUploadMetadata } from '@/lib/platform/uploadPolicy'

export const runtime = 'nodejs'

export async function POST(request) {
  const auth = await getAuthAndModels(request)
  if (!auth.success) {
    return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
  }

  if (!isBlobStorageConfigured()) {
    return NextResponse.json({
      success: false,
      code: 'BLOB_NOT_CONFIGURED',
      message: 'Managed upload storage is not configured',
    }, { status: 503 })
  }

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, message: 'Invalid JSON body' }, { status: 400 })
  }

  const category = normalizeUploadCategory(body.category)
  if (!category) {
    return NextResponse.json({ success: false, message: 'Invalid upload category' }, { status: 400 })
  }

  const validation = validateUploadMetadata({
    filename: body.filename,
    contentType: body.contentType,
    size: Number(body.size),
  })
  if (!validation.valid) {
    return NextResponse.json({ success: false, ...validation }, { status: 400 })
  }

  const tenantId = auth.tenant.databaseName
  const ownerId = String(auth.user._id || auth.user.userId)
  const pathname = buildTenantBlobPath({
    tenantId,
    category,
    ownerId,
    filename: body.filename,
    id: randomUUID(),
  })

  return NextResponse.json({
    success: true,
    data: {
      pathname,
      fileUrl: buildAuthenticatedBlobUrl(pathname),
      access: getBlobAccessMode(),
      category,
      contentType: validation.contentType,
      maximumSizeInBytes: Number(body.size),
    },
  })
}
