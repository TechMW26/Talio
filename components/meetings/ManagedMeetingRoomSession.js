'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Room,
  RoomEvent,
  Track,
  VideoPresets,
} from 'livekit-client'
import {
  HiOutlineArrowsPointingIn,
  HiOutlineArrowsPointingOut,
  HiOutlineChatBubbleLeftRight,
  HiOutlineComputerDesktop,
  HiOutlineDocumentText,
  HiOutlineHandRaised,
  HiOutlineMicrophone,
  HiOutlineMinusSmall,
  HiOutlinePaperAirplane,
  HiOutlinePhoneXMark,
  HiOutlineUserGroup,
  HiOutlineVideoCamera,
  HiOutlineXMark,
} from 'react-icons/hi2'
import { BsEmojiSmile } from 'react-icons/bs'
import { CutLineIcon, MEETING_REACTIONS, MeetingReactionIcon } from '@/components/meetings/MeetingVisualIcons'
import AddMeetingParticipantsModal from '@/app/dashboard/meetings/components/AddMeetingParticipantsModal'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import { getSupportedAudioMimeType, isMeetingAudioUploadSupported } from '@/lib/meetingTranscriber'
import toast from '@/utils/toast'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function participantSnapshot(participant) {
  const microphone = participant.getTrackPublication(Track.Source.Microphone)
  const camera = participant.getTrackPublication(Track.Source.Camera)
  const screen = participant.getTrackPublication(Track.Source.ScreenShare)
  return {
    participant,
    identity: participant.identity,
    name: participant.name || participant.identity,
    isMuted: !microphone || microphone.isMuted,
    isVideoOff: !camera || camera.isMuted,
    isScreenSharing: Boolean(screen && !screen.isMuted),
  }
}

function RemoteAudio({ participant }) {
  const ref = useRef(null)
  const publication = participant.getTrackPublication(Track.Source.Microphone)
  useEffect(() => {
    const track = publication?.track
    const element = ref.current
    if (!track || !element) return undefined
    track.attach(element)
    return () => track.detach(element)
  }, [publication?.track])
  return <audio ref={ref} autoPlay />
}

function ParticipantTile({ item, local = false, reaction, handRaised = false, featured = false }) {
  const videoRef = useRef(null)
  const screenPublication = item.participant.getTrackPublication(Track.Source.ScreenShare)
  const cameraPublication = item.participant.getTrackPublication(Track.Source.Camera)
  const publication = screenPublication && !screenPublication.isMuted ? screenPublication : cameraPublication

  useEffect(() => {
    const track = publication?.track
    const element = videoRef.current
    if (!track || !element) return undefined
    track.attach(element)
    return () => track.detach(element)
  }, [publication?.track])

  return (
    <div className={`relative flex min-h-44 overflow-hidden rounded-2xl bg-slate-200 ring-1 ring-slate-300 dark:bg-slate-900 dark:ring-white/10 ${featured ? 'sm:col-span-2 sm:min-h-[55vh]' : ''}`}>
      {publication?.track && !publication.isMuted ? (
        <video ref={videoRef} autoPlay playsInline muted={local} className={`h-full w-full object-cover ${local && !item.isScreenSharing ? '-scale-x-100' : ''}`} />
      ) : (
        <div className="flex h-full w-full flex-1 items-center justify-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-indigo-600 text-xl font-semibold text-white">
            {item.name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()}
          </span>
        </div>
      )}
      <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-lg bg-black/65 px-2.5 py-1.5 text-xs font-medium text-white backdrop-blur">
        <span>{local ? 'You' : item.name}</span>
        {item.isMuted && <CutLineIcon isOff><HiOutlineMicrophone className="h-4 w-4" /></CutLineIcon>}
      </div>
      {item.isScreenSharing && <span className="absolute left-3 top-3 rounded-full bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white">Presenting</span>}
      {handRaised && <span className="absolute right-3 top-3 rounded-full bg-amber-500 p-2 text-white" aria-label={`${item.name} raised their hand`}><HiOutlineHandRaised className="h-5 w-5" /></span>}
      {reaction && (
        <span className="absolute bottom-10 left-1/2 -translate-x-1/2 animate-bounce rounded-full bg-white/95 p-3 text-indigo-700 shadow-xl">
          <MeetingReactionIcon value={reaction} className="h-7 w-7" />
        </span>
      )}
    </div>
  )
}

