jest.mock('next/server', () => ({ NextResponse: { json: (body, init) => new Response(JSON.stringify(body), init) } }))
jest.mock('@/lib/auth', () => ({ getAuthAndDatabase: jest.fn() }))
jest.mock('@/lib/meetings/livekit.server', () => ({
  createLiveKitParticipantToken: jest.fn().mockResolvedValue({ token: 'signed-token', roomName: 'tenant-room', serverUrl: 'wss://livekit.test' }),
  getLiveKitConfig: jest.fn(() => ({ configured: true })),
}))
jest.mock('@/lib/remoteSupport.server', () => ({
  isRemoteSupportAdministrator: jest.fn(user => ['admin', 'super_admin'].includes(user?.role)),
  publishRemoteSupportEvent: jest.fn().mockResolvedValue(true),
  remoteSupportEmployeeId: jest.fn(user => String(user?.employeeId || '')),
  remoteSupportPublicSession: jest.fn(session => ({ id: String(session._id), status: session.status, targetName: session.targetName })),
  remoteSupportUserId: jest.fn(user => String(user?._id || '')),
  REMOTE_SUPPORT_REQUEST_MINUTES: 2,
  REMOTE_SUPPORT_MAX_MINUTES: 30,
  closeRemoteSupportRoom: jest.fn().mockResolvedValue(true),
}))

import { getAuthAndDatabase } from '@/lib/auth'
import { workflowStore } from '../helpers/firestoreWorkflowStore'
import { POST as createSession } from '@/app/api/remote-support/sessions/route'
import { PATCH as updateSession } from '@/app/api/remote-support/sessions/[id]/route'
import { GET as receiveCommands, POST as sendCommand } from '@/app/api/remote-support/sessions/[id]/commands/route'
import { POST as issueToken } from '@/app/api/remote-support/sessions/[id]/token/route'
import { createLiveKitParticipantToken } from '@/lib/meetings/livekit.server'

const ids = {
  admin: '76c000000000000000000001',
  employeeUser: '76c000000000000000000002',
  employee: '66c000000000000000000010',
  session: '86c000000000000000000001',
}

let actor
let stored
let database
const authenticate = () => getAuthAndDatabase.mockResolvedValue({ success: true, user: actor, tenant: { databaseName: 'tenant_test' }, database })
const seedSession = () => database.create('remotesupportsessions', stored)

beforeEach(() => {
  jest.clearAllMocks()
  actor = { _id: ids.admin, role: 'admin', employeeId: null, isActive: true }
  stored = {
    _id: ids.session,
    targetUser: ids.employeeUser,
    targetEmployee: ids.employee,
    targetName: 'Alex Employee',
    requestedByUser: ids.admin,
    requestedByName: 'Org Admin',
    reason: 'Help set up the desktop client',
    roomId: 'support_abcd1234',
    status: 'pending',
    requestedAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
    audit: [],
    commands: [],
  }
  database = workflowStore({
    users: [actor, { _id: ids.employeeUser, role: 'employee', employeeId: ids.employee, isActive: true }],
    employees: [{ _id: ids.employee, firstName: 'Alex', lastName: 'Employee', status: 'active' }],
  })
  authenticate()
})

test('only tenant administrators can request a session', async () => {
  actor.role = 'employee'
  const response = await createSession(new Request('https://talio.test/api/remote-support/sessions', {
    method: 'POST', body: JSON.stringify({ employeeId: ids.employee, reason: 'Please help with setup' }),
  }))
  expect(response.status).toBe(403)
  expect(await database.count('remotesupportsessions')).toBe(0)
})

test('creates a tenant-scoped pending request without issuing a screen token', async () => {
  const response = await createSession(new Request('https://talio.test/api/remote-support/sessions', {
    method: 'POST', body: JSON.stringify({ employeeId: ids.employee, reason: 'Please help with setup' }),
  }))
  expect(response.status).toBe(201)
  expect((await database.list('remotesupportsessions')).records).toEqual([expect.objectContaining({
    targetUser: ids.employeeUser,
    targetEmployee: ids.employee,
    requestedByUser: ids.admin,
    status: 'pending',
    roomId: expect.stringMatching(/^support_[a-f\d]+$/),
  })])
  expect((await response.json()).session.status).toBe('pending')
  expect(createLiveKitParticipantToken).not.toHaveBeenCalled()
})

