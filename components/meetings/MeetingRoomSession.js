'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import {
  HiOutlineMicrophone,
  HiOutlineVideoCamera,
  HiOutlineComputerDesktop,
  HiOutlinePhoneXMark,
  HiOutlineChatBubbleLeftRight,
  HiOutlineUserGroup,
  HiOutlineHandRaised,
  HiOutlineDocumentText,
  HiOutlineXMark,
  HiOutlinePaperAirplane,
  HiOutlineStopCircle,
  HiOutlineArrowsPointingIn,
  HiOutlineArrowsPointingOut,
  HiOutlineMinusSmall,
  HiOutlineUserPlus,
  HiMiniMicrophone,
  HiMiniVideoCamera
} from 'react-icons/hi2'
import { Skeleton } from '@heroui/react'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import { apiMutate } from '@/hooks/useApiMutation'
import MeetingNotetakerPanel from '@/app/dashboard/meetings/components/MeetingNotetakerPanel'
import AddMeetingParticipantsModal from '@/app/dashboard/meetings/components/AddMeetingParticipantsModal'
import {
  getMeetingTranscriptionMode,
  getMeetingTranscriptionUnavailableReason,
  getSupportedAudioMimeType,
} from '@/lib/meetingTranscriber'
import {
  mergeTranscriptSegments,
  normalizeMeetingLanguage,
} from '@/lib/meetingLanguage'
import {
  addIceCandidateOrQueue,
  clearQueuedIceCandidates,
  createMeetingRtcConfiguration,
  flushQueuedIceCandidates,
} from '@/lib/meetingRtc'
import {
  applyMeetingSenderQuality,
  MEETING_AUDIO_CONSTRAINTS,
  MEETING_CAMERA_CONSTRAINTS,
  MEETING_SCREEN_CONSTRAINTS,
  optimizeMeetingPeerConnections,
  prepareMeetingMediaStream,
} from '@/lib/meetingMediaQuality'
import { BsPin, BsPinFill, BsEmojiSmile } from 'react-icons/bs'
import {
  CutLineIcon,
  MEETING_REACTIONS,
  MeetingReactionIcon,
} from '@/components/meetings/MeetingVisualIcons'
import toast from '@/utils/toast'

const CONNECTION_QUALITY_META = {
  good: { label: 'Good', dot: 'bg-emerald-500 dark:bg-emerald-400', text: 'text-emerald-700 dark:text-emerald-300' },
  fair: { label: 'Adapting', dot: 'bg-amber-500 dark:bg-amber-400', text: 'text-amber-700 dark:text-amber-300' },
  poor: { label: 'Low network', dot: 'bg-red-500 dark:bg-red-400', text: 'text-red-700 dark:text-red-300' },
}

