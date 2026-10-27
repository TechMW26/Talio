import { useEffect } from 'react'
import { act, render } from '@testing-library/react'
import { SocketProvider, useSocket } from '@/contexts/SocketContext'
import toast from '@/utils/toast'
import { markClientDataChanged } from '@/lib/clientDataSync'

const mockClients = [], mockInbox = jest.fn()
jest.mock('@/lib/client/realtimeSocketAdapter', () => ({ createRealtimeClient: jest.fn(() => {
  const listeners = new Map()
  const client = {
    on: jest.fn((name, callback) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(callback) }),
    off: jest.fn((name, callback) => listeners.get(name)?.delete(callback)),
    emit: jest.fn(), disconnect: jest.fn(),
    dispatch: (name, payload) => listeners.get(name)?.forEach(callback => callback(payload)),
  }
  mockClients.push(client)
  return client
}) }))
jest.mock('@/utils/toast', () => ({ __esModule: true, default: { custom: jest.fn(), dismiss: jest.fn() } }))
jest.mock('@/utils/sessionCache', () => ({ clearAllSessionCaches: jest.fn(), validateAuthBackground: jest.fn() }))
jest.mock('@/lib/clientDataSync', () => ({ markClientDataChanged: jest.fn() }))

function InboxSubscriber() {
  const { onNewNotification } = useSocket()
  useEffect(() => onNewNotification(mockInbox), [onNewNotification])
  return null
}
function account(userId = 'user-one', tenant = 'tenant-one') {
  localStorage.setItem('token', `token-${userId}`)
  localStorage.setItem('user', JSON.stringify({ _id: userId, employeeId: `employee-${userId}`, tenant: { databaseName: tenant } }))
}
const hint = id => ({ _id: id, title: 'MIRA reminder', message: 'Review the proposal' })
const emit = data => act(() => mockClients.at(-1).dispatch('new-notification', data))
beforeEach(() => {
  jest.clearAllMocks(); mockClients.length = 0; localStorage.clear(); account()
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

test('replayed ID shows one toast while all hints still invalidate data and reach inbox subscribers', () => {
  render(<SocketProvider><InboxSubscriber /></SocketProvider>)
  emit(hint('notification-one')); emit(hint('notification-one'))
  expect(toast.custom).toHaveBeenCalledTimes(1)
  expect(mockInbox).toHaveBeenCalledTimes(2)
  expect(markClientDataChanged).toHaveBeenCalledTimes(2)
  expect(markClientDataChanged).toHaveBeenNthCalledWith(1, 'realtime:new-notification')
  expect(markClientDataChanged).toHaveBeenNthCalledWith(2, 'realtime:new-notification')
})

test('different deliveries and legacy hints without an ID are not collapsed by their content', () => {
  render(<SocketProvider><InboxSubscriber /></SocketProvider>)
  emit(hint('one')); emit(hint('two'))
  emit({ title: 'Legacy', message: 'Reminder' }); emit({ title: 'Legacy', message: 'Reminder' })
  expect(toast.custom).toHaveBeenCalledTimes(4)
  expect(mockInbox).toHaveBeenCalledTimes(4)
  expect(markClientDataChanged).toHaveBeenCalledTimes(4)
})

test('ledger is bounded and old notification identities expire without changing realtime delivery', () => {
  let clock = 1000000
  jest.spyOn(Date, 'now').mockImplementation(() => clock)
  render(<SocketProvider />)
  for (let index = 0; index < 257; index++) emit(hint(`notification-${index}`))
  expect(toast.custom).toHaveBeenCalledTimes(257)
  emit(hint('notification-256'))
  expect(toast.custom).toHaveBeenCalledTimes(257)
  emit(hint('notification-0')) // First ID was evicted by the 256-entry bound.
  expect(toast.custom).toHaveBeenCalledTimes(258)
  clock += 24 * 60 * 60 * 1000 + 1
  emit(hint('notification-256'))
  expect(toast.custom).toHaveBeenCalledTimes(259)
  expect(markClientDataChanged).toHaveBeenCalledTimes(260)
})

test('replacement account gets its own ledger; callbacks from the previous account cannot display private toasts', () => {
  const view = render(<SocketProvider><InboxSubscriber /></SocketProvider>)
  const previousClient = mockClients.at(-1)
  emit(hint('shared-record-id'))
  account('user-two', 'tenant-two')
  act(() => previousClient.dispatch('new-notification', hint('late-private-record')))
  expect(toast.custom).toHaveBeenCalledTimes(1)
  view.unmount()
  render(<SocketProvider><InboxSubscriber /></SocketProvider>)
  emit(hint('shared-record-id')); emit(hint('shared-record-id'))
  expect(toast.custom).toHaveBeenCalledTimes(2)
  expect(previousClient.disconnect).toHaveBeenCalledTimes(1)
  expect(mockInbox).toHaveBeenCalledTimes(4)
  expect(markClientDataChanged).toHaveBeenCalledTimes(4)
})

test('same user ID in a different tenant cannot receive a stale toast, and token refresh in the same account keeps deduplication', () => {
  render(<SocketProvider />)
  emit(hint('one'))
  localStorage.setItem('token', 'rotated-token')
  emit(hint('one')); emit(hint('two'))
  expect(toast.custom).toHaveBeenCalledTimes(2)
  account('user-one', 'tenant-two')
  emit(hint('private-old-tenant'))
  expect(toast.custom).toHaveBeenCalledTimes(2)
  expect(markClientDataChanged).toHaveBeenCalledTimes(4)
})

test('failed toast rendering and signed-out callbacks do not mark new IDs as shown', () => {
  render(<SocketProvider />)
  toast.custom.mockImplementationOnce(() => { throw new Error('Temporary toast failure') })
  emit(hint('one')); emit(hint('one'))
  expect(toast.custom).toHaveBeenCalledTimes(2)
  localStorage.removeItem('token')
  emit(hint('two'))
  expect(toast.custom).toHaveBeenCalledTimes(2)
  expect(markClientDataChanged).toHaveBeenCalledTimes(3)
})