test('prevents duplicate pending or active sessions for the same employee', async () => {
  await seedSession()
  const response = await createSession(new Request('https://talio.test/api/remote-support/sessions', {
    method: 'POST', body: JSON.stringify({ employeeId: ids.employee, reason: 'Please help with setup' }),
  }))
  expect(response.status).toBe(409)
  expect(await database.count('remotesupportsessions')).toBe(1)
})

test('only the employee can approve a pending remote session', async () => {
  await seedSession()
  const context = { params: Promise.resolve({ id: ids.session }) }
  const request = new Request(`https://talio.test/api/remote-support/sessions/${ids.session}`, {
    method: 'PATCH', body: JSON.stringify({ action: 'approve' }),
  })
  const denied = await updateSession(request, context)
  expect(denied.status).toBe(403)
  expect((await database.get('remotesupportsessions', ids.session)).status).toBe('pending')

  actor = { _id: ids.employeeUser, role: 'employee' }
  authenticate()
  const employeeRequest = new Request(`https://talio.test/api/remote-support/sessions/${ids.session}`, {
    method: 'PATCH', body: JSON.stringify({ action: 'approve' }),
  })
  const approved = await updateSession(employeeRequest, context)
  expect(approved.status).toBe(200)
  expect((await approved.json()).session.status).toBe('approved')
})

test('an administrator can relay a bounded command only after employee approval', async () => {
  stored.status = 'approved'
  stored.expiresAt = new Date(Date.now() + 60_000)
  await seedSession()
  const context = { params: Promise.resolve({ id: ids.session }) }
  const response = await sendCommand(new Request(`https://talio.test/api/remote-support/sessions/${ids.session}/commands`, {
    method: 'POST', body: JSON.stringify({ text: 'Open the calculator app' }),
  }), context)
  expect(response.status).toBe(201)
  expect((await response.json()).command.text).toBe('Open the calculator app')

  await database.mutate('remotesupportsessions', ids.session, session => ({ ...session, status: 'pending' }))
  const denied = await sendCommand(new Request(`https://talio.test/api/remote-support/sessions/${ids.session}/commands`, {
    method: 'POST', body: JSON.stringify({ text: 'Open the calculator app' }),
  }), context)
  expect(denied.status).toBe(409)
})

test('only the employee device may pull commands from an active tenant session', async () => {
  stored.status = 'approved'
  stored.expiresAt = new Date(Date.now() + 60_000)
  stored.commands = [{ id: 'command-1', text: 'Open Calculator', status: 'pending', createdAt: new Date() }]
  await seedSession()
  const context = { params: Promise.resolve({ id: ids.session }) }
  const denied = await receiveCommands(new Request(`https://talio.test/api/remote-support/sessions/${ids.session}/commands`), context)
  expect(denied.status).toBe(403)

  actor = { _id: ids.employeeUser, role: 'employee' }
  authenticate()
  const delivered = await receiveCommands(new Request(`https://talio.test/api/remote-support/sessions/${ids.session}/commands`), context)
  expect(delivered.status).toBe(200)
  expect((await delivered.json()).commands).toEqual([expect.objectContaining({ id: 'command-1', text: 'Open Calculator' })])
})

test('issues a screen-only publishing token to the approved employee, and a receive-only token to the admin', async () => {
  stored.status = 'approved'
  stored.expiresAt = new Date(Date.now() + 60_000)
  await seedSession()
  const context = { params: Promise.resolve({ id: ids.session }) }
  const request = () => new Request(`https://talio.test/api/remote-support/sessions/${ids.session}/token`, { method: 'POST', body: '{}' })

  actor = { _id: ids.employeeUser, role: 'employee', employeeId: ids.employee }
  authenticate()
  const employeeToken = await issueToken(request(), context)
  expect(employeeToken.status).toBe(200)
  expect(createLiveKitParticipantToken).toHaveBeenLastCalledWith(expect.objectContaining({
    canPublish: true,
    canPublishSources: [3, 4],
    canPublishData: false,
  }))

  actor = { _id: ids.admin, role: 'admin' }
  authenticate()
  const adminToken = await issueToken(request(), context)
  expect(adminToken.status).toBe(200)
  expect(createLiveKitParticipantToken).toHaveBeenLastCalledWith(expect.objectContaining({
    canPublish: false,
    canPublishSources: [],
    canPublishData: false,
  }))
})
