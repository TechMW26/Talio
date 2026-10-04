import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from './auth'
import { MIRA_CHAT_STORE_OPTIONS, readMiraTokens, createMiraSession, readMiraSession, updateMiraSession, miraSessionSummary } from './miraChatStore.server'

export async function handleMiraHistory(request, context = {}, kind = 'sessions') {
  try {
    const auth = await getAuthAndDatabase(request, MIRA_CHAT_STORE_OPTIONS)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: auth.status || 401 })
    const userId = String(auth.user._id), { id } = await context.params || {}
    if (kind === 'tokens') return NextResponse.json({ success: true, tokens: await readMiraTokens(auth.database, userId) })
    if (kind === 'sessions') {
      if (request.method === 'GET') {
        const page = await auth.database.list('mirachatsessions', { filters: [{ field: 'user', operator: '==', value: userId }], orderBy: [{ field: 'lastMessageAt', direction: 'desc' }], limit: 50 })
        return NextResponse.json({ success: true, sessions: page.records.map(miraSessionSummary) })
      }
      return NextResponse.json({ success: true, session: miraSessionSummary(await createMiraSession(auth.database, userId, await request.json())) })
    }
    if (request.method === 'GET') return NextResponse.json({ success: true, session: await readMiraSession(auth.database, userId, id) })
    const session = await updateMiraSession(auth.database, userId, id, request.method === 'DELETE' ? {} : await request.json(), request.method === 'DELETE')
    return NextResponse.json({ success: true, ...(session ? { session: miraSessionSummary(session) } : {}) })
  } catch (error) { return NextResponse.json({ success: false, message: error.status ? error.message : 'Unable to process MIRA history' }, { status: error.status || 500 }) }
}
