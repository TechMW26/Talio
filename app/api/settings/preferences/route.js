import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { uploadImage, deleteImage } from '@/lib/mediaStorage'
import { processImage } from '@/lib/imagePipeline'
import { getPreferencesStore, getPreferences, validatePreferences } from '@/lib/platform/firestorePreferences.server'

export const dynamic = 'force-dynamic'
export async function GET(request) {
  try {
    const auth = await getAuthAndDatabase(request)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    return NextResponse.json({ success: true, data: await getPreferences(await getPreferencesStore(auth.tenant.databaseName)) })
  } catch (error) {
    return NextResponse.json({ success: false, message: 'Failed to fetch preferences' }, { status: 500 })
  }
}

export async function PUT(request) {
  let uploaded, databaseName, committed = false
  try {
    const auth = await getAuthAndDatabase(request)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    if (auth.user.role !== 'admin') return NextResponse.json({ success: false, message: 'Access denied' }, { status: 403 })
    databaseName = auth.tenant.databaseName
    const store = await getPreferencesStore(databaseName)
    const previous = await getPreferences(store)
    const body = await request.json()
    const changes = validatePreferences(body)
    if (body.companyLogo?.startsWith('data:image/')) {
      if (!/^data:image\/(png|jpeg|jpg|webp|gif);base64,/.test(body.companyLogo)) throw Object.assign(new Error('Unsupported logo format'), { status: 400 })
      const buffer = Buffer.from(body.companyLogo.split(',')[1], 'base64')
      if (!buffer.length || buffer.length > 10 * 1024 * 1024) throw Object.assign(new Error('Logo must be at most 10 MB'), { status: 400 })
      const image = await processImage(buffer, { type: 'logo' })
      uploaded = await uploadImage(image.buffer, { databaseName, category: 'settings', contentType: image.mimeType, originalName: `company-logo.${image.format}`, userId: String(auth.user._id || auth.user.userId) })
      changes.companyLogo = uploaded.url
      changes.companyLogoFileId = String(uploaded._id)
    } else if (body.companyLogo === '') {
      changes.companyLogo = ''; changes.companyLogoFileId = ''
    } else if (body.companyLogo !== undefined && body.companyLogo !== previous.companyLogo) {
      throw Object.assign(new Error('Upload a logo image instead of supplying a storage URL'), { status: 400 })
    }
    let previousFileId
    const preferences = await store.transaction(async tx => {
      const current = await tx.get('systempreferences', previous._id)
      previousFileId = current?.companyLogoFileId
      const next = { ...(current || previous), ...changes, updatedAt: new Date() }
      if (current) await tx.replace('systempreferences', next)
      else await tx.create('systempreferences', { ...next, createdAt: new Date() })
      return next
    })
    committed = true
    if ('companyLogo' in changes && previousFileId && previousFileId !== preferences.companyLogoFileId) await deleteImage(previousFileId, { databaseName }).catch(() => {})
    return NextResponse.json({ success: true, message: 'Preferences updated successfully', data: preferences })
  } catch (error) {
    if (uploaded && !committed) await deleteImage(uploaded._id, { databaseName }).catch(() => {})
    return NextResponse.json({ success: false, message: error.status ? error.message : 'Failed to update preferences' }, { status: error.status || 500 })
  }
}
