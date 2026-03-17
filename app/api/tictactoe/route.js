import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { sendPushToUser } from '@/lib/pushNotification'

// ─── Socket.IO emit helper ───
function emitToUser(userId, event, payload) {
  const io = global.io
  if (!io) {
    console.error(`[TicTacToe:Emit] ❌ global.io is NULL — cannot emit ${event} to user ${userId}`);
    return
  }
  const room = `user:${userId}`
  const roomSize = io.sockets?.adapter?.rooms?.get(room)?.size ?? 0;
  console.log(`[TicTacToe:Emit] Emitting ${event} to room "${room}" (size: ${roomSize})`);
  if (roomSize === 0) {
    console.warn(`[TicTacToe:Emit] ⚠️ Room "${room}" has 0 connected sockets — event will be lost!`);
  }
  io.to(room).emit(event, payload)
}

// ─── Win detection (server-side) ───
const WIN_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
]
function checkWinner(board) {
  for (const [a, b, c] of WIN_LINES) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return { winner: board[a], line: [a, b, c] }
  }
  return board.every(c => c) ? { winner: 'draw', line: null } : null
}

/**
 * GET /api/tictactoe
 *
 * Smart-polling compatible — clients poll during active game phases only.
 *
 * Endpoints:
 *   1. ?check=history  — Load game history on widget mount (one-time)
 *   2. ?check=pending  — Check for pending invites (polled every ~5s when idle)
 *   3. ?gameId=xxx     — Poll game state (every ~1.5s during active game)
 */
