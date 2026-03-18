'use client'

import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { useSocket } from '@/contexts/SocketContext'
import { playGameInviteSound, playSuccessSound, playGameOverSound } from '@/utils/audio'
import confetti from 'canvas-confetti'
import {
  HiOutlineTrophy,
  HiOutlineXMark,
} from 'react-icons/hi2'

// ─── Win detection ───
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

// Normalize board from DB (may have empty strings, missing slots, etc.)
function normalizeBoard(raw) {
  if (!Array.isArray(raw) || raw.length !== 9) return Array(9).fill(null)
  return raw.map(c => (c === 'X' || c === 'O') ? c : null)
}

// Fire confetti burst for the winner
function fireCrackers() {
  const duration = 2500
  const end = Date.now() + duration
  const colors = ['#6366f1', '#a855f7', '#ec4899', '#f59e0b', '#10b981']

    ; (function frame() {
      confetti({
        particleCount: 4,
        angle: 60,
        spread: 70,
        origin: { x: 0, y: 0.7 },
        colors,
        zIndex: 2147483647,
      })
      confetti({
        particleCount: 4,
        angle: 120,
        spread: 70,
        origin: { x: 1, y: 0.7 },
        colors,
        zIndex: 2147483647,
      })
      if (Date.now() < end) requestAnimationFrame(frame)
    })()
}

const TicTacToeContext = createContext({
  openInvite: () => { },
  hasIncomingInvite: false,
})

