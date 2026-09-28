'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Room, RoomEvent, Track } from 'livekit-client'
import { getToken } from '@/utils/userHelper'
import { useMiraChat } from '@/contexts/MiraChatContext'

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
    cache: 'no-store',
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok || !result.success) throw new Error(result.message || 'Remote support request failed.')
  return result
}

function RemoteVideo({ track }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!track || !ref.current) return
    const element = track.attach(ref.current)
    return () => track.detach(element)
  }, [track])
  return <video ref={ref} autoPlay playsInline className="h-full w-full object-contain bg-black" />
}

export default function RemoteSupportSessionView({ session, side, onSessionChange, onClose }) {
  const { sendMessage, isThinking, openChat } = useMiraChat()
  const roomRef = useRef(null)
  const streamsRef = useRef([])
  const executingRef = useRef(false)
  const thinkingRef = useRef(isThinking)
  const sendMessageRef = useRef(sendMessage)
  const openChatRef = useRef(openChat)
  const [tracks, setTracks] = useState([])
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState('')
  const [sources, setSources] = useState([])
  const [selected, setSelected] = useState([])
  const [sharing, setSharing] = useState(false)
  const [command, setCommand] = useState('')
  const isEmployee = side === 'employee'

  useEffect(() => {
    thinkingRef.current = isThinking
    sendMessageRef.current = sendMessage
    openChatRef.current = openChat
  }, [isThinking, openChat, sendMessage])

  const stopLocalTracks = useCallback(() => {
    for (const stream of streamsRef.current) stream.getTracks().forEach(track => track.stop())
    streamsRef.current = []
  }, [])

  useEffect(() => {
    let disposed = false
    let room
    const connect = async () => {
      try {
        const result = await api(`/api/remote-support/sessions/${session.id}/token`, { method: 'POST', body: '{}' })
        if (disposed) return
        room = new Room({ adaptiveStream: true, dynacast: true })
        roomRef.current = room
        const syncTracks = () => {
          if (!room) return
          const found = []
          room.remoteParticipants.forEach(participant => participant.trackPublications.forEach(publication => {
            if (publication.track && publication.kind === Track.Kind.Video) found.push({ key: `${participant.identity}:${publication.trackSid}`, track: publication.track, name: publication.trackName || 'Shared display' })
          }))
          setTracks(found)
        }
        room.on(RoomEvent.TrackSubscribed, syncTracks)
        room.on(RoomEvent.TrackUnsubscribed, syncTracks)
        room.on(RoomEvent.ParticipantDisconnected, syncTracks)
        room.on(RoomEvent.Disconnected, () => { setConnected(false); setTracks([]) })
        await room.connect(result.data.serverUrl, result.data.token)
        if (!disposed) { setConnected(true); syncTracks() }
      } catch (err) { if (!disposed) setError(err.message || 'Could not connect to the approved session.') }
    }
    void connect()
    return () => {
      disposed = true
      window.dispatchEvent(new CustomEvent('mira:remote-session-stop', { detail: { sessionId: session.id } }))
      stopLocalTracks()
      room?.disconnect()
      roomRef.current = null
    }
  }, [session.id, stopLocalTracks])

  useEffect(() => {
    let disposed = false
    const verifySession = async () => {
      try {
        const result = await api('/api/remote-support/sessions')
        const current = (result.sessions || []).find(item => item.id === session.id)
        if (!disposed && (!current || current.status !== 'approved')) {
          window.dispatchEvent(new CustomEvent('mira:remote-session-stop', { detail: { sessionId: session.id } }))
          onClose?.()
        }
      } catch { /* retry the status check on the next poll */ }
    }
    const timer = window.setInterval(verifySession, 4000)
    return () => { disposed = true; window.clearInterval(timer) }
  }, [onClose, session.id])

  useEffect(() => {
    if (!isEmployee || !connected) return
    let cancelled = false
    const poll = async () => {
      if (thinkingRef.current || executingRef.current) return
      try {
        const result = await api(`/api/remote-support/sessions/${session.id}/commands`)
        const next = result.commands?.[0]
        if (!next || cancelled || executingRef.current) return
        executingRef.current = true
        await api(`/api/remote-support/sessions/${session.id}/commands`, {
          method: 'PATCH', body: JSON.stringify({ commandId: next.id, status: 'running' }),
        })
        openChatRef.current({ mode: 'pip' })
        const outcome = await sendMessageRef.current(next.text, { remoteSessionId: session.id })
        if (!cancelled) await api(`/api/remote-support/sessions/${session.id}/commands`, {
          method: 'PATCH', body: JSON.stringify({ commandId: next.id, status: outcome ? 'completed' : 'failed', result: String(outcome || 'MIRA could not complete the command.') }),
        })
      } catch (err) { if (!cancelled) setError(err.message || 'Could not receive the administrator command.') }
      finally { executingRef.current = false }
    }
    void poll()
    const timer = window.setInterval(poll, 2500)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [connected, isEmployee, session.id])

  const loadSources = async () => {
    setError('')
    const bridge = window.electronAPI
    if (!bridge?.getDesktopSources || !bridge?.getDisplays) {
      setSources([])
      setSelected([])
      return
    }
    try {
      const [available, displays] = await Promise.all([
        bridge.getDesktopSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } }),
        bridge.getDisplays(),
      ])
      const displayNames = new Map((displays || []).map((display, index) => [String(display.id), display.label || `Display ${index + 1}`]))
      const screens = (available || []).filter(source => source.id?.startsWith('screen:')).map((source, index) => ({
        id: source.id,
        name: displayNames.get(String(source.display_id)) || source.name || `Display ${index + 1}`,
      }))
      setSources(screens)
      setSelected(screens.map(screen => screen.id))
      if (!screens.length) setError('No display is available to share.')
    } catch (err) { setError(err.message || 'Could not list connected displays.') }
  }

  const startSharing = async () => {
    const room = roomRef.current
    if (!room) return setError('The approved session is not connected yet.')
    setError('')
    try {
      const bridge = window.electronAPI
      if (bridge?.getScreenShareStream && sources.length) {
        const targets = sources.filter(source => selected.includes(source.id))
        if (!targets.length) return setError('Select at least one display to share.')
        for (const [index, source] of targets.entries()) {
          const spec = await bridge.getScreenShareStream(source.id)
          if (!spec?.success) throw new Error(spec?.error || `Could not access ${source.name}.`)
          const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: spec.constraints.video })
          streamsRef.current.push(stream)
          const videoTrack = stream.getVideoTracks()[0]
          if (videoTrack) await room.localParticipant.publishTrack(videoTrack, { source: Track.Source.ScreenShare, name: source.name || `Display ${index + 1}` })
        }
      } else {
        // getDisplayMedia must remain directly tied to this employee click.
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
        streamsRef.current.push(stream)
        const videoTrack = stream.getVideoTracks()[0]
        if (videoTrack) {
          videoTrack.addEventListener('ended', () => { setSharing(false); stopLocalTracks() }, { once: true })
          await room.localParticipant.publishTrack(videoTrack, { source: Track.Source.ScreenShare, name: 'Shared display' })
        }
      }
      setSharing(true)
    } catch (err) { setError(err.message || 'Screen sharing did not start. Check your screen-capture permission and retry.') }
  }

  const stopSharing = async () => {
    const room = roomRef.current
    for (const stream of streamsRef.current) {
      for (const track of stream.getTracks()) {
        const publication = [...(room?.localParticipant.trackPublications.values() || [])].find(item => item.track?.mediaStreamTrack === track)
        if (publication) await room.localParticipant.unpublishTrack(publication.track, true)
      }
    }
    stopLocalTracks()
    setSharing(false)
  }

  const stopSession = async () => {
    try {
      const result = await api(`/api/remote-support/sessions/${session.id}`, { method: 'PATCH', body: JSON.stringify({ action: 'end' }) })
      onSessionChange?.(result.session)
      onClose?.()
    } catch (err) { setError(err.message || 'Could not end the session.') }
  }

  const sendCommand = async event => {
    event.preventDefault()
    if (!command.trim()) return
    setError('')
    try {
      await api(`/api/remote-support/sessions/${session.id}/commands`, { method: 'POST', body: JSON.stringify({ text: command.trim() }) })
      setCommand('')
    } catch (err) { setError(err.message || 'Could not relay this MIRA command.') }
  }

  return (
    <section className="fixed bottom-4 right-4 z-[10000] w-[min(760px,calc(100vw-2rem))] max-h-[85vh] overflow-auto rounded-2xl border border-amber-400/60 bg-zinc-950 text-white shadow-2xl" aria-label="Active remote support session">
      <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-white/10 bg-zinc-950 p-4">
        <div><div className="font-semibold">Remote support · {isEmployee ? 'You are sharing' : session.targetName}</div><p className="mt-1 text-sm text-zinc-300">{session.requestedByName} · {session.reason}</p><p className="mt-1 text-xs font-semibold text-amber-300">Visible session active · ends {new Date(session.expiresAt).toLocaleTimeString()}</p></div>
        <button className="rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold" onClick={stopSession}>Stop session</button>
      </header>
      {isEmployee ? <div className="space-y-3 p-4">
        <p className="text-sm text-zinc-300">Your screens are not shared until you choose displays and press Start sharing. MIRA commands from the named administrator are visible in your MIRA chat. Stop at any time.</p>
        {!sharing && <>
          <button onClick={loadSources} className="rounded-lg border border-white/20 px-3 py-2 text-sm">Choose displays</button>
          {sources.map(source => <label key={source.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selected.includes(source.id)} onChange={event => setSelected(previous => event.target.checked ? [...previous, source.id] : previous.filter(id => id !== source.id))} />{source.name}</label>)}
          <button onClick={startSharing} className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold">Start sharing selected screen{selected.length === 1 ? '' : 's'}</button>
        </>}
        {sharing && <button onClick={stopSharing} className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold">Stop sharing screens</button>}
        {isThinking && <p role="status" className="text-xs text-sky-300">MIRA is finishing your current request before processing the relayed command.</p>}
      </div> : <div className="space-y-3 p-4">
        <div className="grid min-h-48 grid-cols-1 gap-3 sm:grid-cols-2">{tracks.length ? tracks.map(item => <div key={item.key} className="overflow-hidden rounded-xl border border-white/10"><RemoteVideo track={item.track} /><p className="px-3 py-2 text-xs text-zinc-300">{item.name}</p></div>) : <p className="col-span-full grid place-items-center rounded-xl bg-zinc-900 p-8 text-center text-sm text-zinc-400">Waiting for the employee to explicitly start screen sharing. This session does not capture a screen in the background.</p>}</div>
        <form onSubmit={sendCommand} className="flex gap-2"><input value={command} onChange={event => setCommand(event.target.value)} maxLength={2000} placeholder="Send a command to the employee’s MIRA…" className="min-w-0 flex-1 rounded-lg border border-white/15 bg-zinc-900 px-3 py-2 text-sm" /><button disabled={!command.trim()} className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold disabled:opacity-50">Send</button></form>
        {!!session.commands?.length && <div className="space-y-1 border-t border-white/10 pt-3 text-xs"><p className="font-semibold text-zinc-300">Recent MIRA commands</p>{session.commands.slice(-3).reverse().map(item => <p key={item.id} className="flex justify-between gap-3 text-zinc-400"><span className="truncate">{item.text}</span><span className="shrink-0 capitalize">{item.status}</span></p>)}</div>}
      </div>}
      {!connected && <p className="px-4 pb-3 text-xs text-zinc-400">Connecting to the approved session…</p>}
      {error && <p role="alert" className="px-4 pb-4 text-sm text-red-300">{error}</p>}
    </section>
  )
}
