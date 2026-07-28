'use client'

import { useState, useEffect, useRef, useCallback, use } from 'react'
import { useRouter } from 'next/navigation'
import {
  HiOutlineMicrophone,
  HiOutlineVideoCamera,
  HiOutlinePhoneXMark,
  HiOutlineChatBubbleLeftRight,
  HiOutlineUserGroup,
  HiOutlineHandRaised,
  HiOutlineXMark,
  HiOutlinePaperAirplane,
  HiMiniMicrophone,
  HiMiniVideoCamera
} from 'react-icons/hi2'
import Loader from '@/components/ui/Loader'
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
  optimizeMeetingPeerConnections,
  prepareMeetingMediaStream,
} from '@/lib/meetingMediaQuality'
// Slash icons for muted/off states
import { HiMicrophone as HiOutlineMicrophoneSlash, HiVideoCamera as HiOutlineVideoCameraSlash } from 'react-icons/hi'
import { BsEmojiSmile } from 'react-icons/bs'
import toast from '@/utils/toast'

// Reaction emojis
const REACTIONS = [
  { emoji: '👍', label: 'Thumbs up' },
  { emoji: '👏', label: 'Clap' },
  { emoji: '❤️', label: 'Heart' },
  { emoji: '😂', label: 'Laugh' },
  { emoji: '😮', label: 'Wow' },
  { emoji: '🎉', label: 'Celebrate' },
]

