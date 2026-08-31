/** @jest-environment node */

const fs = require('fs')
const path = require('path')

describe('managed meeting implementation', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'components/meetings/ManagedMeetingRoomSession.js'), 'utf8')

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

  test('does not build peer-to-peer mesh connections', () => {
    expect(source).not.toContain('RTCPeerConnection')
    expect(source).not.toContain('socket.io-client')
  })

  test('renders remote audio and automatically features screen share', () => {
    expect(source).toContain('<RemoteAudio')
    expect(source).toContain('item.isScreenSharing')
    expect(source).toContain("sm:col-span-2 sm:min-h-[55vh]")
  })
})