export async function GET(request) {
  try {
    const auth = await getAuthAndModels(request, ['TicTacToeGame'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }

    const { TicTacToeGame } = auth.models
    const userId = (auth.user._id || auth.user.id || auth.user.userId).toString()
    const { searchParams } = new URL(request.url)
    const check = searchParams.get('check')
    const gameId = searchParams.get('gameId')

    // Check for pending invites
    if (check === 'pending') {
      const pending = await TicTacToeGame.findOne({
        guestUserId: userId,
        status: 'pending',
      }).sort({ createdAt: -1 }).lean()

      return NextResponse.json({ success: true, invite: pending || null })
    }

    // Game history — last 10 finished games for this user
    if (check === 'history') {
      const games = await TicTacToeGame.find({
        $or: [{ hostUserId: userId }, { guestUserId: userId }],
        status: 'ended',
        result: { $ne: null },
      })
        .sort({ updatedAt: -1 })
        .limit(10)
        .select('hostUserId guestUserId hostName guestName hostSymbol result updatedAt')
        .lean()

      const history = games.map(g => {
        const isHost = g.hostUserId === userId
        const opponentName = isHost ? g.guestName : g.hostName
        const mySymbol = isHost ? (g.hostSymbol || 'X') : (g.hostSymbol === 'X' ? 'O' : 'X')
        let outcome = 'draw'
        if (g.result?.winner && g.result.winner !== 'draw') {
          outcome = g.result.winner === mySymbol ? 'win' : 'loss'
        }
        return { opponentName, outcome, date: g.updatedAt }
      })

      return NextResponse.json({ success: true, history })
    }

    // Poll game state
    if (gameId) {
      const game = await TicTacToeGame.findOne({ gameId }).lean()
      if (!game) return NextResponse.json({ success: false, message: 'Game not found' }, { status: 404 })
      return NextResponse.json({ success: true, game })
    }

    return NextResponse.json({ success: false, message: 'Missing check or gameId param' }, { status: 400 })
  } catch (error) {
    console.error('[TicTacToe API] GET Error:', error)
    return NextResponse.json({ success: false, message: 'Server error' }, { status: 500 })
  }
}

/**
 * POST /api/tictactoe — DB-first game actions. Clients poll for state changes.
 * Body: { action, targetUserId, ...payload }
 * Actions: invite | accept | decline | move | end
 */
export async function POST(request) {
  try {
    const auth = await getAuthAndModels(request, ['Employee', 'User', 'Notification', 'TicTacToeGame'])
    if (!auth.success) {
      return NextResponse.json({ success: false, message: auth.message }, { status: 401 })
    }

    const body = await request.json()
    const { action, targetUserId, ...payload } = body

    if (!action) {
      return NextResponse.json({ success: false, message: 'action is required' }, { status: 400 })
    }
    if (!targetUserId) {
      return NextResponse.json({ success: false, message: 'targetUserId is required' }, { status: 400 })
    }

    const validActions = ['invite', 'accept', 'decline', 'move', 'end', 'close']
    if (!validActions.includes(action)) {
      return NextResponse.json({ success: false, message: 'Invalid action' }, { status: 400 })
    }

    const senderId = (auth.user._id || auth.user.id || auth.user.userId).toString()
    const { Employee, User, Notification, TicTacToeGame } = auth.models

    // Get sender info
    let senderName = 'Someone'
    let senderAvatar = null
    if (auth.user.employeeId) {
      const senderEmployee = await Employee.findById(auth.user.employeeId).select('firstName lastName avatar').lean()
      if (senderEmployee) {
        senderName = `${senderEmployee.firstName} ${senderEmployee.lastName}`.trim()
        senderAvatar = senderEmployee.avatar || null
      }
    }
    if (senderName === 'Someone') {
      const senderUser = await User.findById(senderId).select('name email').lean()
      if (senderUser) senderName = senderUser.name || senderUser.email || 'Someone'
    }

    // ── DB-first: persist game state ──
    let game
    const gameId = payload.gameId

    if (action === 'invite') {
      // Cancel any existing pending invites from this user
      await TicTacToeGame.updateMany(
        { hostUserId: senderId, status: 'pending' },
        { status: 'ended' }
      )
      // Create new game
      game = await TicTacToeGame.create({
        gameId,
        hostUserId: senderId,
        guestUserId: targetUserId,
        hostName: senderName,
        hostAvatar: senderAvatar,
        status: 'pending',
        board: Array(9).fill(null),
        currentTurn: 'X',
        hostSymbol: 'X',
      })

      console.log(`[TicTacToe] Invite created: gameId=${gameId} host=${senderId} guest=${targetUserId}`)

      // ── Phase 1 Diagnostic: Invite room check ──
      console.log('\n=== TICTACTOE:INVITE ===');
      console.log('Host userId:', senderId);
      console.log('Guest userId:', targetUserId);
      const guestInviteRoom = `user:${targetUserId}`;
      const guestInviteRoomSize = global.io?.sockets?.adapter?.rooms?.get(guestInviteRoom)?.size ?? 0;
      console.log(`Guest room "${guestInviteRoom}" connected clients:`, guestInviteRoomSize);
      console.log('global.io available:', !!global.io);
      console.log('All current rooms:', [...(global.io?.sockets?.adapter?.rooms?.keys() ?? [])]);

      // ── Delivery: Push notification ──
      // Await so we can log the result; do NOT let failures block the response
      try {
        // Check if guest has FCM tokens before attempting push
        const guestUser = await User.findById(targetUserId).select('fcmTokens email').lean()
        const tokenCount = guestUser?.fcmTokens?.length ?? 0
        console.log(`[TicTacToe] Push target: userId=${targetUserId} email=${guestUser?.email ?? 'NOT_FOUND'} fcmTokens=${tokenCount}`)

        if (tokenCount === 0) {
          console.warn(`[TicTacToe] ⚠️ Guest ${targetUserId} has 0 FCM tokens — push delivery impossible`)
        }

        const pushResult = await sendPushToUser(targetUserId, {
          title: `🎮 ${senderName} challenged you!`,
          body: `Tap to accept and play Tic-Tac-Toe now`,
        }, {
          data: {
            type: 'tictactoe_invite',
            gameId,
            hostUserId: senderId,
            hostName: senderName,
            hostAvatar: senderAvatar,
          },
          url: '/dashboard',
          type: 'tictactoe_invite',
          models: { User, Notification },
        })
        console.log(`[TicTacToe] Push result: success=${pushResult?.success} sent=${pushResult?.successCount ?? 0} failed=${pushResult?.failureCount ?? 0}`)
      } catch (pushErr) {
        console.error('[TicTacToe] Push notification error:', pushErr)
      }

      // Real-time: notify guest via Socket.IO
      emitToUser(targetUserId, 'tictactoe:invite', {
        gameId,
        hostUserId: senderId,
        hostName: senderName,
        hostAvatar: senderAvatar,
        createdAt: game.createdAt,
      })
      console.log('Invite emit fired. Guest was in room:', guestInviteRoomSize > 0 ? 'YES' : 'NO — event dropped silently');
      console.log('=== END TICTACTOE:INVITE ===\n');
    }

    if (action === 'accept') {
      console.log('[TicTacToe:Accept] ──────────────────────────────────');
      console.log('[TicTacToe:Accept] Action triggered by senderId:', senderId);
      console.log('[TicTacToe:Accept] gameId received:', gameId);
      console.log('[TicTacToe:Accept] global.io available:', !!global.io);

      // Get guest name for the game record
      let guestName = senderName
      let guestAvatar = senderAvatar

      game = await TicTacToeGame.findOneAndUpdate(
        { gameId, status: { $in: ['pending', 'playing'] } },
        {
          status: 'playing',
          guestName,
          guestAvatar,
          lastMoveAt: new Date(),
        },
        { new: true }
      )

      if (!game) {
        console.error('[TicTacToe:Accept] ❌ Game NOT found in DB for gameId:', gameId);
      } else {
        console.log('[TicTacToe:Accept] ✅ DB updated — status now:', game.status);
        console.log('[TicTacToe:Accept] hostUserId:', game.hostUserId);
        console.log('[TicTacToe:Accept] guestUserId:', game.guestUserId);
        console.log('[TicTacToe:Accept] senderId (guest accepting):', senderId);
        console.log('[TicTacToe:Accept] guestName resolved:', guestName);
      }

      // Real-time: notify both players the game is starting
      if (game) {
        // ── Phase 1 Diagnostic: Accept room check ──
        console.log('\n=== TICTACTOE:ACCEPT ===');
        console.log('Guest accepting, userId:', senderId);
        console.log('gameId:', gameId);
        const hostAcceptRoom = `user:${game.hostUserId}`;
        const guestAcceptRoom = `user:${game.guestUserId}`;
        const hostRoomSize = global.io?.sockets?.adapter?.rooms?.get(hostAcceptRoom)?.size ?? 0;
        const guestRoomSize = global.io?.sockets?.adapter?.rooms?.get(guestAcceptRoom)?.size ?? 0;
        console.log(`Host room "${hostAcceptRoom}" size:`, hostRoomSize);
        console.log(`Guest room "${guestAcceptRoom}" size:`, guestRoomSize);
        console.log('All current rooms:', [...(global.io?.sockets?.adapter?.rooms?.keys() ?? [])]);

        const acceptPayload = {
          gameId,
          board: game.board,
          currentTurn: game.currentTurn,
          hostSymbol: game.hostSymbol || 'X',
          guestName,
          guestAvatar,
          status: 'playing',
        }
        console.log('[TicTacToe:Accept] acceptPayload keys:', Object.keys(acceptPayload));
        console.log('[TicTacToe:Accept] Emitting to host:', game.hostUserId);
        emitToUser(game.hostUserId, 'tictactoe:accept', acceptPayload)
        console.log('[TicTacToe:Accept] Emitting to guest (sender):', senderId);
        emitToUser(senderId, 'tictactoe:accept', acceptPayload)
        console.log('[TicTacToe:Accept] ✅ Socket.IO emit completed for both players');
        console.log('Accept emit fired. Host in room:', hostRoomSize > 0 ? 'YES' : 'NO — event dropped');
        console.log('Accept emit fired. Guest in room:', guestRoomSize > 0 ? 'YES' : 'NO — event dropped');
        console.log('=== END TICTACTOE:ACCEPT ===\n');
      }
      console.log('[TicTacToe:Accept] ──────────────────────────────────');
    }

    if (action === 'decline') {
      game = await TicTacToeGame.findOneAndUpdate(
        { gameId, status: 'pending' },
        { status: 'declined' },
        { new: true }
      )

      // Real-time: notify host their invite was declined
      if (game) {
        emitToUser(game.hostUserId, 'tictactoe:decline', { gameId })
      }
    }

    if (action === 'move') {
      // Match playing OR ended to handle race with concurrent 'end' call
      game = await TicTacToeGame.findOne({ gameId, status: { $in: ['playing', 'ended'] } })
      if (game) {
        const board = [...game.board]
        if (board[payload.index] == null) {
          board[payload.index] = payload.symbol
        }
        const result = checkWinner(board)
        game.board = board
        game.currentTurn = payload.symbol === 'X' ? 'O' : 'X'
        game.lastMoveAt = new Date()
        if (result) {
          game.result = result
          game.status = 'ended'
        }
        await game.save()

        console.log(`[Move] gameId=${gameId}, cell=${payload.index}, symbol=${payload.symbol}, winner=${result ? JSON.stringify(result) : 'none'}`)

        // Real-time: notify opponent of the move
        const opponentId = senderId === game.hostUserId ? game.guestUserId : game.hostUserId
        emitToUser(opponentId, 'tictactoe:move', {
          gameId,
          board: game.board,
          currentTurn: game.currentTurn,
          lastMove: payload.index,
          status: game.status,
          result: result || null,
          lastMoveAt: game.lastMoveAt,
        })

        // If game ended with this move, notify both players
        if (result) {
          const endPayload = { gameId, result }
          emitToUser(game.hostUserId, 'tictactoe:end', endPayload)
          emitToUser(game.guestUserId, 'tictactoe:end', endPayload)
        }
      }
    }

    if (action === 'end') {
      // Only update if not already ended by the move handler
      game = await TicTacToeGame.findOneAndUpdate(
        { gameId, status: { $ne: 'ended' } },
        { status: 'ended', result: payload.result || null },
        { new: true }
      )
      if (!game) {
        // Already ended by move handler — just fetch current state
        game = await TicTacToeGame.findOne({ gameId }).lean()
      }
    }

    if (action === 'close') {
      // Mark game as ended if still active
      game = await TicTacToeGame.findOneAndUpdate(
        { gameId, status: { $in: ['pending', 'playing'] } },
        { status: 'ended' },
        { new: true }
      )

      // Real-time: notify the opponent the game was closed
      if (game) {
        emitToUser(targetUserId, 'tictactoe:close', { gameId })
      }

      return NextResponse.json({ success: true })
    }

    console.log(`[TicTacToe] ✅ ${action} completed: gameId=${gameId} host=${senderId} guest=${targetUserId}`)

    return NextResponse.json({ success: true, game: game?.toObject?.() || game || null })
  } catch (error) {
    console.error('[TicTacToe API] Error:', error)
    return NextResponse.json({ success: false, message: 'Server error' }, { status: 500 })
  }
}
