/** @jest-environment node */

const fs = require('fs')
const path = require('path')

describe('managed meeting implementation', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'components/meetings/ManagedMeetingRoomSession.js'), 'utf8')
  const signedInSelector = fs.readFileSync(path.join(process.cwd(), 'contexts/MeetingSessionContext.js'), 'utf8')
  const guestSelector = fs.readFileSync(path.join(process.cwd(), 'app/join/[guestLink]/room/page.js'), 'utf8')

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

  test('renders remote audio and automatically features screen share', () => {
    expect(source).toContain('<RemoteAudio')
    expect(source).toContain('item.isScreenSharing')
    expect(source).toContain("sm:col-span-2 sm:min-h-[55vh]")
  })

  test('keeps join failures recoverable without leaving a partial room connected', () => {
    expect(source).toContain('pendingRoom?.disconnect()')
    expect(source).toContain("role=\"alert\"")
    expect(source).toContain("joinError ? 'Try again' : 'Join meeting'")
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
})
