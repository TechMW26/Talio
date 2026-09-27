import { sendCelebrationWishes } from '@/lib/client/celebrationWishes'

const ok = data => ({ ok: true, json: async () => ({ success: true, data }) })
const person = { _id: 'recipient', firstName: 'Garima', years: 1 }
const options = { people: [person], type: 'birthday', employeeId: 'sender', token: 'test-token' }

test('creates a private chat and persists a birthday greeting with authentication', async () => {
  const fetcher = jest.fn().mockResolvedValueOnce(ok({ _id: 'chat' })).mockResolvedValueOnce(ok({ _id: 'message' }))
  const sent = new Set()
  await sendCelebrationWishes({ ...options, fetcher, sent })
  expect(fetcher.mock.calls[0][0]).toBe('/api/chat')
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ isGroup: false, participants: ['recipient'] })
  expect(fetcher.mock.calls[1][0]).toBe('/api/chat/chat/messages')
  expect(fetcher.mock.calls[1][1].headers.Authorization).toBe('Bearer test-token')
  expect(JSON.parse(fetcher.mock.calls[1][1].body).content).toContain('Happy Birthday, Garima!')
  expect(sent.has('birthday:recipient')).toBe(true)
})

test('skips self and previously successful recipients on a partial retry', async () => {
  const sent = new Set()
  const fetcher = jest.fn().mockResolvedValueOnce(ok({ _id: 'chat' })).mockResolvedValueOnce(ok({}))
    .mockResolvedValueOnce({ ok: false, json: async () => ({ success: false, message: 'Unavailable' }) })
  const people = [{ _id: 'sender' }, person, { _id: 'second', firstName: 'Alex' }]
  await expect(sendCelebrationWishes({ ...options, people, fetcher, sent })).rejects.toThrow('Unavailable')
  expect([...sent]).toEqual(['birthday:recipient'])
  fetcher.mockClear().mockResolvedValue(ok({ _id: 'second-chat' }))
  await sendCelebrationWishes({ ...options, people, fetcher, sent })
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(JSON.parse(fetcher.mock.calls[0][1].body).participants).toEqual(['second'])
})

test.each([1, 3])('sends anniversary-specific wishes for %i years', async years => {
  const fetcher = jest.fn().mockResolvedValue(ok({ _id: 'chat' }))
  await sendCelebrationWishes({ ...options, type: 'anniversary', people: [{ ...person, years }], fetcher })
  expect(JSON.parse(fetcher.mock.calls[1][1].body).content).toContain(`${years} ${years === 1 ? 'year' : 'years'} with the team`)
})

test('does not mark a failed message as sent', async () => {
  const sent = new Set()
  const fetcher = jest.fn().mockResolvedValueOnce(ok({ _id: 'chat' }))
    .mockResolvedValueOnce({ ok: false, json: async () => ({ success: false, message: 'Forbidden' }) })
  await expect(sendCelebrationWishes({ ...options, fetcher, sent })).rejects.toThrow('Forbidden')
  expect(sent.size).toBe(0)
})

test('missing authentication does not issue requests', async () => {
  const fetcher = jest.fn()
  await expect(sendCelebrationWishes({ ...options, token: '', fetcher })).rejects.toThrow('sign in')
  expect(fetcher).not.toHaveBeenCalled()
})