export function TicTacToeProvider({ children }) {
  const { socket, isConnected } = useSocket()

  // Get currentUserId from token (JWT decode)
  const [currentUserId, setCurrentUserId] = useState(null)
  useEffect(() => {
    try {
      const token = localStorage.getItem('token')
      if (token) {
        const payload = JSON.parse(atob(token.split('.')[1]))
        setCurrentUserId(payload.userId || payload.id || payload._id || null)
      }
    } catch { /* ignore */ }
  }, [])

  // Game state
  const [phase, setPhase] = useState('closed') // closed | invite-incoming | waiting | playing | result
  const [opponent, setOpponent] = useState(null)
  const [board, setBoard] = useState(Array(9).fill(null))
  const [mySymbol, setMySymbol] = useState('X')
  const [isMyTurn, setIsMyTurn] = useState(false)
  const [result, setResult] = useState(null)
  const [gameId, setGameId] = useState(null)
  const [incomingInvite, setIncomingInvite] = useState(null)

  // Refs for accessing current state in callbacks without stale closures
  const phaseRef = useRef(phase)
  const gameIdRef = useRef(gameId)
  const mySymbolRef = useRef(mySymbol)
  const moveTimeoutRef = useRef(null)

  // Keep refs in sync
  useEffect(() => { phaseRef.current = phase }, [phase])
  useEffect(() => { gameIdRef.current = gameId }, [gameId])
  useEffect(() => { mySymbolRef.current = mySymbol }, [mySymbol])

  // API helper
  const sendAction = useCallback(async (action, targetUserId, extra = {}) => {
    try {
      const token = localStorage.getItem('token')
      const res = await fetch('/api/tictactoe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action, targetUserId, ...extra })
      })
      const data = await res.json()
      if (!res.ok) console.error('[TicTacToe] API error:', data.message)
      return data
    } catch (err) {
      console.error('[TicTacToe] Fetch error:', err)
    }
  }, [])

  // Called from the TicTacToeCard to invite a user
  const openInvite = useCallback((user) => {
    const gid = `ttt_${currentUserId}_${user._id}_${Date.now()}`
    setOpponent({ userId: user._id, name: user.name, avatar: user.avatar })
    setGameId(gid)
    setMySymbol('X')
    setIsMyTurn(true)
    setBoard(Array(9).fill(null))
    setResult(null)
    setPhase('waiting')
    sendAction('invite', user._id, { gameId: gid })
  }, [currentUserId, sendAction])

  // Accept incoming invite
  const acceptInvite = useCallback(() => {
    if (!incomingInvite) return
    const hostId = incomingInvite.fromUserId || incomingInvite.hostUserId
    const hostName = incomingInvite.fromName || incomingInvite.hostName
    const hostAvatar = incomingInvite.fromAvatar || incomingInvite.hostAvatar
    const gid = incomingInvite.gameId
    setOpponent({ userId: hostId, name: hostName, avatar: hostAvatar })
    setGameId(gid)
    setMySymbol('O')
    setIsMyTurn(false)
    setBoard(Array(9).fill(null))
    setResult(null)
    setPhase('playing')
    sendAction('accept', hostId, { gameId: gid })
    setIncomingInvite(null)
  }, [incomingInvite, sendAction])

  // Decline incoming invite
  const declineInvite = useCallback(() => {
    if (!incomingInvite) return
    const hostId = incomingInvite.fromUserId || incomingInvite.hostUserId
    const gid = incomingInvite.gameId
    sendAction('decline', hostId, { gameId: gid })
    setIncomingInvite(null)
    setPhase('closed')
  }, [incomingInvite, sendAction])

  // ─── One-time game state fetch (for reconnection / safety net) ───
  const fetchGameState = useCallback(async () => {
    const gid = gameIdRef.current
    if (!gid) return
    const token = localStorage.getItem('token')
    if (!token) return
    try {
      const res = await fetch(`/api/tictactoe?gameId=${encodeURIComponent(gid)}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      const data = await res.json()
      if (!data.success || !data.game) return
      const g = data.game

      setBoard(normalizeBoard(g.board))

      if (g.status === 'playing' && phaseRef.current === 'waiting') {
        setPhase('playing')
        setIsMyTurn(g.currentTurn === mySymbolRef.current)
        if (g.guestName) {
          setOpponent(prev => prev ? { ...prev, name: g.guestName || prev.name, avatar: g.guestAvatar ?? prev.avatar } : prev)
        }
      } else if (g.status === 'playing') {
        setIsMyTurn(g.currentTurn === mySymbolRef.current)
      }

      if (g.status === 'ended' && g.result) {
        setResult(g.result)
        setPhase('result')
      } else if (g.status === 'declined') {
        setPhase('closed')
        setOpponent(null)
        setGameId(null)
      } else if (g.status === 'ended' && !g.result) {
        setPhase('closed')
        setBoard(Array(9).fill(null))
        setResult(null)
        setOpponent(null)
        setGameId(null)
      }
    } catch (err) {
      console.warn('[TicTacToe] fetchGameState error:', err)
    }
  }, [])

  // Make a move - server handles win detection + end event
  const makeMove = useCallback((idx) => {
    if (!isMyTurn || board[idx] || result) return
    // Optimistic update - instant UI response
    const newBoard = [...board]
    newBoard[idx] = mySymbol
    setBoard(newBoard)
    setIsMyTurn(false)
    sendAction('move', opponent.userId, { gameId, index: idx, symbol: mySymbol })

    // Safety net: if Socket.IO event doesn't arrive in 4s, do one GET
    clearTimeout(moveTimeoutRef.current)
    moveTimeoutRef.current = setTimeout(() => {
      console.warn('[TicTacToe] Move ack timeout (4s) - running single sync GET')
      fetchGameState()
    }, 4000)

    // Client-side win detection for instant feedback on this side
    const res = checkWinner(newBoard)
    if (res) {
      setResult(res)
      setPhase('result')
      clearTimeout(moveTimeoutRef.current) // No ack needed on game-ending move
    }
  }, [isMyTurn, board, result, mySymbol, opponent, gameId, sendAction, fetchGameState])

  // Close / reset - also notifies the other player
  const closeGame = useCallback(() => {
    // If in an active game, notify the opponent
    if (opponent?.userId && gameId && (phase === 'waiting' || phase === 'playing' || phase === 'result')) {
      sendAction('close', opponent.userId, { gameId }).catch(() => { })
    }
    setPhase('closed')
    setBoard(Array(9).fill(null))
    setResult(null)
    setOpponent(null)
    setGameId(null)
    setIncomingInvite(null)
  }, [opponent, gameId, phase, sendAction])

  // ─── Socket.IO real-time event handlers ───
  useEffect(() => {
    if (!socket || !currentUserId) return

    const handleInvite = (data) => {
      if (phaseRef.current !== 'closed') return // ignore if already in a game
      setIncomingInvite({
        gameId: data.gameId,
        fromUserId: data.hostUserId,
        hostUserId: data.hostUserId,
        fromName: data.hostName,
        hostName: data.hostName,
        fromAvatar: data.hostAvatar,
        hostAvatar: data.hostAvatar,
      })
      setPhase('invite-incoming')
      playGameInviteSound().catch(() => { })
    }

    const handleAccept = (data) => {
      if (gameIdRef.current !== data.gameId) return
      setBoard(normalizeBoard(data.board))
      setPhase('playing')
      setIsMyTurn(data.currentTurn === mySymbolRef.current)
      if (data.guestName) {
        setOpponent(prev => prev ? { ...prev, name: data.guestName || prev.name, avatar: data.guestAvatar ?? prev.avatar } : prev)
      }
    }

    const handleDecline = (data) => {
      if (gameIdRef.current !== data.gameId) return
      setPhase('closed')
      setOpponent(null)
      setGameId(null)
    }

    const handleMove = (data) => {
      if (gameIdRef.current !== data.gameId) return
      clearTimeout(moveTimeoutRef.current) // cancel safety net
      setBoard(normalizeBoard(data.board))
      setIsMyTurn(data.currentTurn === mySymbolRef.current)
      if (data.result) {
        setResult(data.result)
        setPhase('result')
      }
    }

    const handleEnd = (data) => {
      if (gameIdRef.current !== data.gameId) return
      if (data.result) {
        setResult(data.result)
        setPhase('result')
      }
    }

    const handleClose = (data) => {
      if (gameIdRef.current !== data.gameId) return
      setPhase('closed')
      setBoard(Array(9).fill(null))
      setResult(null)
      setOpponent(null)
      setGameId(null)
    }

    socket.on('tictactoe:invite', handleInvite)
    socket.on('tictactoe:accept', handleAccept)
    socket.on('tictactoe:decline', handleDecline)
    socket.on('tictactoe:move', handleMove)
    socket.on('tictactoe:end', handleEnd)
    socket.on('tictactoe:close', handleClose)

    return () => {
      socket.off('tictactoe:invite', handleInvite)
      socket.off('tictactoe:accept', handleAccept)
      socket.off('tictactoe:decline', handleDecline)
      socket.off('tictactoe:move', handleMove)
      socket.off('tictactoe:end', handleEnd)
      socket.off('tictactoe:close', handleClose)
    }
  }, [socket, currentUserId])

  // ─── Catch-up on Socket.IO reconnect ───
  useEffect(() => {
    if (!socket) return

    const handleReconnect = () => {
      if (gameIdRef.current && (phaseRef.current === 'waiting' || phaseRef.current === 'playing')) {
        fetchGameState()
      }
    }

    socket.on('reconnect', handleReconnect)
    return () => socket.off('reconnect', handleReconnect)
  }, [socket, fetchGameState])

  // ─── Win/Loss effects ───
  useEffect(() => {
    if (phase !== 'result' || !result) return
    if (result.winner === mySymbol) {
      fireCrackers()
      playSuccessSound().catch(() => { })
    } else if (result.winner !== 'draw') {
      playGameOverSound().catch(() => { })
    }
  }, [phase, result, mySymbol])

  const showPopup = phase !== 'closed'

  return (
    <TicTacToeContext.Provider value={{ openInvite, hasIncomingInvite: phase === 'invite-incoming' }}>
      {children}

      {/* ── Game popup overlay ── */}
      {showPopup && (
        <div className="fixed inset-0 flex items-center justify-center p-4" style={{ zIndex: 2147483646 }}>
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={phase === 'result' || phase === 'invite-incoming' ? closeGame : undefined} />

          {/* Popup card */}
          <div className="relative w-full max-w-md bg-white dark:bg-slate-800 rounded-3xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="flex items-center justify-between px-8 pt-6 pb-4">
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
                  <HiOutlineTrophy className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-900 dark:text-white">Tic-Tac-Toe</h3>
                  {opponent && <p className="text-xs text-gray-500 dark:text-gray-400">vs {opponent.name}</p>}
                </div>
              </div>
              <button
                onClick={closeGame}
                className="p-1.5 rounded-xl hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
              >
                <HiOutlineXMark className="w-5 h-5 text-gray-400" />
              </button>
            </div>

            {/* Content */}
            <div className="px-8 pb-8">
              {/* ── Incoming invite ── */}
              {phase === 'invite-incoming' && incomingInvite && (
                <div className="text-center py-8">
                  <div className="w-20 h-20 mx-auto mb-5 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-3xl shadow-lg shadow-amber-500/30 animate-bounce">
                    🎮
                  </div>
                  <p className="text-xl font-bold text-gray-900 dark:text-white mb-1">
                    {incomingInvite.fromName}
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-8">
                    wants to play Tic-Tac-Toe with you!
                  </p>
                  <div className="flex gap-4">
                    <button
                      onClick={declineInvite}
                      className="flex-1 py-3 rounded-xl border border-gray-200 dark:border-slate-600 text-sm font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
                    >
                      Decline
                    </button>
                    <button
                      onClick={acceptInvite}
                      className="flex-1 py-3 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 text-sm font-semibold text-white hover:opacity-90 transition-opacity shadow-lg shadow-indigo-500/30"
                    >
                      Accept & Play
                    </button>
                  </div>
                </div>
              )}

              {/* ── Waiting for opponent ── */}
              {phase === 'waiting' && (
                <div className="text-center py-10">
                  <div className="w-12 h-12 mx-auto mb-5 border-3 border-indigo-200 border-t-indigo-500 rounded-full animate-spin" />
                  <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                    Waiting for {opponent?.name}...
                  </p>
                  <p className="text-xs text-gray-400 mt-1">Invite sent! They'll get a notification.</p>
                  <button
                    onClick={closeGame}
                    className="mt-4 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              )}

              {/* ── Playing / Result ── */}
              {(phase === 'playing' || phase === 'result') && (
                <>
                  {/* Turn / result indicator */}
                  <div className="mb-4 text-center">
                    {phase === 'result' ? (
                      <div className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-bold ${result?.winner === mySymbol
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                        : result?.winner === 'draw'
                          ? 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-gray-300'
                          : 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
                        }`}>
                        {result?.winner === mySymbol ? '🎉 You won!' : result?.winner === 'draw' ? "🤝 It's a draw!" : '😔 You lost!'}
                      </div>
                    ) : (
                      <div className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-semibold ${isMyTurn
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                        : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                        }`}>
                        <span className={`w-2 h-2 rounded-full ${isMyTurn ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
                        {isMyTurn ? 'Your turn' : `${opponent?.name}'s turn`}
                      </div>
                    )}
                  </div>

                  {/* Symbol legend */}
                  <div className="flex items-center justify-center gap-6 mb-4">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="w-7 h-7 rounded-lg bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center text-xs font-bold text-indigo-600 dark:text-indigo-400">X</span>
                      <span className="text-gray-500 dark:text-gray-400">{mySymbol === 'X' ? 'You' : opponent?.name}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="w-7 h-7 rounded-lg bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center text-xs font-bold text-rose-500 dark:text-rose-400">O</span>
                      <span className="text-gray-500 dark:text-gray-400">{mySymbol === 'O' ? 'You' : opponent?.name}</span>
                    </div>
                  </div>

                  {/* Board */}
                  <div className="grid grid-cols-3 gap-2.5 mx-auto" style={{ width: 'fit-content' }}>
                    {board.map((cell, i) => {
                      const winLine = result?.line || []
                      const isWinCell = winLine.includes(i)
                      return (
                        <button
                          key={i}
                          onClick={() => makeMove(i)}
                          disabled={!isMyTurn || !!cell || !!result}
                          className={`w-20 h-20 rounded-2xl text-3xl font-extrabold flex items-center justify-center transition-all
                            ${!cell && isMyTurn && !result ? 'hover:bg-indigo-50 dark:hover:bg-indigo-900/20 hover:scale-105 cursor-pointer' : 'cursor-default'}
                            ${isWinCell ? 'bg-emerald-100 dark:bg-emerald-900/30 ring-2 ring-emerald-400 scale-105' : 'bg-gray-100 dark:bg-slate-700'}
                            ${cell === 'X' ? 'text-indigo-600 dark:text-indigo-400' : 'text-rose-500 dark:text-rose-400'}
                          `}
                        >
                          {cell || ''}
                        </button>
                      )
                    })}
                  </div>

                  {/* Play again button */}
                  {phase === 'result' && (
                    <div className="flex gap-4 mt-6">
                      <button
                        onClick={closeGame}
                        className="flex-1 py-2.5 rounded-xl border border-gray-200 dark:border-slate-600 text-sm font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
                      >
                        Close
                      </button>
                      <button
                        onClick={() => {
                          const newGameId = `ttt_${currentUserId}_${opponent.userId}_${Date.now()}`
                          setGameId(newGameId)
                          setBoard(Array(9).fill(null))
                          setResult(null)
                          setMySymbol('X')
                          setIsMyTurn(true)
                          setPhase('waiting')
                          sendAction('invite', opponent.userId, { gameId: newGameId })
                        }}
                        className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 text-sm font-semibold text-white hover:opacity-90 transition-opacity shadow-lg shadow-indigo-500/30"
                      >
                        Rematch
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </TicTacToeContext.Provider>
  )
}

export function useTicTacToe() {
  return useContext(TicTacToeContext)
}
