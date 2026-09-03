/** @jest-environment node */

const fs = require('fs')
const path = require('path')

describe('managed meeting implementation', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'components/meetings/ManagedMeetingRoomSession.js'), 'utf8')
  const signedInSelector = fs.readFileSync(path.join(process.cwd(), 'contexts/MeetingSessionContext.js'), 'utf8')
  const guestSelector = fs.readFileSync(path.join(process.cwd(), 'app/join/[guestLink]/room/page.js'), 'utf8')
  const legacySource = fs.readFileSync(path.join(process.cwd(), 'components/meetings/MeetingRoomSession.js'), 'utf8')
  const reactionPickerSource = fs.readFileSync(path.join(process.cwd(), 'components/meetings/MeetingReactionPicker.js'), 'utf8')

  test('uses the Vercel-compatible managed transport by default for employees and guests', () => {
    for (const selector of [signedInSelector, guestSelector]) {
      expect(selector).toContain('usesManagedMeetingTransport()')
      expect(selector).not.toContain("NEXT_PUBLIC_MEETING_TRANSPORT === 'livekit'")
    }
  })

  test('uses an SFU with adaptive streams, dynacast and simulcast', () => {
    expect(source).toContain('adaptiveStream: true')
    expect(source).toContain('dynacast: true')
    expect(source).toContain('simulcast: true')
  })

  test('uses reliable LiveKit data channels for chat and reactions', () => {
    expect(source).toContain("publishData('talio-chat'")
    expect(source).toContain("publishData('talio-reaction'")
    expect(source).toContain('reliable: true')
  })

  test('alerts users to deduplicated unread in-meeting messages', () => {
    expect(source).toContain('seenChatMessageIdsRef.current.has(messageId)')
    expect(source).toContain('showChatRef.current')
    expect(source).toContain("showChat && displayMode === 'full'")
    expect(source).toContain('setUnreadChatCount((current) => current + 1)')
    expect(source).toContain('data-meeting-chat-notification')
    expect(source).toContain('onClick={openChatPanel}')
    expect(source).toContain("unreadChatCount > 99 ? '99+' : unreadChatCount")
  })

  test('shares hand state and never uploads transcription while muted', () => {
    expect(source).toContain("publishData('talio-hand'")
    expect(source).toContain("topic === 'talio-hand'")
    expect(source).toContain('mutedRef.current || !event.data')
    expect(source).toContain("setTranscriptStatus(muted ? 'paused' : 'off')")
  })

  test('restores the persisted meeting notetaker and finalises notes on exit', () => {
    expect(source).toContain("import MeetingNotetakerPanel")
    expect(source).toContain('<MeetingNotetakerPanel')
    expect(source).toContain('/api/meetings/${meeting._id}/transcript')
    expect(source).toContain("refreshInterval: joined && !guestToken ? 5000 : 0")
    expect(source).toContain('await lastTranscriptUploadRef.current')
    expect(source).toContain('/api/meetings/${meeting._id}/summary')
    expect(source).toContain("setEndingMeetingStatus('Generating Mira meeting notes...')")
  })

  test('does not build peer-to-peer mesh connections', () => {
    expect(source).not.toContain('RTCPeerConnection')
    expect(source).not.toContain('socket.io-client')
  })

  test('renders remote audio and uses an uncropped presentation layout with a thumbnail rail', () => {
    expect(source).toContain('<RemoteAudio')
    expect(source).toContain('item.isScreenSharing')
    expect(source).toContain("item.isScreenSharing ? 'bg-black object-contain' : 'object-cover'")
    expect(source).toContain('data-meeting-layout="presentation"')
    expect(source).toContain('data-meeting-participant-rail')
    expect(source).toContain('railParticipants.map')
    expect(source).toContain('compact />')
  })

  test('keeps join failures recoverable without leaving a partial room connected', () => {
    expect(source).toContain('pendingRoom?.disconnect()')
    expect(source).toContain("role=\"alert\"")
    expect(source).toContain("joinError ? 'Try again' : previewStatus === 'loading' ? 'Preparing camera…' : 'Join meeting'")
  })

  test('shows a resilient camera preview and publishes those same tracks on join', () => {
    expect(source).toContain('data-meeting-camera-preview')
    expect(source).toContain('aria-label="Camera preview"')
    expect(source).toContain('createLocalTracks({')
    expect(source).toContain('createLocalVideoTrack({')
    expect(source).toContain('createLocalAudioTrack({')
    expect(source).toContain('liveRoom.localParticipant.publishTrack(track)')
    expect(source).toContain("previewStatus === 'unavailable'")
    expect(source).toContain('Try camera again')
    expect(source).toContain("previewStatus === 'loading'")
    expect(source).toContain("previewStatus === 'audio-only'")
    expect(source).toContain('previewAttemptRef.current += 1')
    expect(source).toContain('stopPreviewTracks()')
  })

  test('keeps compact and expanded picture-in-picture layouts collision free', () => {
    expect(source).toContain('data-meeting-pip="bubble"')
    expect(source).toContain('data-meeting-pip="compact"')
    expect(source).toContain("data-meeting-pip={isPip ? 'expanded' : undefined}")
    expect(source).toContain("onSetPipSize?.('bubble')")
    expect(source).toContain('min-h-[5.25rem]')
    expect(source).toContain('flex-col overflow-hidden rounded-3xl')
    expect(source).toContain('min-h-20 shrink-0')
    expect(source).not.toContain("isCompact ? 'absolute bottom-2 right-2")
  })

  test('renders the reaction picker above every meeting and PiP stacking context', () => {
    expect(source).toContain("import MeetingReactionPicker")
    expect(legacySource).toContain("import MeetingReactionPicker")
    expect(source).toContain('<MeetingReactionPicker')
    expect(legacySource).toContain('<MeetingReactionPicker')
    expect(reactionPickerSource).toContain('Popover')
    expect(reactionPickerSource).toContain("base: 'z-[220]'")
    expect(reactionPickerSource).toContain('data-meeting-reaction-picker')
    expect(source).toContain('bottom-10 left-1/2 z-30')
    expect(legacySource).toContain('bottom-10 z-30')
    expect(source).not.toContain('absolute bottom-14 left-1/2 z-40')
  })
})
