'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Skeleton } from '@heroui/react'
import { useFocusTimer } from '@/contexts/FocusTimerContext'
import { useTicTacToe } from '@/contexts/TicTacToeContext'
import {
  HiOutlineSparkles,
  HiOutlineClock,
  HiOutlineMapPin,
  HiOutlineCalculator,
  HiOutlinePlayCircle,
  HiOutlinePauseCircle,
  HiOutlineArrowPath,
  HiOutlinePencilSquare,
  HiOutlineXMark,
  HiOutlineMagnifyingGlass,
  HiOutlineUserPlus,
  HiOutlineTrophy,
} from 'react-icons/hi2'

// ─── Tic-Tac-Toe Card (invite trigger only — game plays in popup) ───
function TicTacToeCard() {
  const { openInvite, hasIncomingInvite } = useTicTacToe()
  const [phase, setPhase] = useState('idle') // idle | searching
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [history, setHistory] = useState([])
  const debounceRef = useRef(null)

  // Fetch game history on mount
  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) return
    fetch('/api/tictactoe?check=history', {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(r => r.json())
      .then(d => { if (d.history) setHistory(d.history) })
      .catch(() => {})
  }, [])

  const searchUsers = useCallback(async (q) => {
    setSearching(true)
    try {
      const token = localStorage.getItem('token')
      const url = q.trim()
        ? `/api/users/search?q=${encodeURIComponent(q)}&limit=10`
        : `/api/users/search?limit=10`
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
      })
      const data = await res.json()
      if (res.ok) setSearchResults(data.users || [])
    } catch { /* ignore */ }
    setSearching(false)
  }, [])

  useEffect(() => {
    if (phase !== 'searching') return
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => searchUsers(searchQuery), 300)
    return () => clearTimeout(debounceRef.current)
  }, [searchQuery, phase, searchUsers])

  // Preload employees when search panel opens
  useEffect(() => {
    if (phase === 'searching' && searchResults.length === 0 && !searchQuery) {
      searchUsers('')
    }
  }, [phase]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleInvite = useCallback((user) => {
    openInvite(user)
    setPhase('idle')
    setSearchQuery('')
    setSearchResults([])
  }, [openInvite])

  // ── Searching for opponent ──
  if (phase === 'searching') {
    return (
      <div className="rounded-2xl p-4 bg-white dark:bg-slate-800/60 border border-gray-100 dark:border-slate-700/50 shadow-sm flex flex-col">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-xs font-medium text-gray-500 dark:text-gray-400">
            <HiOutlineTrophy className="w-4 h-4" />
            <span>Find Opponent</span>
          </div>
          <button onClick={() => { setPhase('idle'); setSearchQuery(''); setSearchResults([]) }} className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700">
            <HiOutlineXMark className="w-4 h-4 text-gray-400" />
          </button>
        </div>
        <div className="relative mb-2">
          <HiOutlineMagnifyingGlass className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search by name..."
            autoFocus
            className="w-full pl-8 pr-3 py-1.5 rounded-lg text-xs bg-gray-50 dark:bg-slate-700/50 border border-gray-200 dark:border-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-400 text-gray-800 dark:text-gray-200"
          />
        </div>
        <div className="flex-1 overflow-y-auto space-y-1">
          {searching && <p className="text-[10px] text-gray-400 text-center py-2">Searching...</p>}
          {!searching && searchResults.length === 0 && searchQuery && (
            <p className="text-[10px] text-gray-400 text-center py-2">No users found</p>
          )}
          {searchResults.map(u => (
            <button
              key={u._id}
              onClick={() => handleInvite(u)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors text-left"
            >
              {u.avatar ? (
                <img src={u.avatar} alt="" className="w-6 h-6 rounded-full object-cover" />
              ) : (
                <div className="w-6 h-6 rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center text-[10px] font-bold text-indigo-600 dark:text-indigo-400">
                  {u.name?.[0] || '?'}
                </div>
              )}
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">{u.name}</span>
            </button>
          ))}
        </div>
      </div>
    )
  }

  // ── Idle state ──
  return (
    <div className="rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-lg shadow-indigo-500/20 flex flex-col min-h-[140px] relative overflow-hidden">
      {hasIncomingInvite && (
        <span className="absolute top-3 right-3 w-3 h-3 rounded-full bg-amber-400 animate-pulse" />
      )}
      <div className="px-5 pt-4 pb-2 flex items-center gap-2 text-white/70 text-xs font-medium">
        <HiOutlineTrophy className="w-4 h-4" />
        <span>Tic-Tac-Toe</span>
      </div>

      {/* Recent games */}
      {history.length > 0 ? (
        <div className="px-5 flex-1 overflow-hidden">
          {/* W/L/D summary */}
          <div className="flex items-center gap-3 mb-1.5">
            <span className="text-[11px] font-semibold text-emerald-300">
              {history.filter(g => g.outcome === 'win').length}W
            </span>
            <span className="text-[11px] font-semibold text-red-300">
              {history.filter(g => g.outcome === 'loss').length}L
            </span>
            <span className="text-[11px] font-semibold text-white/60">
              {history.filter(g => g.outcome === 'draw').length}D
            </span>
          </div>
          <div className="space-y-1">
            {history.slice(0, 3).map((g, i) => (
              <div key={i} className="flex items-center justify-between text-[11px]">
                <span className="text-white/80 truncate max-w-[120px]">vs {g.opponentName || 'Unknown'}</span>
                <span className={`font-semibold ${
                  g.outcome === 'win' ? 'text-emerald-300' : g.outcome === 'loss' ? 'text-red-300' : 'text-white/60'
                }`}>
                  {g.outcome === 'win' ? '🏆 Won' : g.outcome === 'loss' ? '😔 Lost' : '🤝 Draw'}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="px-5 flex-1 flex items-center">
          <p className="text-sm text-white/80">Challenge a teammate!</p>
        </div>
      )}

      <div className="px-5 pb-4 pt-2">
        <button
          onClick={() => setPhase('searching')}
          className="w-full py-2 rounded-xl bg-white/20 hover:bg-white/30 text-sm font-semibold transition-colors flex items-center justify-center gap-2"
        >
          <HiOutlineUserPlus className="w-4 h-4" /> Invite to Play
        </button>
      </div>
    </div>
  )
}

// ─── Location Map Card ───
function LocationMapCard() {
  const [coords, setCoords] = useState(null)
  const [location, setLocation] = useState(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!navigator.geolocation) { setError(true); return }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords
        setCoords({ lat: latitude, lon: longitude })
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`,
            { headers: { 'Accept-Language': 'en' } }
          )
          const geo = await res.json()
          setLocation(geo.address?.city || geo.address?.town || geo.address?.village || geo.address?.state || 'Your Location')
        } catch {
          setLocation('Your Location')
        }
      },
      () => setError(true),
      { timeout: 10000 }
    )
  }, [])

  return (
    <div className="rounded-2xl bg-white dark:bg-slate-800/60 border border-gray-100 dark:border-slate-700/50 shadow-sm overflow-hidden flex flex-col min-h-[140px]">
      <div className="flex items-center justify-between px-5 pt-4 pb-2">
        <div className="flex items-center gap-2 text-xs font-medium text-gray-500 dark:text-gray-400">
          <HiOutlineMapPin className="w-4 h-4" />
          <span>Your Location</span>
        </div>
        {location && (
          <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400">
            {location}
          </span>
        )}
      </div>
      <div className="flex-1 min-h-[100px]">
        {error ? (
          <div className="h-full flex items-center justify-center text-xs text-gray-400 dark:text-gray-500 p-4">
            Location access denied
          </div>
        ) : !coords ? (
          <div className="h-full flex items-center justify-center">
            <div className="w-5 h-5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <iframe
            title="Your location"
            width="100%"
            height="100%"
            style={{ border: 0, minHeight: 100 }}
            loading="lazy"
            referrerPolicy="no-referrer"
            src={`https://www.openstreetmap.org/export/embed.html?bbox=${coords.lon - 0.01},${coords.lat - 0.01},${coords.lon + 0.01},${coords.lat + 0.01}&layer=mapnik&marker=${coords.lat},${coords.lon}`}
          />
        )}
      </div>
    </div>
  )
}

const TIMER_PRESETS = [5, 10, 15, 25, 30, 45, 60]

// ─── Focus Timer ───
function FocusTimerCard() {
  const { duration, running, done, pct, mins, secs, alarming, dismissAlarm, pickDuration, toggle, reset, TIMER_PRESETS: presets } = useFocusTimer()
  const [picking, setPicking] = useState(false)

  return (
    <div className={`rounded-2xl p-5 bg-white dark:bg-slate-800/60 border shadow-sm flex flex-col justify-between min-h-[140px] transition-all ${
      alarming
        ? 'border-red-300 dark:border-red-500/50 ring-2 ring-red-400/50 animate-pulse'
        : 'border-gray-100 dark:border-slate-700/50'
    }`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-medium text-gray-500 dark:text-gray-400">
          <HiOutlineClock className="w-4 h-4" />
          <span>Focus Timer</span>
        </div>
        <button
          onClick={() => { if (!running && !alarming) setPicking(p => !p) }}
          className={`text-[10px] px-2 py-0.5 rounded-full font-semibold transition-colors ${
            alarming
              ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 animate-pulse'
              : done
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                : 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-slate-600'
          } ${running || alarming ? 'cursor-default' : 'cursor-pointer'}`}
        >
          {alarming ? '⏰ Alarm!' : done ? 'Done!' : `${duration} min`}
        </button>
      </div>

      {picking ? (
        <div className="flex flex-wrap items-center justify-center gap-1.5 my-3">
          {presets.map(m => (
            <button
              key={m}
              onClick={() => { pickDuration(m); setPicking(false) }}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                m === duration
                  ? 'bg-indigo-500 text-white'
                  : 'bg-gray-50 dark:bg-slate-700/50 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700'
              }`}
            >
              {m}m
            </button>
          ))}
        </div>
      ) : (
        <p className={`text-4xl font-extrabold tracking-tight tabular-nums text-center my-3 ${
          alarming ? 'text-red-500 animate-pulse' : done ? 'text-emerald-500' : 'text-gray-900 dark:text-white'
        }`}>
          {mins}:{secs}
        </p>
      )}

      {/* Progress bar */}
      <div className="h-1.5 rounded-full bg-gray-100 dark:bg-slate-700 overflow-hidden mb-3">
        <div
          className="h-full rounded-full transition-all duration-1000"
          style={{ width: `${pct}%`, backgroundColor: alarming ? '#EF4444' : done ? '#10B981' : '#6366F1' }}
        />
      </div>

      {alarming ? (
        <button
          onClick={dismissAlarm}
          className="w-full py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-bold transition-colors shadow-lg shadow-red-500/30 animate-pulse"
        >
          Dismiss Alarm
        </button>
      ) : (
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={toggle}
            className="p-1.5 rounded-xl hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
            title={done ? 'Restart' : running ? 'Pause' : 'Start'}
          >
            {done
              ? <HiOutlineArrowPath className="w-7 h-7 text-emerald-500" />
              : running
                ? <HiOutlinePauseCircle className="w-7 h-7 text-amber-500" />
                : <HiOutlinePlayCircle className="w-7 h-7 text-emerald-500" />}
          </button>
          {!done && (
            <button
              onClick={reset}
              className="p-1.5 rounded-xl hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
              title="Reset"
            >
              <HiOutlineArrowPath className="w-5 h-5 text-gray-400" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Calculator ───
function CalculatorCard() {
  const [display, setDisplay] = useState('0')
  const [prev, setPrev] = useState(null)
  const [op, setOp] = useState(null)
  const [fresh, setFresh] = useState(true)

  const input = useCallback((d) => {
    if (d === '.') {
      if (fresh) { setDisplay('0.'); setFresh(false); return }
      if (display.includes('.')) return
      setDisplay(display + '.')
      return
    }
    if (fresh) { setDisplay(d); setFresh(false) }
    else setDisplay(display === '0' ? d : display + d)
  }, [display, fresh])

  const operate = useCallback((nextOp) => {
    const cur = parseFloat(display)
    if (prev !== null && op) {
      let result = prev
      if (op === '+') result = prev + cur
      else if (op === '-') result = prev - cur
      else if (op === '×') result = prev * cur
      else if (op === '÷') result = cur !== 0 ? prev / cur : 0
      const rounded = Math.round(result * 1e10) / 1e10
      setDisplay(String(rounded))
      setPrev(rounded)
    } else {
      setPrev(cur)
    }
    setOp(nextOp)
    setFresh(true)
  }, [display, prev, op])

  const equals = useCallback(() => {
    if (prev === null || !op) return
    operate(null)
    setOp(null)
  }, [prev, op, operate])

  const clear = useCallback(() => {
    setDisplay('0')
    setPrev(null)
    setOp(null)
    setFresh(true)
  }, [])

  const btnClass = 'flex items-center justify-center rounded-xl text-sm font-semibold h-9 transition-colors'

  return (
    <div className="rounded-2xl p-5 bg-white dark:bg-slate-800/60 border border-gray-100 dark:border-slate-700/50 shadow-sm flex flex-col min-h-[140px]">
      <div className="flex items-center gap-2 text-xs font-medium text-gray-500 dark:text-gray-400 mb-3">
        <HiOutlineCalculator className="w-4 h-4" />
        <span>Calculator</span>
      </div>

      {/* Display */}
      <div className="bg-gray-50 dark:bg-slate-900/50 rounded-xl px-4 py-3 mb-3 text-right">
        {op && <p className="text-[10px] text-gray-400 dark:text-gray-500">{prev} {op}</p>}
        <p className="text-2xl font-extrabold text-gray-900 dark:text-white tabular-nums truncate">{display}</p>
      </div>

      {/* Keypad */}
      <div className="grid grid-cols-4 gap-1.5">
        <button onClick={clear} className={`${btnClass} bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 col-span-2`}>C</button>
        <button onClick={() => operate('÷')} className={`${btnClass} bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100`}>÷</button>
        <button onClick={() => operate('×')} className={`${btnClass} bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100`}>×</button>

        {['7','8','9'].map(d => <button key={d} onClick={() => input(d)} className={`${btnClass} bg-gray-50 dark:bg-slate-700/50 text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-700`}>{d}</button>)}
        <button onClick={() => operate('-')} className={`${btnClass} bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100`}>−</button>

        {['4','5','6'].map(d => <button key={d} onClick={() => input(d)} className={`${btnClass} bg-gray-50 dark:bg-slate-700/50 text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-700`}>{d}</button>)}
        <button onClick={() => operate('+')} className={`${btnClass} bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100`}>+</button>

        {['1','2','3'].map(d => <button key={d} onClick={() => input(d)} className={`${btnClass} bg-gray-50 dark:bg-slate-700/50 text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-700`}>{d}</button>)}
        <button onClick={equals} className={`${btnClass} bg-emerald-500 text-white hover:bg-emerald-600 row-span-2`}>=</button>

        <button onClick={() => input('0')} className={`${btnClass} bg-gray-50 dark:bg-slate-700/50 text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-700 col-span-2`}>0</button>
        <button onClick={() => input('.')} className={`${btnClass} bg-gray-50 dark:bg-slate-700/50 text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-700`}>.</button>
      </div>
    </div>
  )
}

// ─── Sticky Note ───
function StickyNoteCard() {
  const [note, setNote] = useState('')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    try {
      const saved = localStorage.getItem('talio_sticky_note')
      if (saved) setNote(saved)
    } catch {}
  }, [])

  const save = useCallback(() => {
    setNote(draft)
    setEditing(false)
    localStorage.setItem('talio_sticky_note', draft)
  }, [draft])

  const startEdit = useCallback(() => {
    setDraft(note)
    setEditing(true)
  }, [note])

  const clearNote = useCallback(() => {
    setNote('')
    setEditing(false)
    localStorage.removeItem('talio_sticky_note')
  }, [])

  return (
    <div className="rounded-2xl p-5 bg-amber-50 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-800/30 shadow-sm flex flex-col min-h-[140px]">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-xs font-medium text-amber-700 dark:text-amber-400">
          <HiOutlinePencilSquare className="w-4 h-4" />
          <span>Quick Note</span>
        </div>
        <div className="flex items-center gap-1">
          {!editing && note && (
            <button onClick={clearNote} className="p-1 rounded-lg hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors" title="Clear">
              <HiOutlineXMark className="w-3.5 h-3.5 text-amber-500" />
            </button>
          )}
          {!editing && (
            <button onClick={startEdit} className="p-1 rounded-lg hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors" title="Edit">
              <HiOutlinePencilSquare className="w-3.5 h-3.5 text-amber-500" />
            </button>
          )}
        </div>
      </div>

      {editing ? (
        <div className="flex-1 flex flex-col gap-2">
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            className="flex-1 text-sm bg-white dark:bg-slate-800 rounded-xl p-3 border border-amber-200 dark:border-amber-800/50 resize-none focus:outline-none focus:ring-2 focus:ring-amber-400/50 text-gray-800 dark:text-gray-200 min-h-[60px]"
            placeholder="Type your note..."
            autoFocus
            maxLength={500}
          />
          <div className="flex gap-2 justify-end">
            <button onClick={() => setEditing(false)} className="text-xs px-3 py-1 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors">Cancel</button>
            <button onClick={save} className="text-xs px-3 py-1 rounded-lg bg-amber-500 text-white hover:bg-amber-600 transition-colors font-medium">Save</button>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center">
          {note ? (
            <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap break-words">{note}</p>
          ) : (
            <button onClick={startEdit} className="text-sm text-amber-500/70 hover:text-amber-600 transition-colors w-full text-left">
              Tap to add a quick note...
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main Component ───
export default function ActionableInsights() {
  return (
    <div className="space-y-6">
      {/* Section Header */}
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 shadow-lg shadow-indigo-500/25">
          <HiOutlineSparkles className="w-5 h-5 text-white" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-white tracking-tight">
            Quick Tools
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Productivity tools at your fingertips
          </p>
        </div>
      </div>

      {/* Tools Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <TicTacToeCard />
        <FocusTimerCard />
        <CalculatorCard />
        <LocationMapCard />
      </div>

      {/* Sticky Note — full width */}
      <StickyNoteCard />
    </div>
  )
}

function InsightsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Skeleton className="w-10 h-10 rounded-2xl" />
        <div>
          <Skeleton className="h-5 w-48 rounded-lg mb-1" />
          <Skeleton className="h-3.5 w-64 rounded-lg" />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-[140px] rounded-2xl" />)}
      </div>
      <Skeleton className="h-[140px] rounded-2xl" />
    </div>
  )
}
