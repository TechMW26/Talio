/** Real API -> native Firestore emulator -> in-process Socket.IO delivery. */
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { Server } from 'socket.io'
import { io as connect } from 'socket.io-client'
import { Firestore } from 'firebase-admin/firestore'
import { createFirestoreDatabase } from '@/lib/platform/firestoreStore.server'
import { GAME_DATABASE_OPTIONS, findNativeGame } from '@/lib/platform/firestoreTicTacToe.server'
import { POST } from '@/app/api/tictactoe/route'
import { getAuthAndDatabase } from '@/lib/auth'
import { emitRealtimeEvent } from '@/lib/realtimeEvents'
jest.mock('@/lib/auth', () => ({ getAuthAndDatabase: jest.fn() }))
jest.mock('@/lib/realtimeEvents', () => ({ emitRealtimeEvent: jest.fn() }))
jest.mock('@/lib/platform/firestoreApplication.server', () => ({ getFirestoreTenantDatabase: jest.fn() }))
jest.mock('@/lib/platform/firestoreBackgroundJobs.server', () => ({ enqueueBackgroundJob: jest.fn(async () => ({})) }))
jest.mock('next/server', () => ({ NextResponse: { json: (body, options = {}) => new Response(JSON.stringify(body), options) } }))
const emulator = process.env.TALIO_FIRESTORE_EMULATOR_TEST === '1' ? describe : describe.skip
jest.setTimeout(30000)
emulator('Tic-tac-toe native API and delivery', () => {
  let firestore, database, io, server, sockets, previousAcceptance
  const tenant = 'talio_company_game_e2e'
  const host = { _id: '111111111111111111111111', name: 'Host Player', isActive: true }
  const guest = { _id: '222222222222222222222222', name: 'Guest Player', isActive: true }
  const room = (databaseName, id) => databaseName + ':user:' + id
  const event = (socket, name) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(name, received); reject(new Error('Missing ' + name)) }, 5000)
    const received = value => { clearTimeout(timer); resolve(value) }
    socket.once(name, received)
  })
  const action = async (actor, name, extra = {}) => {
    getAuthAndDatabase.mockResolvedValue({ success: true, user: actor, database, tenant: { databaseName: tenant } })
    const response = await POST(new Request('http://localhost/api/tictactoe', { method: 'POST', body: JSON.stringify({ action: name, gameId: 'game', targetUserId: actor._id === host._id ? guest._id : host._id, ...extra }) }))
    const body = await response.json()
    expect(response.status).toBe(200)
    return body.game
  }
  beforeAll(async () => {
    if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185') throw new Error('Isolated emulator required')
    firestore = new Firestore({ projectId: 'demo-talio-firestore' })
    server = createServer(); io = new Server(server)
    io.on('connection', socket => { socket.join(room(socket.handshake.auth.tenant, socket.handshake.auth.userId)); socket.emit('ready') })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    previousAcceptance = process.env.TALIO_LOCAL_ACCEPTANCE
    delete process.env.TALIO_LOCAL_ACCEPTANCE
    emitRealtimeEvent.mockImplementation((name, payload, { userIds, databaseName }) => { for (const id of userIds) io.to(room(databaseName, id)).emit(name, payload) })
  })
  afterAll(async () => {
    await new Promise(resolve => io.close(resolve))
    await firestore.terminate()
    if (previousAcceptance === undefined) delete process.env.TALIO_LOCAL_ACCEPTANCE; else process.env.TALIO_LOCAL_ACCEPTANCE = previousAcceptance
  })
  beforeEach(async () => {
    database = createFirestoreDatabase({ firestore, dataset: 'test-game-e2e-' + randomBytes(8).toString('hex'), databaseName: tenant, ...GAME_DATABASE_OPTIONS })
    for (const user of [host, guest]) await database.create('users', user)
    sockets = await Promise.all([host, guest].map(user => new Promise(resolve => {
      const socket = connect('http://127.0.0.1:' + server.address().port, { transports: ['websocket'], forceNew: true, auth: { tenant, userId: user._id } })
      socket.once('ready', () => resolve(socket))
    })))
  })
  afterEach(() => sockets.forEach(socket => socket.disconnect()))
  const start = async () => {
    const invite = event(sockets[1], 'tictactoe:invite')
    await action(host, 'invite')
    expect(await invite).toMatchObject({ gameId: 'game', hostName: 'Host Player' })
    const accepted = sockets.map(socket => event(socket, 'tictactoe:accept'))
    await action(guest, 'accept')
    for (const result of await Promise.all(accepted)) expect(result.status).toBe('playing')
  }
  test.each([
    ['win', [0, 3, 1, 4, 2], 'X'],
    ['draw', [0, 1, 2, 4, 3, 5, 7, 6, 8], 'draw'],
  ])('invite -> accept -> moves -> %s persists and delivers', async (_name, moves, winner) => {
    await start()
    const ended = sockets.map(socket => event(socket, 'tictactoe:end'))
    for (let n = 0; n < moves.length; n++) {
      const received = event(sockets[n % 2 === 0 ? 1 : 0], 'tictactoe:move')
      await action(n % 2 === 0 ? host : guest, 'move', { index: moves[n] })
      expect((await received).lastMove).toBe(moves[n])
    }
    for (const result of await Promise.all(ended)) expect(result.result.winner).toBe(winner)
    expect(await findNativeGame(database, 'game')).toMatchObject({ status: 'ended', result: { winner } })
  })
  test('invited player can decline and host receives committed status', async () => {
    await action(host, 'invite')
    const declined = event(sockets[0], 'tictactoe:decline')
    await action(guest, 'decline')
    expect((await declined).status).toBe('declined')
    expect((await findNativeGame(database, 'game')).status).toBe('declined')
  })
  test.each([true, false])('host closes accepted=%s invitation', async accepted => {
    if (accepted) await start(); else await action(host, 'invite')
    const closed = event(sockets[1], 'tictactoe:close')
    await action(host, 'close')
    expect((await closed).status).toBe('ended')
    expect((await findNativeGame(database, 'game')).status).toBe('ended')
  })
})
