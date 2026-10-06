import { NextResponse, after } from 'next/server'
import { requirePermission, checkPermission } from '@/lib/permissions'
import { assetDatabase, listAssets, saveAsset, populateAssets } from '@/lib/assetsStore.server'
import { notifyAssetAssignment, assetNotificationRecipients } from '@/lib/assetNotifications.server'
import { emitAssetUpdate } from '@/lib/realtimeEvents'
export async function assetsApi(request, context, method) {
  try {
    const action = ({ GET: 'view', POST: 'create', PUT: 'edit', DELETE: 'delete' })[method]
    const auth = await requirePermission('assets', action)(request, [])
    if (auth.denied) return auth.denied
    const database = await assetDatabase(auth), id = context ? (await context.params).id : null
    if (method === 'GET') return NextResponse.json({ success: true, data: await listAssets(database, auth.user, new URL(request.url).searchParams, ['create', 'edit', 'manage', 'assign'].some(action => checkPermission(auth.user.permissions, 'assets', action))) })
    const { record, previous } = await saveAsset(database, auth.user, method === 'DELETE' ? {} : await request.json(), { id, remove: method === 'DELETE', permissionGranted: true })
    const data = (await populateAssets(database, [record]))[0]
    after(async () => {
      try {
        const recipients = new Set((await assetNotificationRecipients(database, record)).map(user => user.id))
        if (previous?.assignedTo) for (const user of await assetNotificationRecipients(database, previous)) recipients.add(user.id)
        if (recipients.size) emitAssetUpdate({ assetId: record._id, action }, [...recipients], { action, broadcast: false })
        if (method !== 'DELETE') await notifyAssetAssignment({ database, asset: record, previousAssignee: previous?.assignedTo })
      } catch (error) { console.error('[Asset event]', error.message) }
    })
    return NextResponse.json({ success: true, message: `Asset ${method === 'DELETE' ? 'deleted' : id ? 'updated' : 'created'} successfully`, ...(method !== 'DELETE' ? { data } : {}) }, { status: method === 'POST' ? 201 : 200 })
  } catch (error) { return NextResponse.json({ success: false, message: error.status ? error.message : error.code === 'ALREADY_EXISTS' ? 'An asset with this code or UIN already exists' : 'Could not process asset request' }, { status: error.status || (error.code === 'ALREADY_EXISTS' ? 409 : 500) }) }
}
