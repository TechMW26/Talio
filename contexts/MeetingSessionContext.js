'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { usePathname, useRouter } from 'next/navigation'

const MeetingSessionContext = createContext(null)
const ROOM_PATH_PATTERN = /^\/dashboard\/meetings\/room\/([^/]+)/
const MeetingRoomSession = dynamic(
  () => import('@/components/meetings/MeetingRoomSession'),
  {
    ssr: false,
    loading: () => (
      <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-indigo-400" />
        <span className="sr-only">Loading Talio Meet</span>
      </div>
    ),
  }
)

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

  const minimizeToPip = useCallback(() => {
    setPipSize('expanded')
    router.push('/dashboard')
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
      {children}
      {shouldRenderSession && (
        <MeetingRoomSession
          key={activeRoomId}
          roomId={activeRoomId}
          displayMode={isFullRoom ? 'full' : pipSize}
          onJoinedChange={setIsJoined}
          onMinimizeToPip={minimizeToPip}
          onSetPipSize={setPipSize}
          onSessionEnded={endSession}
        />
      )}
    </MeetingSessionContext.Provider>
  )
}

export function useMeetingSession() {
  return useContext(MeetingSessionContext)
}
