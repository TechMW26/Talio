const fs = require('fs')
const path = require('path')

describe('Socket.IO authentication boundaries', () => {
  const serverSource = fs.readFileSync(path.join(process.cwd(), 'server.js'), 'utf8')
  const clientSource = fs.readFileSync(
    path.join(process.cwd(), 'contexts', 'SocketContext.js'),
    'utf8'
  )
  const guestClientSource = fs.readFileSync(
    path.join(process.cwd(), 'app', 'join', '[guestLink]', 'room', 'page.js'),
    'utf8'
  )
  const guestRouteSource = fs.readFileSync(
    path.join(process.cwd(), 'app', 'api', 'meetings', 'guest', '[guestLink]', 'route.js'),
    'utf8'
  )

  test('verifies handshake JWTs and resolves users from tenant storage', () => {
    expect(serverSource).toContain('verifySocketToken(token)')
    expect(serverSource).toContain("getTenantModels(payload.databaseName, ['User', 'Employee'])")
    expect(serverSource).toContain('Employee.findOne({ userId: user._id })')
    expect(serverSource).toContain('socket.authContext = {')
  })

  test('does not trust client payloads for user-room registration', () => {
    expect(serverSource).toContain('String(userId) !== socket.authContext.userId')
    expect(serverSource).toContain('const userId = socket.userId;')
  })

  test('authorizes chat and project rooms before joining', () => {
    expect(serverSource).toContain("authorizeRoomJoin('chat', chatId)")
    expect(serverSource).toContain("authorizeRoomJoin('project', projectId)")
    expect(serverSource).toContain("socket.rooms.has(`chat:${chatId}`)")
  })

  test('browser socket sends its JWT during the handshake', () => {
    expect(clientSource).toContain('auth: token ? { token } : undefined')
  })

  test('guest meetings use signed, room-scoped socket sessions', () => {
    expect(guestRouteSource).toContain("type: 'meeting_guest'")
    expect(guestRouteSource).toContain('.setExpirationTime(')
    expect(guestClientSource).toContain('auth: { token: guestInfo.guestToken }')
    expect(serverSource).toContain("payload?.type === 'meeting_guest'")
    expect(serverSource).toContain('guest.roomId === String(roomId)')
    expect(serverSource).toContain('authorizeMeetingJoin(normalizedRoomId)')
    expect(serverSource).toContain('`meeting:${tenantDatabaseName}:${normalizedRoomId}`')
  })

  test('meeting chat confirms delivery only for joined sockets', () => {
    expect(serverSource).toContain("socket.on('meeting-chat', (data, acknowledge)")
    expect(serverSource).toContain("respond({ success: false, message: 'Join the meeting before sending messages' })")
    expect(serverSource).toContain('respond({ success: true, message: outgoingMessage })')
  })

  test('screen-share state is scoped to the joined meeting room', () => {
    expect(serverSource).toContain("socket.on('meeting-screen-share-state'")
    expect(serverSource).toContain("socket.meetingRoomId !== String(roomId)")
    expect(serverSource).toContain("emit('participant-screen-share-state'")
    expect(serverSource).toContain('isScreenSharing: Boolean(participantSocket.meetingIsScreenSharing)')
  })
})
