import { randomBytes, createHash } from 'node:crypto'
import { collectFirestorePages, readFirestoreReferences } from './platform/firestoreQueries.server'

export const CHAT_STORE_OPTIONS = { queryFields: { chats: ['participants', 'isGroup', 'lastMessageAt'], users: ['employeeId'], employees: ['userId'] } }
const idOf = value => String(value?._id || value || '')
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }) }
export const assertChatId = id => { if (!/^[a-f\d]{24}$/i.test(String(id))) fail('Invalid chat or message ID') }
export async function chatActor(database, actor) {
  const account = await database.get('users', idOf(actor._id || actor.userId))
  if (!account?.isActive) fail('Account is not active', 403)
  const employee = account.employeeId && await database.get('employees', idOf(account.employeeId))
  if (!employee) fail('Employee not found', 404)
  return { account, employee }
}
export async function requireChat(database, actor, chatId) {
  assertChatId(chatId)
  const { account, employee } = await chatActor(database, actor)
  const chat = await database.get('chats', chatId)
  if (!chat) fail('Chat not found', 404)
  if (!(chat.participants || []).map(idOf).includes(employee._id)) fail('Not a participant', 403)
  return { chat, account, employee }
}
const publicEmployee = employee => employee && Object.fromEntries(['_id', 'firstName', 'lastName', 'profilePicture', 'employeeCode'].filter(key => employee[key] !== undefined).map(key => [key, employee[key]]))
export async function populateChat(database, chat, { messages = true } = {}) {
  const refs = await readFirestoreReferences(database, 'employees', [chat.admin, ...(chat.participants || []), ...(messages ? (chat.messages || []).flatMap(m => [m.sender, ...(m.mentions || [])]) : [])].map(idOf))
  const get = id => publicEmployee(refs.get(idOf(id))) || idOf(id)
  const result = { ...chat, participants: chat.participants.map(get), ...(chat.admin ? { admin: get(chat.admin) } : {}) }
  if (!messages) { delete result.messages; return result }
  const byId = new Map((chat.messages || []).map(m => [idOf(m), m]))
  result.messages = (chat.messages || []).map(m => {
    const reply = byId.get(idOf(m.replyTo))
    return { ...m, sender: get(m.sender), mentions: (m.mentions || []).map(get), ...(reply ? { replyTo: { _id: reply._id, content: reply.content, fileName: reply.fileName, sender: get(reply.sender) } } : {}) }
  })
  return result
}
export async function listChats(database, actor) {
  const { employee } = await chatActor(database, actor)
  const chats = await collectFirestorePages(database, 'chats', { filters: [{ field: 'participants', operator: 'array-contains', value: employee._id }], orderBy: [{ field: 'lastMessageAt', direction: 'desc' }] }, 2000)
  return { chats, employeeId: employee._id }
}
export async function createChat(database, actor, input) {
  if (!Array.isArray(input.participants) || !input.participants.length || input.participants.length > 100) fail('Choose between 1 and 100 participants')
  const requested = [...new Set(input.participants.map(idOf))]
  requested.forEach(assertChatId)
  const isGroup = input.isGroup === true
  if (!isGroup && requested.length !== 1) fail('Direct chat requires one other participant')
  if (isGroup && (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 200)) fail('Group name is required (maximum 200 characters)')
  const randomId = randomBytes(12).toString('hex')
  return database.transaction(async tx => {
    const { employee } = await chatActor(tx, actor)
    if (!isGroup && requested[0] === employee._id) fail('Select another participant')
    const participants = [...new Set([employee._id, ...requested])]
    for (const id of requested) if (!await tx.get('employees', id)) fail('Participant does not belong to this company', 403)
    const id = isGroup ? randomId : createHash('sha256').update(participants.slice().sort().join(':')).digest('hex').slice(0, 24)
    const direct = !isGroup && await tx.get('chats', id)
    if (direct && participants.every(p => direct.participants.includes(p))) return direct
    // Discover imported direct threads before creating a new deterministic one.
    if (!isGroup) {
      const legacy = await tx.list('chats', { filters: [{ field: 'participants', operator: 'array-contains', value: employee._id }, { field: 'isGroup', operator: '==', value: false }], limit: 1000, requireComplete: true })
      const existing = legacy.records.find(chat => participants.every(p => chat.participants.map(idOf).includes(p)))
      if (existing) return existing
      // A departed participant cannot be silently re-added to a private thread.
      if (direct) fail('The previous conversation was closed; use a new group conversation', 409)
    }
    const now = new Date()
    const chat = { _id: id, isGroup, participants, createdBy: employee._id, messages: [], lastMessageAt: now, createdAt: now, updatedAt: now, ...(isGroup ? { name: input.name.trim(), admin: employee._id } : {}) }
    await tx.create('chats', chat)
    return chat
  })
}
export async function mutateChat(database, actor, chatId, operation, input = {}) {
  const messageId = randomBytes(12).toString('hex')
  return database.transaction(async tx => {
    const { chat, employee, account } = await requireChat(tx, actor, chatId)
    const next = { ...chat, messages: [...(chat.messages || [])], updatedAt: new Date() }
    let result
    if (operation === 'leave' || operation === 'delete') {
      if (operation === 'delete' && chat.isGroup) {
        if (idOf(chat.admin) !== employee._id) fail('Only the group admin can delete this chat', 403)
        await tx.delete('chats', chatId)
      } else {
        next.participants = chat.participants.filter(id => idOf(id) !== employee._id)
        if (idOf(chat.admin) === employee._id) next.admin = next.participants[0] || null
        if (next.participants.length) await tx.replace('chats', next)
        else await tx.delete('chats', chatId)
      }
      return { chat: next, account, employee }
    }
    if (operation === 'send') {
      const content = typeof input.content === 'string' ? input.content.trim() : ''
      if (content.length > 50000 || (!content && !input.fileUrl)) fail('Message content or an attachment is required')
      const message = { _id: messageId, sender: employee._id, content, createdAt: new Date(), reactions: [], isRead: [{ user: employee._id, readAt: new Date() }] }
      if (input.fileUrl) {
        if (typeof input.fileUrl !== 'string' || input.fileUrl.length > 2048 || !/^(?:https:\/\/|\/api\/)/.test(input.fileUrl)) fail('Invalid attachment URL')
        for (const field of ['fileUrl', 'fileId', 'fileName', 'fileType']) if (input[field] !== undefined) {
          if (typeof input[field] !== 'string' || input[field].length > 2048) fail(`Invalid ${field}`)
          message[field] = input[field]
        }
        if (input.fileSize !== undefined) {
          if (!Number.isSafeInteger(input.fileSize) || input.fileSize < 0) fail('Invalid attachment size')
          message.fileSize = input.fileSize
        }
      }
      if (input.replyTo) {
        assertChatId(idOf(input.replyTo))
        if (!next.messages.some(m => idOf(m) === idOf(input.replyTo))) fail('Reply message not found', 404)
        message.replyTo = idOf(input.replyTo)
      }
      message.mentions = [...new Set((Array.isArray(input.mentions) ? input.mentions : []).map(idOf))].filter(id => chat.participants.map(idOf).includes(id))
      next.messages.push(message)
      next.lastMessage = content || message.fileName || 'File'
      next.lastMessageAt = message.createdAt
      result = message
    } else if (operation === 'read') {
      let markedCount = 0
      next.messages = next.messages.map(message => {
        if (idOf(message.sender) === employee._id || (message.isRead || []).some(r => idOf(r.user) === employee._id)) return message
        markedCount++
        return { ...message, isRead: [...(message.isRead || []), { user: employee._id, readAt: new Date() }] }
      })
      result = { markedCount }
    } else if (operation === 'delete-message' || operation === 'react') {
      assertChatId(input.messageId)
      const index = next.messages.findIndex(m => idOf(m) === input.messageId)
      if (index < 0) fail('Message not found', 404)
      const message = next.messages[index]
      if (operation === 'delete-message') {
        if (idOf(message.sender) !== employee._id) fail('You can only delete your own messages', 403)
        next.messages.splice(index, 1)
        const last = next.messages[next.messages.length - 1]
        next.lastMessage = last?.content || last?.fileName || ''
        next.lastMessageAt = last?.createdAt || chat.createdAt
      } else {
        if (typeof input.reaction !== 'string' || !input.reaction.trim() || input.reaction.length > 64) fail('A valid reaction is required')
        // Old clients wrote account IDs despite the original employee schema.
        const mine = new Set([account._id, employee._id])
        const toggleOff = (message.reactions || []).some(r => mine.has(idOf(r.user)) && r.reaction === input.reaction)
        const reactions = (message.reactions || []).filter(r => !mine.has(idOf(r.user)))
        if (!toggleOff) reactions.push({ user: employee._id, reaction: input.reaction, createdAt: new Date() })
        result = { ...message, reactions }; next.messages[index] = result
      }
    } else fail('Unknown chat operation')
    await tx.replace('chats', next)
    return { chat: next, result, account, employee }
  }, { maxWrites: 400 })
}
