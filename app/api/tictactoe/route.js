import { NextResponse } from 'next/server'
import { getAuthAndModels } from '@/lib/auth'
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

        console.log(`[Move] gameId=${gameId}, cell=${payload.index}, symbol=${payload.symbol}, winner=${result ? JSON.stringify(result) : 'none'}`)
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
      return NextResponse.json({ success: true })
    }

    console.log(`[TicTacToe] ✅ ${action} completed: gameId=${gameId} host=${senderId} guest=${targetUserId}`)

    return NextResponse.json({ success: true, game: game?.toObject?.() || game || null })
  } catch (error) {
    console.error('[TicTacToe API] Error:', error)
    return NextResponse.json({ success: false, message: 'Server error' }, { status: 500 })
  }
}
