import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
import { REALTIME_EVENTS } from '@/lib/realtimeEvents'
import { sendPushToUser } from '@/lib/pushNotification'

// ─── Win detection (server-side) ───
const WIN_LINES = [
  [0,1,2],[3,4,5],[6,7,8],
  [0,3,6],[1,4,7],[2,5,8],
  [0,4,8],[2,4,6],
]
function checkWinner(board) {
  for (const [a,b,c] of WIN_LINES) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return { winner: board[a], line: [a,b,c] }
  }
  return board.every(c => c) ? { winner: 'draw', line: null } : null
}

/**
 * GET /api/tictactoe?check=pending  — Check for pending invites for current user
 * GET /api/tictactoe?gameId=xxx     — Poll game state
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

    const validActions = ['invite', 'accept', 'decline', 'move', 'end']
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

      // Send push notification
      sendPushToUser(targetUserId, {
        title: '🎮 Game Invite!',
        body: `${senderName} wants to play Tic-Tac-Toe with you!`,
      }, {
        url: '/dashboard',
        type: 'system',
        models: { User, Notification },
      }).catch(err => console.warn('[TicTacToe API] Push notification error:', err))
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
      game = await TicTacToeGame.findOne({ gameId, status: 'playing' })
      if (game) {
        const board = [...game.board]
        board[payload.index] = payload.symbol
        const result = checkWinner(board)
        game.board = board
        game.currentTurn = payload.symbol === 'X' ? 'O' : 'X'
        game.lastMoveAt = new Date()
        if (result) {
          game.result = result
          game.status = 'ended'
        }
        await game.save()
      }
    }

    if (action === 'end') {
      game = await TicTacToeGame.findOneAndUpdate(
        { gameId },
        { status: 'ended', result: payload.result || null },
        { new: true }
      )
    }

    // ── Socket.IO: emit if available (fast path) ──
    const io = global.io
    if (io) {
      const eventMap = {
        invite: REALTIME_EVENTS.TICTACTOE_INVITE,
        accept: REALTIME_EVENTS.TICTACTOE_ACCEPT,
        decline: REALTIME_EVENTS.TICTACTOE_DECLINE,
        move: REALTIME_EVENTS.TICTACTOE_MOVE,
        end: REALTIME_EVENTS.TICTACTOE_END,
      }
      const eventData = {
        ...payload,
        fromUserId: senderId,
        fromName: senderName,
        fromAvatar: senderAvatar,
        targetUserId,
        timestamp: new Date().toISOString(),
      }
      io.to(`user:${targetUserId}`).emit(eventMap[action], eventData)
      if (['accept', 'move', 'end'].includes(action)) {
        io.to(`user:${senderId}`).emit(eventMap[action], eventData)
      }
    }

    console.log(`[TicTacToe API] ${action} from ${senderId} to ${targetUserId} (io=${!!io})`)

    return NextResponse.json({ success: true, game: game?.toObject?.() || game || null })
  } catch (error) {
    console.error('[TicTacToe API] Error:', error)
    return NextResponse.json({ success: false, message: 'Server error' }, { status: 500 })
  }
}
