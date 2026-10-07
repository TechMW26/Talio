import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from '@/lib/auth'
import { EMPLOYEE_STORE_OPTIONS } from '@/lib/employees.server'
import { readEmployeeDetails } from '@/lib/employeeDetails.server'
import { prepareEmployeeUpdate } from '@/lib/employeeInput.server'
import { mutateFirestoreEmployee } from '@/lib/platform/firestoreEmployeeAccount.server'
import { recordDigest } from '@/lib/platform/firestoreCodec.cjs'
import { buildCachePattern, clearCachePattern } from '@/lib/cache'
import { uploadImage, deleteImage } from '@/lib/mediaStorage'
import { getImageMetadata, isValidImage } from '@/lib/imageOptimization'
import { DEFAULT_PHOTO_VIEWPORT } from '@/lib/profilePhotoViewport'
import { generateAndStoreKRIsKPIs } from '@/lib/kriGenerator'

export const dynamic = 'force-dynamic'
const failure = error => NextResponse.json({ success: false, message: error.status ? error.message : 'Unable to load or update employee' }, { status: error.status || 500 })
async function context(request, params) {
  const { id } = await params
  if (!/^[a-f\d]{24}$/i.test(id || '')) throw Object.assign(new Error('Invalid employee ID'), { status: 400 })
  const auth = await getAuthAndDatabase(request, EMPLOYEE_STORE_OPTIONS)
  if (!auth.success) throw Object.assign(new Error(auth.message || 'Unauthorized'), { status: auth.status || 401 })
  return { id, auth }
}
async function invalidate(auth, userId = '*') {
  await Promise.all(['employee:detail', 'employees:list', 'directory:list', 'auth:user', 'profile', 'dashboard:employee-stats', 'dashboard:manager-stats', 'dashboard:hr-stats', 'assets:list'].map(namespace =>
    clearCachePattern(buildCachePattern({ tenantId: auth.tenant.databaseName, namespace, userId: namespace === 'auth:user' || namespace === 'profile' ? userId : '*' })).catch(() => {})))
}
export async function GET(request, { params }) {
  try {
    const { id, auth } = await context(request, params)
    const data = await readEmployeeDetails(auth.database, auth.user, id)
    return data ? NextResponse.json({ success: true, data }) : NextResponse.json({ success: false, message: 'Employee not found' }, { status: 404 })
  } catch (error) { return failure(error) }
}
async function update(request, params, partial = false) {
  let upload, databaseName, committed = false
  try {
    const { id, auth } = await context(request, params)
    databaseName = auth.tenant.databaseName
    const current = await auth.database.get('employees', id)
    if (!current) throw Object.assign(new Error('Employee not found'), { status: 404 })
    const body = await request.json()
    let input = body
    if (partial) {
      const allowed = new Set(['status', 'department', 'departments', 'designation', 'designationLevel', 'reportingManager', 'level'])
      input = Object.fromEntries(Object.entries(body).filter(([key]) => allowed.has(key)))
    }
    // Validate authorization and fields before spending storage/provider work.
    let patch = await prepareEmployeeUpdate(auth.database, auth.user, current, input)
    if (patch.profilePicture?.startsWith('data:image/')) {
      const match = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z\d+/=\r\n]+)$/.exec(patch.profilePicture)
      if (!match || match[2].length > 14 * 1024 * 1024) throw Object.assign(new Error('Choose a PNG, JPEG, WebP or GIF image smaller than 10 MB'), { status: 400 })
      const bytes = Buffer.from(match[2], 'base64')
      if (!bytes.length || bytes.length > 10 * 1024 * 1024 || !await isValidImage(bytes)) throw Object.assign(new Error('Invalid profile image'), { status: 400 })
      // Keep source pixels and dimensions intact. Avatar framing is metadata,
      // never a canvas export, mask, thumbnail or destructive resize.
      const metadata = await getImageMetadata(bytes)
      const format = metadata?.format
      if (!['png', 'jpeg', 'webp', 'gif'].includes(format)) throw Object.assign(new Error('Unsupported profile image'), { status: 400 })
      upload = await uploadImage(bytes, { databaseName, category: 'profile', contentType: `image/${format}`, originalName: `profile_${id}.${format}`, employeeId: id, userId: String(auth.user._id || auth.user.userId) })
      patch = { ...patch, profilePicture: upload.url, profilePictureFileId: String(upload._id), profilePictureViewport: patch.profilePictureViewport || { ...DEFAULT_PHOTO_VIEWPORT } }
    }
    const result = await mutateFirestoreEmployee({ actor: auth.user, databaseName, employeeId: id, expectedDigest: recordDigest(current), patch, systemRole: partial ? undefined : input.systemRole })
    committed = true
    await invalidate(auth, result.user?._id)
    if (['designation', 'designationLevel', 'department', 'departments'].some(key => Object.hasOwn(patch, key))) {
      void generateAndStoreKRIsKPIs({ database: auth.database, employeeId: id, userId: auth.user._id || auth.user.userId, generateKPIs: false }).catch(() => {})
    }
    // Old profile media is retained: historical references and migration
    // archives may still reference it. A separate retention policy owns cleanup.
    const data = await readEmployeeDetails(auth.database, auth.user, id)
    return NextResponse.json({ success: true, message: 'Employee updated successfully', data, assetsReturned: result.assetsReturned })
  } catch (error) {
    if (upload && !committed) await deleteImage(String(upload._id), { databaseName }).catch(() => {})
    return failure(error)
  }
}
export async function PUT(request, { params }) { return update(request, params) }
export async function PATCH(request, { params }) { return update(request, params, true) }
export async function DELETE(request, { params }) {
  try {
    const { id, auth } = await context(request, params)
    const current = await auth.database.get('employees', id)
    if (!current) throw Object.assign(new Error('Employee not found'), { status: 404 })
    const result = await mutateFirestoreEmployee({ actor: auth.user, databaseName: auth.tenant.databaseName, employeeId: id, expectedDigest: recordDigest(current), remove: true })
    await invalidate(auth)
    return NextResponse.json({
      success: true, message: 'Employee deleted', userDeleted: result.userDeleted, assetsReturned: result.assetsReturned,
      deletedEmployee: { _id: id, email: current.email, firstName: current.firstName, lastName: current.lastName },
    })
  } catch (error) { return failure(error) }
}

