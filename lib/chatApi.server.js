import { NextResponse } from 'next/server'
import { getAuthAndDatabase } from './auth'
import { CHAT_STORE_OPTIONS, createChat, listChats, mutateChat, populateChat, populateChats, requireChat } from './chat.server'
import { collectFirestorePages } from './platform/firestoreQueries.server'
import { emitChatUnreadUpdated } from './eventBus'
import { sendMessageNotification } from './notificationService'
import { getIO } from './socket'

async function publish(auth, operation, value, params) {
  const { chat, account, employee, result } = value
  const users = []
  for (let i = 0; i < chat.participants.length; i += 30) users.push(...await collectFirestorePages(auth.database, 'users', { filters: [{ field: 'employeeId', operator: 'in', value: chat.participants.slice(i, i + 30) }] }, 1000))
  const userIds = [...new Set(users.filter(user => user.isActive).map(user => user._id))]
  const data = operation === 'send' || operation === 'react' ? (await populateChat(auth.database, chat)).messages.find(message => message._id === result._id) : null
  if (process.env.TALIO_LOCAL_ACCEPTANCE !== '1') {
    const io = getIO()
    const event = operation === 'send' ? 'new-message' : operation === 'react' ? 'message-reaction' : operation === 'delete-message' ? 'message-deleted' : null
    // Publish only to freshly resolved members, not a stale shared chat room.
    if (event) for (const userId of userIds) io?.to(`user:${userId}`).emit(event, { chatId: chat._id, messageId: params.messageId, message: data, senderId: employee._id })
    if (operation === 'send') for (const recipientId of userIds.filter(id => id !== account._id)) await sendMessageNotification({ database: auth.database, senderId: account._id, recipientId, message: result.content || result.fileName || 'Sent a file', chatId: chat._id }).catch(() => {})
    const targets = operation === 'read' ? [account._id] : userIds
    if (targets.length) await emitChatUnreadUpdated({ chatId: chat._id, action: operation, markedCount: result?.markedCount }, targets, auth.tenant.databaseName)
  }
  return data
}
export async function handleChat(request, context = {}, operation) {
  try {
    const auth = await getAuthAndDatabase(request, CHAT_STORE_OPTIONS)
    if (!auth.success) return NextResponse.json({ success: false, message: auth.message }, { status: auth.status || 401 })
    const params = await context.params || {}
    if (operation === 'list' || operation === 'unread') {
      if (operation === 'unread' && !auth.user.employeeId) return NextResponse.json({ success: true, totalUnread: 0, unreadByChat: {} })
      const { chats, employeeId } = await listChats(auth.database, auth.user)
      if (operation === 'unread') {
        const unreadByChat = {}
        for (const chat of chats) {
          const count = (chat.messages || []).filter(m => String(m.sender) !== employeeId && !(m.isRead || []).some(read => String(read.user) === employeeId)).length
          if (count) unreadByChat[chat._id] = count
        }
        return NextResponse.json({ success: true, totalUnread: Object.values(unreadByChat).reduce((sum, count) => sum + count, 0), unreadByChat })
      }
      const data = await populateChats(auth.database, chats)
      return NextResponse.json({ success: true, data, currentUserId: employeeId })
    }
    if (operation === 'create') {
      const chat = await createChat(auth.database, auth.user, await request.json())
      return NextResponse.json({ success: true, data: await populateChat(auth.database, chat), message: 'Chat ready' })
    }
    if (operation === 'get' || operation === 'messages') {
      const { chat } = await requireChat(auth.database, auth.user, params.chatId)
      const populated = await populateChat(auth.database, chat, { messages: operation === 'messages' })
      if (operation === 'get') return NextResponse.json(populated)
      const since = new URL(request.url).searchParams.get('since')
      if (since && !Number.isFinite(new Date(since).getTime())) throw Object.assign(new Error('Invalid message timestamp'), { status: 400 })
      return NextResponse.json({ success: true, data: since ? populated.messages.filter(m => new Date(m.createdAt) > new Date(since)) : populated.messages, ...(since ? { incremental: true, since } : {}) })
    }
    const input = ['send', 'react'].includes(operation) ? await request.json() : {}
    const value = await mutateChat(auth.database, auth.user, params.chatId, operation, { ...input, messageId: params.messageId })
    let data
    try { data = await publish(auth, operation, value, params) } catch { console.error('[Chat] Post-commit delivery needs retry') }
    if (!data && value.result?._id) data = (await populateChat(auth.database, value.chat)).messages.find(m => m._id === value.result._id)
    return NextResponse.json({ success: true, ...(data ? { data } : {}), ...(operation === 'read' ? value.result : {}), message: operation === 'send' ? 'Message sent successfully' : 'Chat updated' })
  } catch (error) { return NextResponse.json({ success: false, message: error.status ? error.message : 'Unable to process chat request' }, { status: error.status || 500 }) }
}
