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
  const [participants, setParticipants] = useState([])
  const [handRaised, setHandRaised] = useState(false)
  const [showReactions, setShowReactions] = useState(false)
  const [floatingReactions, setFloatingReactions] = useState([])
  const [previewReady, setPreviewReady] = useState(false)
  const [previewError, setPreviewError] = useState(null)
  
  // Refs
  const localVideoRef = useRef(null)
  const localStreamRef = useRef(null)
  const socketRef = useRef(null)
  const peerConnectionsRef = useRef({})

  // Load guest info and validate
  useEffect(() => {
    const storedGuestInfo = sessionStorage.getItem('guestInfo')
    if (!storedGuestInfo) {
      toast.error('Please enter your name to join')
      router.push(`/join/${guestLink}`)
      return
    }

    const info = JSON.parse(storedGuestInfo)
    setGuestInfo(info)
    
    // Fetch meeting info
    fetchMeetingInfo()
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
        video: true,
        audio: true
      })
      
      localStreamRef.current = stream
      setPreviewReady(true)
      
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream
        localVideoRef.current.play().catch(() => {})
      }
    } catch (error) {
      console.error('Error starting camera preview:', error)
      if (error.name === 'NotAllowedError') {
        setPreviewError('Camera/microphone access denied')
      } else {
        setPreviewError('Could not access camera')
      }
    }
  }

  // Toggle preview controls
  const togglePreviewMute = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0]
      if (audioTrack) {
        audioTrack.enabled = isMuted
        setIsMuted(!isMuted)
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
      if (!localStreamRef.current) {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true
        })
        localStreamRef.current = stream
      }

      // Connect to socket
      const { io } = await import('socket.io-client')
      socketRef.current = io({
        path: '/api/socketio',
        transports: ['websocket', 'polling']
      })

      socketRef.current.on('connect', () => {
        console.log('Guest connected to meeting socket')
        socketRef.current.emit('join-meeting', {
          roomId: meeting.roomId,
          userId: `guest_${guestInfo.guestToken}`,
          userName: `${guestInfo.guestName} (Guest)`
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
        if (peerConnectionsRef.current[userData.id]) {
          peerConnectionsRef.current[userData.id].close()
          delete peerConnectionsRef.current[userData.id]
        }
      })

      socketRef.current.on('meeting-chat', (message) => {
        setChatMessages(prev => [...prev, message])
      })

      socketRef.current.on('hand-raised', (userData) => {
        toast(`${userData.userName} raised their hand`, { icon: '✋' })
      })

      socketRef.current.on('meeting-reaction', (data) => {
        showFloatingReaction(data.reaction)
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
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        socketRef.current.emit('answer', { to: from, answer })
      })

      socketRef.current.on('answer', async ({ from, answer }) => {
        const pc = peerConnectionsRef.current[from]
        if (pc) {
          await pc.setRemoteDescription(new RTCSessionDescription(answer))
        }
      })

      socketRef.current.on('ice-candidate', async ({ from, candidate }) => {
        const pc = peerConnectionsRef.current[from]
        if (pc && candidate) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate))
          } catch (err) {
            console.error('Error adding ICE candidate:', err)
          }
        }
      })

      setIsJoined(true)
      toast.success('Joined meeting as guest')
    } catch (error) {
      console.error('Error joining meeting:', error)
      toast.error('Failed to join meeting')
    }
  }, [meeting, guestInfo])

  // Create peer connection
  const createPeerConnection = (peerId, peerName) => {
    if (peerConnectionsRef.current[peerId]) {
      return peerConnectionsRef.current[peerId]
    }

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    })

    peerConnectionsRef.current[peerId] = pc

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current)
      })
    }

    pc.ontrack = (event) => {
      setParticipants(prev => prev.map(p => 
        p.id === peerId ? { ...p, stream: event.streams[0] } : p
      ))
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current?.emit('ice-candidate', {
          to: peerId,
          candidate: event.candidate
        })
      }
    }

    return pc
  }

  const createPeerConnectionAndOffer = async (peerId, peerName) => {
    const pc = createPeerConnection(peerId, peerName)
    
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
        audioTrack.enabled = isMuted
        setIsMuted(!isMuted)
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
    if (!chatInput.trim() || !socketRef.current) return

    socketRef.current.emit('meeting-chat', {
      roomId: meeting?.roomId,
      message: chatInput.trim(),
      userName: `${guestInfo?.guestName} (Guest)`,
      timestamp: new Date().toISOString()
    })

    setChatInput('')
  }

  const sendReaction = (emoji) => {
    if (socketRef.current) {
      socketRef.current.emit('meeting-reaction', {
        roomId: meeting?.roomId,
        reaction: emoji
      })
      showFloatingReaction(emoji)
    }
    setShowReactions(false)
  }

  const showFloatingReaction = (emoji) => {
    const id = Date.now()
    setFloatingReactions(prev => [...prev, { id, emoji }])
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
    if (socketRef.current) {
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
      if (socketRef.current) {
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
                  className={`p-3 rounded-full transition-colors ${
                    isMuted ? 'bg-red-500 text-white' : 'bg-gray-800/80 text-white'
                  }`}
                >
                  {isMuted ? <HiOutlineMicrophoneSlash className="w-5 h-5" /> : <HiMiniMicrophone className="w-5 h-5" />}
                </button>
                <button
                  onClick={togglePreviewVideo}
                  className={`p-3 rounded-full transition-colors ${
                    isVideoOff ? 'bg-red-500 text-white' : 'bg-gray-800/80 text-white'
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
            className={`w-full py-3 font-medium rounded-xl transition-colors ${
              previewReady || previewError
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
      {/* Floating Reactions */}
      <div className="fixed bottom-32 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
        {floatingReactions.map(({ id, emoji }) => (
          <div
            key={id}
            className="absolute animate-bounce text-4xl"
            style={{
              left: `${Math.random() * 100 - 50}px`,
              animation: 'float-up 3s ease-out forwards'
            }}
          >
            {emoji}
          </div>
        ))}
      </div>

      {/* Video Grid */}
      <div className="flex-1 p-4 overflow-auto">
        <div className={`grid gap-4 h-full ${
          participants.length === 0 ? 'grid-cols-1' :
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
                  el.play().catch(() => {})
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
          </div>

          {/* Remote Videos */}
          {participants.map(participant => (
            <div key={participant.id} className="relative bg-gray-800 rounded-xl overflow-hidden aspect-video">
              {participant.stream ? (
                <video
                  autoPlay
                  playsInline
                  ref={el => {
                    if (el && participant.stream) {
                      el.srcObject = participant.stream
                      el.play().catch(() => {})
                    }
                  }}
                  className="w-full h-full object-cover"
                />
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
                {participant.userName || 'Participant'}
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
            className={`p-4 rounded-full transition-colors ${
              isMuted ? 'bg-red-500 hover:bg-red-600' : 'bg-gray-700 hover:bg-gray-600'
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
            className={`p-4 rounded-full transition-colors ${
              isVideoOff ? 'bg-red-500 hover:bg-red-600' : 'bg-gray-700 hover:bg-gray-600'
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
            className={`p-4 rounded-full transition-colors ${
              handRaised ? 'bg-yellow-500 hover:bg-yellow-600' : 'bg-gray-700 hover:bg-gray-600'
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
            className={`p-4 rounded-full transition-colors ${
              showChat ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-gray-700 hover:bg-gray-600'
            }`}
          >
            <HiOutlineChatBubbleLeftRight className="w-6 h-6 text-white" />
          </button>

          <button
            onClick={() => setShowParticipants(!showParticipants)}
            className={`p-4 rounded-full transition-colors ${
              showParticipants ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-gray-700 hover:bg-gray-600'
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
            {chatMessages.map((msg, i) => (
              <div key={i} className="text-sm">
                <span className="font-medium text-indigo-600">{msg.userName}: </span>
                <span className="text-gray-700">{msg.message}</span>
              </div>
            ))}
          </div>
          <div className="p-4 border-t flex gap-2">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && sendChatMessage()}
              placeholder="Type a message..."
              className="flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button
              onClick={sendChatMessage}
              className="p-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
            >
              <HiOutlinePaperAirplane className="w-5 h-5" />
            </button>
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
              <span className="text-sm">{guestInfo?.guestName} (You - Guest)</span>
            </div>
            {participants.map(p => (
              <div key={p.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50">
                <div className="w-8 h-8 bg-gray-400 rounded-full flex items-center justify-center">
                  <span className="text-white text-sm font-medium">
                    {p.userName?.[0]?.toUpperCase() || '?'}
                  </span>
                </div>
                <span className="text-sm">{p.userName}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <style jsx>{`
        @keyframes float-up {
          0% {
            opacity: 1;
            transform: translateY(0);
          }
          100% {
            opacity: 0;
            transform: translateY(-100px);
          }
        }
      `}</style>
    </div>
  )
}
