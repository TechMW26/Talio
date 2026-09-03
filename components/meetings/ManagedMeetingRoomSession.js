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
import { CutLineIcon, MeetingReactionIcon } from '@/components/meetings/MeetingVisualIcons'
import MeetingReactionPicker from '@/components/meetings/MeetingReactionPicker'
import AddMeetingParticipantsModal from '@/app/dashboard/meetings/components/AddMeetingParticipantsModal'
import MeetingNotetakerPanel from '@/app/dashboard/meetings/components/MeetingNotetakerPanel'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import { mergeTranscriptSegments } from '@/lib/meetingLanguage'
import { getSupportedAudioMimeType, isMeetingAudioUploadSupported } from '@/lib/meetingTranscriber'
import { getManagedMeetingJoinError } from '@/lib/meetings/transport'
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

function ParticipantTile({ item, local = false, reaction, handRaised = false, featured = false, compact = false }) {
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

  const tileSize = featured
    ? 'h-full min-h-0 w-full'
    : compact
      ? 'h-24 w-36 shrink-0 sm:h-28 sm:w-44'
      : 'min-h-44'

  return (
    <div
      className={`relative flex overflow-hidden bg-slate-200 ring-1 ring-slate-300 dark:bg-slate-900 dark:ring-white/10 ${compact ? 'rounded-xl' : 'rounded-2xl'} ${tileSize}`}
      data-participant-tile={featured ? 'presenter' : compact ? 'rail' : 'grid'}
    >
      {publication?.track && !publication.isMuted ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={local}
          className={`h-full w-full ${item.isScreenSharing ? 'bg-black object-contain' : 'object-cover'} ${local && !item.isScreenSharing ? '-scale-x-100' : ''}`}
        />
      ) : (
        <div className="flex h-full w-full flex-1 items-center justify-center">
          <span className={`flex items-center justify-center rounded-full bg-indigo-600 font-semibold text-white ${compact ? 'h-10 w-10 text-sm' : 'h-16 w-16 text-xl'}`}>
            {item.name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()}
          </span>
        </div>
      )}
      <div className={`absolute flex max-w-[calc(100%-1rem)] items-center gap-1.5 rounded-lg bg-black/65 text-xs font-medium text-white backdrop-blur ${compact ? 'bottom-2 left-2 px-2 py-1' : 'bottom-3 left-3 px-2.5 py-1.5'}`}>
        <span className="truncate">{local ? 'You' : item.name}</span>
        {item.isMuted && <CutLineIcon isOff><HiOutlineMicrophone className="h-4 w-4" /></CutLineIcon>}
      </div>
      {item.isScreenSharing && <span className="absolute left-3 top-3 rounded-full bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white">Presenting</span>}
      {handRaised && <span className="absolute right-3 top-3 rounded-full bg-amber-500 p-2 text-white" aria-label={`${item.name} raised their hand`}><HiOutlineHandRaised className="h-5 w-5" /></span>}
      {reaction && (
        <span className="pointer-events-none absolute bottom-10 left-1/2 z-30 -translate-x-1/2 animate-bounce rounded-full bg-white/95 p-3 text-indigo-700 shadow-xl ring-1 ring-black/5">
          <MeetingReactionIcon value={reaction} className="h-7 w-7" />
        </span>
      )}
    </div>
  )
}