export default function ManagedMeetingRoomSession({
  roomId,
  displayMode = 'full',
  guestToken = null,
  guestName = null,
  meetingData = null,
  onJoinedChange,
  onMinimizeToPip,
  onRestoreMeeting,
  onSetPipSize,
  onSessionEnded,
}) {
  const router = useRouter()
  const roomRef = useRef(null)
  const recorderRef = useRef(null)
  const mutedRef = useRef(false)
  const reactionTimers = useRef(new Map())
  const [meeting, setMeeting] = useState(meetingData)
  const [room, setRoom] = useState(null)
  const [participants, setParticipants] = useState([])
  const [joined, setJoined] = useState(false)
  const [joining, setJoining] = useState(false)
  const [muted, setMuted] = useState(false)
  const [videoOff, setVideoOff] = useState(false)
  const [screenSharing, setScreenSharing] = useState(false)
  const [showChat, setShowChat] = useState(false)
  const [showParticipants, setShowParticipants] = useState(false)
  const [showReactions, setShowReactions] = useState(false)
  const [showAddParticipants, setShowAddParticipants] = useState(false)
  const [messages, setMessages] = useState([])
  const [chatInput, setChatInput] = useState('')
  const [reactions, setReactions] = useState({})
  const [raisedHands, setRaisedHands] = useState({})
  const [handRaised, setHandRaised] = useState(false)
  const [transcriptStatus, setTranscriptStatus] = useState('off')
  const [connectionLabel, setConnectionLabel] = useState('Connecting')

  const { data: meetingResponse } = useAuthedSWR(
    guestToken || meetingData ? null : `/api/meetings?roomId=${encodeURIComponent(roomId)}`,
    { revalidateOnFocus: false }
  )
  useEffect(() => {
    if (meetingResponse?.success && meetingResponse.data?.[0]) setMeeting(meetingResponse.data[0])
  }, [meetingResponse])

  const refreshParticipants = useCallback((activeRoom = roomRef.current) => {
    if (!activeRoom) return
    const remote = [...activeRoom.remoteParticipants.values()].map(participantSnapshot)
    const local = participantSnapshot(activeRoom.localParticipant)
    setParticipants([local, ...remote])
    const presenter = [local, ...remote].find((participant) => participant.isScreenSharing)
    if (presenter) setScreenSharing(local.identity === presenter.identity)
  }, [])

  const showReaction = useCallback((identity, reaction) => {
    setReactions((current) => ({ ...current, [identity]: reaction }))
    clearTimeout(reactionTimers.current.get(identity))
    reactionTimers.current.set(identity, setTimeout(() => {
      setReactions((current) => {
        const next = { ...current }
        delete next[identity]
        return next
      })
    }, 3500))
  }, [])

  const handleData = useCallback((payload, participant, _kind, topic) => {
    try {
      const data = JSON.parse(decoder.decode(payload))
      const sender = participant?.identity || data.senderId
      if (topic === 'talio-chat' && data.message) {
        setMessages((current) => current.some((item) => item.id === data.id) ? current : [...current, { ...data, senderId: sender }])
      }
      if (topic === 'talio-reaction' && data.reaction) showReaction(sender, data.reaction)
      if (topic === 'talio-hand') {
        setRaisedHands((current) => ({ ...current, [sender]: Boolean(data.raised) }))
      }
    } catch {
      // Ignore malformed participant data packets.
    }
  }, [showReaction])

  const join = useCallback(async () => {
    if (joining || joined) return
    setJoining(true)
    try {
      const authorization = guestToken ? `Guest ${guestToken}` : `Bearer ${localStorage.getItem('token')}`
      const response = await fetch('/api/meetings/livekit/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authorization },
        body: JSON.stringify({ roomId }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.message || 'Unable to join managed meeting')

      const liveRoom = new Room({
        adaptiveStream: true,
        dynacast: true,
        videoCaptureDefaults: { resolution: VideoPresets.h720.resolution },
        publishDefaults: { simulcast: true, videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360] },
      })
      roomRef.current = liveRoom
      liveRoom
        .on(RoomEvent.ParticipantConnected, () => refreshParticipants(liveRoom))
        .on(RoomEvent.ParticipantDisconnected, () => refreshParticipants(liveRoom))
        .on(RoomEvent.TrackSubscribed, () => refreshParticipants(liveRoom))
        .on(RoomEvent.TrackUnsubscribed, () => refreshParticipants(liveRoom))
        .on(RoomEvent.TrackMuted, () => refreshParticipants(liveRoom))
        .on(RoomEvent.TrackUnmuted, () => refreshParticipants(liveRoom))
        .on(RoomEvent.LocalTrackPublished, () => refreshParticipants(liveRoom))
        .on(RoomEvent.LocalTrackUnpublished, () => refreshParticipants(liveRoom))
        .on(RoomEvent.DataReceived, handleData)
        .on(RoomEvent.Reconnecting, () => setConnectionLabel('Reconnecting'))
        .on(RoomEvent.Reconnected, () => setConnectionLabel('Connected'))
        .on(RoomEvent.Disconnected, () => setConnectionLabel('Disconnected'))

      await liveRoom.connect(payload.data.serverUrl, payload.data.token, { autoSubscribe: true })
      await Promise.allSettled([
        liveRoom.localParticipant.setMicrophoneEnabled(!muted),
        liveRoom.localParticipant.setCameraEnabled(!videoOff),
      ])
      setRoom(liveRoom)
      setJoined(true)
      setConnectionLabel('Connected')
      refreshParticipants(liveRoom)
      onJoinedChange?.(true)
    } catch (error) {
      console.error('[Managed meeting] Join failed:', error)
      toast.error(error.message)
    } finally {
      setJoining(false)
    }
  }, [guestToken, handleData, joined, joining, muted, onJoinedChange, refreshParticipants, roomId, videoOff])

  useEffect(() => () => {
    for (const timer of reactionTimers.current.values()) clearTimeout(timer)
    roomRef.current?.disconnect()
  }, [])

  useEffect(() => {
    mutedRef.current = muted
  }, [muted])

  useEffect(() => {
    if (!joined || muted || guestToken || !meeting?._id || !isMeetingAudioUploadSupported()) {
      if (recorderRef.current?.state !== 'inactive') {
        try { recorderRef.current.stop() } catch { /* already stopped */ }
      }
      recorderRef.current = null
      setTranscriptStatus(muted ? 'paused' : 'off')
      return undefined
    }

    const sourceTrack = room?.localParticipant
      ?.getTrackPublication(Track.Source.Microphone)
      ?.track?.mediaStreamTrack
    if (!sourceTrack || sourceTrack.readyState !== 'live' || !sourceTrack.enabled) return undefined

    const recordingTrack = sourceTrack.clone()
    const recordingStream = new MediaStream([recordingTrack])
    const mimeType = getSupportedAudioMimeType()
    let recorder
    try {
      recorder = mimeType ? new MediaRecorder(recordingStream, { mimeType }) : new MediaRecorder(recordingStream)
    } catch {
      recordingTrack.stop()
      setTranscriptStatus('unavailable')
      return undefined
    }

    recorderRef.current = recorder
    setTranscriptStatus('listening')
    let startedAt = Date.now()
    recorder.ondataavailable = async (event) => {
      const durationMs = Date.now() - startedAt
      const segmentStartedAt = startedAt
      startedAt = Date.now()
      if (mutedRef.current || !event.data || event.data.size < 2048 || durationMs < 1200) return

      const formData = new FormData()
      formData.append('audio', event.data, `meeting-${meeting._id}-${segmentStartedAt}.webm`)
      formData.append('startedAt', new Date(segmentStartedAt).toISOString())
      formData.append('durationMs', String(durationMs))
      formData.append('language', 'auto')
      formData.append('source', 'live-pollinations')
      try {
        const response = await fetch(`/api/meetings/${meeting._id}/transcript`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
          body: formData,
        })
        if (!response.ok) throw new Error('Transcription upload failed')
        if (!mutedRef.current) setTranscriptStatus('listening')
      } catch {
        if (!mutedRef.current) setTranscriptStatus('retrying')
      }
    }
    recorder.onstop = () => recordingTrack.stop()
    recorder.start(10_000)

    return () => {
      if (recorder.state !== 'inactive') {
        try { recorder.stop() } catch { recordingTrack.stop() }
      } else {
        recordingTrack.stop()
      }
      if (recorderRef.current === recorder) recorderRef.current = null
    }
  }, [guestToken, joined, meeting?._id, muted, room])

  const toggleMute = async () => {
    const next = !muted
    await room?.localParticipant.setMicrophoneEnabled(!next)
    setMuted(next)
    refreshParticipants(room)
  }
  const toggleVideo = async () => {
    const next = !videoOff
    await room?.localParticipant.setCameraEnabled(!next)
    setVideoOff(next)
    refreshParticipants(room)
  }
  const toggleScreen = async () => {
    try {
      await room?.localParticipant.setScreenShareEnabled(!screenSharing, { audio: true })
      setScreenSharing(!screenSharing)
      refreshParticipants(room)
    } catch (error) {
      if (error?.name !== 'NotAllowedError') toast.error('Screen sharing could not start')
    }
  }
  const publishData = async (topic, data) => {
    await room.localParticipant.publishData(encoder.encode(JSON.stringify(data)), {
      reliable: true,
      topic,
    })
  }
  const sendChat = async (event) => {
    event.preventDefault()
    const message = chatInput.trim()
    if (!message || !room) return
    const data = { id: crypto.randomUUID(), message, senderName: room.localParticipant.name || guestName || 'You', createdAt: new Date().toISOString(), senderId: room.localParticipant.identity }
    setMessages((current) => [...current, data])
    setChatInput('')
    await publishData('talio-chat', data)
  }
  const sendReaction = async (reaction) => {
    showReaction(room.localParticipant.identity, reaction)
    await publishData('talio-reaction', { reaction, senderId: room.localParticipant.identity })
    setShowReactions(false)
  }
  const toggleHand = async () => {
    if (!room) return
    const next = !handRaised
    setHandRaised(next)
    setRaisedHands((current) => ({ ...current, [room.localParticipant.identity]: next }))
    await publishData('talio-hand', { raised: next, senderId: room.localParticipant.identity })
  }
  const leave = () => {
    roomRef.current?.disconnect()
    onJoinedChange?.(false)
    onSessionEnded?.()
    if (guestToken) router.push('/')
    else router.push('/dashboard/meetings')
  }

  const localIdentity = room?.localParticipant.identity
  const orderedParticipants = useMemo(() => {
    const presenter = participants.find((participant) => participant.isScreenSharing)
    return presenter ? [presenter, ...participants.filter((participant) => participant.identity !== presenter.identity)] : participants
  }, [participants])
  const isCompact = displayMode === 'compact'
  const isPip = displayMode !== 'full'

  if (!joined) {
    return (
      <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-100 p-4 text-slate-900 dark:bg-slate-950 dark:text-white">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-xl dark:border-white/10 dark:bg-slate-900">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300"><HiOutlineVideoCamera className="h-8 w-8" /></div>
          <h1 className="mt-4 text-xl font-semibold">{meeting?.title || 'Talio Meet'}</h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Managed, adaptive video with automatic low-network optimisation.</p>
          <div className="mt-5 flex justify-center gap-3">
            <button onClick={() => setMuted(!muted)} aria-label={muted ? 'Turn microphone on' : 'Mute microphone'} className={`flex h-12 w-12 items-center justify-center rounded-full ${muted ? 'bg-red-600 text-white' : 'bg-slate-200 dark:bg-slate-800'}`}><CutLineIcon isOff={muted}><HiOutlineMicrophone className="h-6 w-6" /></CutLineIcon></button>
            <button onClick={() => setVideoOff(!videoOff)} aria-label={videoOff ? 'Turn camera on' : 'Turn camera off'} className={`flex h-12 w-12 items-center justify-center rounded-full ${videoOff ? 'bg-red-600 text-white' : 'bg-slate-200 dark:bg-slate-800'}`}><CutLineIcon isOff={videoOff}><HiOutlineVideoCamera className="h-6 w-6" /></CutLineIcon></button>
          </div>
          <button onClick={join} disabled={joining} className="relative mt-6 flex min-h-12 w-full items-center justify-center rounded-xl bg-indigo-600 px-4 font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"><span className={joining ? 'invisible' : ''}>Join meeting</span>{joining && <span className="absolute h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white" />}</button>
        </div>
      </div>
    )
  }

  return (
    <div className={isPip ? `fixed bottom-4 right-4 z-[100] overflow-hidden rounded-2xl border border-slate-300 bg-slate-100 text-slate-900 shadow-2xl dark:border-white/10 dark:bg-slate-950 dark:text-white ${isCompact ? 'h-20 w-72' : 'h-[26rem] w-[min(92vw,28rem)]'}` : 'fixed inset-0 z-[100] flex h-[100dvh] flex-col bg-slate-100 text-slate-900 dark:bg-slate-950 dark:text-white'}>
      <header className="flex min-h-14 items-center justify-between gap-3 border-b border-slate-200 bg-white/90 px-4 dark:border-white/10 dark:bg-slate-900/90">
        <div className="min-w-0"><p className="truncate text-sm font-semibold">{meeting?.title || 'Talio Meet'}</p><p className="flex items-center gap-1 text-xs text-slate-500">{connectionLabel} · {participants.length} participant{participants.length === 1 ? '' : 's'}{!guestToken && transcriptStatus !== 'off' && <><span>·</span><HiOutlineDocumentText className="h-3.5 w-3.5" /><span>{transcriptStatus === 'listening' ? 'Mira listening' : transcriptStatus}</span></>}</p></div>
        <div className="flex items-center gap-1">
          {isPip ? <button onClick={onRestoreMeeting} aria-label="Restore meeting" className="rounded-full p-2 hover:bg-slate-200 dark:hover:bg-white/10"><HiOutlineArrowsPointingOut className="h-5 w-5" /></button> : <button onClick={onMinimizeToPip} aria-label="Minimise meeting" className="rounded-full p-2 hover:bg-slate-200 dark:hover:bg-white/10"><HiOutlineArrowsPointingIn className="h-5 w-5" /></button>}
          {isPip && <button onClick={() => onSetPipSize?.(isCompact ? 'expanded' : 'compact')} aria-label={isCompact ? 'Expand picture in picture' : 'Minimise picture in picture'} className="rounded-full p-2 hover:bg-slate-200 dark:hover:bg-white/10"><HiOutlineMinusSmall className="h-5 w-5" /></button>}
        </div>
      </header>

      {!isCompact && <main className="relative flex min-h-0 flex-1 gap-3 p-3">
        <div className={`grid min-w-0 flex-1 gap-3 overflow-y-auto ${orderedParticipants.length <= 1 ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'}`}>
          {orderedParticipants.map((item, index) => <ParticipantTile key={item.identity} item={item} local={item.identity === localIdentity} reaction={reactions[item.identity]} handRaised={raisedHands[item.identity]} featured={index === 0 && item.isScreenSharing} />)}
        </div>
        {(showChat || showParticipants) && !isPip && <aside className="w-80 shrink-0 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-slate-900">
          <div className="flex items-center justify-between"><h2 className="font-semibold">{showChat ? 'In-meeting chat' : 'Participants'}</h2><button onClick={() => { setShowChat(false); setShowParticipants(false) }} aria-label="Close panel"><HiOutlineXMark className="h-5 w-5" /></button></div>
          {showChat ? <><div className="mt-4 flex h-[calc(100%-5rem)] flex-col gap-2 overflow-y-auto">{messages.length ? messages.map((message) => <div key={message.id} className={`max-w-[90%] rounded-xl px-3 py-2 text-sm ${message.senderId === localIdentity ? 'ml-auto bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-800'}`}><p className="text-xs font-medium opacity-75">{message.senderId === localIdentity ? 'You' : message.senderName}</p><p>{message.message}</p></div>) : <p className="mt-8 text-center text-sm text-slate-500">No messages yet</p>}</div><form onSubmit={sendChat} className="mt-3 flex gap-2"><input value={chatInput} onChange={(event) => setChatInput(event.target.value)} maxLength={2000} placeholder="Message everyone" className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-transparent px-3 dark:border-white/15" /><button aria-label="Send message" className="rounded-xl bg-indigo-600 p-3 text-white"><HiOutlinePaperAirplane className="h-5 w-5" /></button></form></> : <div className="mt-4 space-y-2">{participants.map((participant) => <div key={participant.identity} className="flex items-center justify-between rounded-xl bg-slate-100 p-3 text-sm dark:bg-slate-800"><span>{participant.identity === localIdentity ? 'You' : participant.name}</span>{participant.isMuted && <HiOutlineMicrophone className="h-4 w-4 text-red-500" />}</div>)}{meeting?._id && !guestToken && <button onClick={() => setShowAddParticipants(true)} className="mt-3 w-full rounded-xl border border-indigo-300 px-3 py-2 text-sm font-medium text-indigo-700 dark:text-indigo-300">Add people</button>}</div>}
        </aside>}
      </main>}

      {participants.filter((participant) => participant.identity !== localIdentity).map((participant) => (
        <RemoteAudio key={`audio-${participant.identity}`} participant={participant.participant} />
      ))}

      <footer className={`flex items-center justify-center gap-2 border-t border-slate-200 bg-white/90 px-3 dark:border-white/10 dark:bg-slate-900/90 ${isCompact ? 'absolute bottom-2 right-2 border-0 bg-transparent p-0 dark:bg-transparent' : 'min-h-20'}`}>
        <button onClick={toggleMute} aria-label={muted ? 'Turn microphone on' : 'Mute microphone'} className={`flex h-11 w-11 items-center justify-center rounded-full ${muted ? 'bg-red-600 text-white' : 'bg-slate-200 dark:bg-slate-800'}`}><CutLineIcon isOff={muted}><HiOutlineMicrophone className="h-5 w-5" /></CutLineIcon></button>
        {!isCompact && <><button onClick={toggleVideo} aria-label={videoOff ? 'Turn camera on' : 'Turn camera off'} className={`flex h-11 w-11 items-center justify-center rounded-full ${videoOff ? 'bg-red-600 text-white' : 'bg-slate-200 dark:bg-slate-800'}`}><CutLineIcon isOff={videoOff}><HiOutlineVideoCamera className="h-5 w-5" /></CutLineIcon></button><button onClick={toggleScreen} aria-label={screenSharing ? 'Stop presenting' : 'Present screen'} className={`flex h-11 w-11 items-center justify-center rounded-full ${screenSharing ? 'bg-indigo-600 text-white' : 'bg-slate-200 dark:bg-slate-800'}`}><HiOutlineComputerDesktop className="h-5 w-5" /></button><button onClick={() => { setShowChat(!showChat); setShowParticipants(false) }} aria-label="Open chat" className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-200 dark:bg-slate-800"><HiOutlineChatBubbleLeftRight className="h-5 w-5" /></button><button onClick={() => { setShowParticipants(!showParticipants); setShowChat(false) }} aria-label="Open participants" className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-200 dark:bg-slate-800"><HiOutlineUserGroup className="h-5 w-5" /></button><button onClick={toggleHand} aria-label={handRaised ? 'Lower hand' : 'Raise hand'} className={`flex h-11 w-11 items-center justify-center rounded-full ${handRaised ? 'bg-amber-500 text-white' : 'bg-slate-200 dark:bg-slate-800'}`}><HiOutlineHandRaised className="h-5 w-5" /></button><div className="relative"><button onClick={() => setShowReactions(!showReactions)} aria-label="Open reactions" className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-200 dark:bg-slate-800"><BsEmojiSmile className="h-5 w-5" /></button>{showReactions && <div className="absolute bottom-14 left-1/2 flex -translate-x-1/2 gap-1 rounded-xl border border-slate-200 bg-white p-2 shadow-xl dark:border-white/10 dark:bg-slate-800">{MEETING_REACTIONS.map((reaction) => <button key={reaction.value} onClick={() => sendReaction(reaction.value)} aria-label={`React with ${reaction.label}`} className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-white/10"><MeetingReactionIcon value={reaction.value} className="h-5 w-5" /></button>)}</div>}</div></>}
        <button onClick={leave} aria-label="Leave meeting" className="flex h-11 w-11 items-center justify-center rounded-full bg-red-600 text-white"><HiOutlinePhoneXMark className="h-5 w-5" /></button>
      </footer>
      {showAddParticipants && meeting?._id && <AddMeetingParticipantsModal isOpen meeting={meeting} onClose={() => setShowAddParticipants(false)} onAdded={() => setShowAddParticipants(false)} />}
    </div>
  )
}
