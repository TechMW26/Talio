import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { REALTIME_EVENTS } from '@/lib/realtimeEvents'
import { sendPushToUser } from '@/lib/pushNotification'

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
 * ⚠️  ON-DEMAND ONLY — NEVER call these endpoints on an interval/timer.
 * All real-time game updates are pushed via Socket.IO events.
 *
 * Acceptable use cases:
 *   1. ?check=history  — Load game history on widget mount (one-time)
 *   2. ?check=pending  — Check for pending invite on initial page load only
 *   3. ?gameId=xxx     — Catch-up sync after reconnection or foreground resume
 *
 * These must NEVER be called via setInterval or any polling mechanism.
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
 * POST /api/tictactoe — DB-first game actions. Socket.IO used when available.
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
    }

    if (action === 'accept') {
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
    }

    if (action === 'decline') {
      game = await TicTacToeGame.findOneAndUpdate(
        { gameId, status: 'pending' },
        { status: 'declined' },
        { new: true }
      )
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

        // If game ended via this move, also emit END event so opponent gets the result
        if (result && global.io) {
          const endData = {
            gameId,
            result,
            board,
            currentTurn: null,
            status: 'ended',
            lastMoveAt: game.lastMoveAt?.toISOString() || new Date().toISOString(),
            fromUserId: senderId,
            fromName: senderName,
            fromAvatar: senderAvatar,
            targetUserId,
            hostUserId: game.hostUserId,
            hostName: game.hostName,
            hostAvatar: game.hostAvatar,
            guestUserId: game.guestUserId,
            guestName: game.guestName,
            guestAvatar: game.guestAvatar,
            hostSymbol: game.hostSymbol || 'X',
            timestamp: new Date().toISOString(),
          }
          global.io.to(`user:${targetUserId}`).emit(REALTIME_EVENTS.TICTACTOE_END, endData)
          global.io.to(`user:${senderId}`).emit(REALTIME_EVENTS.TICTACTOE_END, endData)
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
      // Emit close event to the other user
      if (global.io) {
        global.io.to(`user:${targetUserId}`).emit(REALTIME_EVENTS.TICTACTOE_CLOSE, {
          gameId,
          fromUserId: senderId,
          fromName: senderName,
          timestamp: new Date().toISOString(),
        })
      }
      return NextResponse.json({ success: true })
    }

    // ── Socket.IO: emit self-contained event with full game state ──
    // Every event payload includes the complete game state so clients
    // never need a follow-up GET request after receiving an event.
    const io = global.io

    // ── Delivery diagnostics ──
    console.log(`[TicTacToe] Socket.IO delivery: io=${!!io} action=${action}`)
    if (io) {
      const targetRoom = io.sockets.adapter.rooms.get(`user:${targetUserId}`)
      const targetRoomSize = targetRoom ? targetRoom.size : 0
      console.log(`[TicTacToe] Socket.IO emit: room=user:${targetUserId} connected=${targetRoomSize > 0} roomSize=${targetRoomSize}`)
      if (targetRoomSize === 0) {
        console.warn(`[TicTacToe] ⚠️ Guest room user:${targetUserId} is EMPTY — Socket.IO event will not be received`)
      }
    } else {
      console.error(`[TicTacToe] ❌ global.io is NULL — Socket.IO emission skipped entirely. Events cannot be delivered in real-time.`)
    }

    if (io) {
      const eventMap = {
        invite: REALTIME_EVENTS.TICTACTOE_INVITE,
        accept: REALTIME_EVENTS.TICTACTOE_ACCEPT,
        decline: REALTIME_EVENTS.TICTACTOE_DECLINE,
        move: REALTIME_EVENTS.TICTACTOE_MOVE,
        end: REALTIME_EVENTS.TICTACTOE_END,
      }

      // Build a rich payload that includes everything the client needs
      const gameObj = game?.toObject?.() || game || {}
      const eventData = {
        // Action-specific fields from the original request
        ...payload,
        // Identity fields
        fromUserId: senderId,
        fromName: senderName,
        fromAvatar: senderAvatar,
        targetUserId,
        timestamp: new Date().toISOString(),
        // Full self-contained game state — clients never need a follow-up GET
        gameId: gameObj.gameId || gameId,
        board: gameObj.board || null,
        currentTurn: gameObj.currentTurn || null,
        status: gameObj.status || null,
        result: gameObj.result || null,
        lastMoveAt: gameObj.lastMoveAt || null,
        hostUserId: gameObj.hostUserId || senderId,
        hostName: gameObj.hostName || senderName,
        hostAvatar: gameObj.hostAvatar || senderAvatar,
        guestUserId: gameObj.guestUserId || targetUserId,
        guestName: gameObj.guestName || null,
        guestAvatar: gameObj.guestAvatar || null,
        hostSymbol: gameObj.hostSymbol || 'X',
      }

      io.to(`user:${targetUserId}`).emit(eventMap[action], eventData)
      if (['accept', 'move', 'end'].includes(action)) {
        io.to(`user:${senderId}`).emit(eventMap[action], eventData)
      }
    }

    console.log(`[TicTacToe] ✅ ${action} completed: gameId=${gameId} host=${senderId} guest=${targetUserId} io=${!!io}`)

    return NextResponse.json({ success: true, game: game?.toObject?.() || game || null })
  } catch (error) {
    console.error('[TicTacToe API] Error:', error)
    return NextResponse.json({ success: false, message: 'Server error' }, { status: 500 })
  }
}