export default function ManagedMeetingRoomSession({
  roomId,
  displayMode = 'full',
  autoJoin = false,
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
  const joiningRef = useRef(false)
  const autoJoinAttemptedRef = useRef(false)
  const leavingRef = useRef(false)
  const meetingSessionStartedAtRef = useRef(null)
  const recorderStopPromiseRef = useRef(Promise.resolve())
  const lastTranscriptUploadRef = useRef(Promise.resolve())
  const reactionTimers = useRef(new Map())
  const chatNotificationTimerRef = useRef(null)
  const seenChatMessageIdsRef = useRef(new Set())
  const showChatRef = useRef(false)
  const [meeting, setMeeting] = useState(meetingData)
  const [room, setRoom] = useState(null)
  const [participants, setParticipants] = useState([])
  const [joined, setJoined] = useState(false)
  const [joining, setJoining] = useState(false)
  const [joinError, setJoinError] = useState('')
  const [muted, setMuted] = useState(false)
  const [videoOff, setVideoOff] = useState(false)
  const [screenSharing, setScreenSharing] = useState(false)
  const [showChat, setShowChat] = useState(false)
  const [showParticipants, setShowParticipants] = useState(false)
  const [showNotetaker, setShowNotetaker] = useState(false)
  const [showReactions, setShowReactions] = useState(false)
  const [showAddParticipants, setShowAddParticipants] = useState(false)
  const [messages, setMessages] = useState([])
  const [chatInput, setChatInput] = useState('')
  const [unreadChatCount, setUnreadChatCount] = useState(0)
  const [chatNotification, setChatNotification] = useState(null)
  const [reactions, setReactions] = useState({})
  const [raisedHands, setRaisedHands] = useState({})
  const [handRaised, setHandRaised] = useState(false)
  const [transcriptStatus, setTranscriptStatus] = useState('off')
  const [liveTranscript, setLiveTranscript] = useState([])
  const [notetakerError, setNotetakerError] = useState('')
  const [isEndingMeeting, setIsEndingMeeting] = useState(false)
  const [endingMeetingStatus, setEndingMeetingStatus] = useState('Saving your latest meeting notes...')
  const [connectionLabel, setConnectionLabel] = useState('Connecting')

  const { data: meetingResponse } = useAuthedSWR(
    guestToken || meetingData ? null : `/api/meetings?roomId=${encodeURIComponent(roomId)}`,
    { revalidateOnFocus: false }
  )
  useEffect(() => {
    if (meetingResponse?.success && meetingResponse.data?.[0]) setMeeting(meetingResponse.data[0])
  }, [meetingResponse])

  const {
    data: transcriptResponse,
    error: transcriptFetchError,
    mutate: refreshTranscript,
  } = useAuthedSWR(
    joined && meeting?._id && !guestToken ? `/api/meetings/${meeting._id}/transcript` : null,
    {
      refreshInterval: joined && !guestToken ? 5000 : 0,
      revalidateOnFocus: false,
      revalidateIfStale: false,
    }
  )

  useEffect(() => {
    if (!transcriptResponse?.success) return
    setLiveTranscript((current) => mergeTranscriptSegments(
      current,
      transcriptResponse.data?.transcript || []
    ))
  }, [transcriptResponse])

  useEffect(() => {
    const chatPanelIsVisible = showChat && displayMode === 'full'
    showChatRef.current = chatPanelIsVisible
    if (!chatPanelIsVisible) return
    clearTimeout(chatNotificationTimerRef.current)
    setChatNotification(null)
    setUnreadChatCount(0)
  }, [displayMode, showChat])

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
        const messageId = data.id || `${sender || 'participant'}:${data.createdAt || Date.now()}:${data.message}`
        if (seenChatMessageIdsRef.current.has(messageId)) return
        seenChatMessageIdsRef.current.add(messageId)
        if (seenChatMessageIdsRef.current.size > 1000) {
          const oldestMessageId = seenChatMessageIdsRef.current.values().next().value
          seenChatMessageIdsRef.current.delete(oldestMessageId)
        }

        const incomingMessage = {
          ...data,
          id: messageId,
          senderId: sender,
          senderName: data.senderName || participant?.name || 'Participant',
        }
        setMessages((current) => [...current, incomingMessage])

        const isRemoteMessage = sender !== roomRef.current?.localParticipant.identity
        if (isRemoteMessage && !showChatRef.current) {
          setUnreadChatCount((current) => current + 1)
          setChatNotification(incomingMessage)
          clearTimeout(chatNotificationTimerRef.current)
          chatNotificationTimerRef.current = setTimeout(() => {
            setChatNotification((current) => current?.id === messageId ? null : current)
          }, 5000)
        }
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
    if (joiningRef.current || joined) return
    joiningRef.current = true
    setJoining(true)
    setJoinError('')
    let pendingRoom = null
    try {
      const authorization = guestToken ? `Guest ${guestToken}` : `Bearer ${localStorage.getItem('token')}`
      const response = await fetch('/api/meetings/livekit/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authorization },
        body: JSON.stringify({ roomId }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        const requestError = new Error(payload?.message || 'Unable to join managed meeting')
        requestError.code = payload?.code || 'TOKEN_REQUEST_FAILED'
        throw requestError
      }
      if (!payload?.data?.serverUrl || !payload?.data?.token) {
        const responseError = new Error('The meeting service returned an invalid connection response')
        responseError.code = 'INVALID_CONNECTION_RESPONSE'
        throw responseError
      }

      const liveRoom = new Room({
        adaptiveStream: true,
        dynacast: true,
        videoCaptureDefaults: { resolution: VideoPresets.h720.resolution },
        publishDefaults: { simulcast: true, videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360] },
      })
      pendingRoom = liveRoom
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
      meetingSessionStartedAtRef.current = new Date().toISOString()
      setConnectionLabel('Connected')
      refreshParticipants(liveRoom)
      onJoinedChange?.(true)
    } catch (error) {
      console.error('[Managed meeting] Join failed:', error)
      pendingRoom?.disconnect()
      if (roomRef.current === pendingRoom) roomRef.current = null
      const message = getManagedMeetingJoinError(error)
      setJoinError(message)
      toast.error(message)
    } finally {
      joiningRef.current = false
      setJoining(false)
    }
  }, [guestToken, handleData, joined, muted, onJoinedChange, refreshParticipants, roomId, videoOff])

  useEffect(() => {
    if (!autoJoin || joined || joiningRef.current || autoJoinAttemptedRef.current) return
    autoJoinAttemptedRef.current = true
    void join()
  }, [autoJoin, join, joined])

  useEffect(() => () => {
    for (const timer of reactionTimers.current.values()) clearTimeout(timer)
    clearTimeout(chatNotificationTimerRef.current)
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
    setNotetakerError('')
    let startedAt = Date.now()
    let resolveRecorderStop
    const recorderStopPromise = new Promise((resolve) => {
      resolveRecorderStop = resolve
    })
    recorderStopPromiseRef.current = recorderStopPromise

    recorder.ondataavailable = (event) => {
      const durationMs = Date.now() - startedAt
      const segmentStartedAt = startedAt
      startedAt = Date.now()
      if (mutedRef.current || !event.data || event.data.size < 2048 || durationMs < 1200) return

      const audioBlob = event.data
      const uploadPromise = lastTranscriptUploadRef.current
        .catch(() => { })
        .then(async () => {
          if (mutedRef.current) return
          const formData = new FormData()
          formData.append('audio', audioBlob, `meeting-${meeting._id}-${segmentStartedAt}.webm`)
          formData.append('startedAt', new Date(segmentStartedAt).toISOString())
          formData.append('durationMs', String(durationMs))
          formData.append('language', 'auto')
          formData.append('source', 'live-pollinations')

          const response = await fetch(`/api/meetings/${meeting._id}/transcript`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
            body: formData,
          })
          const payload = await response.json().catch(() => null)
          if (!response.ok || payload?.success === false) {
            throw new Error(payload?.message || 'Transcription upload failed')
          }

          setLiveTranscript((current) => mergeTranscriptSegments(
            current,
            payload?.data?.segments || []
          ))
          setNotetakerError('')
          await refreshTranscript?.()
          if (!mutedRef.current) setTranscriptStatus('listening')
        })
        .catch((error) => {
          console.error('[Managed meeting] Transcript upload failed:', error)
          setNotetakerError('The latest speech segment could not be saved. Mira will keep listening and retry with the next segment.')
          if (!mutedRef.current) setTranscriptStatus('retrying')
        })

      lastTranscriptUploadRef.current = uploadPromise
    }
    recorder.onstop = () => {
      recordingTrack.stop()
      resolveRecorderStop?.()
    }
    recorder.start(10_000)

    return () => {
      if (recorder.state !== 'inactive') {
        try { recorder.stop() } catch { recordingTrack.stop() }
      } else {
        recordingTrack.stop()
      }
      if (recorderRef.current === recorder) recorderRef.current = null
    }
  }, [guestToken, joined, meeting?._id, muted, refreshTranscript, room])

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
    seenChatMessageIdsRef.current.add(data.id)
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
  const leave = async () => {
    if (leavingRef.current) return
    leavingRef.current = true
    setIsEndingMeeting(true)
    setEndingMeetingStatus('Saving your latest meeting notes...')

    try {
      const activeRecorder = recorderRef.current
      if (activeRecorder?.state && activeRecorder.state !== 'inactive') {
        try { activeRecorder.stop() } catch { /* recorder was already stopping */ }
      }
      await recorderStopPromiseRef.current.catch(() => { })
      await lastTranscriptUploadRef.current.catch(() => { })

      if (meeting?._id && meeting.isOrganizer && !guestToken) {
        const token = localStorage.getItem('token')
        const actualEnd = new Date().toISOString()
        const sessionStartedAt = meetingSessionStartedAtRef.current
          || meeting.actualStart
          || meeting.scheduledStart
          || actualEnd
        const completed = !meeting.scheduledEnd || new Date(actualEnd) >= new Date(meeting.scheduledEnd)
        const nextStatus = completed ? 'completed' : 'in-progress'

        setEndingMeetingStatus('Saving meeting status...')
        const meetingUpdateResponse = await fetch(`/api/meetings/${meeting._id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            status: nextStatus,
            actualStart: meeting.actualStart || meeting.scheduledStart || sessionStartedAt,
            ...(completed ? { actualEnd } : {}),
          }),
        })
        if (!meetingUpdateResponse.ok) {
          console.error('[Managed meeting] Meeting status could not be updated')
        }

        setEndingMeetingStatus('Generating Mira meeting notes...')
        const summaryResponse = await fetch(`/api/meetings/${meeting._id}/summary`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            language: 'auto',
            allowNoContent: true,
            sendMomEmails: completed,
            sessionStartedAt,
            sessionEndedAt: actualEnd,
          }),
        })
        const summaryPayload = await summaryResponse.json().catch(() => null)
        if (!summaryResponse.ok || summaryPayload?.success === false) {
          throw new Error(summaryPayload?.message || 'Mira meeting notes could not be generated')
        }
        if (summaryPayload?.data?.generated) {
          toast.success('Mira meeting notes were saved to the meeting record')
        }
      }
    } catch (error) {
      console.error('[Managed meeting] Note finalisation failed:', error)
      toast.error('The meeting ended, but Mira notes could not be finalised. You can retry from meeting details.')
    } finally {
      setEndingMeetingStatus('Closing meeting room...')
      meetingSessionStartedAtRef.current = null
      roomRef.current?.disconnect()
      onJoinedChange?.(false)
      onSessionEnded?.()
      if (guestToken) router.push('/')
      else router.push(meeting?._id ? `/dashboard/meetings/${meeting._id}` : '/dashboard/meetings')
    }
  }

  const toggleNotetaker = () => {
    setShowChat(false)
    setShowParticipants(false)
    setShowReactions(false)
    if (isPip) {
      setShowNotetaker(true)
      onRestoreMeeting?.()
      return
    }
    setShowNotetaker((current) => !current)
  }

  const localIdentity = room?.localParticipant.identity
  const orderedParticipants = useMemo(() => {
    const presenter = participants.find((participant) => participant.isScreenSharing)
    return presenter ? [presenter, ...participants.filter((participant) => participant.identity !== presenter.identity)] : participants
  }, [participants])
  const presenter = orderedParticipants[0]?.isScreenSharing ? orderedParticipants[0] : null
  const railParticipants = presenter ? orderedParticipants.slice(1) : []
  const isCompact = displayMode === 'compact'
  const isBubble = displayMode === 'bubble'
  const isPip = displayMode !== 'full'
  const clearChatAlerts = () => {
    clearTimeout(chatNotificationTimerRef.current)
    setChatNotification(null)
    setUnreadChatCount(0)
  }
  const openChatPanel = () => {
    clearChatAlerts()
    showChatRef.current = !isPip
    setShowChat(true)
    setShowParticipants(false)
    setShowNotetaker(false)
    setShowReactions(false)
    if (isPip) onRestoreMeeting?.()
  }
  const toggleChatPanel = () => {
    if (showChat) {
      showChatRef.current = false
      setShowChat(false)
      return
    }
    openChatPanel()
  }
  const participantLabel = `${participants.length} participant${participants.length === 1 ? '' : 's'}`
  const transcriptLabel = !guestToken && transcriptStatus !== 'off'
    ? (transcriptStatus === 'listening' ? 'Mira listening' : transcriptStatus)
    : null
  const endingMeetingOverlay = isEndingMeeting ? (
    <div className="fixed inset-0 z-[160] flex items-center justify-center bg-slate-100/80 px-6 backdrop-blur-sm dark:bg-slate-950/80">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white/95 p-6 text-center shadow-2xl dark:border-white/10 dark:bg-slate-900/95">
        <div className="mx-auto h-12 w-12 animate-spin rounded-full border-[3px] border-indigo-200 border-t-indigo-600 dark:border-white/15 dark:border-t-indigo-400" />
        <h2 className="mt-4 text-lg font-semibold">Ending meeting...</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{endingMeetingStatus}</p>
      </div>
    </div>
  ) : null
  const chatNotificationBanner = chatNotification && !(showChat && !isPip) ? (
    <div
      className="fixed right-3 top-[calc(4rem+env(safe-area-inset-top))] z-[150] w-[min(22rem,calc(100vw-1.5rem))]"
      role="status"
      aria-live="polite"
      data-meeting-chat-notification
    >
      <button
        type="button"
        onClick={openChatPanel}
        className="flex w-full items-start gap-3 rounded-2xl border border-slate-200/90 bg-white/95 p-3 text-left text-slate-900 shadow-2xl ring-1 ring-black/5 backdrop-blur-xl transition hover:-translate-y-0.5 hover:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-white/15 dark:bg-slate-900/95 dark:text-white dark:ring-white/10 dark:hover:border-indigo-400/60"
        aria-label={`Open message from ${chatNotification.senderName || 'participant'}`}
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-200">
          <HiOutlineChatBubbleLeftRight className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{chatNotification.senderName || 'Participant'}</span>
          <span className="mt-0.5 block truncate text-sm text-slate-600 dark:text-slate-300">{chatNotification.message}</span>
        </span>
        {unreadChatCount > 0 && (
          <span className="flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-red-600 px-1.5 text-xs font-bold text-white" aria-label={`${unreadChatCount} unread message${unreadChatCount === 1 ? '' : 's'}`}>
            {unreadChatCount > 99 ? '99+' : unreadChatCount}
          </span>
        )}
      </button>
    </div>
  ) : null

  if (!joined) {
    const isRestoring = autoJoin && !joinError
    return (
      <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-100 p-4 text-slate-900 dark:bg-slate-950 dark:text-white">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-xl dark:border-white/10 dark:bg-slate-900">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300"><HiOutlineVideoCamera className="h-8 w-8" /></div>
          <h1 className="mt-4 text-xl font-semibold">{meeting?.title || 'Talio Meet'}</h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            {isRestoring ? 'Restoring your secure meeting connection…' : 'Managed, adaptive video with automatic low-network optimisation.'}
          </p>
          <div className={`mt-5 justify-center gap-3 ${isRestoring ? 'hidden' : 'flex'}`}>
            <button onClick={() => setMuted(!muted)} aria-label={muted ? 'Turn microphone on' : 'Mute microphone'} className={`flex h-12 w-12 items-center justify-center rounded-full ${muted ? 'bg-red-600 text-white' : 'bg-slate-200 dark:bg-slate-800'}`}><CutLineIcon isOff={muted}><HiOutlineMicrophone className="h-6 w-6" /></CutLineIcon></button>
            <button onClick={() => setVideoOff(!videoOff)} aria-label={videoOff ? 'Turn camera on' : 'Turn camera off'} className={`flex h-12 w-12 items-center justify-center rounded-full ${videoOff ? 'bg-red-600 text-white' : 'bg-slate-200 dark:bg-slate-800'}`}><CutLineIcon isOff={videoOff}><HiOutlineVideoCamera className="h-6 w-6" /></CutLineIcon></button>
          </div>
          {joinError && <p className="mt-5 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-200" role="alert">{joinError}</p>}
          <button onClick={join} disabled={joining || isRestoring} className="relative mt-6 flex min-h-12 w-full items-center justify-center rounded-xl bg-indigo-600 px-4 font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"><span className={joining || isRestoring ? 'invisible' : ''}>{joinError ? 'Try again' : 'Join meeting'}</span>{(joining || isRestoring) && <span className="absolute h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white" />}</button>
        </div>
      </div>
    )
  }

  if (isPip && isBubble) {
    return (
      <>
        {chatNotificationBanner}
        {participants.filter((participant) => participant.identity !== localIdentity).map((participant) => (
          <RemoteAudio key={`audio-${participant.identity}`} participant={participant.participant} />
        ))}
        <button
          type="button"
          onClick={() => onSetPipSize?.('compact')}
          className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-4 z-[130] flex h-14 w-14 items-center justify-center rounded-full border border-indigo-300/40 bg-indigo-600 text-white shadow-2xl ring-1 ring-black/10 transition hover:scale-105 hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-2 dark:ring-white/15"
          title="Expand Talio Meet"
          aria-label="Expand Talio Meet picture in picture"
          data-meeting-pip="bubble"
        >
          <HiOutlineVideoCamera className="h-6 w-6" />
          <span className={`absolute right-0 top-0 h-3 w-3 rounded-full border-2 border-white ${muted ? 'bg-red-500' : 'bg-emerald-400'}`} aria-hidden="true" />
          {unreadChatCount > 0 && (
            <span className="absolute -left-1 -top-1 flex h-6 min-w-6 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white ring-2 ring-white dark:ring-slate-950" aria-label={`${unreadChatCount} unread message${unreadChatCount === 1 ? '' : 's'}`}>
              {unreadChatCount > 99 ? '99+' : unreadChatCount}
            </span>
          )}
        </button>
      </>
    )
  }

  if (isPip && isCompact) {
    return (
      <>
        {endingMeetingOverlay}
        {chatNotificationBanner}
        <section
          className="fixed inset-x-3 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-[130] mx-auto flex min-h-[5.25rem] w-[min(94vw,22rem)] items-center gap-3 overflow-hidden rounded-2xl border border-slate-200/80 bg-white/95 px-3 py-2.5 text-slate-900 shadow-2xl ring-1 ring-black/5 backdrop-blur-xl dark:border-white/15 dark:bg-slate-950/95 dark:text-white dark:ring-white/10 sm:inset-x-auto sm:right-4 sm:mx-0"
          aria-label="Talio Meet compact picture in picture"
          data-meeting-pip="compact"
        >
        {participants.filter((participant) => participant.identity !== localIdentity).map((participant) => (
          <RemoteAudio key={`audio-${participant.identity}`} participant={participant.participant} />
        ))}

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold leading-5">{meeting?.title || 'Talio Meet'}</p>
          <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] leading-4 text-slate-500 dark:text-slate-400">
            <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
            <span className="truncate">
              {connectionLabel} · {participantLabel}{transcriptLabel ? ` · ${transcriptLabel}` : ''}
            </span>
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={unreadChatCount > 0 ? openChatPanel : onRestoreMeeting}
            aria-label={unreadChatCount > 0 ? `Open ${unreadChatCount} unread meeting message${unreadChatCount === 1 ? '' : 's'}` : 'Restore meeting'}
            title={unreadChatCount > 0 ? 'Open unread messages' : 'Restore meeting'}
            className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-200 text-slate-700 transition hover:bg-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-400 dark:bg-slate-800 dark:text-white dark:hover:bg-slate-700"
          >
            <HiOutlineArrowsPointingOut className="h-5 w-5" />
            {unreadChatCount > 0 && (
              <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white ring-2 ring-white dark:ring-slate-950" aria-hidden="true">
                {unreadChatCount > 99 ? '99+' : unreadChatCount}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => onSetPipSize?.('bubble')}
            aria-label="Minimise picture in picture to bubble"
            title="Minimise to bubble"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-200 text-slate-700 transition hover:bg-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-400 dark:bg-slate-800 dark:text-white dark:hover:bg-slate-700"
          >
            <HiOutlineMinusSmall className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={toggleMute}
            aria-label={muted ? 'Turn microphone on' : 'Mute microphone'}
            title={muted ? 'Unmute' : 'Mute'}
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white transition focus:outline-none focus:ring-2 focus:ring-indigo-400 ${muted ? 'bg-red-600 hover:bg-red-500' : 'bg-slate-700 hover:bg-slate-600'}`}
          >
            <CutLineIcon isOff={muted}><HiOutlineMicrophone className="h-5 w-5" /></CutLineIcon>
          </button>
          <button
            type="button"
            onClick={leave}
            disabled={isEndingMeeting}
            aria-label="Leave meeting"
            title="Leave meeting"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-600 text-white transition hover:bg-red-500 focus:outline-none focus:ring-2 focus:ring-red-400"
          >
            <HiOutlinePhoneXMark className="h-5 w-5" />
          </button>
        </div>
        </section>
      </>
    )
  }

  return (
    <div
      className={isPip
        ? 'fixed inset-x-3 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-[130] mx-auto flex h-[min(26rem,calc(100dvh-2rem))] w-[min(94vw,28rem)] flex-col overflow-hidden rounded-3xl border border-slate-200/80 bg-slate-100 text-slate-900 shadow-2xl ring-1 ring-black/5 backdrop-blur-xl dark:border-white/15 dark:bg-slate-950 dark:text-white dark:ring-white/10 sm:inset-x-auto sm:right-4 sm:mx-0'
        : 'fixed inset-0 z-[100] flex h-[100dvh] flex-col bg-slate-100 text-slate-900 dark:bg-slate-950 dark:text-white'}
      data-meeting-pip={isPip ? 'expanded' : undefined}
    >
      {endingMeetingOverlay}
      {chatNotificationBanner}
      <header className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white/90 px-4 dark:border-white/10 dark:bg-slate-900/90">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{meeting?.title || 'Talio Meet'}</p>
          <p className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
            <span className="truncate">{connectionLabel} · {participantLabel}</span>
            {transcriptLabel && <><span className="shrink-0">·</span><HiOutlineDocumentText className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{transcriptLabel}</span></>}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {isPip ? <button onClick={onRestoreMeeting} aria-label="Restore meeting" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full hover:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400 dark:hover:bg-white/10"><HiOutlineArrowsPointingOut className="h-5 w-5" /></button> : <button onClick={onMinimizeToPip} aria-label="Minimise meeting" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full hover:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400 dark:hover:bg-white/10"><HiOutlineArrowsPointingIn className="h-5 w-5" /></button>}
          {isPip && <button onClick={() => onSetPipSize?.('compact')} aria-label="Minimise picture in picture" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full hover:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400 dark:hover:bg-white/10"><HiOutlineMinusSmall className="h-5 w-5" /></button>}
        </div>
      </header>

      {!isCompact && <main className="relative flex min-h-0 flex-1 gap-3 p-3">
        {presenter ? (
          <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-hidden" data-meeting-layout="presentation">
            <div className="min-h-0 flex-1 overflow-hidden rounded-2xl bg-black">
              <ParticipantTile item={presenter} local={presenter.identity === localIdentity} reaction={reactions[presenter.identity]} handRaised={raisedHands[presenter.identity]} featured />
            </div>
            {railParticipants.length > 0 && (
              <div className="flex h-24 shrink-0 gap-2 overflow-x-auto overflow-y-hidden px-0.5 py-0.5 sm:h-28" data-meeting-participant-rail>
                {railParticipants.map((item) => (
                  <ParticipantTile key={item.identity} item={item} local={item.identity === localIdentity} reaction={reactions[item.identity]} handRaised={raisedHands[item.identity]} compact />
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className={`grid min-w-0 flex-1 gap-3 overflow-y-auto ${orderedParticipants.length <= 1 ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'}`} data-meeting-layout="grid">
            {orderedParticipants.map((item) => <ParticipantTile key={item.identity} item={item} local={item.identity === localIdentity} reaction={reactions[item.identity]} handRaised={raisedHands[item.identity]} />)}
          </div>
        )}
        {(showChat || showParticipants) && !isPip && <aside className="w-80 shrink-0 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-slate-900">
          <div className="flex items-center justify-between"><h2 className="font-semibold">{showChat ? 'In-meeting chat' : 'Participants'}</h2><button onClick={() => { setShowChat(false); setShowParticipants(false) }} aria-label="Close panel"><HiOutlineXMark className="h-5 w-5" /></button></div>
          {showChat ? <><div className="mt-4 flex h-[calc(100%-5rem)] flex-col gap-2 overflow-y-auto">{messages.length ? messages.map((message) => <div key={message.id} className={`max-w-[90%] rounded-xl px-3 py-2 text-sm ${message.senderId === localIdentity ? 'ml-auto bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-800'}`}><p className="text-xs font-medium opacity-75">{message.senderId === localIdentity ? 'You' : message.senderName}</p><p>{message.message}</p></div>) : <p className="mt-8 text-center text-sm text-slate-500">No messages yet</p>}</div><form onSubmit={sendChat} className="mt-3 flex gap-2"><input value={chatInput} onChange={(event) => setChatInput(event.target.value)} maxLength={2000} placeholder="Message everyone" className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-transparent px-3 dark:border-white/15" /><button aria-label="Send message" className="rounded-xl bg-indigo-600 p-3 text-white"><HiOutlinePaperAirplane className="h-5 w-5" /></button></form></> : <div className="mt-4 space-y-2">{participants.map((participant) => <div key={participant.identity} className="flex items-center justify-between rounded-xl bg-slate-100 p-3 text-sm dark:bg-slate-800"><span>{participant.identity === localIdentity ? 'You' : participant.name}</span>{participant.isMuted && <HiOutlineMicrophone className="h-4 w-4 text-red-500" />}</div>)}{meeting?._id && !guestToken && <button onClick={() => setShowAddParticipants(true)} className="mt-3 w-full rounded-xl border border-indigo-300 px-3 py-2 text-sm font-medium text-indigo-700 dark:text-indigo-300">Add people</button>}</div>}
        </aside>}
        {!isPip && !guestToken && (
          <MeetingNotetakerPanel
            isOpen={showNotetaker}
            error={notetakerError || transcriptFetchError?.message}
            transcript={liveTranscript}
            onClose={() => setShowNotetaker(false)}
          />
        )}
      </main>}

      {participants.filter((participant) => participant.identity !== localIdentity).map((participant) => (
        <RemoteAudio key={`audio-${participant.identity}`} participant={participant.participant} />
      ))}

      <footer className="flex min-h-20 shrink-0 items-center justify-center gap-2 overflow-x-auto border-t border-slate-200 bg-white/90 px-3 dark:border-white/10 dark:bg-slate-900/90">
        <button onClick={toggleMute} aria-label={muted ? 'Turn microphone on' : 'Mute microphone'} className={`flex h-11 w-11 items-center justify-center rounded-full ${muted ? 'bg-red-600 text-white' : 'bg-slate-200 dark:bg-slate-800'}`}><CutLineIcon isOff={muted}><HiOutlineMicrophone className="h-5 w-5" /></CutLineIcon></button>
        {!isCompact && <>
          <button onClick={toggleVideo} aria-label={videoOff ? 'Turn camera on' : 'Turn camera off'} className={`flex h-11 w-11 items-center justify-center rounded-full ${videoOff ? 'bg-red-600 text-white' : 'bg-slate-200 dark:bg-slate-800'}`}><CutLineIcon isOff={videoOff}><HiOutlineVideoCamera className="h-5 w-5" /></CutLineIcon></button>
          <button onClick={toggleScreen} aria-label={screenSharing ? 'Stop presenting' : 'Present screen'} className={`flex h-11 w-11 items-center justify-center rounded-full ${screenSharing ? 'bg-indigo-600 text-white' : 'bg-slate-200 dark:bg-slate-800'}`}><HiOutlineComputerDesktop className="h-5 w-5" /></button>
          {!guestToken && <button onClick={toggleNotetaker} aria-label={showNotetaker ? 'Close meeting notes' : 'Open meeting notes'} title="Meeting notes" className={`flex h-11 w-11 items-center justify-center rounded-full ${showNotetaker ? 'bg-indigo-600 text-white' : 'bg-slate-200 dark:bg-slate-800'}`}><HiOutlineDocumentText className="h-5 w-5" /></button>}
          <button onClick={toggleChatPanel} aria-label={showChat ? 'Close chat' : 'Open chat'} className={`relative flex h-11 w-11 items-center justify-center rounded-full ${showChat ? 'bg-indigo-600 text-white' : 'bg-slate-200 dark:bg-slate-800'}`}><HiOutlineChatBubbleLeftRight className="h-5 w-5" />{unreadChatCount > 0 && !showChat && <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white ring-2 ring-white dark:ring-slate-900" aria-label={`${unreadChatCount} unread message${unreadChatCount === 1 ? '' : 's'}`}>{unreadChatCount > 99 ? '99+' : unreadChatCount}</span>}</button>
          <button onClick={() => { setShowParticipants(!showParticipants); setShowChat(false); setShowNotetaker(false) }} aria-label="Open participants" className={`flex h-11 w-11 items-center justify-center rounded-full ${showParticipants ? 'bg-indigo-600 text-white' : 'bg-slate-200 dark:bg-slate-800'}`}><HiOutlineUserGroup className="h-5 w-5" /></button>
          <button onClick={toggleHand} aria-label={handRaised ? 'Lower hand' : 'Raise hand'} className={`flex h-11 w-11 items-center justify-center rounded-full ${handRaised ? 'bg-amber-500 text-white' : 'bg-slate-200 dark:bg-slate-800'}`}><HiOutlineHandRaised className="h-5 w-5" /></button>
          <MeetingReactionPicker
            isOpen={showReactions}
            onOpenChange={setShowReactions}
            onSelect={sendReaction}
            buttonClassName={`flex h-11 w-11 items-center justify-center rounded-full ${showReactions ? 'bg-indigo-600 text-white' : 'bg-slate-200 dark:bg-slate-800'}`}
            iconClassName="h-5 w-5"
          />
        </>}
        <button onClick={leave} disabled={isEndingMeeting} aria-label="Leave meeting" className="flex h-11 w-11 items-center justify-center rounded-full bg-red-600 text-white disabled:cursor-wait disabled:opacity-60"><HiOutlinePhoneXMark className="h-5 w-5" /></button>
      </footer>
      {showAddParticipants && meeting?._id && <AddMeetingParticipantsModal isOpen meeting={meeting} onClose={() => setShowAddParticipants(false)} onAdded={() => setShowAddParticipants(false)} />}
    </div>
  )
}