export default function MeetingRoomSession({
  roomId,
  displayMode = 'full',
  autoJoin = false,
  onJoinedChange,
  onMinimizeToPip,
  onRestoreMeeting,
  onSetPipSize,
  onSessionEnded,
}) {
  const router = useRouter()

  // --- SWR: Fetch meeting data ---
  const {
    data: meetingsRes,
    error: meetingError,
    isLoading: meetingLoading,
    mutate: refreshMeeting,
  } = useAuthedSWR(
    `/api/meetings?roomId=${roomId}`,
    { revalidateOnFocus: false, revalidateIfStale: false }
  )

  // Derive user from localStorage
  const user = useMemo(() => {
    if (typeof window === 'undefined') return null
    try {
      const storedUser = localStorage.getItem('user')
      return storedUser ? JSON.parse(storedUser) : null
    } catch {
      return null
    }
  }, [])

  const userDisplayName = useMemo(() => {
    const fullName = `${user?.firstName || ''} ${user?.lastName || ''}`.trim()
    return fullName || 'You'
  }, [user])

  // State
  const [meeting, setMeeting] = useState(null)
  const [isJoined, setIsJoined] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [isVideoOff, setIsVideoOff] = useState(false)
  const [isScreenSharing, setIsScreenSharing] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [showChat, setShowChat] = useState(false)
  const [showParticipants, setShowParticipants] = useState(false)
  const [chatMessages, setChatMessages] = useState([])
  const [chatInput, setChatInput] = useState('')
  const [isSendingChat, setIsSendingChat] = useState(false)
  const [chatError, setChatError] = useState('')
  const [unreadChatCount, setUnreadChatCount] = useState(0)
  const [participants, setParticipants] = useState([])
  const [showAddParticipants, setShowAddParticipants] = useState(false)
  const [handRaised, setHandRaised] = useState(false)
  const [pinnedTile, setPinnedTile] = useState(null) // 'local', participant id, or 'screen'
  const [showReactions, setShowReactions] = useState(false)
  const [floatingReactions, setFloatingReactions] = useState([])
  const [hasLocalStream, setHasLocalStream] = useState(false) // Track when stream is ready
  const [hasScreenStream, setHasScreenStream] = useState(false) // Track screen stream
  const [previewReady, setPreviewReady] = useState(false) // Track preview camera state
  const [previewError, setPreviewError] = useState(null) // Track preview errors
  const [autoJoinFailed, setAutoJoinFailed] = useState(false)
  const [showNotetaker, setShowNotetaker] = useState(false)
  const [liveTranscript, setLiveTranscript] = useState([])
  const [transcriptLanguages, setTranscriptLanguages] = useState([])
  const [notetakerReady, setNotetakerReady] = useState(false)
  const [notetakerError, setNotetakerError] = useState(null)
  const [notetakerMode, setNotetakerMode] = useState('unsupported')
  const [isEndingMeeting, setIsEndingMeeting] = useState(false)
  const [endingMeetingStatus, setEndingMeetingStatus] = useState('Saving your latest meeting activity...')
  const [connectionQuality, setConnectionQuality] = useState('good')

  const { data: transcriptRes, mutate: refreshTranscript } = useAuthedSWR(
    isJoined && meeting?._id ? `/api/meetings/${meeting._id}/transcript` : null,
    {
      refreshInterval: isJoined ? 5000 : 0,
      revalidateOnFocus: false,
      revalidateIfStale: false,
    }
  )

  // Refs
  const localVideoRef = useRef(null)
  const screenVideoRef = useRef(null)
  const localStreamRef = useRef(null)
  const screenStreamRef = useRef(null)
  const mediaRecorderRef = useRef(null)
  const recordedChunksRef = useRef([])
  const socketRef = useRef(null)
  const peerConnectionsRef = useRef({})
  const pendingIceCandidatesRef = useRef({})
  const remoteStreamsRef = useRef({})
  const cameraPreviewStartedRef = useRef(false)
  const meetingStartedRef = useRef(false)
  const meetingSocketJoinedRef = useRef(false)
  const isLeavingRef = useRef(false)
  const autoJoinAttemptedRef = useRef(false)
  const meetingSessionStartedAtRef = useRef(null)
  const transcriptionRecorderRef = useRef(null)
  const lastTranscriptionPromiseRef = useRef(Promise.resolve())
  const isMutedRef = useRef(false)
  const showChatRef = useRef(false)
  const connectionStatsRef = useRef(new WeakMap())
  const connectionQualityRef = useRef('good')
  const connectionRecoverySamplesRef = useRef(0)
  const stopScreenShareRef = useRef(null)
  const iceRestartingPeersRef = useRef(new Set())
  const isScreenSharingRef = useRef(false)

  useEffect(() => {
    isMutedRef.current = isMuted
  }, [isMuted])

  useEffect(() => {
    isScreenSharingRef.current = isScreenSharing
  }, [isScreenSharing])

  useEffect(() => {
    showChatRef.current = showChat
    if (showChat) setUnreadChatCount(0)
  }, [showChat])

  useEffect(() => {
    if (!isJoined) return undefined

    let cancelled = false
    const qualityRank = { good: 0, fair: 1, poor: 2 }
    const monitorConnections = async () => {
      const measuredQuality = await optimizeMeetingPeerConnections({
        peerConnections: peerConnectionsRef.current,
        previousSamples: connectionStatsRef.current,
        isScreenSharing,
        qualityFloor: connectionQualityRef.current,
      })
      if (cancelled) return

      const currentQuality = connectionQualityRef.current
      if (qualityRank[measuredQuality] > qualityRank[currentQuality]) {
        connectionRecoverySamplesRef.current = 0
        connectionQualityRef.current = measuredQuality
        setConnectionQuality(measuredQuality)
      } else if (qualityRank[measuredQuality] < qualityRank[currentQuality]) {
        connectionRecoverySamplesRef.current += 1
        if (connectionRecoverySamplesRef.current >= 3) {
          connectionRecoverySamplesRef.current = 0
          connectionQualityRef.current = measuredQuality
          setConnectionQuality(measuredQuality)
        }
      } else {
        connectionRecoverySamplesRef.current = 0
      }
    }

    void monitorConnections()
    const intervalId = setInterval(() => void monitorConnections(), 5000)
    return () => {
      cancelled = true
      clearInterval(intervalId)
    }
  }, [isJoined, isScreenSharing, participants.length])

  const updateTranscriptLanguages = useCallback((segments = []) => {
    const nextLanguages = segments
      .map(segment => normalizeMeetingLanguage(segment?.language || 'auto'))
      .filter(Boolean)
      .filter(language => language !== 'auto')

    if (nextLanguages.length === 0) return

    setTranscriptLanguages(prev => [...new Set([...prev, ...nextLanguages])])
  }, [])

  const applyPersistedTranscriptSegments = useCallback((segments = []) => {
    if (!Array.isArray(segments) || segments.length === 0) {
      return
    }

    setLiveTranscript(prev => mergeTranscriptSegments(prev, segments))
    updateTranscriptLanguages(segments)
  }, [updateTranscriptLanguages])

  const persistTranscriptSegments = useCallback(async (segments) => {
    if (!meeting?._id || !Array.isArray(segments) || segments.length === 0) {
      return
    }

    const response = await apiMutate(`/api/meetings/${meeting._id}/transcript`, {
      method: 'POST',
      body: {
        language: 'auto',
        source: segments[0]?.source || 'live-transcript',
        segments,
      },
    })

    applyPersistedTranscriptSegments(response?.data?.segments || segments)

    if (refreshTranscript) {
      await refreshTranscript()
    }
  }, [meeting?._id, refreshTranscript, applyPersistedTranscriptSegments])

  const stopTranscriptionRecorder = useCallback((discardPending = false) => {
    const recorderState = transcriptionRecorderRef.current

    if (!recorderState) {
      return Promise.resolve()
    }

    recorderState.discardPending = recorderState.discardPending || discardPending
    transcriptionRecorderRef.current = null

    if (recorderState.mediaRecorder.state !== 'inactive') {
      try {
        recorderState.mediaRecorder.stop()
      } catch {
        recorderState.recordingTrack.stop()
        recorderState.resolveStopPromise?.()
      }

      return recorderState.stopPromise
    }

    recorderState.recordingTrack.stop()
    recorderState.resolveStopPromise?.()
    return recorderState.stopPromise
  }, [])

  const transcribeRecordedSegmentWithPollinations = useCallback(async ({ blob, startedAt, durationMs }) => {
    if (!meeting?._id || !blob || isMutedRef.current) {
      return
    }

    const formData = new FormData()
    formData.append('audio', blob, `meeting-${meeting._id}-${startedAt}.webm`)
    formData.append('startedAt', new Date(startedAt).toISOString())
    formData.append('durationMs', String(durationMs))
    formData.append('language', transcriptLanguages[0] || 'auto')
    formData.append('source', 'live-pollinations')

    const response = await apiMutate(`/api/meetings/${meeting._id}/transcript`, {
      method: 'POST',
      body: formData,
      timeout: 60000,
    })

    applyPersistedTranscriptSegments(response?.data?.segments || [])

    if (refreshTranscript) {
      await refreshTranscript()
    }
  }, [meeting?._id, transcriptLanguages, applyPersistedTranscriptSegments, refreshTranscript])

  useEffect(() => {
    if (!transcriptRes?.success) return

    const nextTranscript = transcriptRes.data?.transcript || []
    const nextLanguages = transcriptRes.data?.languages || []

    setLiveTranscript(prev => mergeTranscriptSegments(prev, nextTranscript))
    setTranscriptLanguages(prev => [
      ...new Set([
        ...prev,
        ...nextLanguages
          .map(language => normalizeMeetingLanguage(language || 'auto'))
          .filter(Boolean)
          .filter(language => language !== 'auto')
      ])
    ])

  }, [transcriptRes])

  useEffect(() => {
    if (!isJoined) return undefined

    const transcriptionMode = getMeetingTranscriptionMode()
    setNotetakerMode(transcriptionMode)

    if (transcriptionMode === 'unsupported') {
      setNotetakerReady(false)
      setNotetakerError(getMeetingTranscriptionUnavailableReason())
      return undefined
    }

    if (transcriptionMode === 'pollinations') {
      setNotetakerError(null)
      setNotetakerReady(true)
      return undefined
    }

    setNotetakerReady(false)
    setNotetakerError(getMeetingTranscriptionUnavailableReason())
    return undefined
  }, [isJoined])

  const upsertParticipant = useCallback((participantLike) => {
    if (!participantLike?.id) return

    setParticipants(prev => {
      const existing = prev.find(p => p.id === participantLike.id)
      if (existing) {
        return prev.map(p => p.id === participantLike.id
          ? { ...p, ...participantLike, stream: participantLike.stream || p.stream }
          : p
        )
      }
      return [...prev, participantLike]
    })
  }, [])

  // Effect to attach local stream to video element when it becomes available
  useEffect(() => {
    if (hasLocalStream && localVideoRef.current && localStreamRef.current) {
      if (localVideoRef.current.srcObject !== localStreamRef.current) {
        localVideoRef.current.srcObject = localStreamRef.current
        localVideoRef.current.play().catch(() => { })
      }
    }
  }, [hasLocalStream])

  // Effect to attach screen stream to video element when it becomes available
  useEffect(() => {
    if (hasScreenStream && screenVideoRef.current && screenStreamRef.current) {
      if (screenVideoRef.current.srcObject !== screenStreamRef.current) {
        screenVideoRef.current.srcObject = screenStreamRef.current
        screenVideoRef.current.play().catch(() => { })
      }
    }
  }, [hasScreenStream])

  // Handle meeting data from SWR (side effects: redirect, camera preview)
  useEffect(() => {
    if (!meetingsRes) return

    if (meetingsRes.success && meetingsRes.data?.length > 0) {
      const meetingData = meetingsRes.data[0]

      // Check if meeting link is still active
      if (meetingData.isLinkActive === false) {
        toast.error('This meeting has ended and the link is no longer active')
        router.push('/dashboard/meetings')
        return
      }

      // Check if meeting has passed its end time
      const now = new Date()
      const endTime = new Date(meetingData.scheduledEnd)
      if (now > endTime && meetingData.status !== 'in-progress') {
        toast.error('This meeting has ended')
        router.push('/dashboard/meetings')
        return
      }

      setMeeting(meetingData)

      // Start camera preview only once
      if (!cameraPreviewStartedRef.current) {
        cameraPreviewStartedRef.current = true
        startCameraPreview()
      }
    } else {
      toast.error('Meeting not found')
      router.push('/dashboard/meetings')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingsRes])

  // Start camera preview before joining
  const startCameraPreview = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: MEETING_CAMERA_CONSTRAINTS,
        audio: MEETING_AUDIO_CONSTRAINTS,
      })

      localStreamRef.current = prepareMeetingMediaStream(stream)
      setHasLocalStream(true)
      setPreviewReady(true)

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream
        localVideoRef.current.play().catch(() => { })
      }
    } catch (error) {
      console.error('Error starting camera preview:', error)
      if (error.name === 'NotAllowedError') {
        setPreviewError('Camera/microphone access denied. You can still join in listen-only mode.')
      } else if (error.name === 'NotFoundError') {
        setPreviewError('No camera or microphone found. You can still join in listen-only mode.')
      } else {
        setPreviewError('Could not access camera. Please check your device settings.')
      }
    }
  }

  // Toggle preview mute (before joining)
  const togglePreviewMute = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0]
      if (audioTrack) {
        const nextMuted = !isMuted
        audioTrack.enabled = !nextMuted
        isMutedRef.current = nextMuted
        setIsMuted(nextMuted)
      }
    }
  }

  // Toggle preview video (before joining)
  const togglePreviewVideo = () => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0]
      if (videoTrack) {
        videoTrack.enabled = isVideoOff
        setIsVideoOff(!isVideoOff)
      }
    }
  }

  const transcribeRecordedSegment = useCallback(async ({ blob, startedAt, durationMs }) => {
    if (!meeting?._id || !blob || blob.size < 2048 || durationMs < 1200 || isMutedRef.current) {
      return
    }

    setNotetakerError(null)

    const processingPromise = lastTranscriptionPromiseRef.current
      .catch(() => { })
      .then(async () => {
        if (isMutedRef.current) return
        await transcribeRecordedSegmentWithPollinations({ blob, startedAt, durationMs })
      })
      .catch(error => {
        console.error('Failed to transcribe meeting audio segment:', error)
        setNotetakerError('Mira live transcription hit an issue for the last segment. Recording will continue and you can still generate the meeting summary afterwards.')
      })

    lastTranscriptionPromiseRef.current = processingPromise
    return processingPromise
  }, [meeting?._id, transcribeRecordedSegmentWithPollinations])

  useEffect(() => {
    if (!isJoined || !hasLocalStream || !notetakerReady || isMuted || notetakerMode !== 'pollinations') {
      return undefined
    }

    const sourceTrack = localStreamRef.current
      ?.getAudioTracks()
      ?.find(track => track.readyState === 'live' && track.enabled)

    if (!sourceTrack) {
      return undefined
    }

    const mimeType = getSupportedAudioMimeType()
    if (mimeType === null) {
      setNotetakerError('This browser does not support recorded audio chunks for Mira cloud transcription.')
      return undefined
    }

    const recordingTrack = sourceTrack.clone()
    const recordingStream = new MediaStream([recordingTrack])
    let mediaRecorder

    try {
      mediaRecorder = mimeType
        ? new MediaRecorder(recordingStream, { mimeType })
        : new MediaRecorder(recordingStream)
    } catch (error) {
      console.error('Failed to start Pollinations meeting recorder:', error)
      recordingTrack.stop()
      setNotetakerError('Mira could not start cloud transcription capture for this meeting.')
      return undefined
    }

    let segmentStartedAt = Date.now()
    const segmentTimesliceMs = 10000
    let resolveStopPromise = () => { }
    const stopPromise = new Promise((resolve) => {
      resolveStopPromise = resolve
    })
    const recorderState = {
      mediaRecorder,
      recordingTrack,
      resolveStopPromise,
      stopPromise,
      discardPending: false,
    }

    transcriptionRecorderRef.current = recorderState

    mediaRecorder.ondataavailable = (event) => {
      const blob = event.data
      const startedAt = segmentStartedAt
      const durationMs = Date.now() - startedAt
      segmentStartedAt = Date.now()

      if (!recorderState.discardPending && !isMutedRef.current && blob?.size > 2048 && durationMs >= 1200) {
        transcribeRecordedSegment({ blob, startedAt, durationMs })
      }
    }

    mediaRecorder.onstop = () => {
      recordingTrack.stop()
      resolveStopPromise()

      if (transcriptionRecorderRef.current === recorderState) {
        transcriptionRecorderRef.current = null
      }
    }

    mediaRecorder.start(segmentTimesliceMs)

    return () => {
      void stopTranscriptionRecorder().catch(() => { })
    }
  }, [
    isJoined,
    hasLocalStream,
    notetakerReady,
    isMuted,
    notetakerMode,
    stopTranscriptionRecorder,
    transcribeRecordedSegment,
  ])

  // Initialize WebRTC and Socket connection
  const joinMeeting = useCallback(async () => {
    setAutoJoinFailed(false)
    try {
      // Use existing preview stream or get new one
      if (!localStreamRef.current) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: MEETING_CAMERA_CONSTRAINTS,
            audio: MEETING_AUDIO_CONSTRAINTS,
          })
          localStreamRef.current = prepareMeetingMediaStream(stream)
        } catch {
          localStreamRef.current = new MediaStream()
          isMutedRef.current = true
          setIsMuted(true)
          setIsVideoOff(true)
          toast('Joining in listen-only mode')
        }
        setHasLocalStream(true)
      }

      if (localVideoRef.current && localStreamRef.current) {
        localVideoRef.current.srcObject = localStreamRef.current
        localVideoRef.current.play().catch(() => { })
      }

      // Connect to socket for signaling
      const { io } = await import('socket.io-client')
      const token = localStorage.getItem('token')
      socketRef.current = io({
        path: '/api/socketio',
        transports: ['websocket', 'polling'],
        auth: token ? { token } : undefined,
        autoConnect: false,
      })

      socketRef.current.on('disconnect', () => {
        if (!isLeavingRef.current && meetingSocketJoinedRef.current) {
          setChatError('Meeting connection lost. Reconnecting…')
        }
      })

      socketRef.current.on('connect', () => {
        if (!meetingSocketJoinedRef.current) return
        socketRef.current.emit('join-meeting', {
          roomId,
          userId: user?._id,
          userName: `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || 'Guest',
          isMuted: isMutedRef.current,
          isScreenSharing: isScreenSharingRef.current,
        }, (response) => {
          if (response?.success) {
            setChatError('')
            toast.success('Reconnected to meeting')
          } else {
            setChatError(response?.message || 'Could not reconnect to meeting')
          }
        })
      })

      // Handle existing participants when joining
      socketRef.current.on('existing-participants', async (existingUsers) => {
        console.log('Existing participants:', existingUsers)
        for (const userData of existingUsers) {
          upsertParticipant(userData)
          if (userData.isScreenSharing) {
            setPinnedTile(userData.id)
          }
          // Create peer connection and send offer to existing user
          await createPeerConnectionAndOffer(userData.id, userData.userName)
        }
      })

      // Handle other participants joining after us
      socketRef.current.on('user-joined', (userData) => {
        console.log('User joined:', userData)
        upsertParticipant(userData)
        if (userData.isScreenSharing) {
          setPinnedTile(userData.id)
        }
        // Don't create offer - wait for the new user to send us an offer
        // The new user will initiate connections with existing participants
        createPeerConnection(userData.id, userData.userName, false)
      })

      socketRef.current.on('user-left', (userData) => {
        console.log('User left:', userData)
        setParticipants(prev => prev.filter(p => p.id !== userData.id))
        setPinnedTile(current => current === userData.id ? null : current)
        if (remoteStreamsRef.current[userData.id]) {
          delete remoteStreamsRef.current[userData.id]
        }
        clearQueuedIceCandidates(pendingIceCandidatesRef, userData.id)
        // Clean up peer connection
        if (peerConnectionsRef.current[userData.id]) {
          peerConnectionsRef.current[userData.id].close()
          delete peerConnectionsRef.current[userData.id]
        }
      })

      socketRef.current.on('meeting-chat', (message) => {
        const isOwnMessage = message.senderSocketId === socketRef.current?.id
        const normalizedMessage = {
          id: message.id || `${message.timestamp}-${message.userId || message.userName}`,
          sender: message.userName || 'Participant',
          text: message.message || '',
          timestamp: message.timestamp,
          isOwn: isOwnMessage,
        }
        setChatMessages(prev => (
          prev.some(existing => existing.id === normalizedMessage.id)
            ? prev
            : [...prev, normalizedMessage]
        ))
        setChatError('')

        if (!showChatRef.current && !isOwnMessage) {
          setUnreadChatCount(count => count + 1)
          toast(`${normalizedMessage.sender}: ${normalizedMessage.text}`, {
            icon: <HiOutlineChatBubbleLeftRight className="h-5 w-5 text-indigo-500" />,
            duration: 5000,
          })
        }
      })

      socketRef.current.on('participant-mute-state', ({ id, isMuted: participantIsMuted }) => {
        setParticipants(prev => prev.map(participant => (
          participant.id === id
            ? { ...participant, isMuted: Boolean(participantIsMuted) }
            : participant
        )))
      })

      socketRef.current.on('hand-raised', (userData) => {
        toast(`${userData.userName} raised their hand`, {
          icon: <HiOutlineHandRaised className="h-5 w-5 text-amber-500" />,
        })
      })

      socketRef.current.on('meeting-reaction', (data) => {
        showFloatingReaction({
          ...(typeof data.reaction === 'object' ? data.reaction : { emoji: data.reaction }),
          sender: data.userName || data.reaction?.sender || 'Participant',
        }, data.id)
      })

      socketRef.current.on('participant-screen-share-state', ({ id, isScreenSharing: participantIsSharing }) => {
        setParticipants(prev => prev.map(participant => (
          participant.id === id
            ? { ...participant, isScreenSharing: Boolean(participantIsSharing) }
            : participant
        )))
        setPinnedTile(current => (
          participantIsSharing
            ? id
            : current === id
              ? null
              : current
        ))
      })

      // WebRTC Signaling
      socketRef.current.on('offer', async ({ from, offer }) => {
        console.log('Received offer from', from)
        // Create peer connection for this participant if not exists
        let pc = peerConnectionsRef.current[from]
        if (!pc) {
          pc = createPeerConnection(from, 'Participant', false)
          // Also add to participants list
          upsertParticipant({ id: from, userName: 'Participant' })
        }
        await pc.setRemoteDescription(new RTCSessionDescription(offer))
        await flushQueuedIceCandidates(peerConnectionsRef, pendingIceCandidatesRef, from)
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        console.log('Sending answer to', from)
        socketRef.current.emit('answer', { to: from, answer })
      })

      socketRef.current.on('answer', async ({ from, answer }) => {
        console.log('Received answer from', from)
        const pc = peerConnectionsRef.current[from]
        if (pc) {
          await pc.setRemoteDescription(new RTCSessionDescription(answer))
          await flushQueuedIceCandidates(peerConnectionsRef, pendingIceCandidatesRef, from)
        }
      })

      socketRef.current.on('ice-candidate', async ({ from, candidate }) => {
        if (!candidate) {
          return
        }

        try {
          await addIceCandidateOrQueue(peerConnectionsRef, pendingIceCandidatesRef, from, candidate)
        } catch (err) {
          console.error('Error adding ICE candidate:', err)
        }
      })

      await new Promise((resolve, reject) => {
        const socket = socketRef.current
        const timeoutId = setTimeout(() => {
          reject(new Error('Meeting connection timed out'))
        }, 15000)
        const settle = (callback, value) => {
          clearTimeout(timeoutId)
          socket.off('connect_error', handleConnectionError)
          socket.off('meeting-access-denied', handleAccessDenied)
          callback(value)
        }
        const handleConnectionError = (error) => settle(reject, error)
        const handleAccessDenied = () => settle(reject, new Error('Meeting access denied'))

        socket.once('connect_error', handleConnectionError)
        socket.once('meeting-access-denied', handleAccessDenied)
        socket.once('connect', () => {
          console.log('Connected to meeting socket')
          socket.emit('join-meeting', {
            roomId,
            userId: user?._id,
            userName: `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || 'Guest',
            isMuted: isMutedRef.current,
            isScreenSharing: isScreenSharingRef.current,
          }, (response) => {
            if (response?.success) {
              settle(resolve)
            } else {
              settle(reject, new Error(response?.message || 'Unable to join meeting'))
            }
          })
        })
        socket.connect()
      })

      meetingSocketJoinedRef.current = true
      meetingSessionStartedAtRef.current = new Date().toISOString()
      setIsJoined(true)
      onJoinedChange?.(true)
      toast.success('Joined meeting')
    } catch (error) {
      setAutoJoinFailed(true)
      console.error('Error joining meeting:', error)
      socketRef.current?.disconnect()
      socketRef.current = null
      meetingSocketJoinedRef.current = false
      if (error.name === 'NotAllowedError') {
        toast.error('Please allow camera and microphone access')
      } else if (error.message === 'Meeting access denied') {
        toast.error('You do not have access to this meeting')
      } else {
        toast.error(error.message || 'Failed to join meeting')
      }
    }
  }, [onJoinedChange, roomId, user, upsertParticipant])

  useEffect(() => {
    if (!autoJoin || isJoined || autoJoinAttemptedRef.current) return
    autoJoinAttemptedRef.current = true
    void joinMeeting()
  }, [autoJoin, isJoined, joinMeeting])

  useEffect(() => {
    if (!isJoined || !meeting?._id || !meeting.isOrganizer || meetingStartedRef.current) {
      return
    }

    const actualStart = meeting.actualStart || new Date().toISOString()

    apiMutate(`/api/meetings/${meeting._id}`, {
      method: 'PUT',
      body: {
        status: 'in-progress',
        actualStart,
      },
    })
      .then(() => {
        meetingStartedRef.current = true
        setMeeting(prev => prev ? {
          ...prev,
          status: 'in-progress',
          actualStart: prev.actualStart || actualStart,
        } : prev)
      })
      .catch(error => {
        meetingStartedRef.current = false
        console.error('Failed to mark meeting as started:', error)
      })
  }, [isJoined, meeting?._id, meeting?.actualStart, meeting?.isOrganizer])

  useEffect(() => {
    if (!isJoined || isMuted) {
      void stopTranscriptionRecorder(isMuted).catch(() => { })
    }
  }, [isJoined, isMuted, stopTranscriptionRecorder])

  // Create WebRTC peer connection
  const createPeerConnection = (peerId, peerName, shouldOffer = false) => {
    // Don't create duplicate connections
    if (peerConnectionsRef.current[peerId]) {
      return peerConnectionsRef.current[peerId]
    }

    const pc = new RTCPeerConnection(createMeetingRtcConfiguration())
    peerConnectionsRef.current[peerId] = pc

    // Add local tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current)
      })
      void applyMeetingSenderQuality(pc, {
        quality: connectionQualityRef.current,
        peerCount: Object.keys(peerConnectionsRef.current).length,
      })
    }

    // Handle incoming tracks
    pc.ontrack = (event) => {
      console.log('Received remote track from', peerId, event)

      const incomingTrack = event.track
      const incomingStream = event.streams?.[0]

      if (incomingStream) {
        remoteStreamsRef.current[peerId] = incomingStream
      } else {
        if (!remoteStreamsRef.current[peerId]) {
          remoteStreamsRef.current[peerId] = new MediaStream()
        }
        const syntheticStream = remoteStreamsRef.current[peerId]
        const alreadyExists = syntheticStream.getTracks().some(t => t.id === incomingTrack.id)
        if (!alreadyExists) {
          syntheticStream.addTrack(incomingTrack)
        }
      }

      const mediaStream = remoteStreamsRef.current[peerId]
      upsertParticipant({ id: peerId, userName: peerName || 'Participant', stream: mediaStream })
    }

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current?.emit('ice-candidate', {
          to: peerId,
          candidate: event.candidate
        })
      }
    }

    // Handle connection state changes
    pc.onconnectionstatechange = () => {
      console.log(`Peer ${peerId} connection state:`, pc.connectionState)
      if (pc.connectionState === 'connected') {
        iceRestartingPeersRef.current.delete(peerId)
        void applyMeetingSenderQuality(pc, {
          quality: connectionQualityRef.current,
          isScreenSharing: isScreenSharingRef.current,
          peerCount: Object.keys(peerConnectionsRef.current).length,
        })
      }

      if (
        pc.connectionState === 'failed'
        && shouldOffer
        && socketRef.current?.connected
        && !iceRestartingPeersRef.current.has(peerId)
      ) {
        iceRestartingPeersRef.current.add(peerId)
        void (async () => {
          try {
            pc.restartIce()
            const offer = await pc.createOffer({ iceRestart: true })
            await pc.setLocalDescription(offer)
            socketRef.current?.emit('offer', { to: peerId, offer })
          } catch (error) {
            iceRestartingPeersRef.current.delete(peerId)
            console.warn(`[Meeting] ICE restart failed for ${peerId}`, error)
          }
        })()
      }
    }

    return pc
  }

  // Create peer connection and send offer (for initiating connection)
  const createPeerConnectionAndOffer = async (peerId, peerName) => {
    const pc = createPeerConnection(peerId, peerName, true)

    try {
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      console.log('Sending offer to', peerId)
      socketRef.current?.emit('offer', { to: peerId, offer })
    } catch (err) {
      console.error('Error creating offer:', err)
    }

    return pc
  }

  // Toggle microphone
  const toggleMute = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0]
      if (audioTrack) {
        const nextMuted = !isMuted
        audioTrack.enabled = !nextMuted
        isMutedRef.current = nextMuted
        setIsMuted(nextMuted)
        socketRef.current?.emit('meeting-mute-state', {
          roomId,
          isMuted: nextMuted,
        })

        if (nextMuted) {
          void stopTranscriptionRecorder(true).catch(() => { })
        }
      }
    }
  }

  // Toggle video
  const toggleVideo = () => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0]
      if (videoTrack) {
        videoTrack.enabled = isVideoOff
        setIsVideoOff(!isVideoOff)
      }
    }
  }

  // Toggle screen sharing
  const toggleScreenShare = async () => {
    if (isScreenSharingRef.current) {
      // Stop screen sharing
      if (screenStreamRef.current) {
        screenStreamRef.current.getVideoTracks().forEach(track => {
          track.onended = null
        })
        screenStreamRef.current.getTracks().forEach(track => track.stop())
        screenStreamRef.current = null
      }
      // Clear screen video ref
      if (screenVideoRef.current) {
        screenVideoRef.current.srcObject = null
      }
      setHasScreenStream(false)
      // Restore camera track in peer connections
      if (localStreamRef.current) {
        const videoTrack = localStreamRef.current.getVideoTracks()[0]
        if (videoTrack) {
          Object.values(peerConnectionsRef.current).forEach(pc => {
            const sender = pc.getSenders().find(s => s.track?.kind === 'video')
            if (sender) {
              void sender.replaceTrack(videoTrack).then(() => applyMeetingSenderQuality(pc, {
                quality: connectionQualityRef.current,
                isScreenSharing: false,
                peerCount: Object.keys(peerConnectionsRef.current).length,
              }))
            }
          })
        }
      }
      isScreenSharingRef.current = false
      setIsScreenSharing(false)
      setPinnedTile(current => current === 'screen' ? null : current)
      socketRef.current?.emit('meeting-screen-share-state', {
        roomId,
        isScreenSharing: false,
      })
    } else {
      try {
        let screenStream = null

        // Check if running in Electron desktop app
        const isElectronApp = typeof window !== 'undefined' && window.isElectron
        const isWindows = isElectronApp && window.platform === 'win32'

        if (isElectronApp && isWindows && window.electronAPI) {
          // Windows Electron: Use desktopCapturer for proper screen share with multi-display support
          try {
            // First trigger the display media request which will show our custom dialog
            screenStream = await navigator.mediaDevices.getDisplayMedia({
              video: MEETING_SCREEN_CONSTRAINTS,
              audio: false,
            })
          } catch (primaryError) {
            // Last resort for older Windows Electron builds.
            console.log('[Meeting] Trying Electron getUserMedia fallback...')
            const sources = await window.electronAPI.getDesktopSources({
              types: ['screen'],
              thumbnailSize: { width: 320, height: 180 }
            })

            if (sources && sources.length > 0) {
              const sourceId = sources[0].id
              screenStream = await navigator.mediaDevices.getUserMedia({
                audio: false,
                video: {
                  mandatory: {
                    chromeMediaSource: 'desktop',
                    chromeMediaSourceId: sourceId,
                    minWidth: 1280,
                    maxWidth: 1920,
                    minHeight: 720,
                    maxHeight: 1080,
                    minFrameRate: 15,
                    maxFrameRate: 15
                  }
                }
              })
            } else {
              throw primaryError
            }
          }
        } else {
          // Standard browser or macOS Electron: use getDisplayMedia normally
          screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: MEETING_SCREEN_CONSTRAINTS,
            audio: false,
          })
        }
        screenStreamRef.current = prepareMeetingMediaStream(screenStream, 'screen')
        setHasScreenStream(true) // Trigger re-render and useEffect to attach stream

        // Set screen stream to screen video element
        if (screenVideoRef.current) {
          screenVideoRef.current.srcObject = screenStream
          screenVideoRef.current.play().catch(() => { }) // Ensure video plays
        }

        // Replace video track in peer connections with screen share
        const videoTrack = screenStream.getVideoTracks()[0]
        await Promise.all(Object.values(peerConnectionsRef.current).map(async pc => {
          const sender = pc.getSenders().find(s => s.track?.kind === 'video')
          if (sender) {
            await sender.replaceTrack(videoTrack)
            await applyMeetingSenderQuality(pc, {
              quality: connectionQualityRef.current,
              isScreenSharing: true,
              peerCount: Object.keys(peerConnectionsRef.current).length,
            })
          }
        }))

        // Handle screen share stop
        videoTrack.onended = () => {
          stopScreenShareRef.current?.()
        }

        isScreenSharingRef.current = true
        setIsScreenSharing(true)
        setPinnedTile('screen')
        socketRef.current?.emit('meeting-screen-share-state', {
          roomId,
          isScreenSharing: true,
        })
      } catch (error) {
        console.error('Error sharing screen:', error)
        // Check for permission denied errors
        if (error.name === 'NotAllowedError' || error.message?.includes('Permission denied')) {
          toast.error('Screen share was blocked. Pick a window/screen in the share dialog and allow access.')
        } else if (error.name === 'AbortError') {
          toast.error('Screen sharing was cancelled.')
        } else if (error.name === 'NotReadableError') {
          toast.error('Screen is currently unavailable. Close other sharing apps and try again.')
        } else if (error.name === 'NotFoundError') {
          toast.error('No screen available to share')
        } else {
          toast.error('Failed to share screen. Please check your permissions.')
        }
      }
    }
  }
  stopScreenShareRef.current = toggleScreenShare

  // Toggle recording
  const toggleRecording = async () => {
    if (isRecording) {
      // Stop recording
      if (mediaRecorderRef.current) {
        mediaRecorderRef.current.stop()
      }
      setIsRecording(false)
    } else {
      try {
        const stream = localStreamRef.current
        if (!stream) {
          toast.error('No media stream available')
          return
        }

        mediaRecorderRef.current = new MediaRecorder(stream, {
          mimeType: 'video/webm;codecs=vp9'
        })

        recordedChunksRef.current = []

        mediaRecorderRef.current.ondataavailable = (event) => {
          if (event.data.size > 0) {
            recordedChunksRef.current.push(event.data)
          }
        }

        mediaRecorderRef.current.onstop = async () => {
          const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' })
          // Here you would upload the recording
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = `meeting-${roomId}-${Date.now()}.webm`
          a.click()
          toast.success('Recording saved')
        }

        mediaRecorderRef.current.start()
        setIsRecording(true)
        toast.success('Recording started')
      } catch (error) {
        console.error('Error starting recording:', error)
        toast.error('Failed to start recording')
      }
    }
  }

  // Raise hand
  const raiseHand = () => {
    setHandRaised(!handRaised)
    socketRef.current?.emit('raise-hand', {
      roomId,
      userId: user?._id,
      userName: `${user?.firstName || ''} ${user?.lastName || ''}`.trim(),
      raised: !handRaised
    })
  }

  // Send reaction
  const sendReaction = (emoji) => {
    const reaction = {
      id: Date.now(),
      emoji,
      sender: `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || 'You',
    }

    // Emit to others
    socketRef.current?.emit('meeting-reaction', { roomId, reaction })

    // Show locally
    showFloatingReaction(reaction, 'local')
    setShowReactions(false)
  }

  // Show floating reaction animation
  const showFloatingReaction = (reaction, participantId) => {
    const id = Date.now() + Math.random()
    const newReaction = { ...reaction, participantId, animId: id }
    setFloatingReactions(prev => [...prev, newReaction])

    // Remove after animation
    setTimeout(() => {
      setFloatingReactions(prev => prev.filter(r => r.animId !== id))
    }, 3000)
  }

  // Send chat message
  const sendChatMessage = () => {
    const message = chatInput.trim()
    if (!message || isSendingChat) return

    const socket = socketRef.current
    if (!socket?.connected) {
      const connectionError = 'Meeting chat is reconnecting. Please try again.'
      setChatError(connectionError)
      toast.error(connectionError)
      return
    }

    setIsSendingChat(true)
    setChatError('')
    socket.timeout(5000).emit('meeting-chat', { roomId, message }, (error, response) => {
      setIsSendingChat(false)
      if (error || !response?.success) {
        const deliveryError = response?.message || 'Message was not delivered. Please try again.'
        setChatError(deliveryError)
        toast.error(deliveryError)
        return
      }

      setChatInput(current => current.trim() === message ? '' : current)
    })
  }

  // Leave meeting
  const leaveMeeting = async () => {
    if (isLeavingRef.current) return
    isLeavingRef.current = true
    setIsEndingMeeting(true)
    setEndingMeetingStatus('Saving your latest transcript and meeting activity...')

    try {
      await stopTranscriptionRecorder()
      await lastTranscriptionPromiseRef.current.catch(() => { })

      if (meeting?._id && meeting.isOrganizer) {
        const actualEnd = new Date().toISOString()
        const sessionStartedAt = meetingSessionStartedAtRef.current || meeting.actualStart || meeting.scheduledStart || actualEnd
        const isWithinScheduledWindow = meeting.scheduledEnd
          ? new Date(actualEnd) < new Date(meeting.scheduledEnd)
          : false
        const nextStatus = isWithinScheduledWindow ? 'in-progress' : 'completed'

        try {
          setEndingMeetingStatus('Saving meeting status...')
          await apiMutate(`/api/meetings/${meeting._id}`, {
            method: 'PUT',
            body: {
              status: nextStatus,
              actualStart: meeting.actualStart || meeting.scheduledStart || sessionStartedAt,
              ...(nextStatus === 'completed' ? { actualEnd } : {}),
            },
          })

          setMeeting(prev => prev ? {
            ...prev,
            status: nextStatus,
            actualStart: prev.actualStart || prev.scheduledStart || sessionStartedAt,
            actualEnd: nextStatus === 'completed' ? actualEnd : prev.actualEnd,
          } : prev)
        } catch (error) {
          console.error('Failed to mark meeting as completed:', error)
        }

        try {
          setEndingMeetingStatus('Generating Mira summary...')
          const summaryResponse = await apiMutate(`/api/meetings/${meeting._id}/summary`, {
            method: 'POST',
            body: {
              language: 'auto',
              allowNoContent: true,
              sendMomEmails: nextStatus === 'completed',
              sessionStartedAt,
              sessionEndedAt: actualEnd,
            },
          })

          if (summaryResponse?.data?.generated) {
            const momEmailSentCount = Number(summaryResponse?.data?.momEmails?.sentCount) || 0
            toast.success(
              nextStatus === 'completed'
                ? (momEmailSentCount > 0
                  ? `Mira summary saved and MOM email sent to ${momEmailSentCount} participant${momEmailSentCount === 1 ? '' : 's'}`
                  : 'Mira summary saved to meeting details')
                : 'Mira session summary appended to meeting details'
            )
          }
        } catch (error) {
          console.error('Failed to generate meeting summary on exit:', error)
          toast.error('Meeting ended, but Mira could not generate the summary automatically. You can retry from meeting details.')
        }
      }

      setEndingMeetingStatus('Closing meeting room...')
    } finally {
      meetingSessionStartedAtRef.current = null

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop())
      }
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach(track => track.stop())
      }

      Object.values(peerConnectionsRef.current).forEach(pc => pc.close())
      peerConnectionsRef.current = {}
      pendingIceCandidatesRef.current = {}
      remoteStreamsRef.current = {}

      if (socketRef.current) {
        meetingSocketJoinedRef.current = false
        socketRef.current.emit('leave-meeting', { roomId })
        socketRef.current.disconnect()
      }

      onJoinedChange?.(false)
      onSessionEnded?.()
      router.push(meeting?._id ? `/dashboard/meetings/${meeting._id}` : '/dashboard/meetings')
    }
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      void stopTranscriptionRecorder().catch(() => { })
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop())
      }
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach(track => track.stop())
      }
      Object.values(peerConnectionsRef.current).forEach(pc => pc.close())
      pendingIceCandidatesRef.current = {}
      remoteStreamsRef.current = {}
      if (socketRef.current) {
        meetingSocketJoinedRef.current = false
        socketRef.current.disconnect()
      }
    }
  }, [stopTranscriptionRecorder])

  if (meetingLoading) {
    return (
      <div
        className="fixed inset-0 z-[110] flex h-[100dvh] w-screen items-center justify-center overflow-hidden bg-slate-100 dark:bg-slate-950"
        role="status"
        aria-live="polite"
      >
        <div className="max-w-lg w-full px-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-white/10 dark:bg-slate-900">
            <div className="flex flex-col items-center">
              <Skeleton className="w-16 h-16 rounded-2xl mb-4" />
              <Skeleton className="h-7 w-48 rounded-lg mb-2" />
              <Skeleton className="h-4 w-36 rounded-lg mb-4" />
              <Skeleton className="w-full aspect-video rounded-xl mb-4" />
              <div className="flex gap-2 mb-4">
                <Skeleton className="w-12 h-12 rounded-full" />
                <Skeleton className="w-12 h-12 rounded-full" />
              </div>
              <Skeleton className="w-full h-12 rounded-xl mb-3" />
              <Skeleton className="w-full h-10 rounded-xl" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (meetingError) {
    return (
      <div
        className="fixed inset-0 z-[110] flex h-[100dvh] w-screen items-center justify-center overflow-hidden bg-slate-100 p-4 text-slate-900 dark:bg-slate-950 dark:text-white"
        role="alert"
      >
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-2xl dark:border-white/10 dark:bg-slate-900">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/15">
            <HiOutlineVideoCamera className="h-7 w-7 text-amber-300" />
          </div>
          <h1 className="text-xl font-semibold">Unable to load this meeting</h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Check your connection and try again. Your camera and microphone have not been joined.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => void refreshMeeting()}
              className="flex-1 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            >
              Retry
            </button>
            <button
              type="button"
              onClick={() => router.push('/dashboard/meetings')}
              className="flex-1 rounded-xl border border-white/15 px-4 py-3 text-sm font-semibold hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/40"
            >
              Back to meetings
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!isJoined) {
    const isRestoring = autoJoin && !autoJoinFailed
    return (
      <div className="fixed inset-0 z-[110] flex h-[100dvh] w-screen items-center justify-center overflow-hidden bg-slate-100 p-4 dark:bg-slate-950">
        <div className="max-w-lg w-full rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-xl dark:border-white/10 dark:bg-slate-900">
          <div className="w-16 h-16 bg-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <HiOutlineVideoCamera className="w-8 h-8 text-white" />
          </div>
          <h1 className="mb-2 text-2xl font-bold text-slate-900 dark:text-white">
            {meeting?.title || 'Meeting Room'}
          </h1>
          <p className="mb-4 text-slate-500 dark:text-slate-300">
            {isRestoring ? 'Restoring your meeting connection…' : 'Ready to join the meeting?'}
          </p>

          {/* Camera Preview */}
          <div className="relative bg-gray-900 rounded-xl aspect-video mb-4 overflow-hidden">
            {previewReady && !isVideoOff ? (
              <video
                ref={(el) => {
                  localVideoRef.current = el
                  if (el && localStreamRef.current && el.srcObject !== localStreamRef.current) {
                    el.srcObject = localStreamRef.current
                    el.play().catch(() => { })
                  }
                }}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover absolute inset-0 z-10 -scale-x-100"
              />
            ) : previewError ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center z-0 p-4">
                <HiOutlineVideoCamera className="w-12 h-12 text-red-400 mb-2" />
                <p className="text-red-400 text-sm text-center">{previewError}</p>
              </div>
            ) : isVideoOff && previewReady ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-800 z-0">
                <div className="w-20 h-20 bg-indigo-600 rounded-full flex items-center justify-center mb-2">
                  <span className="text-3xl font-bold text-white">
                    {user?.firstName?.[0]?.toUpperCase() || 'Y'}
                  </span>
                </div>
                <p className="text-gray-400 text-sm">Camera off</p>
              </div>
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center z-0">
                <svg className="animate-spin w-8 h-8 text-gray-400 mb-3" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                <p className="text-gray-400 text-sm">Starting camera...</p>
              </div>
            )}

            {/* Preview Controls Overlay */}
            {previewReady && (
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-2 z-20">
                <button
                  onClick={togglePreviewMute}
                  className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full transition-colors ${isMuted
                    ? 'bg-red-500 hover:bg-red-600 text-white'
                    : 'bg-gray-800/80 hover:bg-gray-700 text-white'
                    }`}
                  title={isMuted ? 'Unmute' : 'Mute'}
                >
                  <CutLineIcon isOff={isMuted}>
                    <HiMiniMicrophone className="h-5 w-5" />
                  </CutLineIcon>
                </button>
                <button
                  onClick={togglePreviewVideo}
                  className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full transition-colors ${isVideoOff
                    ? 'bg-red-500 hover:bg-red-600 text-white'
                    : 'bg-gray-800/80 hover:bg-gray-700 text-white'
                    }`}
                  title={isVideoOff ? 'Turn on camera' : 'Turn off camera'}
                >
                  <CutLineIcon isOff={isVideoOff}>
                    <HiMiniVideoCamera className="h-5 w-5" />
                  </CutLineIcon>
                </button>
              </div>
            )}
          </div>

          {/* Mic/Video status indicator */}
          {previewReady && (
            <div className="mb-4 flex items-center justify-center gap-4 text-sm text-slate-600 dark:text-slate-300">
              <span className={`flex items-center gap-1 ${isMuted ? 'text-red-500' : 'text-green-600'}`}>
                <CutLineIcon isOff={isMuted}>
                  <HiMiniMicrophone className="h-4 w-4" />
                </CutLineIcon>
                {isMuted ? 'Muted' : 'Mic on'}
              </span>
              <span className={`flex items-center gap-1 ${isVideoOff ? 'text-red-500' : 'text-green-600'}`}>
                <CutLineIcon isOff={isVideoOff}>
                  <HiMiniVideoCamera className="h-4 w-4" />
                </CutLineIcon>
                {isVideoOff ? 'Camera off' : 'Camera on'}
              </span>
            </div>
          )}

          <button
            onClick={joinMeeting}
            disabled={isRestoring || (!previewReady && !previewError)}
            className={`w-full py-3 font-medium rounded-xl transition-colors ${previewReady || previewError
              ? 'bg-indigo-600 text-white hover:bg-indigo-700'
              : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              }`}
          >
            {isRestoring ? 'Reconnecting…' : previewReady || previewError ? 'Join Meeting' : 'Preparing...'}
          </button>

          <button
            onClick={() => {
              // Stop preview stream when canceling
              if (localStreamRef.current) {
                localStreamRef.current.getTracks().forEach(track => track.stop())
                localStreamRef.current = null
              }
              router.push(meeting?._id ? `/dashboard/meetings/${meeting._id}` : '/dashboard/meetings')
            }}
            className="mt-3 w-full py-3 text-slate-500 hover:text-slate-700 dark:text-slate-300 dark:hover:text-white"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  // Calculate total tiles (local + participants + screen share if active)
  const totalTiles = 1 + participants.length + (isScreenSharing ? 1 : 0)

  // Get grid layout based on tile count and pinned state
  const getGridClass = () => {
    if (pinnedTile) {
      // Pinned layout - one large tile, others in strip
      return 'grid-cols-1'
    }

    // Responsive grid based on participant count
    if (totalTiles === 1) return 'grid-cols-1'
    if (totalTiles === 2) return 'grid-cols-1 sm:grid-cols-2'
    if (totalTiles <= 4) return 'grid-cols-2'
    if (totalTiles <= 6) return 'grid-cols-2 sm:grid-cols-3'
    return 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4'
  }

  // Toggle pin for a tile
  const togglePin = (tileId) => {
    setPinnedTile(prev => prev === tileId ? null : tileId)
  }

  // Render a video tile
  const renderTile = (type, data = null, isPinned = false, isInStrip = false) => {
    const tileId = type === 'local' ? 'local' : type === 'screen' ? 'screen' : data?.id
    const isThisPinned = pinnedTile === tileId

    // Different styling for strip tiles vs grid tiles
    const getTileClasses = () => {
      if (isPinned) return 'col-span-full row-span-full h-full'
      if (isInStrip) return 'h-full w-full' // Strip tiles use parent's height
      return 'aspect-video min-h-[120px]' // Grid tiles maintain aspect ratio
    }

    return (
      <div
        key={tileId}
        className={`group relative overflow-hidden rounded-2xl bg-slate-200 shadow-xl ring-1 ring-slate-300 dark:bg-slate-900 dark:ring-white/10 ${getTileClasses()} ${isThisPinned && !isPinned ? 'ring-2 ring-indigo-500 dark:ring-indigo-400' : ''}`}
      >
        {/* Video Element */}
        {type === 'local' ? (
          <>
            <video
              ref={(el) => {
                localVideoRef.current = el
                // Re-attach stream when video element is mounted/updated
                if (el && localStreamRef.current && el.srcObject !== localStreamRef.current) {
                  el.srcObject = localStreamRef.current
                  el.play().catch(() => { }) // Ignore autoplay errors
                }
              }}
              autoPlay
              playsInline
              muted
              className={`absolute inset-0 w-full h-full object-contain -scale-x-100 ${isVideoOff ? 'hidden' : ''}`}
            />
            {isVideoOff && (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-200 dark:bg-slate-800">
                <div className="w-12 h-12 sm:w-20 sm:h-20 bg-indigo-600 rounded-full flex items-center justify-center">
                  <span className="text-lg sm:text-2xl font-bold text-white">
                    {user?.firstName?.[0]?.toUpperCase() || 'Y'}
                  </span>
                </div>
              </div>
            )}
            <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded bg-black/50 px-2 py-1 text-xs text-white sm:bottom-3 sm:left-3 sm:text-sm">
              <span>You</span>
              {isMuted && (
                <CutLineIcon isOff className="text-red-300">
                  <HiOutlineMicrophone className="h-3.5 w-3.5" />
                </CutLineIcon>
              )}
              {handRaised && <HiOutlineHandRaised className="h-4 w-4 text-amber-300" aria-label="Hand raised" />}
            </div>
          </>
        ) : type === 'screen' ? (
          <>
            <video
              ref={(el) => {
                screenVideoRef.current = el
                // Re-attach stream when video element is mounted/updated
                if (el && screenStreamRef.current && el.srcObject !== screenStreamRef.current) {
                  el.srcObject = screenStreamRef.current
                  el.play().catch(() => { }) // Ignore autoplay errors
                }
              }}
              autoPlay
              playsInline
              muted
              className="absolute inset-0 w-full h-full object-contain bg-black"
            />
            <div className="absolute bottom-2 left-2 sm:bottom-3 sm:left-3 px-2 py-1 bg-indigo-600/80 rounded text-white text-xs sm:text-sm">
              Your Screen
            </div>
          </>
        ) : (
          <>
            {data?.stream ? (
              <>
                <video
                  autoPlay
                  playsInline
                  ref={el => {
                    if (el && data.stream && el.srcObject !== data.stream) {
                      el.srcObject = data.stream
                      el.play().catch(() => { }) // Ignore autoplay errors
                    }
                  }}
                  className="absolute inset-0 w-full h-full object-contain"
                />
              </>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-200 dark:bg-slate-800">
                <div className="w-12 h-12 sm:w-20 sm:h-20 bg-indigo-600 rounded-full flex items-center justify-center">
                  <span className="text-lg sm:text-2xl font-bold text-white">
                    {data?.userName?.[0]?.toUpperCase() || '?'}
                  </span>
                </div>
              </div>
            )}
            <div className="absolute bottom-2 left-2 flex max-w-[80%] items-center gap-1.5 rounded bg-black/50 px-2 py-1 text-xs text-white sm:bottom-3 sm:left-3 sm:text-sm">
              <span className="truncate">{data?.userName}</span>
              {data?.isMuted && (
                <CutLineIcon isOff className="flex-shrink-0 text-red-300">
                  <HiOutlineMicrophone className="h-3.5 w-3.5" />
                </CutLineIcon>
              )}
              {data?.isScreenSharing && (
                <HiOutlineComputerDesktop className="h-4 w-4 flex-shrink-0 text-indigo-300" aria-label="Sharing screen" />
              )}
            </div>
          </>
        )}

        <div className="pointer-events-none absolute inset-x-0 bottom-10 z-20 flex flex-col items-center gap-1" aria-live="polite">
          {floatingReactions
            .filter(reaction => reaction.participantId === tileId)
            .map(reaction => (
              <div key={reaction.animId} className="meeting-tile-reaction flex flex-col items-center">
                <span className="rounded-full bg-white/95 p-2 text-indigo-600 shadow-xl">
                  <MeetingReactionIcon value={reaction.emoji} className="h-8 w-8 sm:h-10 sm:w-10" />
                </span>
                <span className="mt-1 max-w-[12rem] truncate rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-medium text-white">
                  {reaction.sender || (tileId === 'local' ? 'You' : 'Participant')}
                </span>
              </div>
            ))}
        </div>

        {/* Pin Button */}
        <button
          onClick={() => togglePin(tileId)}
          className="absolute top-2 right-2 p-1.5 sm:p-2 bg-black/50 hover:bg-black/70 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
          title={isThisPinned ? 'Unpin' : 'Pin'}
        >
          {isThisPinned ? (
            <BsPinFill className="w-3 h-3 sm:w-4 sm:h-4 text-indigo-400" />
          ) : (
            <BsPin className="w-3 h-3 sm:w-4 sm:h-4 text-white" />
          )}
        </button>
      </div>
    )
  }

  const restoreFullMeeting = () => {
    if (onRestoreMeeting) {
      onRestoreMeeting()
      return
    }
    router.push(`/dashboard/meetings/room/${roomId}`)
  }

  const openPanelFromPip = (panel) => {
    setShowChat(panel === 'chat')
    setShowParticipants(panel === 'participants')
    setShowNotetaker(panel === 'mira')
    restoreFullMeeting()
  }

  const renderPipAudioSinks = (excludedParticipantId = null) => (
    <div className="hidden" aria-hidden="true">
      {participants
        .filter(participant => participant.stream && participant.id !== excludedParticipantId)
        .map(participant => (
          <audio
            key={participant.id}
            autoPlay
            playsInline
            ref={element => {
              if (element && element.srcObject !== participant.stream) {
                element.srcObject = participant.stream
                element.play().catch(() => { })
              }
            }}
          />
        ))}
    </div>
  )

  if (displayMode === 'bubble') {
    return (
      <>
        {renderPipAudioSinks()}
        <button
          type="button"
          onClick={() => onSetPipSize?.('expanded')}
          className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] right-4 z-[130] flex h-14 w-14 items-center justify-center rounded-full border border-indigo-300/40 bg-indigo-600 text-white shadow-2xl ring-1 ring-black/10 transition hover:scale-105 hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-2 dark:ring-white/15 sm:bottom-6 sm:right-36"
          title="Expand Talio Meet"
          aria-label="Expand Talio Meet picture in picture"
        >
          <HiOutlineVideoCamera className="h-6 w-6" />
          <span className={`absolute right-0 top-0 h-3 w-3 rounded-full border-2 border-white ${isMuted ? 'bg-red-500' : 'bg-emerald-400'}`} />
        </button>
      </>
    )
  }

  if (displayMode === 'compact') {
    return (
      <>
        {renderPipAudioSinks()}
        <section
          className="fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-[130] mx-auto flex max-w-[23rem] items-center gap-2 rounded-2xl border border-slate-200/80 bg-white/95 p-2.5 text-slate-900 shadow-2xl ring-1 ring-black/5 backdrop-blur-xl dark:border-white/15 dark:bg-slate-950/95 dark:text-white dark:ring-white/10 sm:inset-x-auto sm:bottom-5 sm:right-20 sm:mx-0 sm:w-[23rem]"
          aria-label="Talio Meet compact picture in picture"
        >
          <button
            type="button"
            onClick={restoreFullMeeting}
            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl p-1 text-left transition hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-400 dark:hover:bg-white/10"
            title="Return to meeting"
            aria-label="Return to full meeting"
          >
            <span className="relative flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm">
              <HiOutlineVideoCamera className="h-5 w-5" />
              <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-400 dark:border-slate-950" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{meeting?.title || 'Talio Meet'}</span>
              <span className="block truncate text-[11px] text-slate-500 dark:text-slate-400">
                Live · {participants.length + 1} participants · {isMuted ? 'Muted' : 'Mic on'}
              </span>
            </span>
          </button>
          <button
            type="button"
            onClick={toggleMute}
            className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-white transition focus:outline-none focus:ring-2 focus:ring-indigo-400 ${isMuted ? 'bg-red-600 hover:bg-red-500' : 'bg-slate-700 hover:bg-slate-600'}`}
            title={isMuted ? 'Unmute' : 'Mute'}
            aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
          >
            <CutLineIcon isOff={isMuted}>
              <HiMiniMicrophone className="h-4 w-4" />
            </CutLineIcon>
          </button>
          <button
            type="button"
            onClick={() => onSetPipSize?.('expanded')}
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-slate-200 text-slate-700 transition hover:bg-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-400 dark:bg-slate-700 dark:text-white dark:hover:bg-slate-600"
            title="Expand PiP"
            aria-label="Expand picture in picture"
          >
            <HiOutlineArrowsPointingOut className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onSetPipSize?.('bubble')}
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-slate-200 text-slate-700 transition hover:bg-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-400 dark:bg-slate-700 dark:text-white dark:hover:bg-slate-600"
            title="Minimise to bubble"
            aria-label="Minimise picture in picture to bubble"
          >
            <HiOutlineMinusSmall className="h-4 w-4" />
          </button>
        </section>
      </>
    )
  }

  if (displayMode === 'expanded') {
    const pipParticipant = participants.find(participant => participant.id === pinnedTile)
      || participants.find(participant => participant.stream)
      || participants[0]

    return (
      <>
        {renderPipAudioSinks(isScreenSharing ? null : pipParticipant?.id)}
        <section
          className="fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-[130] mx-auto max-h-[calc(100dvh-7rem)] max-w-[26rem] overflow-hidden rounded-3xl border border-slate-200/80 bg-white/95 text-slate-900 shadow-2xl ring-1 ring-black/5 backdrop-blur-xl dark:border-white/15 dark:bg-slate-950/95 dark:text-white dark:ring-white/10 sm:inset-x-auto sm:bottom-5 sm:right-20 sm:mx-0 sm:w-[24rem]"
          aria-label="Talio Meet picture in picture"
        >
        <header className="flex items-center gap-2 border-b border-slate-200/80 px-3 py-2.5 dark:border-white/10">
          <span className="flex flex-shrink-0 items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300">
            <span className="h-2 w-2 rounded-full bg-emerald-500 dark:bg-emerald-400" aria-hidden="true" />
            Live
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-sm font-semibold">{meeting?.title || 'Talio Meet'}</p>
            <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{participants.length + 1} participants</p>
          </div>
          <button
            type="button"
            onClick={restoreFullMeeting}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-400 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white"
            title="Return to meeting"
            aria-label="Return to full meeting"
          >
            <HiOutlineArrowsPointingOut className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onSetPipSize?.('compact')}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-400 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white"
            title="Compact PiP"
            aria-label="Compact picture in picture"
          >
            <HiOutlineArrowsPointingIn className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onSetPipSize?.('bubble')}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-400 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white"
            title="Minimise to bubble"
            aria-label="Minimise picture in picture to bubble"
          >
            <HiOutlineMinusSmall className="h-4 w-4" />
          </button>
        </header>

        <div className="aspect-video bg-slate-100 p-1.5 dark:bg-slate-900">
          {isScreenSharing
            ? renderTile('screen')
            : pipParticipant
              ? renderTile('participant', pipParticipant)
              : renderTile('local')}
        </div>

        <footer className="flex items-center gap-2 border-t border-slate-200/80 px-3 py-2.5 dark:border-white/10">
          <p className="mr-auto min-w-0 flex-1 truncate text-[11px] font-medium text-slate-500 dark:text-slate-400">
            {isMuted ? 'Microphone muted' : 'Microphone on'} · {isVideoOff ? 'Camera off' : 'Camera on'}
          </p>
          <button
            type="button"
            onClick={toggleMute}
            className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-white transition focus:outline-none focus:ring-2 focus:ring-indigo-400 ${isMuted ? 'bg-red-600 hover:bg-red-500' : 'bg-slate-700 hover:bg-slate-600'}`}
            title={isMuted ? 'Unmute' : 'Mute'}
            aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
          >
            <CutLineIcon isOff={isMuted}>
              <HiMiniMicrophone className="h-5 w-5" />
            </CutLineIcon>
          </button>
          <button
            type="button"
            onClick={toggleVideo}
            className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-white transition focus:outline-none focus:ring-2 focus:ring-indigo-400 ${isVideoOff ? 'bg-red-600 hover:bg-red-500' : 'bg-slate-700 hover:bg-slate-600'}`}
            title={isVideoOff ? 'Turn on camera' : 'Turn off camera'}
            aria-label={isVideoOff ? 'Turn on camera' : 'Turn off camera'}
          >
            <CutLineIcon isOff={isVideoOff}>
              <HiMiniVideoCamera className="h-5 w-5" />
            </CutLineIcon>
          </button>
          <button
            type="button"
            onClick={() => openPanelFromPip('chat')}
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-slate-700 text-white transition hover:bg-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            title="Open meeting chat"
            aria-label="Open meeting chat"
          >
            <HiOutlineChatBubbleLeftRight className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={leaveMeeting}
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-red-600 text-white transition hover:bg-red-500 focus:outline-none focus:ring-2 focus:ring-red-400"
            title="Leave meeting"
            aria-label="Leave meeting"
          >
            <HiOutlinePhoneXMark className="h-5 w-5" />
          </button>
        </footer>
        </section>
      </>
    )
  }

  return (
    <div className="fixed inset-0 z-[110] isolate flex h-screen w-screen flex-col overflow-hidden bg-slate-100 text-slate-900 dark:bg-slate-950 dark:text-white">
      {isEndingMeeting && (
        <div className="absolute inset-0 z-[120] flex items-center justify-center bg-slate-100/80 px-6 backdrop-blur-sm dark:bg-slate-950/80">
          <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-2xl dark:border-white/10 dark:bg-slate-900/90">
            <div className="flex flex-col items-center text-center">
              <div className="mb-4 h-14 w-14 rounded-full border-[3px] border-white/15 border-t-cyan-300 animate-spin" />
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Ending meeting...</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                {endingMeetingStatus}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="relative z-30 flex h-14 flex-shrink-0 items-center justify-between border-b border-slate-200 bg-white px-3 shadow-sm dark:border-white/10 dark:bg-slate-900 dark:shadow-none sm:px-4">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
          <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full bg-emerald-400" aria-label="Meeting connected" />
          <h1 className="truncate text-sm font-semibold text-slate-900 dark:text-white sm:text-base">
            {meeting?.title || 'Meeting'}
          </h1>
          {isRecording && (
            <span className="flex items-center gap-1 text-red-500 text-xs sm:text-sm flex-shrink-0">
              <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
              <span className="hidden sm:inline">Recording</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {meeting?.isOrganizer && (
            <button
              type="button"
              onClick={() => setShowAddParticipants(true)}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-100 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10"
              title="Add participants"
            >
              <HiOutlineUserPlus className="h-4 w-4" />
              <span className="hidden md:inline">Add people</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setShowChat(false)
              setShowParticipants(false)
              setShowNotetaker(false)
              onMinimizeToPip?.()
            }}
            className="flex items-center gap-1.5 rounded-lg border border-indigo-300 bg-indigo-50 px-2.5 py-1.5 text-xs font-medium text-indigo-700 transition hover:bg-indigo-100 dark:border-indigo-400/30 dark:bg-indigo-500/15 dark:text-indigo-200 dark:hover:bg-indigo-500/25"
            title="Minimise meeting"
            aria-label="Minimise meeting"
          >
            <HiOutlineArrowsPointingIn className="h-4 w-4" />
            <span className="hidden sm:inline">Minimise</span>
          </button>
          <span
            className={`hidden items-center gap-1.5 rounded-full bg-slate-100 px-2 py-1 text-xs dark:bg-white/5 sm:flex ${CONNECTION_QUALITY_META[connectionQuality].text}`}
            title="Talio automatically adjusts video quality to your network"
          >
            <span className={`h-2 w-2 rounded-full ${CONNECTION_QUALITY_META[connectionQuality].dot}`} />
            {CONNECTION_QUALITY_META[connectionQuality].label}
          </span>
          <span className="text-xs text-slate-500 dark:text-slate-400 sm:text-sm">
            {participants.length + 1} <span className="hidden sm:inline">participants</span>
          </span>
          {liveTranscript.length > 0 && (
            <span className="hidden text-xs text-slate-500 dark:text-slate-400 sm:inline">
              {liveTranscript.length} transcript segments
            </span>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="relative z-10 flex min-h-0 flex-1 overflow-hidden">
        {/* Video Grid Area */}
        <div className={`relative z-0 flex-1 p-2 sm:p-4 min-w-0 overflow-hidden ${showChat || showParticipants || showNotetaker ? 'hidden sm:block' : ''}`}>
          {pinnedTile ? (
            // Pinned Layout
            <div className="h-full flex flex-col gap-2 sm:gap-3">
              {/* Pinned Tile */}
              <div className="flex-1 min-h-0">
                {pinnedTile === 'local' && renderTile('local', null, true)}
                {pinnedTile === 'screen' && isScreenSharing && renderTile('screen', null, true)}
                {participants.find(p => p.id === pinnedTile) &&
                  renderTile('participant', participants.find(p => p.id === pinnedTile), true)
                }
              </div>

              {/* Other Tiles Strip */}
              <div className="h-24 sm:h-32 flex gap-2 overflow-x-auto overflow-y-hidden flex-shrink-0">
                {pinnedTile !== 'local' && (
                  <div className="w-32 sm:w-44 flex-shrink-0 h-full">
                    {renderTile('local', null, false, true)}
                  </div>
                )}
                {isScreenSharing && pinnedTile !== 'screen' && (
                  <div className="w-32 sm:w-44 flex-shrink-0 h-full">
                    {renderTile('screen', null, false, true)}
                  </div>
                )}
                {participants.filter(p => p.id !== pinnedTile).map(p => (
                  <div key={p.id} className="w-32 sm:w-44 flex-shrink-0 h-full">
                    {renderTile('participant', p, false, true)}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            // Grid Layout - center content when only 1 tile
            <div className={`${totalTiles === 1 ? 'flex items-center justify-center h-full' : `grid ${getGridClass()} gap-2 sm:gap-4 h-full auto-rows-fr`}`}>
              {totalTiles === 1 ? (
                // Single tile - limit size and center
                <div className="w-full max-w-3xl aspect-video">
                  {renderTile('local')}
                </div>
              ) : (
                <>
                  {renderTile('local')}
                  {isScreenSharing && renderTile('screen')}
                  {participants.map(p => renderTile('participant', p))}
                </>
              )}
            </div>
          )}
        </div>

        {/* Chat Sidebar */}
        {showChat && (
          <aside className="relative z-20 flex w-full flex-shrink-0 flex-col border-l border-slate-200 bg-white shadow-lg dark:border-slate-800 dark:bg-slate-900 sm:w-80">
            <div className="flex flex-shrink-0 items-center justify-between border-b border-slate-200 p-3 dark:border-slate-800 sm:p-4">
              <h2 className="font-medium text-slate-900 dark:text-white">Chat</h2>
              <button
                onClick={() => setShowChat(false)}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-white"
                aria-label="Close chat"
              >
                <HiOutlineXMark className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3 min-h-0">
              {chatMessages.length === 0 ? (
                <p className="text-center text-sm text-slate-500 dark:text-slate-400">No messages yet</p>
              ) : (
                chatMessages.map(msg => (
                  <div key={msg.id} className={`flex ${msg.isOwn ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[88%] rounded-2xl px-3 py-2 text-sm ${msg.isOwn ? 'rounded-br-md bg-indigo-600 text-white' : 'rounded-bl-md bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100'}`}>
                      <p className={`mb-0.5 text-xs font-semibold ${msg.isOwn ? 'text-indigo-100' : 'text-indigo-600 dark:text-indigo-300'}`}>
                        {msg.isOwn ? 'You' : msg.sender}
                      </p>
                      <p className="break-words">{msg.text}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="flex-shrink-0 border-t border-slate-200 p-3 dark:border-slate-800 sm:p-4">
              {chatError && (
                <p className="mb-2 text-xs text-red-600" role="alert">{chatError}</p>
              )}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && sendChatMessage()}
                  placeholder="Type a message..."
                  disabled={isSendingChat}
                  className="flex-1 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:placeholder-slate-500"
                />
                <button
                  onClick={sendChatMessage}
                  disabled={isSendingChat || !chatInput.trim()}
                  className="p-2 bg-indigo-600 rounded-lg hover:bg-indigo-700 flex-shrink-0 disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="Send meeting message"
                >
                  <HiOutlinePaperAirplane className="w-5 h-5 text-white" />
                </button>
              </div>
            </div>
          </aside>
        )}

        {/* Participants Sidebar */}
        {showParticipants && (
          <aside className="relative z-20 flex w-full flex-shrink-0 flex-col border-l border-slate-200 bg-white shadow-lg dark:border-slate-800 dark:bg-slate-900 sm:w-80">
            <div className="flex flex-shrink-0 items-center justify-between border-b border-slate-200 p-3 dark:border-slate-800 sm:p-4">
              <h2 className="font-medium text-slate-900 dark:text-white">
                Participants ({participants.length + 1})
              </h2>
              <div className="flex items-center gap-1">
                {meeting?.isOrganizer && (
                  <button
                    type="button"
                    onClick={() => setShowAddParticipants(true)}
                    className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-500/15"
                    title="Add participants"
                  >
                    <HiOutlineUserPlus className="h-4 w-4" />
                    Add
                  </button>
                )}
                <button
                  onClick={() => setShowParticipants(false)}
                  className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-white"
                  aria-label="Close participants"
                >
                  <HiOutlineXMark className="h-5 w-5" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-2 sm:space-y-3 min-h-0">
              {/* You */}
              <div className="flex items-center gap-3 rounded-xl bg-indigo-50 p-2 dark:bg-indigo-500/15">
                <div className="w-8 h-8 bg-indigo-600 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-medium text-white">
                    {user?.firstName?.[0]?.toUpperCase()}
                  </span>
                </div>
                <span className="flex-1 truncate text-sm text-slate-800 dark:text-slate-100 sm:text-base">
                  You {meeting?.isOrganizer ? '(Host)' : ''}
                </span>
                {isMuted && (
                  <CutLineIcon isOff className="text-red-500">
                    <HiOutlineMicrophone className="h-4 w-4" />
                  </CutLineIcon>
                )}
              </div>
              {/* Other participants */}
              {participants.map(p => (
                <div key={p.id} className="flex items-center gap-3 rounded-xl p-2 hover:bg-slate-100 dark:hover:bg-white/5">
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-slate-400 dark:bg-slate-700">
                    <span className="text-sm font-medium text-white">
                      {p.userName?.[0]?.toUpperCase()}
                    </span>
                  </div>
                  <span className="flex-1 truncate text-sm text-slate-800 dark:text-slate-100 sm:text-base">{p.userName}</span>
                  {p.isMuted && (
                    <CutLineIcon isOff className="text-red-500">
                      <HiOutlineMicrophone className="h-4 w-4" />
                    </CutLineIcon>
                  )}
                </div>
              ))}
            </div>
          </aside>
        )}

        <MeetingNotetakerPanel
          isOpen={showNotetaker}
          error={notetakerError}
          transcript={liveTranscript}
          onClose={() => setShowNotetaker(false)}
        />

        <AddMeetingParticipantsModal
          isOpen={showAddParticipants}
          meeting={meeting}
          onClose={() => setShowAddParticipants(false)}
          onAdded={updatedMeeting => {
            setMeeting(current => current ? {
              ...current,
              ...updatedMeeting,
              isOrganizer: current.isOrganizer,
              myInviteStatus: current.myInviteStatus,
            } : current)
          }}
        />
      </div>

      {/* Controls */}
      <div className="relative z-40 flex h-16 flex-shrink-0 items-center justify-start gap-1 overflow-x-auto border-t border-slate-200 bg-white px-2 shadow-2xl dark:border-white/10 dark:bg-slate-900 sm:h-20 sm:justify-center sm:gap-2 sm:overflow-visible sm:px-4">
        {/* Mute */}
        <button
          onClick={toggleMute}
          className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full transition-colors sm:h-14 sm:w-14 ${isMuted ? 'bg-red-600 hover:bg-red-700' : 'bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600'
            }`}
          title={isMuted ? 'Unmute' : 'Mute'}
        >
          <CutLineIcon isOff={isMuted} className={isMuted ? 'text-white' : 'text-slate-700 dark:text-white'}>
            <HiOutlineMicrophone className="h-5 w-5 sm:h-6 sm:w-6" />
          </CutLineIcon>
        </button>

        {/* Video */}
        <button
          onClick={toggleVideo}
          className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full transition-colors sm:h-14 sm:w-14 ${isVideoOff ? 'bg-red-600 hover:bg-red-700' : 'bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600'
            }`}
          title={isVideoOff ? 'Turn on camera' : 'Turn off camera'}
        >
          <CutLineIcon isOff={isVideoOff} className={isVideoOff ? 'text-white' : 'text-slate-700 dark:text-white'}>
            <HiOutlineVideoCamera className="h-5 w-5 sm:h-6 sm:w-6" />
          </CutLineIcon>
        </button>

        {/* Screen Share - Hidden on mobile */}
        <button
          onClick={toggleScreenShare}
          className={`hidden h-14 w-14 flex-shrink-0 items-center justify-center rounded-full transition-colors sm:flex ${isScreenSharing ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600'
            }`}
          title={isScreenSharing ? 'Stop sharing' : 'Share screen'}
        >
          <HiOutlineComputerDesktop className={`h-5 w-5 sm:h-6 sm:w-6 ${isScreenSharing ? 'text-white' : 'text-slate-700 dark:text-white'}`} />
        </button>

        {/* Record - Hidden on mobile */}
        <button
          onClick={toggleRecording}
          className={`hidden h-14 w-14 flex-shrink-0 items-center justify-center rounded-full transition-colors sm:flex ${isRecording ? 'bg-red-600 hover:bg-red-700' : 'bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600'
            }`}
          title={isRecording ? 'Stop recording' : 'Start recording'}
        >
          <HiOutlineStopCircle className={`h-5 w-5 sm:h-6 sm:w-6 ${isRecording ? 'text-white' : 'text-slate-700 dark:text-white'}`} />
        </button>

        {/* Raise Hand */}
        <button
          onClick={raiseHand}
          className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full transition-colors sm:h-14 sm:w-14 ${handRaised ? 'bg-amber-600 hover:bg-amber-700' : 'bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600'
            }`}
          title={handRaised ? 'Lower hand' : 'Raise hand'}
        >
          <HiOutlineHandRaised className={`h-5 w-5 sm:h-6 sm:w-6 ${handRaised ? 'text-white' : 'text-slate-700 dark:text-white'}`} />
        </button>

        {/* Reactions */}
        <div className="relative flex-shrink-0">
          <button
            onClick={() => setShowReactions(!showReactions)}
            className={`flex h-10 w-10 items-center justify-center rounded-full transition-colors sm:h-14 sm:w-14 ${showReactions ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600'
              }`}
            title="Reactions"
          >
            <BsEmojiSmile className={`h-5 w-5 sm:h-6 sm:w-6 ${showReactions ? 'text-white' : 'text-slate-700 dark:text-white'}`} />
          </button>

          {/* Reactions Popup */}
          {showReactions && (
            <div className="absolute bottom-full left-1/2 z-50 mb-2 flex -translate-x-1/2 gap-1 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-800">
              {MEETING_REACTIONS.map(({ value, label, Icon }) => (
                <button
                  key={value}
                  onClick={() => sendReaction(value)}
                  className="rounded-lg p-2 text-indigo-600 transition-colors hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-white/10"
                  title={label}
                  aria-label={label}
                >
                  <Icon className="h-6 w-6 sm:h-7 sm:w-7" aria-hidden="true" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Mira */}
        <button
          onClick={() => {
            setShowNotetaker(!showNotetaker)
            setShowChat(false)
            setShowParticipants(false)
          }}
          className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full transition-colors sm:h-14 sm:w-14 ${showNotetaker ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600'
            }`}
          title="Mira"
        >
          <HiOutlineDocumentText className={`h-5 w-5 sm:h-6 sm:w-6 ${showNotetaker ? 'text-white' : 'text-slate-700 dark:text-white'}`} />
        </button>

        {/* Chat */}
        <button
          onClick={() => {
            setShowChat(!showChat)
            setShowNotetaker(false)
            setShowParticipants(false)
          }}
          className={`relative flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full transition-colors sm:h-14 sm:w-14 ${showChat ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600'
            }`}
          title="Chat"
        >
          <HiOutlineChatBubbleLeftRight className={`h-5 w-5 sm:h-6 sm:w-6 ${showChat ? 'text-white' : 'text-slate-700 dark:text-white'}`} />
          {unreadChatCount > 0 && !showChat && (
            <span className="absolute -right-1 -top-1 flex min-h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
              {Math.min(unreadChatCount, 99)}
            </span>
          )}
        </button>

        {/* Participants */}
        <button
          onClick={() => {
            setShowParticipants(!showParticipants)
            setShowChat(false)
            setShowNotetaker(false)
          }}
          className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full transition-colors sm:h-14 sm:w-14 ${showParticipants ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600'
            }`}
          title="Participants"
        >
          <HiOutlineUserGroup className={`h-5 w-5 sm:h-6 sm:w-6 ${showParticipants ? 'text-white' : 'text-slate-700 dark:text-white'}`} />
        </button>

        {/* Leave */}
        <button
          onClick={leaveMeeting}
          disabled={isEndingMeeting}
          className={`ml-2 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full transition-colors sm:ml-4 sm:h-14 sm:w-14 ${isEndingMeeting ? 'bg-red-400 cursor-wait' : 'bg-red-600 hover:bg-red-700'}`}
          title="Leave meeting"
        >
          <HiOutlinePhoneXMark className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
        </button>
      </div>
      <style jsx global>{`
        @keyframes meeting-reaction-rise {
          0% { opacity: 0; transform: translateY(12px) scale(.72); }
          18% { opacity: 1; transform: translateY(0) scale(1.08); }
          75% { opacity: 1; transform: translateY(-34px) scale(1); }
          100% { opacity: 0; transform: translateY(-58px) scale(.9); }
        }
        .meeting-tile-reaction {
          animation: meeting-reaction-rise 3s ease-out forwards;
        }
      `}</style>
    </div>
  )
}
