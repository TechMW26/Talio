import { populateChats, populateChat } from '@/lib/chat.server'

const employee = { _id: 'a', firstName: 'A', salary: 999, email: 'private@example.test' }
const chat = { _id: 'chat', admin: 'a', participants: ['a', 'missing'], messages: [
  { _id: 'm1', sender: 'a', content: 'Hello', mentions: ['missing'] },
  { _id: 'm2', sender: 'a', replyTo: 'm1', mentions: ['a'] },
] }
test('many chats share one bounded participant read without changing message shape', async () => {
  const database = { getMany: jest.fn(async () => [employee]) }
  const result = await populateChats(database, Array.from({ length: 40 }, (_, i) => ({ ...chat, _id: String(i) })))
  expect(database.getMany).toHaveBeenCalledTimes(1)
  expect(database.getMany).toHaveBeenCalledWith('employees', ['a', 'missing'])
  expect(result.map(row => row._id)).toEqual(Array.from({ length: 40 }, (_, i) => String(i)))
  expect(result[0].participants).toEqual([{ _id: 'a', firstName: 'A' }, 'missing'])
  expect(result[0].messages[1].replyTo).toMatchObject({ _id: 'm1', content: 'Hello', sender: { _id: 'a', firstName: 'A' } })
  expect(JSON.stringify(result)).not.toContain('salary')
  expect(JSON.stringify(result)).not.toContain('private@example')
  expect(chat.participants).toEqual(['a', 'missing'])
})
test('single-chat wrapper and message-free responses remain compatible', async () => {
  const database = { getMany: jest.fn(async () => [employee]) }
  const result = await populateChat(database, chat, { messages: false })
  expect(result).not.toHaveProperty('messages')
  expect(result.admin).toEqual({ _id: 'a', firstName: 'A' })
  expect(await populateChats(database, [])).toEqual([])
  expect(database.getMany).toHaveBeenCalledTimes(1)
})
test('separate tenant calls never reuse employee records', async () => {
  const a = { getMany: jest.fn(async () => [employee]) }, b = { getMany: jest.fn(async () => []) }
  await populateChat(a, chat)
  expect((await populateChat(b, chat)).participants[0]).toBe('a')
  expect(b.getMany).toHaveBeenCalledTimes(1)
})
