'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { usePathname, useRouter } from 'next/navigation'
import { ErrorBoundaryWithRetry } from '@/components/ui/ErrorBoundary'

const MeetingSessionContext = createContext(null)
const ROOM_PATH_PATTERN = /^\/dashboard\/meetings\/room\/([^/]+)/
const useManagedMeetings = process.env.NEXT_PUBLIC_MEETING_TRANSPORT === 'livekit'
const MeetingRoomSession = dynamic(
  () => useManagedMeetings
    ? import('@/components/meetings/ManagedMeetingRoomSession')
    : import('@/components/meetings/MeetingRoomSession'),
  {
    ssr: false,
    loading: () => (
      <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-100 dark:bg-slate-950">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-300 border-t-indigo-500 dark:border-white/20 dark:border-t-indigo-400" />
        <span className="sr-only">Loading Talio Meet</span>
      </div>
    ),
  }
)

function MeetingRoomErrorFallback({ retry, onBack }) {
  return (
    <div
      className="fixed inset-0 z-[140] flex h-[100dvh] w-screen items-center justify-center bg-slate-100 p-4 text-slate-900 dark:bg-slate-950 dark:text-white"
      role="alert"
    >
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-2xl dark:border-white/10 dark:bg-slate-900">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-500/15 text-red-600 dark:text-red-300">
          <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v4m0 4h.01M10.3 3.7 2.4 17.4A2 2 0 0 0 4.1 20h15.8a2 2 0 0 0 1.7-2.6L13.7 3.7a2 2 0 0 0-3.4 0Z" />
          </svg>
        </div>
        <h1 className="text-xl font-semibold">Talio Meet could not load</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Refresh the meeting session or return to your meetings.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={retry}
            className="flex-1 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-400"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={onBack}
            className="flex-1 rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-400 dark:border-white/15 dark:hover:bg-white/10 dark:focus:ring-white/40"
          >
            Back to meetings
          </button>
        </div>
      </div>
    </div>
  )
}

export function MeetingSessionProvider({ children }) {
  const pathname = usePathname()
  const router = useRouter()
  const routeRoomId = pathname?.match(ROOM_PATH_PATTERN)?.[1] || null
  const [activeRoomId, setActiveRoomId] = useState(routeRoomId)
  const [isJoined, setIsJoined] = useState(false)
  const [pipSize, setPipSize] = useState('expanded')

  useEffect(() => {
    if (routeRoomId && routeRoomId !== activeRoomId) {
      setActiveRoomId(routeRoomId)
      setIsJoined(false)
      setPipSize('expanded')
      return
    }

    if (!routeRoomId && activeRoomId && !isJoined) {
      setActiveRoomId(null)
    }
  }, [activeRoomId, isJoined, routeRoomId])

  useEffect(() => {
    if (activeRoomId) {
      router.prefetch?.('/dashboard')
    }
  }, [activeRoomId, router])

  const minimizeToPip = useCallback(() => {
    setPipSize('expanded')
    router.replace('/dashboard')
  }, [router])

  const restoreMeeting = useCallback(() => {
    if (activeRoomId) {
      router.push(`/dashboard/meetings/room/${activeRoomId}`)
    }
  }, [activeRoomId, router])

  const endSession = useCallback(() => {
    setActiveRoomId(null)
    setIsJoined(false)
    setPipSize('expanded')
  }, [])

  const value = useMemo(() => ({
    activeRoomId,
    isJoined,
    pipSize,
    restoreMeeting,
    setPipSize,
  }), [activeRoomId, isJoined, pipSize, restoreMeeting])

  const isFullRoom = Boolean(routeRoomId && routeRoomId === activeRoomId)
  const shouldRenderSession = Boolean(activeRoomId && (isFullRoom || isJoined))

  return (
    <MeetingSessionContext.Provider value={value}>
      {!isFullRoom && children}
      {shouldRenderSession && (
        <ErrorBoundaryWithRetry
          key={activeRoomId}
          fallback={({ retry }) => (
            <MeetingRoomErrorFallback
              retry={retry}
              onBack={() => {
                endSession()
                router.push('/dashboard/meetings')
              }}
            />
          )}
        >
          <MeetingRoomSession
            roomId={activeRoomId}
            displayMode={isFullRoom ? 'full' : pipSize}
            onJoinedChange={setIsJoined}
            onMinimizeToPip={minimizeToPip}
            onRestoreMeeting={restoreMeeting}
            onSetPipSize={setPipSize}
            onSessionEnded={endSession}
          />
        </ErrorBoundaryWithRetry>
      )}
    </MeetingSessionContext.Provider>
  )
}

export function useMeetingSession() {
  return useContext(MeetingSessionContext)
}
