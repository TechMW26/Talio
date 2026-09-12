'use client'

import { useState, useEffect, use } from 'react'
import { useRouter } from 'next/navigation'
import Loader from '@/components/ui/Loader'
import ManagedMeetingRoomSession from '@/components/meetings/ManagedMeetingRoomSession'

export default function GuestMeetingRoom({ params }) {
  const router = useRouter()
  const { guestLink } = use(params)
  const [state, setState] = useState({ loading: true, guestInfo: null, meeting: null, error: null })

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const raw = sessionStorage.getItem('guestInfo')
        const guestInfo = raw ? JSON.parse(raw) : null
        if (!guestInfo?.guestToken || guestInfo.guestLink !== guestLink) {
          router.replace(`/join/${guestLink}`)
          return
        }
        const response = await fetch(`/api/meetings/guest/${guestLink}`)
        const payload = await response.json()
        if (!response.ok) throw new Error(payload.message || 'Meeting unavailable')
        if (!cancelled) setState({ loading: false, guestInfo, meeting: payload.data, error: null })
      } catch (error) {
        if (!cancelled) setState({ loading: false, guestInfo: null, meeting: null, error: error.message })
      }
    }
    void load()
    return () => { cancelled = true }
  }, [guestLink, router])

  if (state.loading) return <div className="fixed inset-0 flex items-center justify-center bg-slate-950 text-white"><Loader /></div>
  if (state.error) return <div className="fixed inset-0 flex items-center justify-center bg-slate-950 p-6 text-center text-white"><div><p className="font-semibold">Talio Meet could not load</p><p className="mt-2 text-sm text-slate-400">{state.error}</p><button onClick={() => router.replace(`/join/${guestLink}`)} className="mt-5 rounded-xl bg-indigo-600 px-4 py-2">Return to join page</button></div></div>

  return (
    <ManagedMeetingRoomSession
      roomId={state.guestInfo.roomId}
      guestToken={state.guestInfo.guestToken}
      guestName={state.guestInfo.guestName}
      meetingData={state.meeting}
      displayMode="full"
      onJoinedChange={() => {}}
      onSessionEnded={() => sessionStorage.removeItem('guestInfo')}
    />
  )
}
