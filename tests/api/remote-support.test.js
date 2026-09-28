jest.mock('next/server', () => ({ NextResponse: { json: (body, init) => new Response(JSON.stringify(body), init) } }))
jest.mock('@/lib/auth', () => ({ getAuthAndModels: jest.fn() }))
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

import { getAuthAndModels } from '@/lib/auth'
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
let models

function query(value) {
  const chain = {
    select: jest.fn(() => chain),
    lean: jest.fn().mockResolvedValue(value),
  }
  return chain
}

beforeEach(() => {
  jest.clearAllMocks()
  actor = { _id: ids.admin, role: 'admin', employeeId: null }
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
    toObject() { return { ...this } },
  }
  models = {
    RemoteSupportSession: {
      create: jest.fn(async value => { Object.assign(stored, value); return stored }),
      findOne: jest.fn(() => query(null)),
      findById: jest.fn(() => ({ lean: jest.fn().mockResolvedValue(stored) })),
      findOneAndUpdate: jest.fn((filter, update) => {
        if (update.$set?.status) stored.status = update.$set.status
        if (update.$set?.expiresAt) stored.expiresAt = update.$set.expiresAt
        if (update.$set?.endedAt) stored.endedAt = update.$set.endedAt
        return query(stored)
      }),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    },
    Employee: {
      findOne: jest.fn(() => query({ _id: ids.employee, firstName: 'Alex', lastName: 'Employee' })),
      findById: jest.fn(() => query(null)),
    },
    User: { findOne: jest.fn(() => query({ _id: ids.employeeUser })) },
  }
  getAuthAndModels.mockResolvedValue({ success: true, user: actor, tenant: { databaseName: 'tenant_test' }, models })
})

test('only tenant administrators can request a session', async () => {
  actor.role = 'employee'
  const response = await createSession(new Request('https://talio.test/api/remote-support/sessions', {
    method: 'POST', body: JSON.stringify({ employeeId: ids.employee, reason: 'Please help with setup' }),
  }))
  expect(response.status).toBe(403)
  expect(models.RemoteSupportSession.create).not.toHaveBeenCalled()
})

test('creates a tenant-scoped pending request without issuing a screen token', async () => {
  const response = await createSession(new Request('https://talio.test/api/remote-support/sessions', {
    method: 'POST', body: JSON.stringify({ employeeId: ids.employee, reason: 'Please help with setup' }),
  }))
  expect(response.status).toBe(201)
  expect(models.RemoteSupportSession.create).toHaveBeenCalledWith(expect.objectContaining({
    targetUser: ids.employeeUser,
    targetEmployee: ids.employee,
    requestedByUser: ids.admin,
    status: 'pending',
    roomId: expect.stringMatching(/^support_[a-f\d]+$/),
  }))
  expect((await response.json()).session.status).toBe('pending')
})

test('prevents duplicate pending or active sessions for the same employee', async () => {
  models.RemoteSupportSession.findOne.mockReturnValue(query({ _id: 'active-session' }))
  const response = await createSession(new Request('https://talio.test/api/remote-support/sessions', {
    method: 'POST', body: JSON.stringify({ employeeId: ids.employee, reason: 'Please help with setup' }),
  }))
  expect(response.status).toBe(409)
  expect(models.RemoteSupportSession.create).not.toHaveBeenCalled()
})

test('only the employee can approve a pending remote session', async () => {
  const context = { params: Promise.resolve({ id: ids.session }) }
  const request = new Request(`https://talio.test/api/remote-support/sessions/${ids.session}`, {
    method: 'PATCH', body: JSON.stringify({ action: 'approve' }),
  })
  const denied = await updateSession(request, context)
  expect(denied.status).toBe(403)
  expect(models.RemoteSupportSession.findOneAndUpdate).not.toHaveBeenCalled()

  actor = { _id: ids.employeeUser, role: 'employee' }
  getAuthAndModels.mockResolvedValue({ success: true, user: actor, tenant: { databaseName: 'tenant_test' }, models })
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
  const context = { params: Promise.resolve({ id: ids.session }) }
  const response = await sendCommand(new Request(`https://talio.test/api/remote-support/sessions/${ids.session}/commands`, {
    method: 'POST', body: JSON.stringify({ text: 'Open the calculator app' }),
  }), context)
  expect(response.status).toBe(201)
  expect((await response.json()).command.text).toBe('Open the calculator app')

  stored.status = 'pending'
  const denied = await sendCommand(new Request(`https://talio.test/api/remote-support/sessions/${ids.session}/commands`, {
    method: 'POST', body: JSON.stringify({ text: 'Open the calculator app' }),
  }), context)
  expect(denied.status).toBe(409)
})

test('only the employee device may pull commands from an active tenant session', async () => {
  stored.status = 'approved'
  stored.expiresAt = new Date(Date.now() + 60_000)
  stored.commands = [{ id: 'command-1', text: 'Open Calculator', status: 'pending', createdAt: new Date() }]
  const context = { params: Promise.resolve({ id: ids.session }) }
  const denied = await receiveCommands(new Request(`https://talio.test/api/remote-support/sessions/${ids.session}/commands`), context)
  expect(denied.status).toBe(403)

  actor = { _id: ids.employeeUser, role: 'employee' }
  getAuthAndModels.mockResolvedValue({ success: true, user: actor, tenant: { databaseName: 'tenant_test' }, models })
  const delivered = await receiveCommands(new Request(`https://talio.test/api/remote-support/sessions/${ids.session}/commands`), context)
  expect(delivered.status).toBe(200)
  expect((await delivered.json()).commands).toEqual([expect.objectContaining({ id: 'command-1', text: 'Open Calculator' })])
})

test('issues a screen-only publishing token to the approved employee, and a receive-only token to the admin', async () => {
  stored.status = 'approved'
  stored.expiresAt = new Date(Date.now() + 60_000)
  const context = { params: Promise.resolve({ id: ids.session }) }
  const request = () => new Request(`https://talio.test/api/remote-support/sessions/${ids.session}/token`, { method: 'POST', body: '{}' })

  actor = { _id: ids.employeeUser, role: 'employee', employeeId: ids.employee }
  getAuthAndModels.mockResolvedValue({ success: true, user: actor, tenant: { databaseName: 'tenant_test' }, models })
  const employeeToken = await issueToken(request(), context)
  expect(employeeToken.status).toBe(200)
  expect(createLiveKitParticipantToken).toHaveBeenLastCalledWith(expect.objectContaining({
    canPublish: true,
    canPublishSources: [3, 4],
    canPublishData: false,
  }))

  actor = { _id: ids.admin, role: 'admin' }
  getAuthAndModels.mockResolvedValue({ success: true, user: actor, tenant: { databaseName: 'tenant_test' }, models })
  const adminToken = await issueToken(request(), context)
  expect(adminToken.status).toBe(200)
  expect(createLiveKitParticipantToken).toHaveBeenLastCalledWith(expect.objectContaining({
    canPublish: false,
    canPublishSources: [],
    canPublishData: false,
  }))
})
