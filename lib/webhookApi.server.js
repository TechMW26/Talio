import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from './auth'
import { WEBHOOK_STORE_OPTIONS, assertWebhookId, publicWebhook, listWebhooks, mutateWebhook } from './webhooks.server'
export async function webhookApi(request, params, method) {
  try {
    const auth = await getAuthAndDatabase(request, WEBHOOK_STORE_OPTIONS)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: auth.status || 401 })
    if (!['admin', 'hr'].includes(auth.user.role)) return NextResponse.json({ success: false, message: 'Access denied' }, { status: 403 })
    const id = params ? (await params).id : null
    if (id) assertWebhookId(id)
    if (method === 'GET') {
      if (!id) return NextResponse.json({ success: true, data: await listWebhooks(auth.database) })
      const record = await auth.database.get('webhooks', id)
      if (!record) return NextResponse.json({ success: false, message: 'Webhook not found' }, { status: 404 })
      const logs = await auth.database.list('webhookdeliverylogs', { filters: [{ field: 'webhook', operator: '==', value: id }], orderBy: [{ field: 'createdAt', direction: 'desc' }], limit: 25 })
      return NextResponse.json({ success: true, data: { ...publicWebhook(record), recentDeliveries: logs.records } })
    }
    const operation = method === 'DELETE' ? 'delete' : id && method === 'POST' ? 'rotate' : 'save'
    const data = await mutateWebhook(auth.database, auth.user, operation === 'save' ? await request.json() : {}, id, operation)
    const message = operation === 'delete' ? 'Webhook deleted; delivery audit records retained' : operation === 'rotate' || !id ? 'Save the secret; it is only shown once' : 'Webhook updated successfully'
    return NextResponse.json({ success: true, message, ...(data ? { data } : {}) }, { status: !id ? 201 : 200, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return NextResponse.json({ success: false, message: error.status ? error.message : 'Unable to process webhook' }, { status: error.status || 500 }) }
}