export default function GuestMeetingRoom({ params }) {
  const router = useRouter()
  const { guestLink } = use(params)

  // Guest info
  const [guestInfo, setGuestInfo] = useState(null)
  const [meeting, setMeeting] = useState(null)
  const [loading, setLoading] = useState(true)
  const [isJoined, setIsJoined] = useState(false)

  // Meeting controls
  const [isMuted, setIsMuted] = useState(false)
  const [isVideoOff, setIsVideoOff] = useState(false)
  const [showChat, setShowChat] = useState(false)
  const [showParticipants, setShowParticipants] = useState(false)
  const [chatMessages, setChatMessages] = useState([])
  const [chatInput, setChatInput] = useState('')
  const [isSendingChat, setIsSendingChat] = useState(false)
  const [chatError, setChatError] = useState('')
  const [unreadChatCount, setUnreadChatCount] = useState(0)
  const [participants, setParticipants] = useState([])
  const [handRaised, setHandRaised] = useState(false)
  const [showReactions, setShowReactions] = useState(false)
  const [floatingReactions, setFloatingReactions] = useState([])
  const [previewReady, setPreviewReady] = useState(false)
  const [previewError, setPreviewError] = useState(null)
  const [connectionQuality, setConnectionQuality] = useState('good')

  // Refs
  const localVideoRef = useRef(null)
  const localStreamRef = useRef(null)
  const socketRef = useRef(null)
  const peerConnectionsRef = useRef({})
  const pendingIceCandidatesRef = useRef({})
  const remoteStreamsRef = useRef({})
  const showChatRef = useRef(false)
  const isMutedRef = useRef(false)
  const meetingSocketJoinedRef = useRef(false)
  const connectionStatsRef = useRef(new WeakMap())
  const connectionQualityRef = useRef('good')
  const connectionRecoverySamplesRef = useRef(0)
  const iceRestartingPeersRef = useRef(new Set())

  useEffect(() => {
    showChatRef.current = showChat
    if (showChat) setUnreadChatCount(0)
  }, [showChat])

  useEffect(() => {
    isMutedRef.current = isMuted
  }, [isMuted])

  useEffect(() => {
    if (!isJoined) return undefined

    let cancelled = false
    const qualityRank = { good: 0, fair: 1, poor: 2 }
    const monitorConnections = async () => {
      const measuredQuality = await optimizeMeetingPeerConnections({
        peerConnections: peerConnectionsRef.current,
        previousSamples: connectionStatsRef.current,
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
  }, [isJoined, participants.length])

  // Load guest info and validate
  useEffect(() => {
    const storedGuestInfo = sessionStorage.getItem('guestInfo')
    if (!storedGuestInfo) {
      toast.error('Please enter your name to join')
      router.push(`/join/${guestLink}`)
      return
    }

    try {
      const info = JSON.parse(storedGuestInfo)
      if (!info?.guestToken || (info.guestLink && info.guestLink !== guestLink)) {
        throw new Error('Guest session does not match this meeting')
      }
      setGuestInfo(info)
    } catch {
      sessionStorage.removeItem('guestInfo')
      toast.error('Your guest session is invalid. Please enter your name again.')
      router.replace(`/join/${guestLink}`)
      return
    }

    // Fetch meeting info
    void fetchMeetingInfo()
  }, [guestLink])

  const fetchMeetingInfo = async () => {
    try {
      const response = await fetch(`/api/meetings/guest/${guestLink}`)
      const data = await response.json()

      if (data.success) {
        setMeeting(data.data)
        startCameraPreview()
      } else {
        toast.error(data.message || 'Meeting not found')
        router.push(`/join/${guestLink}`)
      }
    } catch (error) {
      console.error('Error fetching meeting:', error)
      toast.error('Failed to load meeting')
      router.push(`/join/${guestLink}`)
    } finally {
      setLoading(false)
    }
  }

  // Start camera preview
  const startCameraPreview = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: MEETING_CAMERA_CONSTRAINTS,
        audio: MEETING_AUDIO_CONSTRAINTS,
      })

      localStreamRef.current = prepareMeetingMediaStream(stream)
      setPreviewReady(true)

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream
        localVideoRef.current.play().catch(() => { })
      }
    } catch (error) {
      console.error('Error starting camera preview:', error)
      if (error.name === 'NotAllowedError') {
        setPreviewError('Camera/microphone access denied. You can still join in listen-only mode.')
      } else {
        setPreviewError('Could not access camera. You can still join in listen-only mode.')
      }
    }
  }

  // Toggle preview controls
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

  const togglePreviewVideo = () => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0]
      if (videoTrack) {
        videoTrack.enabled = isVideoOff
        setIsVideoOff(!isVideoOff)
      }
    }
  }

  // Join meeting
  const joinMeeting = useCallback(async () => {
    if (!guestInfo || !meeting?.roomId) return

    try {
      // Use existing preview stream
      let joiningMuted = isMuted
      if (!localStreamRef.current) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: MEETING_CAMERA_CONSTRAINTS,
            audio: MEETING_AUDIO_CONSTRAINTS,
          })
          localStreamRef.current = prepareMeetingMediaStream(stream)
        } catch {
          localStreamRef.current = new MediaStream()
          joiningMuted = true
          isMutedRef.current = true
          setIsMuted(true)
          setIsVideoOff(true)
          toast('Joining in listen-only mode', { icon: '🎧' })
        }
      }

      // Connect to socket
      const { io } = await import('socket.io-client')
      socketRef.current = io({
        path: '/api/socketio',
        transports: ['websocket', 'polling'],
        auth: { token: guestInfo.guestToken },
        autoConnect: false,
      })

      socketRef.current.on('disconnect', () => {
        if (meetingSocketJoinedRef.current) {
          setChatError('Meeting connection lost. Reconnecting…')
        }
      })

      socketRef.current.on('connect', () => {
        if (!meetingSocketJoinedRef.current) return
        socketRef.current.emit('join-meeting', {
          roomId: meeting.roomId,
          userName: `${guestInfo.guestName} (Guest)`,
          isMuted: isMutedRef.current,
        }, (response) => {
          if (response?.success) {
            setChatError('')
            toast.success('Reconnected to meeting')
          } else {
            setChatError(response?.message || 'Could not reconnect to meeting')
          }
        })
      })

      // Handle existing participants
      socketRef.current.on('existing-participants', async (existingUsers) => {
        console.log('Existing participants:', existingUsers)
        for (const userData of existingUsers) {
          setParticipants(prev => [...prev.filter(p => p.id !== userData.id), userData])
          await createPeerConnectionAndOffer(userData.id, userData.userName)
        }
      })

      // Handle new participants
      socketRef.current.on('user-joined', (userData) => {
        console.log('User joined:', userData)
        setParticipants(prev => [...prev.filter(p => p.id !== userData.id), userData])
        createPeerConnection(userData.id, userData.userName)
      })

      socketRef.current.on('user-left', (userData) => {
        console.log('User left:', userData)
        setParticipants(prev => prev.filter(p => p.id !== userData.id))
        clearQueuedIceCandidates(pendingIceCandidatesRef, userData.id)
        if (remoteStreamsRef.current[userData.id]) {
          delete remoteStreamsRef.current[userData.id]
        }
        if (peerConnectionsRef.current[userData.id]) {
          peerConnectionsRef.current[userData.id].close()
          delete peerConnectionsRef.current[userData.id]
        }
      })

      socketRef.current.on('meeting-chat', (message) => {
        const normalizedMessage = {
          ...message,
          isOwn: message.senderSocketId === socketRef.current?.id,
        }
        setChatMessages(prev => (
          prev.some(existing => existing.id === normalizedMessage.id)
            ? prev
            : [...prev, normalizedMessage]
        ))
        setChatError('')
        if (!showChatRef.current && !normalizedMessage.isOwn) {
          setUnreadChatCount(count => count + 1)
          toast(`${message.userName || 'Participant'}: ${message.message}`, {
            icon: '💬',
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
        toast(`${userData.userName} raised their hand`, { icon: '✋' })
      })

      socketRef.current.on('meeting-reaction', (data) => {
        showFloatingReaction({
          ...(typeof data.reaction === 'object' ? data.reaction : { emoji: data.reaction }),
          sender: data.userName || data.reaction?.sender || 'Participant',
        }, data.id)
      })

      // WebRTC Signaling
      socketRef.current.on('offer', async ({ from, offer }) => {
        let pc = peerConnectionsRef.current[from]
        if (!pc) {
          pc = createPeerConnection(from, 'Participant')
          setParticipants(prev => {
            if (!prev.find(p => p.id === from)) {
              return [...prev, { id: from, userName: 'Participant' }]
            }
            return prev
          })
        }
        await pc.setRemoteDescription(new RTCSessionDescription(offer))
        await flushQueuedIceCandidates(peerConnectionsRef, pendingIceCandidatesRef, from)
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        socketRef.current.emit('answer', { to: from, answer })
      })

      socketRef.current.on('answer', async ({ from, answer }) => {
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
          console.log('Guest connected to meeting socket')
          socket.emit('join-meeting', {
            roomId: meeting.roomId,
            userName: `${guestInfo.guestName} (Guest)`,
            isMuted: joiningMuted,
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
      setIsJoined(true)
      toast.success('Joined meeting as guest')
    } catch (error) {
      console.error('Error joining meeting:', error)
      socketRef.current?.disconnect()
      socketRef.current = null
      meetingSocketJoinedRef.current = false
      toast.error(error.message || 'Failed to join meeting')
    }
  }, [meeting, guestInfo, isMuted])

  // Create peer connection
  const createPeerConnection = (peerId, peerName, shouldOffer = false) => {
    if (peerConnectionsRef.current[peerId]) {
      return peerConnectionsRef.current[peerId]
    }

    const pc = new RTCPeerConnection(createMeetingRtcConfiguration())

    peerConnectionsRef.current[peerId] = pc

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current)
      })
      void applyMeetingSenderQuality(pc, {
        quality: connectionQualityRef.current,
        peerCount: Object.keys(peerConnectionsRef.current).length,
      })
    }

    pc.ontrack = (event) => {
      const incomingTrack = event.track
      const incomingStream = event.streams?.[0]

      if (incomingStream) {
        remoteStreamsRef.current[peerId] = incomingStream
      } else {
        if (!remoteStreamsRef.current[peerId]) {
          remoteStreamsRef.current[peerId] = new MediaStream()
        }

        const syntheticStream = remoteStreamsRef.current[peerId]
        const alreadyExists = syntheticStream.getTracks().some(track => track.id === incomingTrack.id)
        if (!alreadyExists) {
          syntheticStream.addTrack(incomingTrack)
        }
      }

      const mediaStream = remoteStreamsRef.current[peerId]

      setParticipants(prev => {
        const nextParticipant = { id: peerId, userName: peerName || 'Participant', stream: mediaStream }
        const existingParticipant = prev.find(participant => participant.id === peerId)

        if (existingParticipant) {
          return prev.map(participant => participant.id === peerId
            ? { ...participant, ...nextParticipant }
            : participant
          )
        }

        return [...prev, nextParticipant]
      })
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current?.emit('ice-candidate', {
          to: peerId,
          candidate: event.candidate
        })
      }
    }

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        iceRestartingPeersRef.current.delete(peerId)
        void applyMeetingSenderQuality(pc, {
          quality: connectionQualityRef.current,
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

  const createPeerConnectionAndOffer = async (peerId, peerName) => {
    const pc = createPeerConnection(peerId, peerName, true)

    try {
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      socketRef.current?.emit('offer', { to: peerId, offer })
    } catch (err) {
      console.error('Error creating offer:', err)
    }

    return pc
  }

  // Toggle controls
  const toggleMute = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0]
      if (audioTrack) {
        const nextMuted = !isMuted
        audioTrack.enabled = !nextMuted
        isMutedRef.current = nextMuted
        setIsMuted(nextMuted)
        socketRef.current?.emit('meeting-mute-state', {
          roomId: meeting?.roomId,
          isMuted: nextMuted,
        })
      }
    }
  }

  const toggleVideo = () => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0]
      if (videoTrack) {
        videoTrack.enabled = isVideoOff
        setIsVideoOff(!isVideoOff)
      }
    }
  }

  const toggleHandRaise = () => {
    if (!handRaised && socketRef.current) {
      socketRef.current.emit('raise-hand', { roomId: meeting?.roomId })
    }
    setHandRaised(!handRaised)
  }

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
    socket.timeout(5000).emit('meeting-chat', {
      roomId: meeting?.roomId,
      message,
    }, (error, response) => {
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

  const sendReaction = (emoji) => {
    if (socketRef.current) {
      socketRef.current.emit('meeting-reaction', {
        roomId: meeting?.roomId,
        reaction: emoji
      })
      showFloatingReaction({
        emoji,
        sender: `${guestInfo?.guestName || 'You'} (Guest)`,
      }, 'local')
    }
    setShowReactions(false)
  }

  const showFloatingReaction = (reaction, participantId) => {
    const id = Date.now() + Math.random()
    setFloatingReactions(prev => [...prev, { ...reaction, id, participantId }])
    setTimeout(() => {
      setFloatingReactions(prev => prev.filter(r => r.id !== id))
    }, 3000)
  }

  // Leave meeting
  const leaveMeeting = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop())
    }
    Object.values(peerConnectionsRef.current).forEach(pc => pc.close())
    pendingIceCandidatesRef.current = {}
    remoteStreamsRef.current = {}
    if (socketRef.current) {
      meetingSocketJoinedRef.current = false
      socketRef.current.emit('leave-meeting', { roomId: meeting?.roomId })
      socketRef.current.disconnect()
    }
    sessionStorage.removeItem('guestInfo')
    router.push(`/join/${guestLink}`)
  }

  // Cleanup
  useEffect(() => {
    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop())
      }
      Object.values(peerConnectionsRef.current).forEach(pc => pc.close())
      pendingIceCandidatesRef.current = {}
      remoteStreamsRef.current = {}
      if (socketRef.current) {
        meetingSocketJoinedRef.current = false
        socketRef.current.disconnect()
      }
    }
  }, [])

  if (loading) {
    return (
      <div className="h-screen w-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <Loader size="lg" className="mb-4" />
          <p className="text-white">Loading meeting...</p>
        </div>
      </div>
    )
  }

  // Pre-join screen
  if (!isJoined) {
    return (
      <div className="h-screen w-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="max-w-lg w-full bg-white rounded-2xl p-6 text-center shadow-xl border border-gray-200">
          <div className="w-16 h-16 bg-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <HiOutlineVideoCamera className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-800 mb-2">
            {meeting?.title || 'Meeting Room'}
          </h1>
          <p className="text-gray-500 mb-4">
            Joining as: <span className="font-medium text-indigo-600">{guestInfo?.guestName} (Guest)</span>
          </p>

          {/* Camera Preview */}
          <div className="relative bg-gray-900 rounded-xl aspect-video mb-4 overflow-hidden">
            {previewReady && !isVideoOff ? (
              <video
                ref={localVideoRef}
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
                    {guestInfo?.guestName?.[0]?.toUpperCase() || 'G'}
                  </span>
                </div>
                <p className="text-gray-400 text-sm">Camera off</p>
              </div>
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center z-0">
                <Loader size="md" className="mb-3" />
                <p className="text-gray-400 text-sm">Starting camera...</p>
              </div>
            )}

            {/* Preview Controls */}
            {previewReady && (
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-2 z-20">
                <button
                  onClick={togglePreviewMute}
                  className={`p-3 rounded-full transition-colors ${isMuted ? 'bg-red-500 text-white' : 'bg-gray-800/80 text-white'
                    }`}
                >
                  {isMuted ? <HiOutlineMicrophoneSlash className="w-5 h-5" /> : <HiMiniMicrophone className="w-5 h-5" />}
                </button>
                <button
                  onClick={togglePreviewVideo}
                  className={`p-3 rounded-full transition-colors ${isVideoOff ? 'bg-red-500 text-white' : 'bg-gray-800/80 text-white'
                    }`}
                >
                  {isVideoOff ? <HiOutlineVideoCameraSlash className="w-5 h-5" /> : <HiMiniVideoCamera className="w-5 h-5" />}
                </button>
              </div>
            )}
          </div>

          <button
            onClick={joinMeeting}
            disabled={!previewReady && !previewError}
            className={`w-full py-3 font-medium rounded-xl transition-colors ${previewReady || previewError
                ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              }`}
          >
            Join Meeting
          </button>

          <button
            onClick={() => {
              if (localStreamRef.current) {
                localStreamRef.current.getTracks().forEach(track => track.stop())
              }
              sessionStorage.removeItem('guestInfo')
              router.push(`/join/${guestLink}`)
            }}
            className="w-full py-3 text-gray-500 hover:text-gray-700 mt-3"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  // Meeting room UI
  return (
    <div className="h-screen w-screen bg-gray-900 flex flex-col overflow-hidden">
      <div className="pointer-events-none fixed right-3 top-3 z-30 rounded-full bg-black/60 px-3 py-1.5 text-xs font-medium text-white backdrop-blur">
        <span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${
          connectionQuality === 'good' ? 'bg-emerald-400' : connectionQuality === 'fair' ? 'bg-amber-400' : 'bg-red-400'
        }`} />
        {connectionQuality === 'good' ? 'Good connection' : connectionQuality === 'fair' ? 'Adapting quality' : 'Low network'}
      </div>
      {/* Video Grid */}
      <div className="flex-1 p-4 overflow-auto">
        <div className={`grid gap-4 h-full ${participants.length === 0 ? 'grid-cols-1' :
            participants.length === 1 ? 'grid-cols-1 sm:grid-cols-2' :
              participants.length <= 3 ? 'grid-cols-2' :
                'grid-cols-2 sm:grid-cols-3'
          }`}>
          {/* Local Video */}
          <div className="relative bg-gray-800 rounded-xl overflow-hidden aspect-video">
            <video
              ref={(el) => {
                if (el && localStreamRef.current) {
                  el.srcObject = localStreamRef.current
                  el.play().catch(() => { })
                }
              }}
              autoPlay
              playsInline
              muted
              className={`w-full h-full object-cover -scale-x-100 ${isVideoOff ? 'hidden' : ''}`}
            />
            {isVideoOff && (
              <div className="absolute inset-0 flex items-center justify-center bg-gray-800">
                <div className="w-16 h-16 bg-indigo-600 rounded-full flex items-center justify-center">
                  <span className="text-2xl font-bold text-white">
                    {guestInfo?.guestName?.[0]?.toUpperCase() || 'G'}
                  </span>
                </div>
              </div>
            )}
            <div className="absolute bottom-2 left-2 px-2 py-1 bg-black/50 rounded text-white text-xs">
              You (Guest) {isMuted && '🔇'} {handRaised && '✋'}
            </div>
            <div className="pointer-events-none absolute inset-x-0 bottom-10 z-20 flex flex-col items-center">
              {floatingReactions.filter(reaction => reaction.participantId === 'local').map(reaction => (
                <div key={reaction.id} className="meeting-tile-reaction flex flex-col items-center">
                  <span className="text-5xl drop-shadow-lg">{reaction.emoji}</span>
                  <span className="rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-medium text-white">{reaction.sender}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Remote Videos */}
          {participants.map(participant => (
            <div key={participant.id} className="relative bg-gray-800 rounded-xl overflow-hidden aspect-video">
              {participant.stream ? (
                <>
                  <video
                    autoPlay
                    playsInline
                    ref={el => {
                      if (el && participant.stream && el.srcObject !== participant.stream) {
                        el.srcObject = participant.stream
                        el.play().catch(() => { })
                      }
                  }}
                  className="w-full h-full object-cover"
                />
                </>
              ) : (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-16 h-16 bg-indigo-600 rounded-full flex items-center justify-center">
                    <span className="text-2xl font-bold text-white">
                      {participant.userName?.[0]?.toUpperCase() || '?'}
                    </span>
                  </div>
                </div>
              )}
              <div className="absolute bottom-2 left-2 px-2 py-1 bg-black/50 rounded text-white text-xs">
                {participant.userName || 'Participant'} {participant.isMuted && '🔇'}
              </div>
              <div className="pointer-events-none absolute inset-x-0 bottom-10 z-20 flex flex-col items-center">
                {floatingReactions.filter(reaction => reaction.participantId === participant.id).map(reaction => (
                  <div key={reaction.id} className="meeting-tile-reaction flex flex-col items-center">
                    <span className="text-5xl drop-shadow-lg">{reaction.emoji}</span>
                    <span className="max-w-[12rem] truncate rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-medium text-white">{reaction.sender}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Controls */}
      <div className="bg-gray-800 p-4">
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={toggleMute}
            className={`p-4 rounded-full transition-colors ${isMuted ? 'bg-red-500 hover:bg-red-600' : 'bg-gray-700 hover:bg-gray-600'
              }`}
          >
            {isMuted ? (
              <HiOutlineMicrophoneSlash className="w-6 h-6 text-white" />
            ) : (
              <HiMiniMicrophone className="w-6 h-6 text-white" />
            )}
          </button>

          <button
            onClick={toggleVideo}
            className={`p-4 rounded-full transition-colors ${isVideoOff ? 'bg-red-500 hover:bg-red-600' : 'bg-gray-700 hover:bg-gray-600'
              }`}
          >
            {isVideoOff ? (
              <HiOutlineVideoCameraSlash className="w-6 h-6 text-white" />
            ) : (
              <HiMiniVideoCamera className="w-6 h-6 text-white" />
            )}
          </button>

          <button
            onClick={toggleHandRaise}
            className={`p-4 rounded-full transition-colors ${handRaised ? 'bg-yellow-500 hover:bg-yellow-600' : 'bg-gray-700 hover:bg-gray-600'
              }`}
          >
            <HiOutlineHandRaised className="w-6 h-6 text-white" />
          </button>

          <div className="relative">
            <button
              onClick={() => setShowReactions(!showReactions)}
              className="p-4 rounded-full bg-gray-700 hover:bg-gray-600 transition-colors"
            >
              <BsEmojiSmile className="w-6 h-6 text-white" />
            </button>
            {showReactions && (
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-white rounded-xl shadow-lg p-2 flex gap-1">
                {REACTIONS.map(({ emoji, label }) => (
                  <button
                    key={emoji}
                    onClick={() => sendReaction(emoji)}
                    className="p-2 hover:bg-gray-100 rounded-lg transition-colors text-xl"
                    title={label}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={() => setShowChat(!showChat)}
            className={`relative p-4 rounded-full transition-colors ${showChat ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-gray-700 hover:bg-gray-600'
              }`}
          >
            <HiOutlineChatBubbleLeftRight className="w-6 h-6 text-white" />
            {unreadChatCount > 0 && !showChat && (
              <span className="absolute -right-1 -top-1 flex min-h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                {Math.min(unreadChatCount, 99)}
              </span>
            )}
          </button>

          <button
            onClick={() => setShowParticipants(!showParticipants)}
            className={`p-4 rounded-full transition-colors ${showParticipants ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-gray-700 hover:bg-gray-600'
              }`}
          >
            <HiOutlineUserGroup className="w-6 h-6 text-white" />
          </button>

          <button
            onClick={leaveMeeting}
            className="p-4 rounded-full bg-red-500 hover:bg-red-600 transition-colors"
          >
            <HiOutlinePhoneXMark className="w-6 h-6 text-white" />
          </button>
        </div>
      </div>

      {/* Chat Panel */}
      {showChat && (
        <div className="fixed right-0 top-0 bottom-0 w-80 bg-white shadow-xl z-40 flex flex-col">
          <div className="p-4 border-b flex items-center justify-between">
            <h3 className="font-semibold">Chat</h3>
            <button onClick={() => setShowChat(false)}>
              <HiOutlineXMark className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-1 overflow-auto p-4 space-y-3">
            {chatMessages.map(msg => (
              <div key={msg.id} className={`flex ${msg.isOwn ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[88%] rounded-2xl px-3 py-2 text-sm ${msg.isOwn ? 'rounded-br-md bg-indigo-600 text-white' : 'rounded-bl-md bg-gray-100 text-gray-800'}`}>
                  <p className={`mb-0.5 text-xs font-semibold ${msg.isOwn ? 'text-indigo-100' : 'text-indigo-600'}`}>
                    {msg.isOwn ? 'You' : (msg.userName || 'Participant')}
                  </p>
                  <p className="break-words">{msg.message}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="border-t p-4">
            {chatError && <p className="mb-2 text-xs text-red-600" role="alert">{chatError}</p>}
            <div className="flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendChatMessage()}
                placeholder="Type a message..."
                disabled={isSendingChat}
                className="flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button
                onClick={sendChatMessage}
                disabled={isSendingChat || !chatInput.trim()}
                className="p-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Send meeting message"
              >
                <HiOutlinePaperAirplane className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Participants Panel */}
      {showParticipants && (
        <div className="fixed right-0 top-0 bottom-0 w-80 bg-white shadow-xl z-40 flex flex-col">
          <div className="p-4 border-b flex items-center justify-between">
            <h3 className="font-semibold">Participants ({participants.length + 1})</h3>
            <button onClick={() => setShowParticipants(false)}>
              <HiOutlineXMark className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-1 overflow-auto p-4 space-y-2">
            <div className="flex items-center gap-3 p-2 rounded-lg bg-indigo-50">
              <div className="w-8 h-8 bg-indigo-600 rounded-full flex items-center justify-center">
                <span className="text-white text-sm font-medium">
                  {guestInfo?.guestName?.[0]?.toUpperCase() || 'G'}
                </span>
              </div>
              <span className="text-sm flex-1">{guestInfo?.guestName} (You - Guest)</span>
              {isMuted && <HiOutlineMicrophoneSlash className="h-4 w-4 text-red-500" aria-label="Muted" />}
            </div>
            {participants.map(p => (
              <div key={p.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50">
                <div className="w-8 h-8 bg-gray-400 rounded-full flex items-center justify-center">
                  <span className="text-white text-sm font-medium">
                    {p.userName?.[0]?.toUpperCase() || '?'}
                  </span>
                </div>
                <span className="text-sm flex-1">{p.userName}</span>
                {p.isMuted && <HiOutlineMicrophoneSlash className="h-4 w-4 text-red-500" aria-label="Muted" />}
              </div>
            ))}
          </div>
        </div>
      )}
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
